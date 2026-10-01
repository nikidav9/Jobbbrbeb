/**
 * Замер Юпитера: сколько откликов на сайтах компаний он отправил сам.
 *
 * Считается по jm_jupiter_applications — одна строка на свайп вправо по
 * карьерной вакансии. Колонок людей (user_id, резюме, квитанции) здесь нет
 * намеренно: раздел отвечает «как работает Юпитер по сайтам», а не «кто
 * откликался». Поэтому и `JUPITER_COLUMNS` — единственный список того, что
 * панель вообще просит у базы.
 *
 * Модуль без импортов: его проверяет tests/jupiter_stats.test.ts обычным
 * node, без сборки панели.
 */

// engine — колонка заявки (миграция 136): 'http' или 'browser'. checkpoint
// не просим вовсе: в нём лежат токены возобновления.
export const JUPITER_COLUMNS = 'id,state,reason_code,canonical_url,vacancy_url,company,created_at,submitted_at,verified_at,engine'

export type JupiterRow = {
  id?: string
  /** Движок заявки: 'http' (по умолчанию) | 'browser' (переведена эскалацией). */
  engine?: string | null
  state: string
  reason_code: string | null
  canonical_url: string | null
  vacancy_url: string | null
  company: string | null
  created_at: string
  submitted_at: string | null
  verified_at: string | null
}

/**
 * Куда относится заявка в отчёте.
 *
 * auto      — Юпитер отправил сам;
 * manual    — человек отправил сам из «Ждут вас» (MANUAL_WEBVIEW) — это не
 *             заслуга Юпитера, и считать её автоотправкой значит врать;
 * parked    — сайт ещё не включён для автоотклика (SITE_NOT_VERIFIED);
 * human     — Юпитер дошёл до места, где нужен человек (капча, вопрос без
 *             ответа в профиле, согласие);
 * working   — в очереди или в работе;
 * failed    — не отправлено или исход неизвестен;
 * duplicate — повтор уже поданного отклика.
 */
export type Bucket = 'auto' | 'manual' | 'parked' | 'human' | 'working' | 'failed' | 'duplicate'

export const BUCKET_LABEL: Record<Bucket, string> = {
  auto: 'Отправил Юпитер',
  manual: 'Отправили сами',
  parked: 'Сайт ещё подключаем',
  human: 'Ждут человека',
  working: 'В очереди и в работе',
  failed: 'Ошибки и неизвестный исход',
  duplicate: 'Повторы',
}

const WORKING = new Set([
  'queued', 'opening_site', 'finding_vacancy', 'opening_application', 'filling',
  'validating', 'ready_to_submit', 'submitting', 'verifying', 'retryable_failed',
])

export function bucketOf(r: Pick<JupiterRow, 'state' | 'reason_code'>): Bucket {
  if (r.state === 'submitted') return r.reason_code === 'MANUAL_WEBVIEW' ? 'manual' : 'auto'
  if (r.state === 'action_required') return r.reason_code === 'SITE_NOT_VERIFIED' ? 'parked' : 'human'
  if (r.state === 'duplicate') return 'duplicate'
  if (WORKING.has(r.state)) return 'working'
  return 'failed'
}

/** Сайт заявки: хост без www. Так же сайты различает site_compat Юпитера. */
export function siteOf(r: Pick<JupiterRow, 'canonical_url' | 'vacancy_url'>): string {
  const raw = r.canonical_url || r.vacancy_url || ''
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '') || '—'
  } catch {
    return '—'
  }
}

export type SiteStat = {
  site: string
  company: string
  total: number
  auto: number
  verified: number
  human: number
  parked: number
  failed: number
  /** Самая частая причина остановки (не для отправленных). */
  topReason: string | null
  topReasonCount: number
}

export type Totals = Record<Bucket, number> & { total: number; verified: number }

export type DayStat = { day: string; auto: number; manual: number; parked: number; human: number; other: number }

export type JupiterReport = {
  totals: Totals
  sites: SiteStat[]
  days: DayStat[]
}

/** Дата в Москве: день отклика считаем по времени пользователей, а не UTC. */
function moscowDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 10)
}

/** Последние `days` календарных дней по Москве, старые первыми. */
export function lastDays(days: number, now: Date = new Date()): string[] {
  const today = moscowDay(now.toISOString())
  const base = Date.parse(today + 'T00:00:00Z')
  return Array.from({ length: days }, (_, i) =>
    new Date(base - (days - 1 - i) * 86400_000).toISOString().slice(0, 10))
}

