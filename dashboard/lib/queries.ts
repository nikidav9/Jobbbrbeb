import { supabase } from './supabase'
import { subDays, format, eachDayOfInterval } from 'date-fns'
import { buildProduct, type ProductInput } from './productStats'

// Supabase режет выборку до 1000 строк. Для полных агрегатов
// тянем всю таблицу постранично, иначе счётчики занижаются.
async function selectAll(table: string, columns: string): Promise<any[]> {
  const page = 1000
  let from = 0
  const all: any[] = []
  for (;;) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + page - 1)
    if (error) throw error
    if (!data || data.length === 0) break
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

/** Чтение, которое не валит весь «Обзор»: не прочиталась таблица — пустой
 *  список и её имя в `failed`, чтобы панель честно сказала, чего не хватает. */
async function safeRead<T>(name: string, failed: string[], read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read()
  } catch {
    failed.push(name)
    return []
  }
}

/**
 * «Обзор» — метрики продукта. Счёт — lib/productStats.ts, здесь только
 * строки. Колонок берём ровно столько, сколько нужно для счёта: ни писем,
 * ни резюме, ни адресов вакансий панель здесь не просит.
 */
export async function fetchOverview() {
  const now = new Date()
  // Восемь недельных когорт + D30 у самой старой — с запасом 70 дней.
  const since = subDays(now, 70).toISOString()
  const until = new Date(now.getTime() + 86_400_000).toISOString()
  const failed: string[] = []
  const [users, resume, swipes, jupiter, permApps, emails] = await Promise.all([
    safeRead('jm_users', failed, () => selectAll('jm_users', 'id,role,created_at,first_name,last_name,is_blocked')),
    safeRead('jm_resume_files', failed, () => selectAll('jm_resume_files', 'user_id,selected')),
    safeRead('jm_ext_swipes', failed, () => selectAllBetween('jm_ext_swipes', 'user_id,dir,created_at', 'created_at', since, until)),
    safeRead('jm_jupiter_applications', failed, () => selectAllBetween('jm_jupiter_applications', 'user_id,state,reason_code,created_at', 'created_at', since, until)),
    safeRead('jm_perm_applications', failed, () => selectAllBetween('jm_perm_applications', 'worker_id,created_at', 'created_at', since, until)),
    safeRead('jm_jupiter_emails', failed, () => selectAllBetween('jm_jupiter_emails', 'user_id,received_at', 'received_at', since, until)),
  ])
  const input: ProductInput = {
    users,
    resumeUsers: resume.filter((r: any) => r.selected).map((r: any) => r.user_id),
    swipes,
    jupiter,
    permApps,
    emails,
  }
  return { ...buildProduct(input, now), failed }
}

// ─── users ───────────────────────────────────────────────────────────────────

export async function fetchUsers() {
  const since = subDays(new Date(), 90).toISOString()
  const until = new Date(Date.now() + 86_400_000).toISOString()
  // Активность в ленте — по каждому человеку: сколько свайпал и откликался,
  // когда последний раз. Не прочиталось — колонка покажет прочерк, список
  // людей всё равно откроется.
  const [{ data: users }, { data: webPushRows }, resumeRows, swipeRows, appRows] = await Promise.all([
    supabase
      .from('jm_users')
      .select('id,role,first_name,last_name,phone,email,is_blocked,created_at,push_token')
      .order('created_at', { ascending: false }),
    supabase
      .from('jm_web_push_subscriptions')
      .select('user_id,updated_at'),
    selectAll('jm_resume_files', 'user_id,selected').catch(() => null),
    selectAllBetween('jm_ext_swipes', 'user_id,created_at', 'created_at', since, until).catch(() => null),
    selectAllBetween('jm_jupiter_applications', 'user_id,created_at', 'created_at', since, until).catch(() => null),
  ])

  const u = users ?? []
  const webPushMap = new Map((webPushRows ?? []).map((r: any) => [r.user_id, r.updated_at as string]))
  const resumeSet = resumeRows ? new Set(resumeRows.filter((r: any) => r.selected).map((r: any) => r.user_id as string)) : null
  const act = new Map<string, { swipes: number; apps: number; last: string }>()
  const touch = (uid: string, at: string, kind: 'swipes' | 'apps') => {
    const row = act.get(uid) ?? { swipes: 0, apps: 0, last: '' }
    row[kind]++
    if (at > row.last) row.last = at
    act.set(uid, row)
  }
  for (const r of swipeRows ?? []) touch(r.user_id, r.created_at, 'swipes')
  for (const r of appRows ?? []) touch(r.user_id, r.created_at, 'apps')
  const activityKnown = swipeRows !== null && appRows !== null

  const days90 = dayRange(90)
  const w30 = subDays(new Date(), 30).toISOString()
  const w7 = subDays(new Date(), 7).toISOString()

  const regByDay = groupByDate(u, 'created_at')
  const growth90 = days90.map(d => ({ date: toDayLabel(d), regs: regByDay[d] ?? 0 }))

  const recent = u.map((x: any) => {
    const a = act.get(x.id)
    return {
      name: `${x.first_name ?? ''} ${x.last_name ?? ''}`.trim(),
      phone: x.phone,
      email: x.email ?? null,
      role: x.role,
      blocked: x.is_blocked,
      date: x.created_at?.slice(0, 10),
      id: x.id,
      hasResume: resumeSet ? resumeSet.has(x.id) : null,
      swipes: activityKnown ? (a?.swipes ?? 0) : null,
      apps: activityKnown ? (a?.apps ?? 0) : null,
      lastActive: a?.last ? a.last.slice(0, 10) : null,
      hasPushToken: !!x.push_token,
      hasWebPush: webPushMap.has(x.id),
      webPushDate: webPushMap.get(x.id)?.slice(0, 10) ?? null,
    }
  })

  const active7 = Array.from(act.values()).filter(a => a.last > w7).length

  return {
    kpi: {
      total: u.length,
      blocked: u.filter((x: any) => x.is_blocked).length,
      newWeek: u.filter((x: any) => x.created_at > w7).length,
      newMonth: u.filter((x: any) => x.created_at > w30).length,
      withResume: resumeSet ? u.filter((x: any) => resumeSet.has(x.id)).length : null,
      active7: activityKnown ? active7 : null,
      withPushToken: u.filter((x: any) => x.push_token).length,
      withWebPush: webPushMap.size,
      webPushNewWeek: (webPushRows ?? []).filter((r: any) => r.updated_at > w7).length,
      // Без Expo-токена — ещё не «недоступен»: у части этих людей подключён
      // веб-пуш с айфона. Недоступны только те, у кого нет ни того, ни другого.
      noPushAtAll: u.filter((x: any) => !x.push_token && !webPushMap.has(x.id)).length,
    },
    growth90,
    recent,
  }
}

