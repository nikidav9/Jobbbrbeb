/**
 * Метрики продукта для «Обзора»: активация, удержание, DAU/WAU/MAU,
 * отклики и лимит, исход откликов Юпитера.
 *
 * Чистые функции, без сети и React: всё, что считается, считается здесь, а
 * `fetchOverview` (lib/queries.ts) только приносит строки. Пустые массивы —
 * нормальный вход: на чистой базе всё обязано выйти нулями, а не ошибкой.
 *
 * Дни — московские: лимит «10 в сутки» сбрасывается в полночь по Москве
 * (php-proxy/energy.php), и «активен сегодня» должно значить то же самое.
 *
 * Активность — действие в ленте: свайп (jm_ext_swipes, в любую сторону) или
 * отклик (jm_jupiter_applications, jm_perm_applications). Вход в приложение
 * без свайпа активностью не считается: его база не записывает, а «открыл и
 * закрыл» — не то, ради чего продукт существует.
 */
import { bucketOf } from './jupiterStats'

export const DAILY_LIMIT = 10 // = JT_DAILY_APPLIES в php-proxy/energy.php
const DAY = 86_400_000
const MSK = 3 * 3600_000

export type PUser = {
  id: string
  role: string | null
  created_at: string
  first_name: string | null
  last_name: string | null
  is_blocked: boolean | null
}
export type PSwipe = { user_id: string; dir: number; created_at: string }
export type PJupiter = { user_id: string; state: string; reason_code: string | null; created_at: string }
export type PPermApp = { worker_id: string; created_at: string }
export type PEmail = { user_id: string; received_at: string }

export type ProductInput = {
  users: PUser[]
  /** user_id тех, у кого выбрано резюме (jm_resume_files.selected). */
  resumeUsers: string[]
  swipes: PSwipe[]
  jupiter: PJupiter[]
  permApps: PPermApp[]
  emails: PEmail[]
}

/** Московская дата 'YYYY-MM-DD'. */
export function mskDay(iso: string | Date): string {
  const t = typeof iso === 'string' ? Date.parse(iso) : iso.getTime()
  return new Date(t + MSK).toISOString().slice(0, 10)
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)
}

function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY)
}

/** Понедельник московской недели. */
function weekStart(day: string): string {
  const dow = new Date(day + 'T00:00:00Z').getUTCDay() // 0 — воскресенье
  return addDays(day, -((dow + 6) % 7))
}

