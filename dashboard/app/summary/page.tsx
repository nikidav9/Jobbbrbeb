'use client'
import { useCallback } from 'react'
import { fetchExecutiveSummary, PALETTE } from '@/lib/queries'
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


function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mono" style={{
      fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase',
      letterSpacing: '.1em', color: 'var(--ink-3)', margin: '10px 0 -4px 2px',
    }}>{children}</div>
  )
}

export default function SummaryPage() {
  const fetcher = useCallback(() => fetchExecutiveSummary(), [])
  const { data: d, loading, lastUpdated, pulse, refresh } = useRealtime(fetcher, {
    tables: ['jm_users', 'jm_vacancies', 'jm_perm_vacancies', 'jm_likes', 'jm_perm_applications'],
    intervalSec: 60,
  })

  if (loading || !d) return <PageSkeleton rows={3} />
  const k = d.kpi
  const s = d.season
  // Ноль изменений — не рост: чип в этом случае не показывается вовсе.
  const wkDelta = (cur: number, prev: number) =>
    cur === prev ? undefined : `${cur > prev ? '+' : '−'}${Math.abs(cur - prev)} к прошлой неделе`
  const wkTone = (cur: number, prev: number): 'pos' | 'neg' | 'neutral' =>
    cur === prev ? 'neutral' : cur > prev ? 'pos' : 'neg'

  return (
    <div>
      <PageHeader title="Сводка" intervalSec={60} lastUpdated={lastUpdated} pulse={pulse} onRefresh={refresh} />

      <div className="page-content">

        <SectionTitle>Сезон · цели к концу сентября</SectionTitle>
        <div className="g-4">
          <KpiCard
            label="Мэтчей за 7 дней"
            value={`${s.matches7} / ${s.targetMatches}`}
            sub="смены + одобренные заявки · цель в неделю"
            sparkColor={PALETTE.orange}
            delta={wkDelta(s.matches7, s.matchesPrev7)}
            deltaTone={wkTone(s.matches7, s.matchesPrev7)}
          />
          <KpiCard
            label="Директоров публиковали"
            value={`${s.pubs7} / ${s.targetPubs}`}
            sub="за 7 дней · цель в неделю"
            sparkColor={PALETTE.purple}
            delta={wkDelta(s.pubs7, s.pubsPrev7)}
            deltaTone={wkTone(s.pubs7, s.pubsPrev7)}
          />
          <KpiCard label="Смены закрыты людьми" value={`${k.fillRatePct}%`}
            sub="мест занято в закрытых сменах" sparkColor={PALETTE.cyan} />
          <KpiCard label="Новых работников · 7 дней" value={s.newWorkers7}
            sub={`всего работников: ${k.workers}`} sparkColor={PALETTE.green} />
        </div>

        <SectionTitle>Рост</SectionTitle>
        <div className="g-4">
          <KpiCard
            label="Пользователей"
            value={k.totalUsers}
            sub={`${k.workers} работников · ${k.employers} директоров`}
            sparkColor={PALETTE.orange}
            delta={k.userGrowthDelta ? `${k.userGrowthDelta.text} за месяц` : undefined}
            deltaTone={k.userGrowthDelta?.tone}
          />
          <KpiCard label="Новых за 30 дней" value={k.newUsers30}
            sub={`${k.totalUsers ? Math.round(k.newUsers30 / k.totalUsers * 100) : 0}% базы`} sparkColor={PALETTE.amber} />
          <KpiCard label="MAU" value={k.mau} sub="совершили действие за 30 дней" sparkColor={PALETTE.blue} />
          <KpiCard label="WAU" value={k.wau} sub="совершили действие за 7 дней" sparkColor={PALETTE.cyan} />
        </div>

        <SectionTitle>Предложение и спрос · 30 дней</SectionTitle>
        <div className="g-4">
          <KpiCard label="Смен опубликовано" value={k.shifts30} sub="за 30 дней" sparkColor={PALETTE.orange} />
          <KpiCard label="Постоянных вакансий" value={k.perm30} sub="за 30 дней" sparkColor={PALETTE.blue} />
          <KpiCard label="Активных директоров" value={k.activeDirectors30} sub="публиковали за 30 дней" sparkColor={PALETTE.purple} />
          <KpiCard label="Откликов за 30 дней" value={k.responses30} sub={`${k.totalResponses} за всё время`} sparkColor={PALETTE.pink} />
        </div>

        <SectionTitle>Здоровье маркетплейса</SectionTitle>
        <div className="g-4">
          <KpiCard label="Вакансий с откликом" value={`${k.supplyWithResponsePct}%`} sub="получили ≥1 отклик" sparkColor={PALETTE.green} />
          <KpiCard label="Скорость отклика"
            value={k.medianResponseH === null ? null : `${k.medianResponseH} ч`}
            sub={k.medianResponseH === null ? 'откликов ещё не было' : `медиана · ${k.respWithin24hPct}% в первые сутки`}
            sparkColor={PALETTE.cyan} />
          <KpiCard label="Возврат работников" value={`${k.repeatWorkersPct}%`} sub="откликаются повторно" sparkColor={PALETTE.blue} />
          <KpiCard label="Возврат директоров" value={`${k.repeatDirectorsPct}%`} sub="публикуют повторно" sparkColor={PALETTE.purple} />
        </div>

        <SectionTitle>Вовлечённость и качество</SectionTitle>
        <div className="g-4">
          <KpiCard label="Мэтчей" value={k.matches} sub={`${k.completed} смен завершено`} sparkColor={PALETTE.purple} />
          <KpiCard label="Чатов" value={k.chats} sub={`ср. ${k.avgMsgsPerChat} сообщ./чат`} sparkColor={PALETTE.pink} />
          <KpiCard label="Средняя оценка"
            value={k.ratingsCount > 0 ? k.avgRating : null}
            sub={k.ratingsCount > 0 ? `по ${k.ratingsCount} оценкам` : 'оценок пока нет'}
            sparkColor={PALETTE.amber} />
          <KpiCard label="Охват уведомлениями" value={`${k.reachPct}%`}
            sub="push или web-push" sparkColor={PALETTE.green} />
        </div>

        <ChartCard title="Рост базы пользователей" sub="Накопительно · 90 дней">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={d.cumulativeUsers} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="gCum" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE.orange} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={PALETTE.orange} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} interval={13} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TT} />
              <Area type="monotone" dataKey="users" name="Пользователей" stroke={PALETTE.orange} fill="url(#gCum)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Недельная динамика" sub="Новые пользователи · опубликованное предложение · отклики · 12 недель">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.weekly} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TT} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={LEGEND} />
              <Bar dataKey="users" name="Новые пользователи" fill={PALETTE.orange} radius={[3, 3, 0, 0]} />
              <Bar dataKey="supply" name="Вакансии+смены" fill={PALETTE.blue} radius={[3, 3, 0, 0]} />
              <Bar dataKey="responses" name="Отклики" fill={PALETTE.green} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

      </div>
    </div>
  )
}