// ─── vacancies ───────────────────────────────────────────────────────────────
//
// Только свои вакансии работодателей (jm_perm_vacancies). Смены закрыты
// 17.09.2026: их список, автозакрытие прошедших смен, просмотры, зарплатные
// корзины и «топ работодателей» сняты — своих вакансий единицы, а основная
// лента — внешние карьерные сайты (раздел «Внешние вакансии»).

export async function fetchVacancies() {
  const [{ data: pv }, { data: apps }, { data: users }] = await Promise.all([
    supabase.from('jm_perm_vacancies').select('id,title,status,created_at,employer_id,salary,company,metro_station,address,description,schedule,work_type'),
    supabase.from('jm_perm_applications').select('id,vacancy_id,worker_id,status,created_at').order('created_at', { ascending: false }),
    supabase.from('jm_users').select('id,first_name,last_name,phone'),
  ])

  const p = pv ?? []
  const ap = apps ?? []

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

  const w30 = subDays(new Date(), 30).toISOString()

  return {
    kpi: {
      totalPerm: p.length,
      openPerm: p.filter((x: any) => x.status === 'open').length,
      newMonth: p.filter((x: any) => x.created_at > w30).length,
      apps: ap.length,
      pendingApps: ap.filter((a: any) => (a.status ?? 'pending') === 'pending').length,
    },
    permVacancyCards,
  }
}

// ─── user profile ────────────────────────────────────────────────────────────

export async function fetchUserProfile(userId: string) {
  const [
    { data: user },
    { data: chats },
    { data: swipes },
    { data: jupiter },
    { data: permVacancies },
    { data: permApps },
    { data: resume },
    { data: webPushSub },
  ] = await Promise.all([
    supabase.from('jm_users').select('*').eq('id', userId).maybeSingle(),
    supabase.from('jm_chats').select('id,vac_title,company_name,created_at,worker_id,employer_id,vacancy_id')
      .or(`worker_id.eq.${userId},employer_id.eq.${userId}`)
      .order('created_at', { ascending: false }).limit(20),
    supabase.from('jm_ext_swipes').select('dir,created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(1000),
    // Без checkpoint и resume_token: там токены возобновления прогона.
    supabase.from('jm_jupiter_applications').select('id,company,state,reason_code,created_at,submitted_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
    supabase.from('jm_perm_vacancies').select('id,title,status,created_at,company,address')
      .eq('employer_id', userId).order('created_at', { ascending: false }).limit(20),
    supabase.from('jm_perm_applications').select('id,vacancy_id,status,created_at')
      .eq('worker_id', userId).order('created_at', { ascending: false }).limit(20),
    supabase.from('jm_resume_files').select('imported_at,selected')
      .eq('user_id', userId).eq('selected', true).maybeSingle(),
    supabase.from('jm_web_push_subscriptions').select('updated_at').eq('user_id', userId).maybeSingle(),
  ])

  const sw = (swipes ?? []) as any[]
  return {
    user: user ?? null,
    chats: chats ?? [],
    jupiter: jupiter ?? [],
    permVacancies: permVacancies ?? [],
    permApps: permApps ?? [],
    swipesRight: sw.filter(s => s.dir === 1).length,
    swipesLeft: sw.filter(s => s.dir === -1).length,
    lastSwipe: sw[0]?.created_at?.slice(0, 10) ?? null,
    resume: (resume as any) ?? null,
    hasWebPush: !!webPushSub,
    webPushDate: (webPushSub as any)?.updated_at?.slice(0, 10) ?? null,
  }
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
