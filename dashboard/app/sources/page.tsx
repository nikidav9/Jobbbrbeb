'use client'
import { useCallback, useEffect, useState } from 'react'
import PageHeader from '@/components/PageHeader'
import Button from '@/components/Button'
import Chip from '@/components/Chip'
import KpiCard from '@/components/KpiCard'
import { getToken } from '@/lib/adminApi'

/**
 * Источники чужих вакансий.
 *
 * Вторая половина агрегатора: сюда добавляют адрес фида партнёра, и с него
 * начинают втекать вакансии. Первая половина — «Ключи API» — про обратное:
 * там мы отдаём свои.
 *
 * Страница отвечает на один вопрос, который иначе выясняется жалобой: жив ли
 * фид. «Источник добавлен» ничего не значит — значит только «в последний
 * заход получено столько-то». Поэтому в таблице не настройки, а результат.
 */

type Source = {
  id: string
  name: string
  url: string
  enabled: boolean
  period_min: number
  last_run_at: string | null
  last_status: string | null
  last_count: number | null
  last_success_at: string | null
  consecutive_failures: number
  last_duration_ms: number | null
  last_pages: number | null
  last_skipped: number | null
  last_deactivated: number | null
  auth_configured: boolean
  environment: 'production' | 'sandbox'
  notifications_enabled: boolean
  connector_kind: string
  integration_mode: 'redirect' | 'embedded_test' | 'embedded'
  integration_configured: boolean
  career_pages: string[]
}

type PartnerReport = {
  аудитория_работников: number
  активных_работников: number
  новых_регистраций: number
  уникальный_охват: number
  уникальный_интерес: number
  уникальные_конверсии: number
  конверсия_охват_интерес_pct: number | null
  конверсия_интерес_отклик_pct: number | null
  расходы_rub: number
  стоимость_отклика_rub: number | null
  новых_для_партнёра: number
  известных_партнёру: number
  статус_новизны_не_передан: number
  доля_новых_pct: number | null
  регионы_аудитории: Record<string, number>
  регионы_активной_аудитории: Record<string, number>
  регионы_партнёрской_активности: Record<string, number>
}

type Stats = {
  всего: number
  по_источникам: Record<string, number>
  показы_7дней?: number
  переходов_7дней?: number
  конверсии_7дней?: number
  ctr_7дней?: number
  конверсия_из_переходов_7дней?: number
  ошибок_фида_7дней?: number
  воронка_по_источникам_7дней?: Record<string, {
    impressions: number
    clicks: number
    conversions: number
  }>
  без_станции?: number
  без_профессии?: number
  партнёрский_отчёт_30дней?: PartnerReport
}

type ExtVacancy = {
  id: string
  source_id: string
  source_name: string | null
  title: string
  company: string | null
  metro_station: string | null
  metro_station_norm: string | null
  work_type: string | null
  kind: string
  date: string | null
  salary: number | null
  pay_period: string | null
  url: string
}

function when(v: string | null): string {
  if (!v) return 'ни разу'
  const diff = Date.now() - new Date(v).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  return `${Math.floor(h / 24)} дн назад`
}

const SAMPLE = 'https://jobtoo.ru/api/v1/sample-feed.json'

/**
 * Что именно лежит в базе.
 *
 * Понадобилось после простого вопроса, на который нечем было ответить:
 * «у нас три чужих вакансии — что это за вакансии?». Сводка отвечала
 * «три» и молчала о том, какие.
 *
 * Показываем и разобранное, и исходное: рядом с приведённой станцией —
 * то, как её прислал источник. По одной приведённой не понять, почему
 * разбор ошибся, а поправлять придётся именно исходное.
 */
