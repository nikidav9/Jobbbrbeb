import { supabase, supabaseAdmin } from './supabase'
import { subDays, format, eachDayOfInterval, parseISO, startOfDay } from 'date-fns'
import { buildWorkerActivationCohort, buildWorkerShiftCohort } from './workerCohort'

// Supabase режет выборку до 1000 строк. Для полных агрегатов (просмотры и т.п.)
// тянем всю таблицу постранично, иначе счётчики занижаются.
async function selectAll(table: string, columns: string): Promise<any[]> {
  const page = 1000
  let from = 0
  const all: any[] = []
  for (;;) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + page - 1)
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < page) break
    from += page
  }
  return all
}

async function selectAllBetween(
  table: string,
  columns: string,
  field: string,
  fromValue: string,
  toValue: string,
): Promise<any[]> {
  const page = 1000
  let from = 0
  const all: any[] = []
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .gte(field, fromValue)
      .lt(field, toValue)
      .range(from, from + page - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < page) break
    from += page
  }
  return all
}

// ─── constants ───────────────────────────────────────────────────────────────

export const WORK_TYPE_LABELS: Record<string, string> = {
  stocker: 'Кладовщик',
  cook: 'Повар',
  shift_supervisor: 'Менеджер',
  picker: 'Комплектовщик',
}

/** Палитра графиков.
 *
 *  Первые пять — те же значения, что у токенов `--accent`, `--info`,
 *  `--positive`, `--negative`, `--ink-4`: Recharts кладёт цвет прямо в
 *  SVG-атрибут и `var(...)` там не работает, поэтому значения продублированы
 *  здесь. Дублируются именно значения, а не решения: менять их можно только
 *  вместе с MASTER.md.
 *
 *  Остальные — для рядов, которым не хватает смысловых цветов. Все проверены
 *  на контраст к белой карточке (≥ 4.5:1), потому что подписи на графиках
 *  красятся в цвет ряда. */
export const PALETTE = {
  orange: '#FF6B1A', // = --accent (DS.accent)
  blue: '#2C6FB5',   // = --info
  green: '#1E7A4C',  // = --positive
  red: '#C8321B',    // = --negative (DS.danger)
  gray: '#9A9086',   // = --ink-4, только заливкой
  purple: '#5F4BB6',
  amber: '#B8801F',
  cyan: '#0E7490',
  pink: '#9D2060',
}

export const CHART_COLORS = Object.values(PALETTE)

// ─── helpers ─────────────────────────────────────────────────────────────────

export function dayRange(days: number) {
  const end = new Date()
  const start = subDays(end, days - 1)
  return eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd'))
}

export function groupByDate(items: any[], field: string): Record<string, number> {
  const map: Record<string, number> = {}
  for (const item of items) {
    const key = item[field]?.slice(0, 10)
    if (key) map[key] = (map[key] ?? 0) + 1
  }
  return map
}

export function fillDays(map: Record<string, number>, days: string[]): number[] {
  return days.map(d => map[d] ?? 0)
}

export function toDayLabel(dateKey: string): string {
  return dateKey.slice(5) // "MM-DD"
}

export function pct(a: number, b: number): string {
  if (b === 0) return '0%'
  return ((a / b) * 100).toFixed(1) + '%'
}

export function trend(current: number, prev: number): number {
  if (prev === 0) return current > 0 ? 100 : 0
  return Math.round(((current - prev) / prev) * 100)
}

// Готовый «чип» изменения для KPI: на малой базе показываем абсолютную разницу
// (процент от 1→7 = 600% — бессмыслен), иначе процент со знаком и цветом.
// Возвращает null, если изменения нет.
export function growthChip(current: number, prev: number): { text: string; tone: 'pos' | 'neg' } | null {
  const diff = current - prev
  if (diff === 0) return null
  const tone: 'pos' | 'neg' = diff > 0 ? 'pos' : 'neg'
  const sign = diff > 0 ? '+' : '−'
  const mag = Math.abs(diff)
  // Малая база (или ноль) — процент не показателен, даём абсолютное изменение
  if (prev < 5) return { text: `${sign}${mag}`, tone }
  const p = Math.min(999, Math.round((mag / prev) * 100))
  return { text: `${sign}${p}%`, tone }
}

// ─── overview ────────────────────────────────────────────────────────────────

