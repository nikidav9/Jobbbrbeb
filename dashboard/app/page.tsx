'use client'
import { useCallback } from 'react'
import { fetchOverview, PALETTE, CHART_COLORS } from '@/lib/queries'
import { useRealtime } from '@/lib/useRealtime'
import KpiCard from '@/components/KpiCard'
import ChartCard from '@/components/ChartCard'
import PageHeader from '@/components/PageHeader'
import PageSkeleton from '@/components/PageSkeleton'
import DonutRoles from '@/components/DonutRoles'
import {
  AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { AXIS, AXIS_CAT, GRID, LEGEND, TT } from '@/lib/chart'


export default function OverviewPage() {
  const fetcher = useCallback(() => fetchOverview(), [])
  const { data: d, loading, lastUpdated, pulse, refresh } = useRealtime(fetcher, {
    tables: ['jm_users', 'jm_vacancies', 'jm_perm_vacancies', 'jm_likes'],
    intervalSec: 30,
  })

  if (loading || !d) return <PageSkeleton rows={3} />

  return (
    <div>
      <PageHeader title="Обзор" intervalSec={30} lastUpdated={lastUpdated} pulse={pulse} onRefresh={refresh} />

      <div className="page-content">

        {/* Main KPIs */}
        <div className="g-4">
          <KpiCard label="Всего пользователей" value={d.kpi.totalUsers}
            sub={`+${d.kpi.newUsersWeek} за 7 дней`}
            delta={d.kpi.usersDelta?.text} deltaTone={d.kpi.usersDelta?.tone} />
          <KpiCard label="Вакансии" value={d.kpi.tempVacancies + d.kpi.permVacancies}
            sub={`${d.kpi.openTemp + d.kpi.openPerm} открыто`} sparkColor={PALETTE.green} />
          <KpiCard label="Совпадений" value={d.kpi.totalMatches}
            sub={`${d.kpi.matchRate}% от всех откликов`}
            delta={d.kpi.matchesDelta?.text} deltaTone={d.kpi.matchesDelta?.tone} />
          <KpiCard label="Средний рейтинг" value={d.kpi.avgRating}
            sub={d.kpi.ratingsCount > 0 ? `по ${d.kpi.ratingsCount} оценкам` : 'оценок пока нет'}
            sparkColor={PALETTE.amber} />
        </div>

        {/* Secondary KPIs */}
        <div className="g-4">
          <KpiCard label="Работники" value={d.kpi.workers}
            sub={`${Math.round(d.kpi.workers / Math.max(d.kpi.totalUsers, 1) * 100)}% базы`}
            sparkColor={PALETTE.orange} />
          <KpiCard label="Работодатели" value={d.kpi.employers}
            sub={`${Math.round(d.kpi.employers / Math.max(d.kpi.totalUsers, 1) * 100)}% базы`}
            sparkColor={PALETTE.blue} />
          <KpiCard label="Лайков" value={d.kpi.totalLikes} sparkColor={PALETTE.pink} />
          <KpiCard label="Подтверждено" value={d.kpi.confirmed} sparkColor={PALETTE.green} />
        </div>

        {/* Charts */}
        <div className="g-14">
          <ChartCard title="Регистрации по дням" sub="Работники и работодатели · 30 дней">
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={d.dailyUsers} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="gW" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PALETTE.orange} stopOpacity={0.2} /><stop offset="95%" stopColor={PALETTE.orange} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PALETTE.blue} stopOpacity={0.2} /><stop offset="95%" stopColor={PALETTE.blue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TT} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={LEGEND} />
                <Area type="monotone" dataKey="workers" name="Работники" stroke={PALETTE.orange} fill="url(#gW)" strokeWidth={1.7} dot={false} />
                <Area type="monotone" dataKey="employers" name="Работодатели" stroke={PALETTE.blue} fill="url(#gE)" strokeWidth={1.7} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ChartCard title="Пользователи" sub="Роли">
              <DonutRoles workers={d.kpi.workers} employers={d.kpi.employers} />
            </ChartCard>

            <ChartCard title="Вакансии и совпадения" sub="30 дней">
              <ResponsiveContainer width="100%" height={100}>
                <AreaChart data={d.dailyVacs.slice(-14)} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gV" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={PALETTE.green} stopOpacity={0.2} /><stop offset="95%" stopColor={PALETTE.green} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gM" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={PALETTE.purple} stopOpacity={0.2} /><stop offset="95%" stopColor={PALETTE.purple} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                  <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} interval={3} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TT} />
                  <Area type="monotone" dataKey="vacancies" name="Вакансии" stroke={PALETTE.green} fill="url(#gV)" strokeWidth={1.7} dot={false} />
                  <Area type="monotone" dataKey="matches" name="Совпадения" stroke={PALETTE.purple} fill="url(#gM)" strokeWidth={1.7} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>

        {/* Funnel + work types */}
        <div className="g-2">
          {/* Воронка. Здесь было три ошибки сразу, и все три — про правду,
              а не про вид:

              — правый столбец показывал то долю («100%» на первом шаге), то
                падение («−40%» на остальных»); две разные величины в одной
                колонке читаются как одна;
              — при равенстве соседних шагов падение выходило нулём, и вместо
                «−0%» рисовалось «100%»;
              — длина полосы считалась от первого шага, а лайков больше, чем
                людей: полоса вылезала за карточку.

              Теперь длина считается от наибольшего шага, а падение вынесено к
              названию — туда, где оно и означает переход от предыдущего. */}
          <ChartCard title="Воронка выхода на смену" sub="Когорта регистраций 30 дней · последние 7 дней дозревают">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
              {(() => {
                const max = Math.max(...d.funnel.map(f => f.value), 1)
                const colors = [PALETTE.blue, PALETTE.cyan, PALETTE.purple, PALETTE.orange, PALETTE.green]
                return d.funnel.map((item, i) => {
                  const prev = i > 0 ? d.funnel[i - 1].value : null
                  const keep = prev && prev > 0 ? Math.round((item.value / prev) * 100) : null
                  return (
                    <div key={item.name}>
                      <div style={{
                        display: 'flex', alignItems: 'baseline', gap: 8,
                        fontSize: 13, marginBottom: 5,
                      }}>
                        <span style={{ color: 'var(--ink-2)' }}>{item.name}</span>
                        {keep !== null && (
                          <span className="num" style={{
                            fontSize: 11, color: keep >= 100 ? 'var(--positive)' : 'var(--ink-3)',
                          }}>
                            {keep}% от предыдущего
                          </span>
                        )}
                        <span className="num" style={{
                          marginLeft: 'auto', color: 'var(--ink)', fontWeight: 550,
                        }}>{item.value.toLocaleString('ru-RU')}</span>
                      </div>
                      <div style={{ height: 8, background: 'var(--bg-sunken)', borderRadius: 4 }}>
                        <div style={{
                          width: `${Math.max((item.value / max) * 100, item.value > 0 ? 2 : 0)}%`,
                          height: '100%', background: colors[i], borderRadius: 4,
                          transition: 'width var(--slow) var(--ease)',
                        }} />
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </ChartCard>

          <ChartCard title="Типы работ" sub="Временные вакансии">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.workTypeDist} layout="vertical" margin={{ left: 0, right: 24, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={AXIS_CAT} tickLine={false} axisLine={false} width={80} />
                <Tooltip contentStyle={TT} />
                <Bar dataKey="value" name="Вакансий" radius={[0, 4, 4, 0]}>
                  {d.workTypeDist.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

      </div>
    </div>
  )
}

