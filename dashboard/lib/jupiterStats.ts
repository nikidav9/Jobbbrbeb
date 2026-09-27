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

export const JUPITER_COLUMNS = 'state,reason_code,canonical_url,vacancy_url,company,created_at,submitted_at,verified_at'

export type JupiterRow = {
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

/** Причины остановки — теми же словами, что видит человек в «Откликах». */
export const REASON_LABEL: Record<string, string> = {
  SITE_NOT_VERIFIED: 'Сайт ещё подключаем',
  CAPTCHA_REQUIRED: 'Капча',
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
  POST_OUTCOME_UNCERTAIN: 'Исход отправки неизвестен',
  STEP_DID_NOT_ADVANCE: 'Шаг анкеты не сменился',
  FORM_GONE: 'Анкета пропала',
  DUPLICATE_BLOCKED: 'Повтор',
}