/** Соискатель: не работодатель и не обезличенный удалённый аккаунт (jm_delete_account). */
export function isSeeker(u: PUser): boolean {
  if (u.role === 'employer') return false
  if (u.is_blocked && u.first_name === 'Удалённый') return false
  return true
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

export type FunnelStep = { key: string; name: string; hint: string; value: number }

export type RetentionRow = {
  week: string
  label: string
  size: number
  /** null — когорта до этого дня ещё не дожила. */
  d1: number | null
  d7: number | null
  d30: number | null
  /** Сколько человек уже дожили до дня N — знаменатель. */
  n1: number
  n7: number
  n30: number
}

export type Outcome = { key: string; name: string; value: number }

export function buildProduct(input: ProductInput, now: Date = new Date(), funnelDays = 30) {
  const today = mskDay(now)
  const seekers = input.users.filter(isSeeker)
  const seekerIds = new Set(seekers.map(u => u.id))

  // ── Активность по дням: user → множество дней; отклики — по дням ──
  const activeDays = new Map<string, Set<string>>()
  const appsPerUserDay = new Map<string, number>() // `${user}|${day}`
  const firstSwipe = new Map<string, string>()
  const firstApply = new Map<string, string>()
  const firstEmail = new Map<string, string>()
  const mark = (uid: string, iso: string) => {
    if (!seekerIds.has(uid)) return
    const d = mskDay(iso)
    let s = activeDays.get(uid)
    if (!s) { s = new Set(); activeDays.set(uid, s) }
    s.add(d)
  }
  const earliest = (m: Map<string, string>, uid: string, iso: string) => {
    const cur = m.get(uid)
    if (!cur || iso < cur) m.set(uid, iso)
  }
  const apply = (uid: string, iso: string) => {
    mark(uid, iso)
    earliest(firstApply, uid, iso)
    // Отклик — тоже свайп вправо: без свайпа его не сделать.
    earliest(firstSwipe, uid, iso)
    const k = `${uid}|${mskDay(iso)}`
    appsPerUserDay.set(k, (appsPerUserDay.get(k) ?? 0) + 1)
  }
  for (const s of input.swipes) { mark(s.user_id, s.created_at); earliest(firstSwipe, s.user_id, s.created_at) }
  for (const a of input.jupiter) apply(a.user_id, a.created_at)
  for (const a of input.permApps) apply(a.worker_id, a.created_at)
  for (const e of input.emails) earliest(firstEmail, e.user_id, e.received_at)

  // ── Активация: когорта регистраций за funnelDays дней ──
  const resume = new Set(input.resumeUsers)
  const profileReady = (u: PUser) =>
    resume.has(u.id) && !!(u.first_name ?? '').trim() && !!(u.last_name ?? '').trim()
  const funnelFrom = addDays(today, -(funnelDays - 1))
  const cohort = seekers.filter(u => mskDay(u.created_at) >= funnelFrom)
  // Шаги вложены: каждый следующий считает тех, кто прошёл и все предыдущие.
  // Порядок — как в приложении: «почта → код → лента», профиль и резюме
  // просят только на первом отклике (services/resumeGate.ts).
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0
  for (const u of cohort) {
    if (!firstSwipe.has(u.id)) continue
    s1++
    if (!profileReady(u)) continue
    s2++
    if (!firstApply.has(u.id)) continue
    s3++
    if (firstEmail.has(u.id)) s4++
  }
  const funnel: FunnelStep[] = [
    { key: 'reg', name: 'Зарегистрировались', hint: 'jm_users', value: cohort.length },
    { key: 'swipe', name: 'Первый свайп', hint: 'jm_ext_swipes или отклик', value: s1 },
    { key: 'profile', name: 'Профиль готов', hint: 'резюме выбрано, имя и фамилия', value: s2 },
    { key: 'apply', name: 'Первый отклик', hint: 'jm_jupiter_applications, jm_perm_applications', value: s3 },
    { key: 'reply', name: 'Пришло письмо от работодателя', hint: 'jm_jupiter_emails, включая автоответы', value: s4 },
  ]
  // Время до первого свайпа и до первого отклика — медиана, в часах.
  const hoursTo = (m: Map<string, string>) => {
    const hrs = cohort.filter(u => m.has(u.id))
      .map(u => (Date.parse(m.get(u.id)!) - Date.parse(u.created_at)) / 3600_000)
      .filter(h => Number.isFinite(h) && h >= 0)
      .sort((a, b) => a - b)
    if (!hrs.length) return null
    const mid = Math.floor(hrs.length / 2)
    return hrs.length % 2 ? hrs[mid] : (hrs[mid - 1] + hrs[mid]) / 2
  }

  // ── Удержание: недельные когорты, D1/D7/D30 ──
  // Dn — был активен ровно на n-й московский день после регистрации.
  // День засчитывается, только когда он целиком прошёл: сегодняшний ещё идёт.
  const byWeek = new Map<string, PUser[]>()
  const weeksBack = 8
  const oldestWeek = addDays(weekStart(today), -7 * (weeksBack - 1))
  for (const u of seekers) {
    const w = weekStart(mskDay(u.created_at))
    if (w < oldestWeek) continue
    const list = byWeek.get(w)
    if (list) list.push(u); else byWeek.set(w, [u])
  }
  const retain = (users: PUser[], n: number) => {
    let base = 0, kept = 0
    for (const u of users) {
      const target = addDays(mskDay(u.created_at), n)
      if (target >= today) continue
      base++
      if (activeDays.get(u.id)?.has(target)) kept++
    }
    return { base, kept }
  }
  const fmtWeek = (w: string) => {
    const end = addDays(w, 6)
    return `${w.slice(8, 10)}.${w.slice(5, 7)}–${end.slice(8, 10)}.${end.slice(5, 7)}`
  }
  const retention: RetentionRow[] = []
  for (let i = 0; i < weeksBack; i++) {
    const w = addDays(oldestWeek, 7 * i)
    const users = byWeek.get(w) ?? []
    const r1 = retain(users, 1), r7 = retain(users, 7), r30 = retain(users, 30)
    retention.push({
      week: w, label: fmtWeek(w), size: users.length,
      d1: ratio(r1.kept, r1.base), d7: ratio(r7.kept, r7.base), d30: ratio(r30.kept, r30.base),
      n1: r1.base, n7: r7.base, n30: r30.base,
    })
  }
  retention.reverse() // свежие сверху
  const allCohorts = Array.from(byWeek.values()).flat()
  const t1 = retain(allCohorts, 1), t7 = retain(allCohorts, 7), t30 = retain(allCohorts, 30)
  const retentionTotal = {
    d1: ratio(t1.kept, t1.base), d7: ratio(t7.kept, t7.base), d30: ratio(t30.kept, t30.base),
    n1: t1.base, n7: t7.base, n30: t30.base,
  }

  // ── DAU / WAU / MAU за 30 дней, включая сегодняшний ──
  const days30 = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29))
  const dauByDay = new Map<string, number>(days30.map(d => [d, 0]))
  const appsByDay = new Map<string, number>(days30.map(d => [d, 0]))
  const regByDay = new Map<string, number>(days30.map(d => [d, 0]))
  const wauSet = new Set<string>(), mauSet = new Set<string>()
  const from7 = days30[23]
  for (const [uid, days] of Array.from(activeDays.entries())) {
    for (const d of Array.from(days)) {
      if (!dauByDay.has(d)) continue
      dauByDay.set(d, dauByDay.get(d)! + 1)
      mauSet.add(uid)
      if (d >= from7) wauSet.add(uid)
    }
  }
  for (const u of seekers) {
    const d = mskDay(u.created_at)
    if (regByDay.has(d)) regByDay.set(d, regByDay.get(d)! + 1)
  }

  // ── Отклики на активного и лимит ──
  let apps30 = 0, applyDays = 0, limitDays = 0
  const limitUsers = new Set<string>()
  const perDay = { '1–2': 0, '3–5': 0, '6–9': 0, [`${DAILY_LIMIT}`]: 0 } as Record<string, number>
  for (const [k, n] of Array.from(appsPerUserDay.entries())) {
    const [uid, d] = k.split('|')
    if (!appsByDay.has(d)) continue
    appsByDay.set(d, appsByDay.get(d)! + n)
    apps30 += n
    applyDays++
    if (n >= DAILY_LIMIT) { limitDays++; limitUsers.add(uid); perDay[`${DAILY_LIMIT}`]++ }
    else if (n >= 6) perDay['6–9']++
    else if (n >= 3) perDay['3–5']++
    else perDay['1–2']++
  }
  const activeDays30 = Array.from(dauByDay.values()).reduce((a, b) => a + b, 0)

  const daily = days30.map(d => ({
    date: d.slice(5),
    dau: dauByDay.get(d) ?? 0,
    apps: appsByDay.get(d) ?? 0,
    regs: regByDay.get(d) ?? 0,
  }))

  // ── Исход откликов Юпитера за 30 дней ──
  const oc = { sent: 0, likely: 0, human: 0, error: 0, parked: 0, working: 0, duplicate: 0 }
  for (const a of input.jupiter) {
    if (mskDay(a.created_at) < days30[0]) continue
    if (a.state === 'submission_unknown') { oc.likely++; continue }
    const b = bucketOf(a)
    if (b === 'auto' || b === 'manual') oc.sent++
    else if (b === 'human') oc.human++
    else if (b === 'parked') oc.parked++
    else if (b === 'working') oc.working++
    else if (b === 'duplicate') oc.duplicate++
    else oc.error++
  }
  const outcomes: Outcome[] = [
    { key: 'sent', name: 'Ушёл', value: oc.sent },
    { key: 'likely', name: 'Скорее всего, ушёл', value: oc.likely },
    { key: 'human', name: 'Ждёт человека', value: oc.human },
    { key: 'error', name: 'Ошибка', value: oc.error },
    { key: 'parked', name: 'Сайт ещё подключаем', value: oc.parked },
    { key: 'working', name: 'В очереди и в работе', value: oc.working },
    { key: 'duplicate', name: 'Повтор', value: oc.duplicate },
  ]
  const outcomesTotal = Object.values(oc).reduce((a, b) => a + b, 0)

  return {
    today,
    seekers: seekers.length,
    newToday: regByDay.get(today) ?? 0,
    new7: days30.slice(23).reduce((a, d) => a + (regByDay.get(d) ?? 0), 0),
    funnel,
    funnelDays,
    hoursToSwipe: hoursTo(firstSwipe),
    hoursToApply: hoursTo(firstApply),
    retention,
    retentionTotal,
    dau: dauByDay.get(today) ?? 0,
    dauYesterday: dauByDay.get(days30[28]) ?? 0,
    wau: wauSet.size,
    mau: mauSet.size,
    avgDau: activeDays30 / 30,
    /** Средний DAU за 30 дней / MAU. */
    stickiness: ratio(activeDays30 / 30, mauSet.size),
    apps30,
    /** Откликов на активного пользователя в день: отклики / человеко-дни активности. */
    appsPerActiveDay: ratio(apps30, activeDays30),
    /** Откликов в день у тех, кто в этот день откликался. */
    appsPerApplyDay: ratio(apps30, applyDays),
    applyDays,
    limitDays,
    /** Доля дней с откликами, когда человек выбрал все 10. */
    limitShare: ratio(limitDays, applyDays),
    limitUsers: limitUsers.size,
    perDay: Object.entries(perDay).map(([name, value]) => ({ name, value })),
    daily,
    outcomes,
    outcomesTotal,
  }
}

export type ProductReport = ReturnType<typeof buildProduct>