export async function fetchOverview() {
  const now = new Date()
  const cohortFrom = subDays(now, 37).toISOString()
  const cohortTo = subDays(now, 7).toISOString()
  const [
    { data: users },
    { data: tempVacs },
    { data: permVacs },
    { data: likes },
    { data: chats },
    { data: messages },
    { data: ratings },
    { data: permApps },
    cohortUsers,
    cohortLikes,
  ] = await Promise.all([
    supabase.from('jm_users').select('id,role,created_at,is_blocked'),
    supabase.from('jm_vacancies').select('id,status,work_type,created_at,workers_needed,workers_found'),
    supabase.from('jm_perm_vacancies').select('id,status,created_at'),
    supabase.from('jm_likes').select('id,worker_id,worker_liked,is_match,matched_at,worker_confirmed,employer_confirmed,shift_completed,outcome,created_at'),
    supabase.from('jm_chats').select('id,created_at'),
    supabase.from('jm_messages').select('id,created_at'),
    supabase.from('jm_ratings').select('id,rating'),
    supabase.from('jm_perm_applications').select('id,status,created_at'),
    selectAllBetween('jm_users', 'id,role,created_at', 'created_at', cohortFrom, cohortTo),
    selectAllBetween(
      'jm_likes',
      'worker_id,worker_liked,is_match,worker_confirmed,employer_confirmed,shift_completed,outcome,created_at',
      'created_at',
      cohortFrom,
      now.toISOString(),
    ),
  ])

  const u = users ?? []
  const tv = tempVacs ?? []
  const pv = permVacs ?? []
  const lk = likes ?? []
  const ch = chats ?? []
  const ms = messages ?? []
  const rt = ratings ?? []
  const pa = permApps ?? []

  const workers = u.filter((x: any) => x.role === 'worker')
  const employers = u.filter((x: any) => x.role === 'employer')
  // Мэтч = совпадение по смене (is_match) ИЛИ одобренный отклик на вакансию
  const shiftMatches = lk.filter((x: any) => x.is_match)
  const permApproved = pa.filter((x: any) => x.status === 'approved')
  const matches = [
    ...shiftMatches.map((x: any) => ({ at: x.matched_at ?? x.created_at })),
    ...permApproved.map((x: any) => ({ at: x.created_at })),
  ]
  const confirmed = lk.filter((x: any) => x.worker_confirmed && x.employer_confirmed)
  const completed = lk.filter((x: any) => x.shift_completed)

  const w7 = subDays(now, 7).toISOString()
  const w30 = subDays(now, 30).toISOString()

  const newUsersWeek = u.filter((x: any) => x.created_at > w7).length
  const newUsersMonth = u.filter((x: any) => x.created_at > w30).length
  const newVacsMonth = tv.filter((x: any) => x.created_at > w30).length
  const newMatchesMonth = matches.filter((x) => x.at > w30).length

  // prev month for trend
  const w60 = subDays(now, 60).toISOString()
  const prevUsersMonth = u.filter((x: any) => x.created_at > w60 && x.created_at <= w30).length
  const prevMatchesMonth = matches.filter((x) => x.at > w60 && x.at <= w30).length

  // 30-day daily data
  const days30 = dayRange(30)
  const usersByDay = groupByDate(u, 'created_at')
  const workersByDay = groupByDate(workers, 'created_at')
  const employersByDay = groupByDate(employers, 'created_at')
  const vacsByDay = groupByDate(tv, 'created_at')
  const matchesByDay = groupByDate(
    matches.map((x) => ({ created_at: x.at })),
    'created_at'
  )

  const dailyUsers = days30.map(d => ({
    date: toDayLabel(d),
    workers: workersByDay[d] ?? 0,
    employers: employersByDay[d] ?? 0,
    total: usersByDay[d] ?? 0,
  }))

  const dailyVacs = days30.map(d => ({
    date: toDayLabel(d),
    vacancies: vacsByDay[d] ?? 0,
    matches: matchesByDay[d] ?? 0,
  }))

  // work type dist
  const wtMap: Record<string, number> = {}
  for (const v of tv) {
    const wt = (v as any).work_type ?? 'other'
    wtMap[wt] = (wtMap[wt] ?? 0) + 1
  }
  const workTypeDist = Object.entries(wtMap)
    .map(([k, v]) => ({ name: WORK_TYPE_LABELS[k] ?? k, value: v }))
    .sort((a, b) => b.value - a.value)

  // Одна дозревшая когорта: каждый следующий шаг считает тех же работников.
  const funnel = buildWorkerShiftCohort(cohortUsers, cohortLikes, now).steps

  // ratings
  const avgRating = rt.length > 0
    ? rt.reduce((s: number, r: any) => s + Number(r.rating), 0) / rt.length
    : 0

  return {
    kpi: {
      totalUsers: u.length,
      workers: workers.length,
      employers: employers.length,
      blocked: u.filter((x: any) => x.is_blocked).length,
      tempVacancies: tv.length,
      permVacancies: pv.length,
      openTemp: tv.filter((x: any) => x.status === 'open').length,
      openPerm: pv.filter((x: any) => x.status === 'open').length,
      totalLikes: lk.length,
      totalMatches: matches.length,
      // конверсия «отклик → мэтч»: все отклики = свайпы по сменам + заявки на вакансии
      matchRate: (lk.length + pa.length) > 0 ? ((matches.length / (lk.length + pa.length)) * 100).toFixed(1) : '0',
      confirmed: confirmed.length,
      completed: completed.length,
      chats: ch.length,
      messages: ms.length,
      avgMessages: ch.length > 0 ? (ms.length / ch.length).toFixed(1) : '0',
      // null, а не 0: «нет ни одной оценки» и «все поставили ноль» — разные
      // сообщения, и панель обязана их различать.
      avgRating: rt.length > 0 ? avgRating.toFixed(2) : null,
      ratingsCount: rt.length,
      newUsersWeek,
      newUsersMonth,
      newVacsMonth,
      newMatchesMonth,
      usersDelta: growthChip(newUsersMonth, prevUsersMonth),
      matchesDelta: growthChip(newMatchesMonth, prevMatchesMonth),
    },
    dailyUsers,
    dailyVacs,
    workTypeDist,
    funnel,
  }
}

// ─── users ───────────────────────────────────────────────────────────────────

