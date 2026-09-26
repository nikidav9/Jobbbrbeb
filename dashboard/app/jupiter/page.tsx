'use client'
import { useCallback, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { PALETTE } from '@/lib/queries'
import {
  JUPITER_COLUMNS, BUCKET_LABEL, REASON_LABEL, buildReport, type JupiterRow,
} from '@/lib/jupiterStats'
import PageHeader from '@/components/PageHeader'
import PageSkeleton from '@/components/PageSkeleton'
import KpiCard from '@/components/KpiCard'
import ChartCard from '@/components/ChartCard'
import FilterChips from '@/components/FilterChips'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { AXIS, GRID, TT } from '@/lib/chart'

/**
 * Юпитер: замер автооткликов на сайтах компаний.
 *
 * Отвечает на вопрос владельца «сколько откликов Юпитер реально отправляет
 * и где застревает» — до того, как включать новые сайты. Строка таблицы —
 * сайт, а не человек: колонок людей панель у базы не просит вовсе
 * (см. JUPITER_COLUMNS в lib/jupiterStats).
 */

async function fetchRows(): Promise<JupiterRow[]> {
  const page = 1000
  const all: JupiterRow[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('jm_jupiter_applications')
      .select(JUPITER_COLUMNS)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    all.push(...(data as unknown as JupiterRow[]))
    if (data.length < page) break
  }
  return all
}

type Period = '7' | '30' | 'all'
const PERIOD_DAYS: Record<Period, number> = { '7': 7, '30': 30, all: 0 }

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')

const th: React.CSSProperties = { padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px 14px', whiteSpace: 'nowrap' }

export default function JupiterPage() {
  const fetcher = useCallback(() => fetchRows(), [])
  const { data: rows, loading, error, lastUpdated, pulse, refresh } = useRealtime(fetcher, { intervalSec: 600 })
  const [period, setPeriod] = useState<Period>('7')

  const counts = useMemo(() => {
    const all = rows ?? []
    return {
      '7': buildReport(all, 7).totals.total,
      '30': buildReport(all, 30).totals.total,
      all: all.length,
    }
  }, [rows])
  const report = useMemo(() => buildReport(rows ?? [], PERIOD_DAYS[period]), [rows, period])

  if (loading && !rows) return <PageSkeleton rows={3} />

  const header = <PageHeader title="Юпитер" intervalSec={600} lastUpdated={lastUpdated} pulse={pulse} onRefresh={refresh} />

  if (error && !rows) {
    return (
      <div>
        {header}
        <div className="page-content">
          <ChartCard title="Не удалось загрузить заявки Юпитера" sub="jm_jupiter_applications">
            <div style={{ fontSize: 13, color: 'var(--negative)' }}>{error}</div>
          </ChartCard>
        </div>
      </div>
    )
  }

  const t = report.totals
  const tickDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

  return (
    <div>
      {header}
      <div className="page-content">
        <FilterChips<Period>
          value={period}
          onChange={setPeriod}
          options={[
            { key: '7', label: '7 дней', count: counts['7'] },
            { key: '30', label: '30 дней', count: counts['30'] },
            { key: 'all', label: 'Всё время', count: counts.all },
          ]}
        />

        <div className="g-4">
          <KpiCard label="Свайпов по сайтам компаний" value={t.total} sub="по дате отклика" />
          <KpiCard label={BUCKET_LABEL.auto} value={t.auto} sub={`${pct(t.auto, t.total)} от свайпов`} color="var(--positive)" />
          <KpiCard label="Подтверждено сайтом" value={t.verified}
            sub={`${pct(t.verified, t.auto)} отправленных · письмо или экран успеха`} color="var(--positive)" />
          <KpiCard label={BUCKET_LABEL.human} value={t.human} sub="капча, вопрос, согласие" color="var(--accent)" />
          <KpiCard label={BUCKET_LABEL.parked} value={t.parked} sub="ждут включения сайта" color="var(--info)" />
          <KpiCard label={BUCKET_LABEL.manual} value={t.manual} sub="люди отправили из «Ждут вас»" />
          <KpiCard label={BUCKET_LABEL.working} value={t.working} sub="очередь и повторы попыток" />
          <KpiCard label={BUCKET_LABEL.failed} value={t.failed + t.duplicate}
            sub={t.duplicate ? `из них повторов: ${t.duplicate}` : 'не отправлено или исход неизвестен'}
            color="var(--negative)" />
        </div>

        <ChartCard title="По дням" sub={period === 'all' ? 'Последние 30 дней · по Москве' : `Последние ${period} дней · по Москве`}>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={report.days} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={AXIS} tickFormatter={tickDay} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS} allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TT} labelFormatter={v => tickDay(String(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="auto" name={BUCKET_LABEL.auto} stackId="a" fill={PALETTE.green} />
                <Bar dataKey="manual" name={BUCKET_LABEL.manual} stackId="a" fill={PALETTE.cyan} />
                <Bar dataKey="human" name={BUCKET_LABEL.human} stackId="a" fill={PALETTE.orange} />
                <Bar dataKey="parked" name={BUCKET_LABEL.parked} stackId="a" fill={PALETTE.blue} />
                <Bar dataKey="other" name="Прочее" stackId="a" fill={PALETTE.gray} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="По сайтам" sub="Сайт — хост вакансии, как его различает Юпитер. Людей здесь нет.">
          {report.sites.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '4px 0 8px' }}>
              За этот период свайпов по сайтам компаний не было.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', margin: '0 -16px -14px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>
                    <th style={th}>Сайт</th>
                    <th style={{ ...th, textAlign: 'right' }}>Свайпов</th>
                    <th style={{ ...th, textAlign: 'right' }}>Отправил</th>
                    <th style={{ ...th, textAlign: 'right' }}>Подтверждено</th>
                    <th style={{ ...th, textAlign: 'right' }}>Ждут человека</th>
                    <th style={{ ...th, textAlign: 'right' }}>Подключаем</th>
                    <th style={{ ...th, textAlign: 'right' }}>Ошибки</th>
                    <th style={{ ...th, whiteSpace: 'normal', minWidth: 160 }}>Чаще всего останавливает</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sites.map(s => (
                    <tr key={s.site} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={td}>
                        <div style={{ color: 'var(--ink)' }}>{s.company || s.site}</div>
                        {s.company ? <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{s.site}</div> : null}
                      </td>
                      <td className="mono" style={{ ...td, textAlign: 'right' }}>{s.total}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right', color: s.auto ? 'var(--positive)' : 'var(--ink-3)' }}>
                        {s.auto} <span style={{ color: 'var(--ink-3)' }}>· {pct(s.auto, s.total)}</span>
                      </td>
                      <td className="mono" style={{ ...td, textAlign: 'right' }}>{s.verified}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right' }}>{s.human}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right' }}>{s.parked}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right', color: s.failed ? 'var(--negative)' : undefined }}>{s.failed}</td>
                      <td style={{ ...td, whiteSpace: 'normal', minWidth: 160, color: 'var(--ink-2)' }}>
                        {s.topReason
                          ? <>{REASON_LABEL[s.topReason] ?? s.topReason} <span className="mono" style={{ color: 'var(--ink-3)' }}>×{s.topReasonCount}</span></>
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  )
}
