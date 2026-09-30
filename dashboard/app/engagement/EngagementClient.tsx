'use client'
import { useCallback } from 'react'
import { fetchEngagement, PALETTE } from '@/lib/queries'
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


export default function EngagementPage() {
  const fetcher = useCallback(() => fetchEngagement(), [])
  const { data: d, loading, error, lastUpdated, pulse, refresh } = useRealtime(fetcher, {
    tables: ['jm_chats', 'jm_messages'],
    intervalSec: 30,
  })

  if (loading) return <PageSkeleton rows={2} />
  if (error || !d) return <ErrorState message={error ?? 'Нет данных'} onRetry={refresh} />

  return (
    <div>
      <PageHeader title="Активность" intervalSec={30} lastUpdated={lastUpdated} pulse={pulse} onRefresh={refresh} />

      <div className="page-content">
        <div className="g-3">
          <KpiCard label="Всего чатов" value={d.kpi.totalChats} sub="за всё время" sparkColor={PALETTE.cyan} />
          <KpiCard label="Сообщений" value={d.kpi.totalMessages} sub="за всё время" sparkColor={PALETTE.blue} />
          <KpiCard label="Сообщений на чат" value={d.kpi.avgMsgPerChat} sub="в среднем" sparkColor={PALETTE.purple} />
        </div>
        <div className="g-3">
          {/* Чип «+N» рядом с числом N повторял его же. */}
          <KpiCard label="Новых чатов за 7 дней" value={d.kpi.activeChats}
            sub={d.kpi.totalChats ? `${Math.round(d.kpi.activeChats / d.kpi.totalChats * 100)}% всех чатов` : '—'} />
          <KpiCard label="Не прочли работники" value={d.kpi.unreadWorker}
            sub="сообщений ждут работников" sparkColor={PALETTE.orange} />
          <KpiCard label="Не прочли работодатели" value={d.kpi.unreadEmployer}
            sub="сообщений ждут работодателей" sparkColor={PALETTE.blue} />
        </div>

        <ChartCard title="Сообщения и чаты по дням" sub="90 дней">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={d.daily90} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="gMsg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE.blue} stopOpacity={0.2} /><stop offset="95%" stopColor={PALETTE.blue} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gCht" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE.cyan} stopOpacity={0.2} /><stop offset="95%" stopColor={PALETTE.cyan} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} interval={8} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TT} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={LEGEND} />
              <Area type="monotone" dataKey="messages" name="Сообщения" stroke={PALETTE.blue} fill="url(#gMsg)" strokeWidth={1.7} dot={false} />
              <Area type="monotone" dataKey="chats" name="Новые чаты" stroke={PALETTE.cyan} fill="url(#gCht)" strokeWidth={1.7} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Насколько разговорчивы чаты" sub="Сколько чатов набрало столько-то сообщений">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.msgDist} margin={{ top: 12, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TT} />
              <Bar dataKey="value" name="Чатов" radius={[4, 4, 0, 0]} fill={PALETTE.blue}
                   label={{ position: 'top', fontSize: 11, fill: 'var(--ink-3)' }} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

      </div>
    </div>
  )
}


function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--negative)"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5L21.5 20H2.5L12 3.5z" /><path d="M12 10v4M12 17h.01" />
      </svg>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Не удалось загрузить данные</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'Manrope, sans-serif', maxWidth: 400, textAlign: 'center' }}>{message}</div>
      <button onClick={onRetry} className="jt-btn jt-btn-secondary" style={{ marginTop: 8 }}>
        Повторить
      </button>
    </div>
  )
}