export async function fetchUsers() {
  const [{ data: users }, { data: webPushRows }] = await Promise.all([
    supabase
      .from('jm_users')
      .select('id,role,first_name,last_name,phone,email,metro_station,metro_line_id,is_blocked,created_at,company,push_token')
      .order('created_at', { ascending: false }),
    supabase
      .from('jm_web_push_subscriptions')
      .select('user_id,updated_at'),
  ])

  const u = users ?? []
  const webPushMap = new Map((webPushRows ?? []).map((r: any) => [r.user_id, r.updated_at as string]))

  const workers = u.filter((x: any) => x.role === 'worker')
  const employers = u.filter((x: any) => x.role === 'employer')

  const days30 = dayRange(30)
  const days90 = dayRange(90)

  const w30 = subDays(new Date(), 30).toISOString()
  const w7 = subDays(new Date(), 7).toISOString()

  // metro top
  const metroMap: Record<string, { workers: number; employers: number }> = {}
  for (const user of u) {
    const s = (user as any).metro_station
    if (!s) continue
    if (!metroMap[s]) metroMap[s] = { workers: 0, employers: 0 }
    if ((user as any).role === 'worker') metroMap[s].workers++
    else metroMap[s].employers++
  }
  const metroTop = Object.entries(metroMap)
    .map(([station, counts]) => ({ station, ...counts, total: counts.workers + counts.employers }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  // 90-day growth
  const wByDay = groupByDate(workers, 'created_at')
  const eByDay = groupByDate(employers, 'created_at')
  const growth90 = days90.map(d => ({
    date: toDayLabel(d),
    workers: wByDay[d] ?? 0,
    employers: eByDay[d] ?? 0,
  }))

  // cumulative
  let cumW = workers.filter((x: any) => x.created_at < subDays(new Date(), 90).toISOString()).length
  let cumE = employers.filter((x: any) => x.created_at < subDays(new Date(), 90).toISOString()).length
  const cumulative = growth90.map(d => {
    cumW += d.workers
    cumE += d.employers
    return { date: d.date, workers: cumW, employers: cumE, total: cumW + cumE }
  })

  const recent = u.map((x: any) => ({
    name: `${x.first_name ?? ''} ${x.last_name ?? ''}`.trim(),
    phone: x.phone,
    email: x.email ?? null,
    role: x.role,
    metro: x.metro_station ?? '—',
    company: x.company ?? '—',
    blocked: x.is_blocked,
    date: x.created_at?.slice(0, 10),
    id: x.id,
    hasPushToken: !!x.push_token,
    hasWebPush: webPushMap.has(x.id),
    webPushDate: webPushMap.get(x.id)?.slice(0, 10) ?? null,
    hadPushTokenBefore: !!x.push_token && webPushMap.has(x.id),
  }))

  const withWebPush = webPushMap.size
  const webPushNewWeek = (webPushRows ?? []).filter((r: any) => r.updated_at > w7).length
  const webPushNewMonth = (webPushRows ?? []).filter((r: any) => r.updated_at > w30).length
  const webPushOnlyCount = u.filter((x: any) => !x.push_token && webPushMap.has(x.id)).length

  return {
    kpi: {
      total: u.length,
      workers: workers.length,
      employers: employers.length,
      blocked: u.filter((x: any) => x.is_blocked).length,
      newWeek: u.filter((x: any) => x.created_at > w7).length,
      newMonth: u.filter((x: any) => x.created_at > w30).length,
      workerPct: u.length > 0 ? ((workers.length / u.length) * 100).toFixed(0) : '0',
      // Считается отдельно, а не как «сто минус доля работников»: роли двумя
      // значениями не исчерпываются, и разница уходила бы в работодателей.
      employerPct: u.length > 0 ? ((employers.length / u.length) * 100).toFixed(0) : '0',
      withPushToken: u.filter((x: any) => x.push_token).length,
      withoutPushToken: u.filter((x: any) => !x.push_token).length,
      // Без Expo-токена — ещё не «недоступен»: у части этих людей подключён
      // веб-пуш с айфона. Недоступны только те, у кого нет ни того, ни другого,
      // и раньше панель называла этим числом всех без Expo — то есть завышала
      // его на всех айфонщиков разом.
      noPushAtAll: u.filter((x: any) => !x.push_token && !webPushMap.has(x.id)).length,
      withWebPush,
      webPushNewWeek,
      webPushNewMonth,
      webPushOnlyCount,
    },
    growth90,
    cumulative,
    metroTop,
    recent,
    roleSplit: [
      { name: 'Работники', value: workers.length, fill: PALETTE.orange },
      { name: 'Работодатели', value: employers.length, fill: PALETTE.blue },
    ],
  }
}

// ─── vacancies ───────────────────────────────────────────────────────────────

/** Смены с прошедшей датой должны быть закрыты — дашборд подчищает их при загрузке.
 *  Точная логика (по времени окончания, ночные смены) живёт на сервере;
 *  здесь только страховка: закрываем то, что старше вчерашнего дня. */
async function autoCloseStaleVacancies() {
  // МСК = UTC+3
  const mskYesterday = new Date(Date.now() + 3 * 3600_000 - 86400_000).toISOString().slice(0, 10)
  try {
    await supabaseAdmin
      .from('jm_vacancies')
      .update({ status: 'closed' })
      .eq('status', 'open')
      .lt('date', mskYesterday)
  } catch { /* не блокируем аналитику */ }
}

export async function fetchVacancies() {
  await autoCloseStaleVacancies()
  const [{ data: tv }, { data: pv }, { data: apps }, { data: users }, { data: likes }, tvViews, pvViews] = await Promise.all([
    supabase.from('jm_vacancies').select('id,status,work_type,work_type_label,created_at,employer_id,salary,workers_needed,workers_found,is_urgent,no_experience_needed,company,date,address,metro_station,time_start,time_end'),
    supabase.from('jm_perm_vacancies').select('id,title,status,created_at,employer_id,salary,company,metro_station,address,description,schedule,work_type'),
    supabase.from('jm_perm_applications').select('id,vacancy_id,worker_id,status,created_at').order('created_at', { ascending: false }),
    supabase.from('jm_users').select('id,first_name,last_name,phone'),
    supabase.from('jm_likes').select('id,vacancy_id,worker_id,is_match,worker_liked,employer_liked,worker_skipped,created_at').order('created_at', { ascending: false }),
    selectAll('jm_vacancy_views', 'vacancy_id,viewed_at'),
    selectAll('jm_perm_vacancy_views', 'vacancy_id,viewed_at'),
  ])

  const t = tv ?? []
  const p = pv ?? []
  const ap = apps ?? []
  const lk = likes ?? []

  const userMap: Record<string, { name: string; phone: string }> = {}
  for (const u of users ?? []) {
    const name = [(u as any).first_name, (u as any).last_name].filter(Boolean).join(' ') || (u as any).phone || '—'
    userMap[(u as any).id] = { name, phone: (u as any).phone ?? '—' }
  }

  type AppInfo = { id: string; workerId: string; name: string; phone: string; status: string; date: string }

  const appsByVac: Record<string, AppInfo[]> = {}
  const appByVac: Record<string, { total: number; pending: number; approved: number; rejected: number }> = {}

  for (const a of ap) {
    const vid = (a as any).vacancy_id
    const wid = (a as any).worker_id
    if (!vid) continue
    if (!appByVac[vid]) appByVac[vid] = { total: 0, pending: 0, approved: 0, rejected: 0 }
    if (!appsByVac[vid]) appsByVac[vid] = []
    appByVac[vid].total++
    const st = (a as any).status ?? 'pending'
    if (st === 'approved') appByVac[vid].approved++
    else if (st === 'rejected') appByVac[vid].rejected++
    else appByVac[vid].pending++
    const worker = userMap[wid]
    appsByVac[vid].push({ id: (a as any).id, workerId: wid, name: worker?.name ?? '—', phone: worker?.phone ?? '—', status: st, date: (a as any).created_at?.slice(0, 10) ?? '' })
  }

  const permVacancyCards = p.map((v: any) => ({
    id: v.id,
    title: v.title ?? 'Без названия',
    company: v.company ?? '—',
    metro: v.metro_station ?? null,
    address: v.address ?? null,
    salary: v.salary ? Number(v.salary).toLocaleString('ru-RU') + ' ₽' : null,
    salaryRaw: v.salary ? Number(v.salary) : null,
    status: v.status ?? 'open',
    schedule: v.schedule ?? null,
    createdAt: v.created_at?.slice(0, 10) ?? null,
    apps: appByVac[v.id] ?? { total: 0, pending: 0, approved: 0, rejected: 0 },
    applicants: appsByVac[v.id] ?? [],
  })).sort((a: any, b: any) => b.apps.total - a.apps.total)

  const likesByVac: Record<string, AppInfo[]> = {}
  const likeCountByVac: Record<string, { total: number; matched: number; pending: number; rejected: number }> = {}

  for (const l of lk) {
    const vid = (l as any).vacancy_id
    const wid = (l as any).worker_id
    if (!vid || !(l as any).worker_liked) continue
    if (!likesByVac[vid]) likesByVac[vid] = []
    if (!likeCountByVac[vid]) likeCountByVac[vid] = { total: 0, matched: 0, pending: 0, rejected: 0 }
    likeCountByVac[vid].total++
    let st: string
    if ((l as any).is_match) { st = 'matched'; likeCountByVac[vid].matched++ }
    else if ((l as any).employer_liked === false) { st = 'rejected'; likeCountByVac[vid].rejected++ }
    else { st = 'pending'; likeCountByVac[vid].pending++ }
    const worker = userMap[wid]
    likesByVac[vid].push({ id: (l as any).id, workerId: wid, name: worker?.name ?? '—', phone: worker?.phone ?? '—', status: st, date: (l as any).created_at?.slice(0, 10) ?? '' })
  }

  const tempVacancyCards = t.map((v: any) => ({
    id: v.id,
    title: v.work_type_label ?? WORK_TYPE_LABELS[v.work_type ?? ''] ?? 'Вакансия',
    company: v.company ?? '—',
    salary: v.salary ? Number(v.salary).toLocaleString('ru-RU') + ' ₽' : null,
    status: v.status ?? 'open',
    isUrgent: !!v.is_urgent,
    workersNeeded: v.workers_needed ?? null,
    workersFound: v.workers_found ?? 0,
    shiftDate: v.date ?? null,
    timeStart: v.time_start ?? null,
    timeEnd: v.time_end ?? null,
    address: v.address ?? null,
    metro: v.metro_station ?? null,
    createdAt: v.created_at?.slice(0, 10) ?? null,
    apps: likeCountByVac[v.id] ?? { total: 0, matched: 0, pending: 0, rejected: 0 },
    applicants: likesByVac[v.id] ?? [],
  })).sort((a: any, b: any) => b.apps.total - a.apps.total)

  const w30 = subDays(new Date(), 30).toISOString()
  const days30 = dayRange(30)
  const days90 = dayRange(90)

  const tByDay = groupByDate(t, 'created_at')
  const pByDay = groupByDate(p, 'created_at')

  const daily90 = days90.map(d => ({
    date: toDayLabel(d),
    temp: tByDay[d] ?? 0,
    perm: pByDay[d] ?? 0,
  }))

  const wtMap: Record<string, number> = {}
  for (const v of t) {
    const wt = (v as any).work_type ?? 'other'
    wtMap[wt] = (wtMap[wt] ?? 0) + 1
  }
  const workTypeDist = Object.entries(wtMap)
    .map(([k, v]) => ({ name: WORK_TYPE_LABELS[k] ?? k, temp: v, value: v }))
    .sort((a, b) => b.value - a.value)

  const empMap: Record<string, { name: string; temp: number; perm: number }> = {}
  for (const v of t) {
    const eid = (v as any).employer_id
    const company = (v as any).company ?? eid
    if (!eid) continue
    if (!empMap[eid]) empMap[eid] = { name: company, temp: 0, perm: 0 }
    empMap[eid].temp++
    empMap[eid].name = company
  }
  for (const v of p) {
    const eid = (v as any).employer_id
    const company = (v as any).company ?? eid
    if (!eid) continue
    if (!empMap[eid]) empMap[eid] = { name: company, temp: 0, perm: 0 }
    empMap[eid].perm++
    empMap[eid].name = company
  }
  const topEmployers = Object.values(empMap)
    .map(e => ({ ...e, total: e.temp + e.perm }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  const salaryBuckets: Record<string, number> = {
    '< 30k': 0, '30–50k': 0, '50–80k': 0, '80–120k': 0, '> 120k': 0,
  }
  for (const v of p) {
    const s = Number((v as any).salary ?? 0)
    if (s < 30000) salaryBuckets['< 30k']++
    else if (s < 50000) salaryBuckets['30–50k']++
    else if (s < 80000) salaryBuckets['50–80k']++
    else if (s < 120000) salaryBuckets['80–120k']++
    else salaryBuckets['> 120k']++
  }
  const salaryDist = Object.entries(salaryBuckets).map(([name, value]) => ({ name, value }))

  // ── Динамика просмотров (уникальные просмотры с меткой времени) ──
  const tViews = (tvViews ?? []) as any[]
  const pViews = (pvViews ?? []) as any[]
  const days30v = dayRange(30)
  const tViewsByDay = groupByDate(tViews.map(v => ({ created_at: v.viewed_at })), 'created_at')
  const pViewsByDay = groupByDate(pViews.map(v => ({ created_at: v.viewed_at })), 'created_at')
  const viewsDaily30 = days30v.map(d => ({
    date: toDayLabel(d),
    temp: tViewsByDay[d] ?? 0,
    perm: pViewsByDay[d] ?? 0,
  }))
  const w7v = subDays(new Date(), 7).toISOString()
  const viewsKpi = {
    tempTotal: tViews.length,
    permTotal: pViews.length,
    temp7: tViews.filter(v => (v.viewed_at ?? '') > w7v).length,
    perm7: pViews.filter(v => (v.viewed_at ?? '') > w7v).length,
  }

  return {
    kpi: {
      totalTemp: t.length,
      totalPerm: p.length,
      openTemp: t.filter((x: any) => x.status === 'open').length,
      openPerm: p.filter((x: any) => x.status === 'open').length,
      closedTemp: t.filter((x: any) => x.status === 'closed').length,
      closedPerm: p.filter((x: any) => x.status === 'closed').length,
      urgentTemp: t.filter((x: any) => x.is_urgent).length,
      newMonth: t.filter((x: any) => x.created_at > w30).length + p.filter((x: any) => x.created_at > w30).length,
    },
    viewsDaily30,
    viewsKpi,
    daily90,
    workTypeDist,
    topEmployers,
    salaryDist,
    tempStatus: [
      { name: 'Открыто', value: t.filter((x: any) => x.status === 'open').length, fill: PALETTE.green },
      { name: 'Закрыто', value: t.filter((x: any) => x.status === 'closed').length, fill: PALETTE.gray },
    ],
    permStatus: [
      { name: 'Открыто', value: p.filter((x: any) => x.status === 'open').length, fill: PALETTE.green },
      { name: 'Закрыто', value: p.filter((x: any) => x.status === 'closed').length, fill: PALETTE.gray },
    ],
    permVacancyCards,
    tempVacancyCards,
  }
}

// ─── engagement ──────────────────────────────────────────────────────────────

// ─── user profile ────────────────────────────────────────────────────────────

export async function fetchUserProfile(userId: string) {
  const [
    { data: user },
    { data: chats },
    { data: ratingsReceived },
    { data: ratingsSent },
    { data: likes },
    { data: vacancies },
    { data: permVacancies },
    { data: permApps },
    { data: webPushSub },
  ] = await Promise.all([
    supabase.from('jm_users').select('*').eq('id', userId).maybeSingle(),
    supabase.from('jm_chats').select('id,vac_title,company_name,created_at,worker_id,employer_id,vacancy_id')
      .or(`worker_id.eq.${userId},employer_id.eq.${userId}`)
      .order('created_at', { ascending: false }).limit(20),
    supabase.from('jm_ratings').select('id,rating,review_text,role,created_at,from_user_id')
      .eq('to_user_id', userId).order('created_at', { ascending: false }).limit(20),
    supabase.from('jm_ratings').select('id,rating,review_text,role,created_at,to_user_id')
      .eq('from_user_id', userId).order('created_at', { ascending: false }).limit(10),
    supabase.from('jm_likes').select('id,vacancy_id,is_match,worker_liked,employer_liked,created_at')
      .eq('worker_id', userId).order('created_at', { ascending: false }).limit(30),
    supabase.from('jm_vacancies').select('id,work_type_label,work_type,status,created_at,company,address')
      .eq('employer_id', userId).order('created_at', { ascending: false }).limit(20),
    supabase.from('jm_perm_vacancies').select('id,title,status,created_at,company,address')
      .eq('employer_id', userId).order('created_at', { ascending: false }).limit(20),
    supabase.from('jm_perm_applications').select('id,vacancy_id,status,created_at')
      .eq('worker_id', userId).order('created_at', { ascending: false }).limit(20),
    supabase.from('jm_web_push_subscriptions').select('updated_at').eq('user_id', userId).maybeSingle(),
  ])

  const avgRating = ratingsReceived && ratingsReceived.length > 0
    ? (ratingsReceived.reduce((s: number, r: any) => s + Number(r.rating), 0) / ratingsReceived.length).toFixed(1)
    : null

  return {
    user: user ?? null,
    chats: chats ?? [],
    ratingsReceived: ratingsReceived ?? [],
    ratingsSent: ratingsSent ?? [],
    likes: likes ?? [],
    vacancies: vacancies ?? [],
    permVacancies: permVacancies ?? [],
    permApps: permApps ?? [],
    avgRating,
    totalLikes: (likes ?? []).length,
    totalMatches: (likes ?? []).filter((l: any) => l.is_match).length,
    hasWebPush: !!webPushSub,
    webPushDate: (webPushSub as any)?.updated_at?.slice(0, 10) ?? null,
  }
}

// ─── cohorts ─────────────────────────────────────────────────────────────────

// ─── funnel ──────────────────────────────────────────────────────────────────

export async function fetchFunnel() {
  const funnelNow = new Date()
  const cohortFrom = subDays(funnelNow, 37).toISOString()
  const cohortTo = subDays(funnelNow, 7).toISOString()
  const [
    { data: users },
    { data: likes },
    { data: permApps },
    { data: guestEvents },
    cohortUsers,
    cohortLikes,
    cohortPermApps,
    cohortShiftViews,
    cohortPermViews,
  ] = await Promise.all([
    supabase.from('jm_users').select('id,role,created_at'),
    supabase.from('jm_likes').select('id,worker_id,is_match,worker_liked,worker_confirmed,employer_confirmed,shift_completed,created_at'),
    supabase.from('jm_perm_applications').select('id,worker_id,status,created_at'),
    supabase.from('jm_guest_events').select('anon_id,event_type,vacancy_kind,campaign_id,channel,occurred_at'),
    selectAllBetween(
      'jm_users',
      'id,role,created_at,first_name,last_name,metro_station,work_types',
      'created_at',
      cohortFrom,
      cohortTo,
    ),
    selectAllBetween(
      'jm_likes',
      'worker_id,worker_liked,is_match,worker_confirmed,employer_confirmed,shift_completed,outcome,created_at',
      'created_at',
      cohortFrom,
      funnelNow.toISOString(),
    ),
    selectAllBetween(
      'jm_perm_applications',
      'worker_id,status,created_at',
      'created_at',
      cohortFrom,
      funnelNow.toISOString(),
    ),
    selectAllBetween(
      'jm_vacancy_views',
      'worker_id,viewed_at',
      'viewed_at',
      cohortFrom,
      funnelNow.toISOString(),
    ),
    selectAllBetween(
      'jm_perm_vacancy_views',
      'worker_id,viewed_at',
      'viewed_at',
      cohortFrom,
      funnelNow.toISOString(),
    ),
  ])

  const u = users ?? []
  const lk = likes ?? []
  const ap = permApps ?? []
  const ge = guestEvents ?? []

  const workers = u.filter((x: any) => x.role === 'worker')

  const likedLk = lk.filter((l: any) => l.worker_liked)
  const matchedLk = lk.filter((l: any) => l.is_match)
  const confirmedLk = lk.filter((l: any) => l.worker_confirmed && l.employer_confirmed)
  const completedLk = lk.filter((l: any) => l.shift_completed)

  const shiftsByWorker: Record<string, number> = {}
  for (const l of completedLk) {
    const wid = (l as any).worker_id
    shiftsByWorker[wid] = (shiftsByWorker[wid] ?? 0) + 1
  }
  const shiftCounts = Object.values(shiftsByWorker)
  const workersWithShift = shiftCounts.length
  const avgShiftsPerWorker = workersWithShift > 0
    ? (shiftCounts.reduce((a, b) => a + b, 0) / workersWithShift).toFixed(1) : '0'
  const returningWorkers = shiftCounts.filter(c => c > 1).length

  const likesByWorker: Record<string, number> = {}
  for (const l of likedLk) {
    const wid = (l as any).worker_id
    likesByWorker[wid] = (likesByWorker[wid] ?? 0) + 1
  }
  const likeCounts = Object.values(likesByWorker)
  const activityBuckets = [
    { name: '0 лайков', value: Math.max(0, workers.length - Object.keys(likesByWorker).length) },
    { name: '1', value: likeCounts.filter(c => c === 1).length },
    { name: '2–5', value: likeCounts.filter(c => c >= 2 && c <= 5).length },
    { name: '6–10', value: likeCounts.filter(c => c >= 6 && c <= 10).length },
    { name: '11+', value: likeCounts.filter(c => c > 10).length },
  ]

  const shiftBuckets = [
    { name: '1 смена', value: shiftCounts.filter(c => c === 1).length },
    { name: '2–3', value: shiftCounts.filter(c => c >= 2 && c <= 3).length },
    { name: '4–7', value: shiftCounts.filter(c => c >= 4 && c <= 7).length },
    { name: '8+', value: shiftCounts.filter(c => c >= 8).length },
  ]

  const days30 = dayRange(30)
  const likeByDay = groupByDate(likedLk, 'created_at')
  const matchByDay = groupByDate(matchedLk, 'created_at')
  const completedByDay = groupByDate(completedLk, 'created_at')
  const daily30 = days30.map(d => ({
    date: toDayLabel(d),
    likes: likeByDay[d] ?? 0,
    matches: matchByDay[d] ?? 0,
    completed: completedByDay[d] ?? 0,
  }))

  const guestUnique = (eventType: string, since?: string) =>
    new Set(ge.filter((e: any) =>
      e.event_type === eventType && (!since || e.occurred_at >= since)
    ).map((e: any) => e.anon_id)).size
  const guestEventsCount = (eventType: string, since?: string) =>
    ge.filter((e: any) => e.event_type === eventType && (!since || e.occurred_at >= since)).length
  const guestSince7 = subDays(funnelNow, 7).toISOString()
  const guestSince30 = subDays(funnelNow, 30).toISOString()
  const guestStarted30 = guestUnique('guest_started', guestSince30)
  const guestCompleted30 = guestUnique('registration_completed', guestSince30)
  const guestByDay = (eventType: string) => groupByDate(
    ge.filter((e: any) => e.event_type === eventType), 'occurred_at'
  )
  const guestImpressionsByDay = guestByDay('vacancy_impression')
  const guestIntentByDay = guestByDay('apply_intent')
  const guestCompletedByDay = guestByDay('registration_completed')
  const guestDaily30 = days30.map(d => ({
    date: toDayLabel(d),
    impressions: guestImpressionsByDay[d] ?? 0,
    intents: guestIntentByDay[d] ?? 0,
    registrations: guestCompletedByDay[d] ?? 0,
  }))
  const guestFunnel = [
    { name: 'Вошли гостем', value: guestUnique('guest_started', guestSince30), fill: PALETTE.blue },
    { name: 'Смотрели вакансии', value: guestUnique('vacancy_impression', guestSince30), fill: PALETTE.cyan },
    { name: 'Хотели откликнуться', value: guestUnique('apply_intent', guestSince30), fill: PALETTE.orange },
    { name: 'Зарегистрировались', value: guestCompleted30, fill: PALETTE.green },
  ]

  // Канал открытия восстанавливаем по campaign_id публикации: в самой
  // startapp-ссылке нет пользовательских данных и названия Telegram-чата.
  const telegramPublished30 = ge.filter((e: any) =>
    e.event_type === 'campaign_published' && e.campaign_id && e.occurred_at >= guestSince30
  )
  const telegramCampaigns = new Set(telegramPublished30.map((e: any) => e.campaign_id))
  const telegramEvents30 = ge.filter((e: any) =>
    e.campaign_id && telegramCampaigns.has(e.campaign_id) && e.occurred_at >= guestSince30
  )
  const telegramOpens30 = telegramEvents30.filter((e: any) => e.event_type === 'campaign_open').length
  const telegramApplies30 = telegramEvents30.filter((e: any) => e.event_type === 'campaign_apply').length
  const telegramRegistrations30 = new Set(
    telegramEvents30.filter((e: any) => e.event_type === 'registration_completed')
      .map((e: any) => e.anon_id)
  ).size
  const telegramFunnel = [
    { name: 'Публикации', value: telegramPublished30.length, fill: PALETTE.blue },
    { name: 'Открытия', value: telegramOpens30, fill: PALETTE.cyan },
    { name: 'Намерения откликнуться', value: telegramApplies30, fill: PALETTE.orange },
    { name: 'Регистрации', value: telegramRegistrations30, fill: PALETTE.green },
  ]

  // Органические рекомендации пользователей считаем отдельно от наших
  // публикаций: это самостоятельный канал привлечения с нулевой закупочной
  // стоимостью, и смешивание скрыло бы его реальную эффективность.
  const referralShared30 = ge.filter((e: any) =>
    e.event_type === 'campaign_shared' && e.channel === 'user_share'
      && e.campaign_id && e.occurred_at >= guestSince30
  )
  const referralCampaigns = new Set(referralShared30.map((e: any) => e.campaign_id))
  const referralEvents30 = ge.filter((e: any) =>
    e.campaign_id && referralCampaigns.has(e.campaign_id) && e.occurred_at >= guestSince30
  )
  const referralOpens30 = referralEvents30.filter((e: any) => e.event_type === 'campaign_open').length
  const referralApplies30 = referralEvents30.filter((e: any) => e.event_type === 'campaign_apply').length
  const referralRegistrations30 = new Set(
    referralEvents30.filter((e: any) => e.event_type === 'registration_completed')
      .map((e: any) => e.anon_id)
  ).size
  const referralFunnel = [
    { name: 'Поделились', value: referralShared30.length, fill: PALETTE.purple },
    { name: 'Открытия', value: referralOpens30, fill: PALETTE.cyan },
    { name: 'Намерения откликнуться', value: referralApplies30, fill: PALETTE.orange },
    { name: 'Регистрации', value: referralRegistrations30, fill: PALETTE.green },
  ]

  const cohortColors = [
    PALETTE.blue, PALETTE.cyan, PALETTE.purple,
    PALETTE.orange, PALETTE.amber, PALETTE.green,
  ]
  const workerActivation = buildWorkerActivationCohort(
    cohortUsers,
    cohortLikes,
    cohortPermApps,
    cohortShiftViews,
    cohortPermViews,
    funnelNow,
  )
  const mainFunnel = workerActivation.steps
    .map((step, index) => ({ ...step, fill: cohortColors[index] }))
  const [
    cohortWorkers,
    cohortProfileReady,
    cohortViewed,
    cohortApplied,
    cohortAccepted,
    cohortWorked,
  ] = workerActivation.steps.map(step => step.value)

  const eventFunnel = [
    { name: 'Лайки воркеров', value: likedLk.length, fill: PALETTE.blue },
    { name: 'Совпадения', value: matchedLk.length, fill: PALETTE.purple },
    { name: 'Подтверждено', value: confirmedLk.length, fill: PALETTE.orange },
    { name: 'Смены завершены', value: completedLk.length, fill: PALETTE.green },
  ]

  const permFunnel = [
    { name: 'Подано заявок', value: ap.length, fill: PALETTE.blue },
    { name: 'Одобрено', value: ap.filter((a: any) => a.status === 'approved').length, fill: PALETTE.green },
    { name: 'Отклонено', value: ap.filter((a: any) => a.status === 'rejected').length, fill: PALETTE.red },
  ]

  return {
    kpi: {
      workers: workers.length,
      cohortWorkers,
      cohortProfileReady,
      cohortViewed,
      cohortApplied,
      cohortAccepted,
      cohortWorked,
      cohortProfileRate: pct(cohortProfileReady, cohortWorkers),
      cohortViewRate: pct(cohortViewed, cohortProfileReady),
      cohortApplyRate: pct(cohortApplied, cohortProfileReady),
      cohortAcceptRate: pct(cohortAccepted, cohortApplied),
      cohortWorkRate: pct(cohortWorked, cohortWorkers),
      cohortAppliedWithin7d: workerActivation.appliedWithin7d,
      cohortAppliedWithin7dRate: pct(workerActivation.appliedWithin7d, cohortProfileReady),
      cohortProfileAnomalies: workerActivation.legacyProfileAnomalies,
      cohortBiggestDrop: workerActivation.biggestDrop,
      totalLikes: likedLk.length,
      totalMatches: matchedLk.length,
      matchRate: likedLk.length > 0 ? ((matchedLk.length / likedLk.length) * 100).toFixed(1) : '0',
      completedCount: completedLk.length,
      completionRate: matchedLk.length > 0 ? ((completedLk.length / matchedLk.length) * 100).toFixed(1) : '0',
      avgShiftsPerWorker,
      returningWorkers,
      returningRate: workersWithShift > 0 ? ((returningWorkers / workersWithShift) * 100).toFixed(1) : '0',
      permApplications: ap.length,
      permApproved: ap.filter((a: any) => a.status === 'approved').length,
      guestUnique7: guestUnique('guest_started', guestSince7),
      guestUnique30: guestStarted30,
      guestImpressions30: guestEventsCount('vacancy_impression', guestSince30),
      guestIntent30: guestEventsCount('apply_intent', guestSince30),
      guestRegistrations30: guestCompleted30,
      guestRegistrationRate30: guestStarted30 > 0
        ? ((guestCompleted30 / guestStarted30) * 100).toFixed(1) : '0',
      telegramPublished30: telegramPublished30.length,
      telegramOpens30,
      telegramApplies30,
      telegramRegistrations30,
      telegramOpenRate30: telegramPublished30.length > 0
        ? ((telegramOpens30 / telegramPublished30.length) * 100).toFixed(1) : '0',
      telegramApplyRate30: telegramOpens30 > 0
        ? ((telegramApplies30 / telegramOpens30) * 100).toFixed(1) : '0',
      telegramRegistrationRate30: telegramOpens30 > 0
        ? ((telegramRegistrations30 / telegramOpens30) * 100).toFixed(1) : '0',
      referralShared30: referralShared30.length,
      referralOpens30,
      referralApplies30,
      referralRegistrations30,
      referralOpenRate30: referralShared30.length > 0
        ? ((referralOpens30 / referralShared30.length) * 100).toFixed(1) : '0',
      referralApplyRate30: referralOpens30 > 0
        ? ((referralApplies30 / referralOpens30) * 100).toFixed(1) : '0',
      referralRegistrationRate30: referralOpens30 > 0
        ? ((referralRegistrations30 / referralOpens30) * 100).toFixed(1) : '0',
    },
    guestFunnel,
    guestDaily30,
    telegramFunnel,
    referralFunnel,
    mainFunnel,
    eventFunnel,
    daily30,
    activityBuckets,
    shiftBuckets,
    permFunnel,
  }
}

// ─── chats ───────────────────────────────────────────────────────────────────

// ─── exchange (биржа) ────────────────────────────────────────────────────────

// ─── executive summary (Сводка для презентаций) ──────────────────────────────

function median(arr: number[]): number {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ─── external vacancies ─────────────────────────────────────────────────────
//
// Внешние (карьерные) вакансии: каталог, здоровье сбора, свайпы и отклики через
// Jupiter. Каталог берём из открытого /api/feed_stats.php: там уже посчитаны
// «IT-лента» и «Москва» тем же правилом, что в самой ленте (FS_MOSCOW_RE,
// jm_it_companies) — повторять это правило здесь значило бы разойтись с ним.
// Показы карточек в базу не пишутся (таблица событий снята в 096), поэтому
// воронка начинается со свайпа, а не с показа.

const FEED_STATS_URL = process.env.NEXT_PUBLIC_FEED_STATS_URL || 'https://jobtoo.ru/api/feed_stats.php'

export const JOB_SECTION_LABELS: Record<string, string> = {
  it: 'IT и разработка', warehouse: 'Склад и логистика', delivery: 'Курьеры и доставка',
  transport: 'Водители и транспорт', retail: 'Магазины и торговый зал', food: 'Кафе и рестораны',
  production: 'Производство и рабочие', service: 'Уборка, охрана, сервис', sales: 'Продажи и клиенты',
  finance: 'Финансы и бухгалтерия', office: 'Офис, HR и юристы', marketing: 'Маркетинг и дизайн',
  medical: 'Медицина и аптеки', engineering: 'Инженеры и стройка', other: 'Другое',
}

export const JUPITER_STATE_LABELS: Record<string, string> = {
  queued: 'В очереди', running: 'Идёт', retryable_failed: 'Повтор', failed: 'Ошибка',
  submitted: 'Отправлен', verified: 'Подтверждён', needs_human: 'Ждёт человека',
}

type FeedStats = {
  generated_at: string
  total: number; it_total: number; it_feed_total: number; feed_total: number
  companies: number; it_companies: number
  by_section: Record<string, number>
  by_company: { company: string; total: number; it: number }[]
}

export async function fetchExternal() {
  const now = new Date()
  const since = subDays(now, 90).toISOString()
  const until = new Date(now.getTime() + 86_400_000).toISOString()

  const [stats, sourcesRes, swipes, apps] = await Promise.all([
    fetch(FEED_STATS_URL, { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<FeedStats>) : null))
      .catch(() => null),
    supabase.from('jm_ext_sources')
      .select('id,name,enabled,last_run_at,last_status,last_count,last_success_at,consecutive_failures,last_deactivated'),
    selectAllBetween('jm_ext_swipes', 'user_id,vacancy_id,dir,created_at', 'created_at', since, until),
    selectAllBetween('jm_jupiter_applications', 'user_id,company,state,created_at,submitted_at', 'created_at', since, until),
  ])

  // Компания и раздел свайпнутых вакансий — пачками по id, а не весь каталог.
  const ids = Array.from(new Set(swipes.map((s: any) => s.vacancy_id as string)))
  const vacById: Record<string, { title: string; company: string; section: string }> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('jm_ext_vacancies')
      .select('id,title,company,section').in('id', ids.slice(i, i + 200))
    for (const v of (data ?? []) as any[]) vacById[v.id] = { title: v.title ?? '', company: v.company ?? '—', section: v.section ?? 'other' }
  }

  const right = swipes.filter((s: any) => s.dir === 1)
  const left = swipes.filter((s: any) => s.dir === -1)
  const days30 = dayRange(30)
  const d30 = days30[0]
  const in30 = (iso?: string | null) => !!iso && iso.slice(0, 10) >= d30
  const right30 = right.filter((s: any) => in30(s.created_at))
  const left30 = left.filter((s: any) => in30(s.created_at))
  const apps30 = apps.filter((a: any) => in30(a.created_at))
  const submitted = apps.filter((a: any) => a.state === 'submitted' || a.state === 'verified')

  const rByDay = groupByDate(right30, 'created_at')
  const lByDay = groupByDate(left30, 'created_at')
  const aByDay = groupByDate(apps30, 'created_at')
  const daily30 = days30.map(d => ({ date: toDayLabel(d), right: rByDay[d] ?? 0, left: lByDay[d] ?? 0, apps: aByDay[d] ?? 0 }))

  const byState: Record<string, number> = {}
  for (const a of apps as any[]) byState[a.state] = (byState[a.state] ?? 0) + 1
  const appsByState = Object.entries(byState)
    .map(([state, value]) => ({ name: JUPITER_STATE_LABELS[state] ?? state, value }))
    .sort((a, b) => b.value - a.value)

  // По компаниям: интерес (свайпы) рядом с каталогом (активные вакансии) и откликами.
  const comp: Record<string, { right: number; left: number; apps: number; active: number; it: number }> = {}
  const row = (c: string) => (comp[c] ??= { right: 0, left: 0, apps: 0, active: 0, it: 0 })
  for (const s of swipes as any[]) {
    const c = vacById[s.vacancy_id]?.company ?? '—'
    if (s.dir === 1) row(c).right++; else row(c).left++
  }
  for (const a of apps as any[]) row(a.company || '—').apps++
  for (const c of stats?.by_company ?? []) { row(c.company).active = c.total; row(c.company).it = c.it }
  const companies = Object.entries(comp)
    .map(([name, v]) => ({ name, ...v, likeRate: v.right + v.left > 0 ? Math.round((v.right / (v.right + v.left)) * 100) : null }))
    .sort((a, b) => b.right - a.right || b.apps - a.apps || b.active - a.active)

  const secSwipes: Record<string, { right: number; left: number }> = {}
  for (const s of swipes as any[]) {
    const sec = vacById[s.vacancy_id]?.section ?? 'other'
    secSwipes[sec] ??= { right: 0, left: 0 }
    if (s.dir === 1) secSwipes[sec].right++; else secSwipes[sec].left++
  }
  const sections = Object.keys({ ...(stats?.by_section ?? {}), ...secSwipes })
    .map(k => ({ name: JOB_SECTION_LABELS[k] ?? k, active: stats?.by_section?.[k] ?? 0,
                 right: secSwipes[k]?.right ?? 0, left: secSwipes[k]?.left ?? 0 }))
    .sort((a, b) => b.active - a.active)

  const vacRight: Record<string, number> = {}
  for (const s of right as any[]) vacRight[s.vacancy_id] = (vacRight[s.vacancy_id] ?? 0) + 1
  const topVacancies = Object.entries(vacRight)
    .sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([id, n]) => ({ title: vacById[id]?.title || id, company: vacById[id]?.company ?? '—', right: n }))

  const sources = ((sourcesRes.data ?? []) as any[]).map(s => ({
    id: s.id as string, name: (s.name ?? s.id) as string, enabled: !!s.enabled,
    lastRunAt: s.last_run_at as string | null, lastStatus: (s.last_status ?? '') as string,
    lastCount: (s.last_count ?? 0) as number, lastSuccessAt: s.last_success_at as string | null,
    failures: (s.consecutive_failures ?? 0) as number, deactivated: (s.last_deactivated ?? 0) as number,
  }))

  const swipers = new Set(swipes.map((s: any) => s.user_id)).size
  const appliers = new Set(apps.map((a: any) => a.user_id)).size

  return {
    statsAt: stats?.generated_at ?? null,
    kpi: {
      active: stats?.total ?? null, itFeed: stats?.it_feed_total ?? null, feed: stats?.feed_total ?? null,
      companies: stats?.companies ?? null, itCompanies: stats?.it_companies ?? null,
      right30: right30.length, left30: left30.length,
      likeRate30: right30.length + left30.length > 0 ? Math.round((right30.length / (right30.length + left30.length)) * 100) : 0,
      swipers, appliers, apps90: apps.length, apps30: apps30.length, submitted: submitted.length,
      // Грубая конверсия за 90 дней: отклик не привязан к свайпу по id вакансии
      // (Jupiter хранит адрес), поэтому это отношение количеств, а не путь одного человека.
      applyRate: right.length > 0 ? Math.round((apps.length / right.length) * 100) : 0,
      submitRate: apps.length > 0 ? Math.round((submitted.length / apps.length) * 100) : 0,
    },
    funnel: [
      { name: 'Свайп вправо', value: right.length, fill: PALETTE.pink },
      { name: 'Отклик', value: apps.length, fill: PALETTE.purple },
      { name: 'Отправлен', value: submitted.length, fill: PALETTE.green },
    ],
    daily30, appsByState, companies, sections, topVacancies, sources,
  }
}
