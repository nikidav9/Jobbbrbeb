'use client'
import { useCallback } from 'react'
import { fetchOverview, PALETTE } from '@/lib/queries'
import { DAILY_LIMIT, type RetentionRow } from '@/lib/productStats'
import { useRealtime } from '@/lib/useRealtime'
import KpiCard from '@/components/KpiCard'
import ChartCard from '@/components/ChartCard'
import PageHeader from '@/components/PageHeader'
import PageSkeleton from '@/components/PageSkeleton'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { AXIS, GRID, LEGEND, TT } from '@/lib/chart'

/**
 * «Обзор» — метрики продукта, а не базы.
 *
 * Пять вопросов, ради которых владелец открывает панель:
 *   1. доходят ли новые люди до первого отклика (активация);
 *   2. возвращаются ли (удержание D1/D7/D30 по недельным когортам);
 *   3. сколько людей живёт в ленте каждый день (DAU/WAU/MAU, липкость);
 *   4. хватает ли лимита в 10 откликов (отклики на активного, упёрлись в лимит);
 *   5. что Юпитер делает с откликами (ушёл / скорее всего / ждёт человека / ошибка).
 *
 * Счёт — lib/productStats.ts. Пустая база — нули и прочерки, не ошибка.
 */

const pctText = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : `${(v * 100).toFixed(digits)}%`

const num = (v: number) => v.toLocaleString('ru-RU')

const hoursText = (h: number | null) => {
  if (h == null) return '—'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} мин`
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} ч`
  return `${Math.round(h / 24)} дн`
}

const OUTCOME_COLOR: Record<string, string> = {
  sent: PALETTE.green,
  likely: PALETTE.cyan,
  human: PALETTE.amber,
  error: PALETTE.red,
  parked: PALETTE.purple,
  working: PALETTE.blue,
  duplicate: PALETTE.gray,
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>{text}</div>
  )
}

/** Полоса: длина — от наибольшего значения, число и доля — текстом рядом. */
function BarRow({ name, hint, value, max, color, note }: {
  name: string; hint?: string; value: number; max: number; color: string; note?: string
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, marginBottom: 5 }}>
        <span style={{ color: 'var(--ink-2)' }}>{name}</span>
        {note && <span className="num" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{note}</span>}
        <span className="num" style={{ marginLeft: 'auto', color: 'var(--ink)', fontWeight: 550 }}>{num(value)}</span>
      </div>
      <div style={{ height: 8, background: 'var(--bg-sunken)', borderRadius: 4 }}>
        <div style={{
          width: `${max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0}%`,
          height: '100%', background: color, borderRadius: 4,
          transition: 'width var(--slow) var(--ease)',
        }} />
      </div>
      {hint && <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

/** Ячейка удержания: доля и знаменатель; не дожили — прочерк. */
function RetCell({ v, n }: { v: number | null; n: number }) {
  if (v == null) return <td style={cell}><span style={{ color: 'var(--ink-4)' }}>—</span></td>
  // Интенсивность фона — от доли: одна гамма (акцент), светлее → темнее.
  const alpha = Math.min(0.85, 0.08 + v * 0.9)
  return (
    <td style={cell}>
      <span className="num" style={{
        display: 'inline-block', minWidth: 52, padding: '3px 8px', borderRadius: 6,
        background: `rgba(255, 107, 26, ${alpha.toFixed(2)})`,
        color: alpha > 0.5 ? '#141414' : 'var(--ink)', fontWeight: 550,
      }} title={`${Math.round(v * n)} из ${n}`}>{pctText(v)}</span>
      <span className="num" style={{ fontSize: 10.5, color: 'var(--ink-3)', marginLeft: 6 }}>из {n}</span>
    </td>
  )
}

const cell: React.CSSProperties = { padding: '8px 12px 8px 0', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--ink-3)', fontWeight: 500, padding: '0 12px 10px 0', borderBottom: '1px solid var(--line)',
}

