'use client'
import { useCallback } from 'react'
import { fetchExternal, PALETTE } from '@/lib/queries'
import { useRealtime } from '@/lib/useRealtime'
import KpiCard from '@/components/KpiCard'
import ChartCard from '@/components/ChartCard'
import Chip from '@/components/Chip'
import PageHeader from '@/components/PageHeader'
import PageSkeleton from '@/components/PageSkeleton'
import { downloadCSV } from '@/lib/csv-export'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { AXIS, AXIS_CAT, GRID, LEGEND, TT } from '@/lib/chart'

const n = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('ru-RU'))
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

/**
 * Внешние (карьерные) вакансии: сколько их и у кого, как идёт сбор, что
 * люди свайпают и сколько откликов уходит через Jupiter. Показы карточек не
 * пишутся, поэтому воронка начинается со свайпа вправо.
 */
export default function ExternalPage() {
  const fetcher = useCallback(() => fetchExternal(), [])
  const { data: d, loading, lastUpdated, pulse, refresh } = useRealtime(fetcher, {
    tables: ['jm_ext_swipes', 'jm_jupiter_applications', 'jm_ext_sources'],
    intervalSec: 60,
  })

  if (loading || !d) return <PageSkeleton rows={3} />

  function exportCompanies() {
    downloadCSV(d!.companies.map(c => ({
      Компания: c.name, 'Активных вакансий': c.active, 'Из них IT': c.it,
      'Свайпов вправо': c.right, 'Свайпов влево': c.left, 'Доля вправо, %': c.likeRate ?? '', Откликов: c.apps,
    })), `external_companies_${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div>
      <PageHeader title="Внешние вакансии" intervalSec={60} lastUpdated={lastUpdated} pulse={pulse} onRefresh={refresh} />

      <div className="page-content">
        <div className="g-4">
          <KpiCard label="Активных вакансий" value={n(d.kpi.active)} sub={`компаний: ${n(d.kpi.companies)}`} sparkColor={PALETTE.blue} />
          <KpiCard label="В IT-ленте" value={n(d.kpi.itFeed)} sub={`IT-компаний: ${n(d.kpi.itCompanies)}`} sparkColor={PALETTE.purple} />
          <KpiCard label="В ленте (Москва и удалённо)" value={n(d.kpi.feed)} sub={d.statsAt ? `счётчик на ${when(d.statsAt)}` : 'счётчик недоступен'} sparkColor={PALETTE.cyan} />
          <KpiCard label="Людей свайпали" value={n(d.kpi.swipers)} sub={`откликались: ${n(d.kpi.appliers)} · 90 дней`} sparkColor={PALETTE.orange} />
        </div>

        <div className="g-4">
          <KpiCard label="Свайпов вправо" value={n(d.kpi.right30)} sub={`влево: ${n(d.kpi.left30)} · 30 дней`} sparkColor={PALETTE.pink} />
          <KpiCard label="Доля «вправо»" value={`${d.kpi.likeRate30}%`} sub="от всех свайпов · 30 дней" sparkColor={PALETTE.pink} />
          <KpiCard label="Откликов через Jupiter" value={n(d.kpi.apps90)} sub={`за 30 дней: ${n(d.kpi.apps30)} · отправлено: ${n(d.kpi.submitted)}`} sparkColor={PALETTE.purple} />
          <KpiCard label="Отклик доходит до отправки" value={`${d.kpi.submitRate}%`} sub={`откликов на свайп вправо: ${d.kpi.applyRate}% · 90 дней`} sparkColor={PALETTE.green} />
        </div>

        <ChartCard title="Свайпы и отклики по дням" sub="30 дней">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={d.daily30} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} interval={3} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TT} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={LEGEND} />
              <Area type="monotone" dataKey="right" name="Вправо" stroke={PALETTE.pink} fill={PALETTE.pink} fillOpacity={0.12} strokeWidth={1.7} dot={false} />
              <Area type="monotone" dataKey="left" name="Влево" stroke={PALETTE.gray} fill={PALETTE.gray} fillOpacity={0.08} strokeWidth={1.4} dot={false} />
              <Area type="monotone" dataKey="apps" name="Отклики" stroke={PALETTE.purple} fill={PALETTE.purple} fillOpacity={0.12} strokeWidth={1.7} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="g-2">
          <ChartCard title="Воронка" sub="90 дней · показы карточек не записываются, начинаем со свайпа">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
              {d.funnel.map((item, i) => {
                const max = d.funnel[0].value
                const w = max > 0 ? (item.value / max) * 100 : 0
                const conv = i > 0 && d.funnel[i - 1].value > 0 ? `${Math.round((item.value / d.funnel[i - 1].value) * 100)}%` : '—'
                return (
                  <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, color: 'var(--ink-2)', width: 110, flexShrink: 0 }}>{item.name}</span>
                    <div style={{ flex: 1, height: 10, background: 'var(--bg-sunken)', borderRadius: 5 }}>
                      <div style={{ width: `${Math.max(w, item.value > 0 ? 2 : 0)}%`, height: '100%', background: item.fill, borderRadius: 5 }} />
                    </div>
                    <span className="num" style={{ fontSize: 13, fontWeight: 550, width: 56, textAlign: 'right' }}>{n(item.value)}</span>
                    <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)', width: 48, textAlign: 'right' }}>{conv}</span>
                  </div>
                )
              })}
            </div>
          </ChartCard>

          <ChartCard title="Отклики по состояниям" sub="Jupiter · 90 дней">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d.appsByState} layout="vertical" margin={{ left: 8, right: 40, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={AXIS_CAT} tickLine={false} axisLine={false} width={110} />
                <Tooltip contentStyle={TT} />
                <Bar dataKey="value" name="Откликов" fill={PALETTE.purple} radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, fill: 'var(--ink-3)' }} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard title="Разделы" sub="Активные вакансии и свайпы за 90 дней">
          <ResponsiveContainer width="100%" height={Math.max(220, d.sections.length * 26)}>
            <BarChart data={d.sections} layout="vertical" margin={{ left: 8, right: 16, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={AXIS_CAT} tickLine={false} axisLine={false} width={170} />
              <Tooltip contentStyle={TT} />
              <Legend iconType="square" iconSize={8} wrapperStyle={LEGEND} />
              <Bar dataKey="active" name="Активных" fill={PALETTE.blue} opacity={0.75} radius={[0, 4, 4, 0]} />
              <Bar dataKey="right" name="Вправо" fill={PALETTE.pink} radius={[0, 4, 4, 0]} />
              <Bar dataKey="left" name="Влево" fill={PALETTE.gray} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Компании" sub="Каталог, интерес и отклики · свайпы и отклики за 90 дней">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="jt-btn" onClick={exportCompanies}>Скачать CSV</button>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '60vh' }}>
            <table className="jt-table">
              <thead><tr>{['Компания', 'Активных', 'IT', 'Вправо', 'Влево', 'Доля вправо', 'Отклики'].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {d.companies.map(c => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="num">{n(c.active)}</td>
                    <td className="num">{n(c.it)}</td>
                    <td className="num">{n(c.right)}</td>
                    <td className="num">{n(c.left)}</td>
                    <td className="num">{c.likeRate == null ? '—' : `${c.likeRate}%`}</td>
                    <td className="num">{n(c.apps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>

        <div className="g-2">
          <ChartCard title="Вакансии, которые чаще свайпают вправо" sub="Топ-15 · 90 дней">
            <div style={{ overflowX: 'auto' }}>
              <table className="jt-table">
                <thead><tr>{['Вакансия', 'Компания', 'Вправо'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {d.topVacancies.length === 0
                    ? <tr><td colSpan={3} style={{ color: 'var(--ink-3)' }}>Свайпов пока нет</td></tr>
                    : d.topVacancies.map((v, i) => (
                      <tr key={i}><td>{v.title}</td><td>{v.company}</td><td className="num">{n(v.right)}</td></tr>
                    ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <ChartCard title="Сбор" sub="Последний прогон каждого источника">
            <div style={{ overflowX: 'auto' }}>
              <table className="jt-table">
                <thead><tr>{['Источник', 'Состояние', 'Прогон', 'Пришло', 'Погашено', 'Последний успех'].map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {d.sources.map(s => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>
                        {!s.enabled ? <Chip tone="neutral">выключен</Chip>
                          : s.failures > 0 ? <Chip tone="negative">{`ошибка ×${s.failures}`}</Chip>
                          : <Chip tone="positive">ок</Chip>}
                      </td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{when(s.lastRunAt)}</td>
                      <td className="num">{n(s.lastCount)}</td>
                      <td className="num">{n(s.deactivated)}</td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{when(s.lastSuccessAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      </div>
    </div>
  )
}