function VacancyList() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<ExtVacancy[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    setErr(null)
    try {
      const res = await fetch('/api/admin/ext-sources?vacancies=1', {
        headers: { 'X-Admin-Token': getToken() },
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setRows((data.vacancies ?? []) as ExtVacancy[])
    } catch (e: any) { setErr(e.message) }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && rows === null) load()
  }

  return (
    <div className="jt-card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>Чужие вакансии в базе</div>
        <Button onClick={toggle}>{open ? 'Свернуть' : 'Показать'}</Button>
        {open && <Button onClick={load}>Обновить</Button>}
      </div>

      {err && <div style={{ padding: '0 16px 16px', color: 'var(--negative)', fontSize: 13.5 }}>{err}</div>}

      {open ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="jt-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                {['Вакансия', 'Источник', 'Метро', 'Профессия', 'Когда', 'Оплата', ''].map(h => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={7} style={{ padding: 16, color: 'var(--ink-3)' }}>Загружаю…</td></tr>}
              {rows !== null && !rows.length && (
                <tr><td colSpan={7} style={{ padding: 16, color: 'var(--ink-3)' }}>Пока пусто.</td></tr>
              )}
              {(rows ?? []).map(v => (
                <tr key={v.id}>
                  <td>
                    <div style={{ fontWeight: 550, color: 'var(--ink)' }}>{v.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{v.company ?? '—'}</div>
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}>{v.source_name ?? v.source_id}</td>
                  <td>
                    {v.metro_station_norm
                      ? <span style={{ color: 'var(--ink-2)' }}>{v.metro_station_norm}</span>
                      : <Chip tone="neutral">не узнали</Chip>}
                    {v.metro_station && v.metro_station !== v.metro_station_norm ? (
                      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>прислали: {v.metro_station}</div>
                    ) : null}
                  </td>
                  <td style={{ color: 'var(--ink-2)' }}>
                    {v.work_type ?? <Chip tone="neutral">—</Chip>}
                  </td>
                  <td className="num" style={{ color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
                    {v.kind === 'permanent' ? 'постоянная' : (v.date ?? '—')}
                  </td>
                  <td className="num" style={{ color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
                    {v.salary ? `${v.salary.toLocaleString('ru-RU')} ₽` : '—'}
                    {v.salary && v.pay_period ? <span style={{ color: 'var(--ink-3)' }}> / {v.pay_period}</span> : null}
                  </td>
                  <td>
                    <a href={v.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>открыть</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

export default function SourcesPage() {
  const [items, setItems] = useState<Source[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [updated, setUpdated] = useState('')

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [header, setHeader] = useState('')
  const [value, setValue] = useState('')
  const [period, setPeriod] = useState(30)
  const [environment, setEnvironment] = useState<'production' | 'sandbox'>('sandbox')
  const [costSource, setCostSource] = useState('')
  const [costAmount, setCostAmount] = useState('')
  const [costDate, setCostDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [costNote, setCostNote] = useState('')
  const [careerDrafts, setCareerDrafts] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin/ext-sources', { headers: { 'X-Admin-Token': getToken() } })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const loaded = (data.items ?? []) as Source[]
      setItems(loaded)
      setCareerDrafts(Object.fromEntries(
        loaded.filter(s => s.connector_kind === 'career')
          .map(s => [s.id, (s.career_pages ?? []).join('\n')]),
      ))
      setStats(data.stats ?? null)
      setUpdated(new Date().toLocaleTimeString('ru-RU'))
    } catch (e: any) { setErr(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function send(body: unknown, method: 'POST' | 'DELETE' = 'POST') {
    const res = await fetch('/api/admin/ext-sources', {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': getToken() },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data
  }

  async function add() {
    if (!name.trim() || !url.trim()) return
    setBusy('add'); setErr(null)
    try {
      await send({
        name, url, auth_header: header || null, auth_value: value || null,
        period_min: period, environment,
        notifications_enabled: environment === 'production',
      })
      setName(''); setUrl(''); setHeader(''); setValue('')
      await load()
    } catch (e: any) { setErr(e.message) }
    setBusy(null)
  }

  async function saveCost() {
    const amount = Number(costAmount.replace(',', '.'))
    if (!costSource || !Number.isFinite(amount) || amount <= 0 || !costDate) return
    setBusy('cost'); setErr(null)
    try {
      await send({ cost: { source_id: costSource, amount_rub: amount, incurred_at: costDate, note: costNote } })
      setCostAmount(''); setCostNote('')
      await load()
    } catch (e: any) { setErr(e.message) }
    setBusy(null)
  }

  async function runNow(s: Source) {
    setBusy(s.id); setErr(null)
    try { await send({ run: s.id }); await load() }
    catch (e: any) { setErr(e.message) }
    setBusy(null)
  }

  async function toggle(s: Source) {
    if (!s.enabled && s.connector_kind === 'career' && !(s.career_pages ?? []).length) {
      setErr('Сначала сохраните хотя бы одну карьерную страницу')
      return
    }
    setBusy(s.id); setErr(null)
    try { await send({ ...s, enabled: !s.enabled }); await load() }
    catch (e: any) { setErr(e.message) }
    setBusy(null)
  }

  async function saveCareerPages(s: Source) {
    const pages = Array.from(new Set(
      (careerDrafts[s.id] ?? '').split('\n').map(v => v.trim()).filter(Boolean),
    ))
    setBusy(s.id); setErr(null)
    try {
      await send({ ...s, career_pages: pages })
      await load()
    } catch (e: any) { setErr(e.message) }
    setBusy(null)
  }

  async function remove(s: Source) {
    if (!confirm(`Удалить «${s.name}»? Все его вакансии тоже исчезнут из ленты.`)) return
    setBusy(s.id); setErr(null)
    try { await send({ id: s.id }, 'DELETE'); await load() }
    catch (e: any) { setErr(e.message) }
    setBusy(null)
  }

  const box: React.CSSProperties = {
    border: '1px solid var(--line)', borderRadius: 'var(--radius)',
    padding: 16, background: 'var(--bg-elev)',
  }
  const field: React.CSSProperties = {
    padding: '9px 12px', borderRadius: 'var(--radius-sm)', fontSize: 14,
    border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--ink)',
  }

  return (
    <div>
      <PageHeader title="Источники вакансий" lastUpdated={updated} onRefresh={load} />

      <div className="page-content" style={{ maxWidth: 1000 }}>

        <div className="g-3">
          <KpiCard label="Источников" value={items.length}
            sub={items.length ? `включено ${items.filter(s => s.enabled).length}` : 'пока ни одного'} />
          <KpiCard label="Чужих вакансий" value={stats?.всего ?? null} sub="сейчас в базе" />
          <KpiCard label="Показов за неделю" value={stats?.показы_7дней ?? null}
            sub="карточка была видна пользователю" />
          <KpiCard label="Переходов за неделю" value={stats?.переходов_7дней ?? null}
            sub={`CTR ${(stats?.ctr_7дней ?? 0).toLocaleString('ru-RU')}%`} />
          <KpiCard label="Конверсий за неделю" value={stats?.конверсии_7дней ?? null}
            sub={`${(stats?.конверсия_из_переходов_7дней ?? 0).toLocaleString('ru-RU')}% от переходов`} />
          <KpiCard label="Ошибок фида за неделю" value={stats?.ошибок_фида_7дней ?? null}
            sub={`сейчас с ошибкой: ${items.filter(s => s.last_status && !s.last_status.startsWith('ок')).length}`} />
        </div>

        {stats?.партнёрский_отчёт_30дней ? (() => {
          const p = stats.партнёрский_отчёт_30дней
          const pct = (v: number | null) => v === null ? 'нет данных' : `${v.toLocaleString('ru-RU')}%`
          const money = (v: number | null) => v === null ? 'нет данных' : `${v.toLocaleString('ru-RU')} ₽`
          const regions = Object.entries(p.регионы_активной_аудитории).slice(0, 10)
          return (
            <div className="jt-card"
              style={{ padding: 16, position: 'relative', overflow: 'hidden' }}>
              <div style={{ fontSize: 17, fontWeight: 650, marginBottom: 4 }}>Отчёт для партнёра · 30 дней</div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14 }}>
                Только production-источники и уникальные незаблокированные работники. Неизвестные значения не заменяются нулями.
              </div>
              <div className="g-3">
                <KpiCard label="Аудитория работников" value={p.аудитория_работников}
                  sub={`активны: ${p.активных_работников} · новых: ${p.новых_регистраций}`} />
                <KpiCard label="Уникальный охват" value={p.уникальный_охват}
                  sub={`интерес: ${p.уникальный_интерес}`} />
                <KpiCard label="Подтверждённые отклики" value={p.уникальные_конверсии}
                  sub={`из интереса: ${pct(p.конверсия_интерес_отклик_pct)}`} />
                <KpiCard label="Стоимость отклика" value={money(p.стоимость_отклика_rub)}
                  sub={p.расходы_rub > 0 ? `расходы: ${money(p.расходы_rub)}` : 'внесите фактические расходы'} />
                <KpiCard label="Доля новых кандидатов" value={pct(p.доля_новых_pct)}
                  sub={`подтверждено новых: ${p.новых_для_партнёра} · неизвестно: ${p.статус_новизны_не_передан}`} />
                <KpiCard label="Охват → интерес" value={pct(p.конверсия_охват_интерес_pct)}
                  sub="по уникальным кандидатам" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16, marginTop: 16 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Активная аудитория по регионам</div>
                  {regions.length ? regions.map(([region, count]) => (
                    <div key={region} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                      <span style={{ color: 'var(--ink-2)' }}>{region}</span><b className="num">{count}</b>
                    </div>
                  )) : <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Регион пока не указан.</div>}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Добавить расходы пилота</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    <select className="jt-input" value={costSource} onChange={e => setCostSource(e.target.value)}>
                      <option value="">Выберите production-источник</option>
                      {items.filter(s => s.environment === 'production').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <input className="jt-input num" inputMode="decimal" value={costAmount}
                      onChange={e => setCostAmount(e.target.value)} placeholder="Сумма, ₽" />
                    <input className="jt-input" type="date" value={costDate} onChange={e => setCostDate(e.target.value)} />
                    <input className="jt-input" value={costNote} onChange={e => setCostNote(e.target.value)}
                      placeholder="Комментарий — например, рекламная кампания" />
                    <Button onClick={saveCost} disabled={busy === 'cost' || !costSource || !costAmount || !costDate}>
                      Учесть расход
                    </Button>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
                    Стоимость отклика = фактические расходы / уникальные подтверждённые партнёром отклики.
                  </div>
                </div>
              </div>
            </div>
          )
        })() : null}

        {/* Качество разбора. Станция, которую мы не узнали, не попадает в
            фильтр по метро — вакансия висит в поиске, но найти её по метро
            нельзя. Молчать об этом нельзя: снаружи это выглядит как «поиск
            не работает». */}
        {stats && ((stats.без_станции ?? 0) > 0 || (stats.без_профессии ?? 0) > 0) ? (
          <div className="jt-card" style={{ padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Что не разобралось</div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-2)', maxWidth: '68ch' }}>
              Станция не узнана: <b className="num">{stats.без_станции ?? 0}</b> — эти вакансии есть
              в поиске, но не находятся по метро.{' '}
              Профессия не определена: <b className="num">{stats.без_профессии ?? 0}</b> — не попадают
              под фильтр по профессии.
              {' '}Если доля велика, стоит попросить источник присылать станцию отдельным полем,
              без приставок и пояснений.
            </div>
          </div>
        ) : null}

        <div className="jt-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Как это работает</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', maxWidth: '68ch' }}>
            Партнёр даёт адрес, отдающий JSON. Мы забираем сами по расписанию — так партнёру
            не нужно заводить у себя очередь и следить за доставкой. Обязательных полей три:
            <code> id</code>, <code>title</code>, <code>url</code>. Формат целиком —{' '}
            <a href={SAMPLE} target="_blank" rel="noreferrer">образец фида</a>.
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 8, maxWidth: '68ch' }}>
            По умолчанию человек откликается на сайте источника. После настройки подписанного API
            источник можно перевести во встроенный режим — тогда повторная регистрация не нужна.
          </div>
        </div>

        <div className="jt-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Добавить источник</div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            <input className="jt-input" value={name} onChange={e => setName(e.target.value)} placeholder="Кто — например, «Яндекс Смены»" />
            <input className="jt-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="Адрес фида (https://…)" />
            <input className="jt-input" value={header} onChange={e => setHeader(e.target.value)} placeholder="Заголовок доступа — если нужен" />
            <input className="jt-input" value={value} onChange={e => setValue(e.target.value)} placeholder="Значение заголовка" />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              заходить каждые{' '}
              <input type="number" min={5} max={1440} value={period}
                onChange={e => setPeriod(Math.max(5, Number(e.target.value) || 30))}
                className="jt-input num" style={{ width: 88 }} /> мин
            </label>
            <label style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              режим{' '}
              <select className="jt-input" value={environment}
                onChange={e => setEnvironment(e.target.value as 'production' | 'sandbox')}>
                <option value="sandbox">Sandbox — скрыто</option>
                <option value="production">Production — пользователям</option>
              </select>
            </label>
            <Button variant="primary" onClick={add} disabled={busy === 'add' || !name.trim() || !url.trim()}>
              Добавить
            </Button>
            <Button onClick={() => { setName('Образец (проверка)'); setUrl(SAMPLE); setPeriod(60) }}>
              Подставить наш образец
            </Button>
          </div>
          <div style={{ fontSize: 12.5, color: environment === 'sandbox' ? 'var(--positive)' : 'var(--negative)', marginTop: 8 }}>
            {environment === 'sandbox'
              ? 'Безопасный режим: вакансии не видны пользователям, уведомления запрещены на уровне базы.'
              : 'Боевой режим: вакансии появятся в приложении. Использовать только после приёмки и письменного допуска.'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8 }}>
            Смены на сегодня протухают за часы — для них 15–30 минут. Постоянные вакансии живут
            неделями, там хватит и раза в сутки.
          </div>
        </div>

        {err && <div className="jt-card" style={{ padding: 16, borderColor: 'var(--negative)', color: 'var(--negative)', fontSize: 13.5 }}>{err}</div>}

        <div className="jt-card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
          <table className="jt-table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                {['Источник', 'Последний заход', 'Что вышло', 'Готовность', 'В базе', 'Показы', 'Переходы', 'Конверсии', ''].map(h => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ padding: 16, color: 'var(--ink-3)' }}>Загружаю…</td></tr>}
              {!loading && !items.length && (
                <tr><td colSpan={9} style={{ padding: 16, color: 'var(--ink-3)' }}>
                  Источников пока нет. Нажмите «Подставить наш образец», чтобы посмотреть, как всё работает.
                </td></tr>
              )}
              {items.map(s => {
                const failed = !!s.last_status && !s.last_status.startsWith('ок')
                return (
                  // Выключенный источник приглушается фоном, а не прозрачностью:
                  // при 0.55 его состояние перестаёт читаться, а именно за ним
                  // сюда и заходят.
                  <tr key={s.id} style={{ background: s.enabled ? undefined : 'var(--bg-sunken)' }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 550, color: 'var(--ink)' }}>{s.name}</span>
                        {!s.enabled && <Chip tone="neutral">Выключен</Chip>}
                        {s.environment === 'sandbox' && <Chip tone="neutral">Sandbox</Chip>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', wordBreak: 'break-all' }}>{s.url}</div>
                      {s.connector_kind === 'career' ? (
                        <textarea className="jt-input" rows={3}
                          value={careerDrafts[s.id] ?? ''}
                          onChange={e => setCareerDrafts(d => ({ ...d, [s.id]: e.target.value }))}
                          placeholder="Один HTTPS-адрес карьерной страницы на строку"
                          style={{ width: '100%', minWidth: 260, marginTop: 8, resize: 'vertical' }} />
                      ) : null}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="num" style={{ color: 'var(--ink-2)' }}>{when(s.last_run_at)}</span>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>каждые {s.period_min} мин</div>
                    </td>
                    <td>
                      {s.last_status
                        ? <Chip tone={failed ? 'negative' : 'positive'}>{s.last_status}</Chip>
                        : <span style={{ color: 'var(--ink-3)' }}>ещё не заходили</span>}
                    </td>
                    <td style={{ minWidth: 150 }}>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        <Chip tone={(s.consecutive_failures ?? 0) > 0 ? 'negative' : 'positive'}>
                          {(s.consecutive_failures ?? 0) > 0
                            ? `ошибок подряд: ${s.consecutive_failures}`
                            : 'стабилен'}
                        </Chip>
                        {s.auth_configured && <Chip tone="neutral">доступ настроен</Chip>}
                        {s.integration_mode === 'embedded' && s.integration_configured
                          ? <Chip tone="positive">отклик внутри JobToo</Chip>
                          : s.integration_mode === 'embedded_test'
                          ? <Chip tone="neutral">тест встроенного отклика</Chip>
                          : <Chip tone="neutral">переход по ссылке</Chip>}
                      </div>
                      <div className="num" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
                        успешно: {when(s.last_success_at)}
                        {s.last_duration_ms != null ? ` · ${(s.last_duration_ms / 1000).toLocaleString('ru-RU')} с` : ''}
                        {s.last_pages != null ? ` · ${s.last_pages} стр.` : ''}
                        {s.last_skipped != null ? ` · пропущено ${s.last_skipped}` : ''}
                      </div>
                    </td>
                    <td className="num" style={{ color: 'var(--ink-2)' }}>
                      {stats?.по_источникам?.[s.id] ?? 0}
                    </td>
                    <td className="num" style={{ color: 'var(--ink-2)' }}>
                      {stats?.воронка_по_источникам_7дней?.[s.id]?.impressions ?? 0}
                    </td>
                    <td className="num" style={{ color: 'var(--ink-2)' }}>
                      {stats?.воронка_по_источникам_7дней?.[s.id]?.clicks ?? 0}
                    </td>
                    <td className="num" style={{ color: 'var(--ink-2)' }}>
                      {stats?.воронка_по_источникам_7дней?.[s.id]?.conversions ?? 0}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button style={{ height: 28, padding: '0 10px' }}
                          onClick={() => runNow(s)} disabled={busy === s.id}>
                          {busy === s.id ? '…' : 'Проверить'}
                        </Button>
                        <Button style={{ height: 28, padding: '0 10px' }}
                          onClick={() => toggle(s)} disabled={busy === s.id}>
                          {s.enabled ? 'Выключить' : 'Включить'}
                        </Button>
                        {s.connector_kind === 'career' ? (
                          <Button style={{ height: 28, padding: '0 10px' }}
                            onClick={() => saveCareerPages(s)} disabled={busy === s.id}>
                            Сохранить адреса
                          </Button>
                        ) : null}
                        <Button variant="danger" style={{ height: 28, padding: '0 10px' }}
                          onClick={() => remove(s)} disabled={busy === s.id}>
                          Удалить
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>

        <VacancyList />

        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', maxWidth: '68ch' }}>
          Чужие вакансии видны людям во вкладке «Поиск» — с пометкой источника и кнопкой
          «Открыть у источника». Откликнуться у нас на них нельзя, и карточка об этом говорит
          прямо: отклик происходит на той стороне.
        </div>
      </div>
    </div>
  )
}