/**
 * Отчёт за последние `days` дней по дате отклика (created_at).
 * `days = 0` — за всё время; график тогда рисуется за 30 дней.
 */
export function buildReport(rows: JupiterRow[], days: number, now: Date = new Date()): JupiterReport {
  const axis = lastDays(days || 30, now)
  const from = days ? axis[0] : ''
  const picked = rows.filter(r => !from || moscowDay(r.created_at) >= from)

  const totals: Totals = {
    total: 0, verified: 0,
    auto: 0, manual: 0, parked: 0, human: 0, working: 0, failed: 0, duplicate: 0,
  }
  const bySite = new Map<string, SiteStat & { reasons: Map<string, number>; companies: Map<string, number> }>()
  const byDay = new Map<string, DayStat>(axis.map(d => [d, { day: d, auto: 0, manual: 0, parked: 0, human: 0, other: 0 }]))

  for (const r of picked) {
    const b = bucketOf(r)
    totals.total++
    totals[b]++
    if (b === 'auto' && r.verified_at) totals.verified++

    const site = siteOf(r)
    let s = bySite.get(site)
    if (!s) {
      s = {
        site, company: '', total: 0, auto: 0, verified: 0, human: 0, parked: 0, failed: 0,
        topReason: null, topReasonCount: 0, reasons: new Map(), companies: new Map(),
      }
      bySite.set(site, s)
    }
    s.total++
    if (b === 'auto') { s.auto++; if (r.verified_at) s.verified++ }
    if (b === 'human') s.human++
    if (b === 'parked') s.parked++
    if (b === 'failed') s.failed++
    if (b !== 'auto' && b !== 'manual' && r.reason_code) {
      s.reasons.set(r.reason_code, (s.reasons.get(r.reason_code) ?? 0) + 1)
    }
    if (r.company) s.companies.set(r.company, (s.companies.get(r.company) ?? 0) + 1)

    const d = byDay.get(moscowDay(r.created_at))
    if (d) {
      if (b === 'auto' || b === 'manual' || b === 'parked' || b === 'human') d[b]++
      else d.other++
    }
  }

  const top = (m: Map<string, number>): [string, number] | null =>
    Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null

  const sites: SiteStat[] = Array.from(bySite.values())
    .map(({ reasons, companies, ...s }) => {
      const r = top(reasons)
      return { ...s, company: top(companies)?.[0] ?? '', topReason: r?.[0] ?? null, topReasonCount: r?.[1] ?? 0 }
    })
    .sort((a, b) => b.total - a.total || a.site.localeCompare(b.site))

  return { totals, sites, days: Array.from(byDay.values()) }
}

/** Ждала ли заявка капчу человека: CAPTCHA_HUMAN (браузерный движок) или CAPTCHA_REQUIRED (HTTP). */
export const CAPTCHA_REASONS = ['CAPTCHA_HUMAN', 'CAPTCHA_REQUIRED']

/** Событие истории отклика с капчей (jm_jupiter_events, без user_id). */
export type CaptchaEvent = { application_id: string; reason_code: string | null; engine?: string | null }

export type EngineKey = 'http' | 'browser' | 'unknown'

export const ENGINE_LABEL: Record<EngineKey, string> = {
  http: 'HTTP',
  browser: 'Переведено на браузер',
  unknown: 'Движок не записан',
}

/**
 * Колонка engine хранит 'http' | 'browser'; в событиях истории движок
 * записан полным именем (jupiter-web-engine | jupiter-browser-engine).
 */
export function engineOf(name: string | null | undefined): EngineKey {
  if (name === 'http' || name === 'jupiter-web-engine') return 'http'
  if (name === 'browser' || name === 'jupiter-browser-engine') return 'browser'
  return 'unknown'
}

export type EngineStat = {
  engine: EngineKey
  total: number
  auto: number
  verified: number
  /** Заявок, дошедших до капчи человека. */
  captchaWaited: number
  /** Из них уже отправлено. */
  captchaSolved: number
  /** Три самые частые причины остановки (не для отправленных). */
  topReasons: { code: string; count: number }[]
}

/**
 * Разрез по движку за последние `days` дней (0 — всё время).
 * Движок — колонка engine заявки; если её нет (старая строка), — из события с капчей.
 */