function RetentionTable({ rows, total }: {
  rows: RetentionRow[]
  total: { d1: number | null; d7: number | null; d30: number | null; n1: number; n7: number; n30: number }
}) {
  if (rows.every(r => r.size === 0)) return <Empty text="Регистраций за восемь недель пока нет" />
  return (
    <div className="table-scroll">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr>{['Неделя регистрации', 'Людей', 'D1', 'D7', 'D30'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cell, fontWeight: 600, color: 'var(--ink)' }}>Все когорты</td>
            <td style={cell} className="num">{num(rows.reduce((a, r) => a + r.size, 0))}</td>
            <RetCell v={total.d1} n={total.n1} />
            <RetCell v={total.d7} n={total.n7} />
            <RetCell v={total.d30} n={total.n30} />
          </tr>
          {rows.map(r => (
            <tr key={r.week}>
              <td style={{ ...cell, color: 'var(--ink-2)' }} className="num">{r.label}</td>
              <td style={cell} className="num">{num(r.size)}</td>
              <RetCell v={r.d1} n={r.n1} />
              <RetCell v={r.d7} n={r.n7} />
              <RetCell v={r.d30} n={r.n30} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function OverviewPage() {
  const fetcher = useCallback(() => fetchOverview(), [])
  const { data: d, loading, error, lastUpdated, pulse, refresh } = useRealtime(fetcher, { intervalSec: 60 })

  if (loading && !d) return <PageSkeleton rows={3} />
  if (!d) {
    return (
      <div>
        <PageHeader title="Обзор" intervalSec={60} lastUpdated={lastUpdated} pulse={pulse} onRefresh={refresh} />
        <div className="page-content">
          <ChartCard title="Не удалось загрузить" sub={error ?? 'Сервер не ответил'}>
            <Empty text="Обновите страницу через минуту" />
          </ChartCard>
        </div>
      </div>
    )
  }

  const f = d.funnel
  const fMax = Math.max(f[0]?.value ?? 0, 1)
  const funnelColors = [PALETTE.blue, PALETTE.cyan, PALETTE.purple, PALETTE.orange, PALETTE.green]
  const outMax = Math.max(...d.outcomes.map(o => o.value), 1)
  const noActivity = d.daily.every(x => x.dau === 0 && x.regs === 0)
  const noApps = d.applyDays === 0

  return (
    <div>
      <PageHeader title="Обзор" intervalSec={60} lastUpdated={lastUpdated} pulse={pulse} onRefresh={refresh} />

      <div className="page-content">
        {d.failed.length > 0 && (
          <div style={{
            padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 12.5,
            background: 'var(--negative-soft)', border: '1px solid var(--negative-line)', color: 'var(--negative)',
          }}>
            Не прочитались таблицы: {d.failed.join(', ')}. Цифры, которые от них зависят, занижены.
          </div>
        )}

        {/* Активность сейчас */}
        <div className="g-4">
          <KpiCard label="Активны сегодня" value={d.dau}
            sub={`вчера: ${num(d.dauYesterday)} · свайп или отклик`} sparkColor={PALETTE.orange} />
          <KpiCard label="За 7 дней (WAU)" value={d.wau}
            sub={`за 30 дней (MAU): ${num(d.mau)}`} sparkColor={PALETTE.blue} />
          <KpiCard label="Липкость DAU/MAU" value={pctText(d.stickiness)}
            sub={`средний DAU за 30 дней: ${d.avgDau.toFixed(1)}`} sparkColor={PALETTE.purple} />
          <KpiCard label="Соискателей в базе" value={d.seekers}
            sub={`новых сегодня: ${num(d.newToday)} · за 7 дней: ${num(d.new7)}`} sparkColor={PALETTE.green} />
        </div>

        {/* Отклики и лимит */}
        <div className="g-4">
          <KpiCard label="Откликов за 30 дней" value={d.apps30}
            sub="Юпитер и свои вакансии" sparkColor={PALETTE.orange} />
          <KpiCard label="Откликов на активного в день"
            value={d.appsPerActiveDay == null ? null : d.appsPerActiveDay.toFixed(1)}
            sub={d.appsPerApplyDay == null ? 'откликов пока нет' : `у откликавшихся в этот день: ${d.appsPerApplyDay.toFixed(1)}`} />
          <KpiCard label={`Упёрлись в лимит ${DAILY_LIMIT}`} value={pctText(d.limitShare)}
            sub={`${num(d.limitDays)} из ${num(d.applyDays)} дней с откликами · людей: ${num(d.limitUsers)}`}
            sparkColor={PALETTE.red} />
          <KpiCard label="До первого отклика" value={hoursText(d.hoursToApply)}
            sub={`медиана от регистрации · до первого свайпа: ${hoursText(d.hoursToSwipe)}`} />
        </div>

        <div className="g-14">
          <ChartCard title="Активные и новые по дням" sub="30 дней по Москве · активный = свайп или отклик за день">
            {noActivity ? <Empty text="Ни регистраций, ни свайпов за 30 дней пока нет" /> : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={d.daily} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gDau" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={PALETTE.orange} stopOpacity={0.2} /><stop offset="95%" stopColor={PALETTE.orange} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gReg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={PALETTE.blue} stopOpacity={0.15} /><stop offset="95%" stopColor={PALETTE.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} interval={4} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TT} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={LEGEND} />
                  <Area type="monotone" dataKey="dau" name="Активны (DAU)" stroke={PALETTE.orange} fill="url(#gDau)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="regs" name="Регистрации" stroke={PALETTE.blue} fill="url(#gReg)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Сколько откликов за день" sub={`Дни с откликами за 30 дней · ${DAILY_LIMIT} — лимит`}>
            {noApps ? <Empty text="Откликов за 30 дней пока нет" /> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={d.perDay} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TT} formatter={(v: any) => [v, 'человеко-дней']} />
                  <Bar dataKey="value" name="Человеко-дней" fill={PALETTE.orange} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        <div className="g-2">
          {/* Активация. Шаги вложены: каждый считает тех же людей, прошедших
              все предыдущие, поэтому доля «от предыдущего» не бывает выше 100%. */}
          <ChartCard title="Активация" sub={`Регистрации за ${d.funnelDays} дней · свежие ещё дозревают`}>
            {f[0].value === 0 ? <Empty text={`Регистраций за ${d.funnelDays} дней пока нет`} /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
                {f.map((s, i) => {
                  const prev = i > 0 ? f[i - 1].value : null
                  const note = prev == null ? undefined
                    : prev > 0 ? `${Math.round((s.value / prev) * 100)}% от предыдущего · ${Math.round((s.value / fMax) * 100)}% от регистраций`
                    : '—'
                  return <BarRow key={s.key} name={s.name} hint={s.hint} value={s.value} max={fMax} color={funnelColors[i]} note={note} />
                })}
              </div>
            )}
          </ChartCard>

          <ChartCard title="Исход откликов Юпитера" sub="Заявки за 30 дней по текущему состоянию · подробности — раздел «Юпитер»">
            {d.outcomesTotal === 0 ? <Empty text="Юпитер за 30 дней ещё не откликался" /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
                {d.outcomes.filter(o => o.value > 0 || ['sent', 'likely', 'human', 'error'].includes(o.key)).map(o => (
                  <BarRow key={o.key} name={o.name} value={o.value} max={outMax} color={OUTCOME_COLOR[o.key]}
                    note={`${Math.round((o.value / d.outcomesTotal) * 100)}%`} />
                ))}
              </div>
            )}
          </ChartCard>
        </div>

        <ChartCard title="Удержание" sub="Недельные когорты регистрации · Dn — был активен на n-й день после регистрации (по Москве); день считается, когда он прошёл">
          <RetentionTable rows={d.retention} total={d.retentionTotal} />
        </ChartCard>
      </div>
    </div>
  )
}