export function buildEngineReport(
  rows: JupiterRow[], events: CaptchaEvent[], days: number, now: Date = new Date(),
): EngineStat[] {
  const from = days ? lastDays(days, now)[0] : ''
  const evByApp = new Map<string, CaptchaEvent[]>()
  for (const e of events) {
    const list = evByApp.get(e.application_id)
    if (list) list.push(e); else evByApp.set(e.application_id, [e])
  }
  const acc = new Map<EngineKey, EngineStat & { reasons: Map<string, number> }>()
  for (const r of rows) {
    if (from && moscowDay(r.created_at) < from) continue
    const evs = (r.id && evByApp.get(r.id)) || []
    const key = engineOf(r.engine ?? evs.find(e => e.engine)?.engine)
    let s = acc.get(key)
    if (!s) {
      s = { engine: key, total: 0, auto: 0, verified: 0, captchaWaited: 0, captchaSolved: 0, topReasons: [], reasons: new Map() }
      acc.set(key, s)
    }
    const b = bucketOf(r)
    s.total++
    if (b === 'auto') { s.auto++; if (r.verified_at) s.verified++ }
    if (b !== 'auto' && b !== 'manual' && r.reason_code) {
      s.reasons.set(r.reason_code, (s.reasons.get(r.reason_code) ?? 0) + 1)
    }
    const waited = CAPTCHA_REASONS.includes(r.reason_code ?? '') || evs.length > 0
    if (waited) {
      s.captchaWaited++
      if (r.state === 'submitted') s.captchaSolved++
    }
  }
  if (!acc.size) return []
  // HTTP и «Переведено на браузер» — всегда отдельными строками, даже с нулём:
  // ноль переводов — тоже ответ. «Движок не записан» — только если есть.
  const blank = (engine: EngineKey) => ({
    engine, total: 0, auto: 0, verified: 0, captchaWaited: 0, captchaSolved: 0, topReasons: [], reasons: new Map<string, number>(),
  })
  const order: EngineKey[] = ['http', 'browser', 'unknown']
  return order.filter(k => k !== 'unknown' || acc.has(k)).map(k => {
    const { reasons, ...s } = acc.get(k) ?? blank(k)
    const topReasons = Array.from(reasons.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3).map(([code, count]) => ({ code, count }))
    return { ...s, topReasons }
  })
}

/**
 * Капча человеку (jm_jupiter_captcha, миграция 135). Панель просит только
 * эти колонки: ни user_id, ни картинки (image_png), ни ответа (answer).
 */
export const CAPTCHA_COLUMNS = 'id,application_id,status,created_at,answered_at'

export type CaptchaRow = {
  id: string
  application_id: string
  status: 'pending' | 'answered' | 'expired' | 'solved' | 'failed' | string
  created_at: string
  answered_at: string | null
}

export type CaptchaStat = {
  /** Показано человеку — каждая строка таблицы. */
  shown: number
  solved: number
  failed: number
  expired: number
  /** Ещё ждут ответа или ответ ещё не проверен (pending, answered). */
  open: number
  /** Среднее answered_at − created_at, секунды; null — ответов не было. */
  avgAnswerSec: number | null
}

/** Капча за последние `days` дней по дате показа (0 — всё время). */
export function buildCaptchaReport(rows: CaptchaRow[], days: number, now: Date = new Date()): CaptchaStat {
  const from = days ? lastDays(days, now)[0] : ''
  const st: CaptchaStat = { shown: 0, solved: 0, failed: 0, expired: 0, open: 0, avgAnswerSec: null }
  let sum = 0
  let n = 0
  for (const r of rows) {
    if (from && moscowDay(r.created_at) < from) continue
    st.shown++
    if (r.status === 'solved') st.solved++
    else if (r.status === 'failed') st.failed++
    else if (r.status === 'expired') st.expired++
    else st.open++
    if (r.answered_at) {
      const ms = Date.parse(r.answered_at) - Date.parse(r.created_at)
      if (Number.isFinite(ms) && ms >= 0) { sum += ms; n++ }
    }
  }
  if (n) st.avgAnswerSec = Math.round(sum / n / 1000)
  return st
}

/** «42 с», «3 мин 5 с», «—» для null. */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  if (sec < 60) return `${sec} с`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s ? `${m} мин ${s} с` : `${m} мин`
}

/**
 * «Скорее всего, ушёл» (state submission_unknown): почему исход неизвестен.
 * Владелец 02.10.2026: «почти во всех откликах так выходит» — раздел нужен,
 * чтобы чинить по фактам. Берёт те же строки, что и основной замер, новых
 * колонок у базы не просит.
 */
export const UNKNOWN_REASON_LABEL: Record<string, string> = {
  // worker.apply_result: прогон упал ПОСЛЕ before_submit — а он зовётся и на
  // промежуточной «Далее», не только на последней «Отправить».
  POST_OUTCOME_UNCERTAIN: 'Сбой после нажатия «Далее» или «Отправить» (сторож 4 мин, ошибка шага)',
  // agent._unknown_outcome: связь оборвалась на самой отправке, проверка GET-ом
  // не нашла подтверждения.
  SUBMISSION_UNKNOWN: 'Связь оборвалась на отправке, подтверждения нет',
}

export type UnknownSite = {
  site: string
  company: string
  total: number
  reasons: { code: string; count: number }[]
  browser: number
}

export type UnknownReport = {
  total: number
  /** Доля от всех свайпов по сайтам за период. */
  ofAll: number
  reasons: { code: string; count: number }[]
  sites: UnknownSite[]
}

export function buildUnknownReport(rows: JupiterRow[], days: number, now: Date = new Date()): UnknownReport {
  const axis = lastDays(days || 30, now)
  const from = days ? axis[0] : ''
  const picked = rows.filter(r => !from || moscowDay(r.created_at) >= from)
  const unknown = picked.filter(r => r.state === 'submission_unknown')
  const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  const sorted = (m: Map<string, number>) =>
    Array.from(m.entries()).map(([code, n]) => ({ code, count: n }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))

  const all = new Map<string, number>()
  const bySite = new Map<string, { reasons: Map<string, number>; companies: Map<string, number>; total: number; browser: number }>()
  for (const r of unknown) {
    const code = r.reason_code || '—'
    count(all, code)
    const site = siteOf(r)
    let s = bySite.get(site)
    if (!s) { s = { reasons: new Map(), companies: new Map(), total: 0, browser: 0 }; bySite.set(site, s) }
    s.total++
    count(s.reasons, code)
    if (r.company) count(s.companies, r.company)
    if (engineOf(r.engine) === 'browser') s.browser++
  }
  const sites = Array.from(bySite.entries())
    .map(([site, s]) => ({
      site, company: sorted(s.companies)[0]?.code ?? '', total: s.total,
      reasons: sorted(s.reasons), browser: s.browser,
    }))
    .sort((a, b) => b.total - a.total || a.site.localeCompare(b.site))
  return { total: unknown.length, ofAll: picked.length, reasons: sorted(all), sites }
}

/** Причины остановки — теми же словами, что видит человек в «Откликах». */
export const REASON_LABEL: Record<string, string> = {
  SITE_NOT_VERIFIED: 'Сайт ещё подключаем',
  CAPTCHA_REQUIRED: 'Капча',
  CAPTCHA_HUMAN: 'Капча — ждём человека',
  CONSENT_REQUIRED: 'Нужно согласие',
  UNSUPPORTED_SCRIPT: 'Нужен браузер',
  MISSING_PROFILE_FIELD: 'Вопрос без ответа в профиле',
  UNKNOWN_REQUIRED_QUESTION: 'Неизвестный обязательный вопрос',
  LIVE_AUTHORIZATION_REVOKED: 'Автоотклик выключен',
  MAX_STEPS: 'Анкета не найдена за отведённые шаги',
  NAVIGATION_FAILED: 'Сайт не открылся',
  VACANCY_NOT_FOUND: 'Вакансия снята',
  DOMAIN_BLOCKED: 'Переход на чужой домен',
  VALIDATION_FAILED: 'Сайт не принял поля',
  SUBMIT_FAILED: 'Отправка не прошла',
  SUCCESS_NOT_CONFIRMED: 'Успех не подтверждён',
  SITE_NEEDS_FIX: 'Сайт просит исправить поля',
  SITE_REJECTED: 'Сайт ответил ошибкой',
  POST_OUTCOME_UNCERTAIN: 'Исход отправки неизвестен',
  STEP_DID_NOT_ADVANCE: 'Шаг анкеты не сменился',
  FORM_GONE: 'Анкета пропала',
  DUPLICATE_BLOCKED: 'Повтор',
}
