'use client'
import { useCallback } from 'react'
import { fetchFunnel, PALETTE } from '@/lib/queries'
import { useRealtime } from '@/lib/useRealtime'
import KpiCard from '@/components/KpiCard'
import ChartCard from '@/components/ChartCard'
import PageHeader from '@/components/PageHeader'
import PageSkeleton from '@/components/PageSkeleton'
import {
  AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { AXIS, GRID, TT } from '@/lib/chart'


function FunnelBar({ items }: { items: { name: string; value: number; fill: string }[] }) {
  const max = items[0]?.value || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
      {items.map((item, i) => {
        const pct = (item.value / max) * 100
        const convPct = i > 0 && items[i - 1].value > 0
          ? ((item.value / items[i - 1].value) * 100).toFixed(0) : null
        return (
          <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-2)', width: 150, flexShrink: 0 }}>{item.name}</span>
            <div style={{ flex: 1, height: 10, background: 'var(--bg-sunken)', borderRadius: 5 }}>
              <div style={{
                width: `${Math.max(pct, item.value > 0 ? 2 : 0)}%`, height: '100%',
                background: item.fill, borderRadius: 5,
                transition: 'width var(--slow) var(--ease)',
              }} />
            </div>
            <span className="num" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 550, width: 56, textAlign: 'right', flexShrink: 0 }}>
              {item.value.toLocaleString('ru-RU')}
            </span>
            <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)', width: 52, textAlign: 'right', flexShrink: 0 }}>
              {convPct !== null ? `${convPct}%` : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function FunnelPage() {
  const fetcher = useCallback(() => fetchFunnel(), [])
  const { data: d, loading, lastUpdated, pulse, refresh } = useRealtime(fetcher, {
    tables: ['jm_likes', 'jm_users', 'jm_perm_applications', 'jm_guest_events'],
    intervalSec: 60,
  })

  if (loading || !d) return <PageSkeleton rows={2} />

  return (
    <div>
      <PageHeader title="Воронка конверсии" intervalSec={60} lastUpdated={lastUpdated} pulse={pulse} onRefresh={refresh} />

      <div className="page-content">
        {/* Гостевой просмотр */}
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-3)', fontWeight: 500, fontFamily: 'Geist Mono, monospace', paddingBottom: 2 }}>
          Гости без регистрации · 30 дней
        </div>
        <div className="g-4">
          <KpiCard label="Уникальных гостей" value={d.kpi.guestUnique30}
            sub={`${d.kpi.guestUnique7} за 7 дней`} sparkColor={PALETTE.blue} />
          <KpiCard label="Просмотров вакансий" value={d.kpi.guestImpressions30}
            sub="карточки в гостевом режиме" sparkColor={PALETTE.cyan} />
          <KpiCard label="Хотели откликнуться" value={d.kpi.guestIntent30}
            sub="нажали отклик или сообщение" sparkColor={PALETTE.orange} />
          <KpiCard label="Гость → регистрация" value={`${d.kpi.guestRegistrationRate30}%`}
            sub={`${d.kpi.guestRegistrations30} регистраций`} sparkColor={PALETTE.green} />
        </div>

        <div className="g-2">
          <ChartCard title="Гостевая воронка" sub="Уникальные устройства за 30 дней · без персональных данных">
            <FunnelBar items={d.guestFunnel} />
          </ChartCard>
          <ChartCard title="Активность гостей" sub="30 дней — просмотры, намерения и регистрации">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={d.guestDaily30} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} interval={3} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TT} formatter={(v: any, name: string) => [
                  v,
                  name === 'impressions' ? 'Просмотры' : name === 'intents' ? 'Намерения' : 'Регистрации',
                ]} />
                <Area type="monotone" dataKey="impressions" stroke={PALETTE.blue} fill={PALETTE.blue} fillOpacity={0.08} strokeWidth={1.7} dot={false} />
                <Area type="monotone" dataKey="intents" stroke={PALETTE.orange} fill={PALETTE.orange} fillOpacity={0.06} strokeWidth={1.7} dot={false} />
                <Area type="monotone" dataKey="registrations" stroke={PALETTE.green} fill={PALETTE.green} fillOpacity={0.06} strokeWidth={1.7} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Telegram-привлечение */}
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-3)', fontWeight: 500, fontFamily: 'Geist Mono, monospace', paddingBottom: 2 }}>
          Telegram · 30 дней
        </div>
        <div className="g-4">
          <KpiCard label="Публикаций" value={d.kpi.telegramPublished30}
            sub="группа и личные уведомления" sparkColor={PALETTE.blue} />
          <KpiCard label="Открытий" value={d.kpi.telegramOpens30}
            sub={`${d.kpi.telegramOpenRate30}% на публикацию`} sparkColor={PALETTE.cyan} />
          <KpiCard label="Намерений откликнуться" value={d.kpi.telegramApplies30}
            sub={`${d.kpi.telegramApplyRate30}% от открытий`} sparkColor={PALETTE.orange} />
          <KpiCard label="Регистраций" value={d.kpi.telegramRegistrations30}
            sub={`${d.kpi.telegramRegistrationRate30}% от открытий · анонимная атрибуция`} sparkColor={PALETTE.green} />
        </div>
        <ChartCard title="Telegram-воронка" sub="Публикация → открытие конкретной вакансии → намерение откликнуться">
          <FunnelBar items={d.telegramFunnel} />
        </ChartCard>

        {/* Органические рекомендации */}
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-3)', fontWeight: 500, fontFamily: 'Geist Mono, monospace', paddingBottom: 2 }}>
          Рекомендации пользователей · 30 дней
        </div>
        <div className="g-4">
          <KpiCard label="Поделились" value={d.kpi.referralShared30}
            sub="открыли системное меню и отправили ссылку" sparkColor={PALETTE.purple} />
          <KpiCard label="Открытий" value={d.kpi.referralOpens30}
            sub={`${d.kpi.referralOpenRate30}% на рекомендацию`} sparkColor={PALETTE.cyan} />
          <KpiCard label="Намерений откликнуться" value={d.kpi.referralApplies30}
            sub={`${d.kpi.referralApplyRate30}% от открытий`} sparkColor={PALETTE.orange} />
          <KpiCard label="Регистраций" value={d.kpi.referralRegistrations30}
            sub={`${d.kpi.referralRegistrationRate30}% от открытий · стоимость канала 0 ₽`} sparkColor={PALETTE.green} />
        </div>
        <ChartCard title="Реферальная воронка" sub="Поделились вакансией → получатель открыл → захотел откликнуться">
          <FunnelBar items={d.referralFunnel} />
        </ChartCard>

        {/* Активация */}
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-3)', fontWeight: 500, fontFamily: 'Geist Mono, monospace', paddingBottom: 2 }}>
          Активация
        </div>
        <div className="g-4">
          <KpiCard label="Работники в когорте" value={d.kpi.cohortWorkers}
            sub="30 дней · последние 7 дней исключены" sparkColor={PALETTE.blue} />
          <KpiCard label="Профиль готов" value={d.kpi.cohortProfileReady}
            sub={`${d.kpi.cohortProfileRate} от когорты`} sparkColor={PALETTE.cyan} />
          <KpiCard label="Посмотрели вакансию" value={d.kpi.cohortViewed}
            sub={`${d.kpi.cohortViewRate} от готовых профилей`} sparkColor={PALETTE.purple} />
          <KpiCard label="Откликнулись" value={d.kpi.cohortApplied}
            sub={`${d.kpi.cohortApplyRate} от готовых профилей`} sparkColor={PALETTE.orange} />
        </div>
        <div className="g-4">
          <KpiCard label="Получили одобрение" value={d.kpi.cohortAccepted}
            sub={`${d.kpi.cohortAcceptRate} от откликнувшихся`} sparkColor={PALETTE.amber} />
          <KpiCard label="Вышли на смену" value={d.kpi.cohortWorked}
            sub={`${d.kpi.cohortWorkRate} от когорты`} sparkColor={PALETTE.green} />
          <KpiCard label="Отклик за 7 дней" value={d.kpi.cohortAppliedWithin7d}
            sub={`${d.kpi.cohortAppliedWithin7dRate} от готовых профилей`} sparkColor={PALETTE.blue} />
          <KpiCard label="Старые неполные профили" value={d.kpi.cohortProfileAnomalies}
            sub="есть активность, но не хватает обязательных полей" sparkColor={PALETTE.gray} />
        </div>

        {/* Конверсия */}
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-3)', fontWeight: 500, fontFamily: 'Geist Mono, monospace', paddingBottom: 2, paddingTop: 4 }}>
          Конверсия
        </div>
        <div className="g-4">
          <KpiCard label="Всего лайков" value={d.kpi.totalLikes} sub="за всё время" sparkColor={PALETTE.pink} />
          <KpiCard label="Совпадений" value={d.kpi.totalMatches}
            sub={`из ${d.kpi.totalLikes} лайков`} sparkColor={PALETTE.purple} />
          <KpiCard label="Лайк становится совпадением" value={`${d.kpi.matchRate}%`}
            sub="доля лайков" sparkColor={PALETTE.purple} />
          <KpiCard label="Совпадение доходит до смены" value={`${d.kpi.completionRate}%`}
            sub="доля совпадений" sparkColor={PALETTE.green} />
        </div>

        {/* Удержание */}
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-3)', fontWeight: 500, fontFamily: 'Geist Mono, monospace', paddingBottom: 2, paddingTop: 4 }}>
          Удержание
        </div>
        <div className="g-4">
          <KpiCard label="Смен завершено" value={d.kpi.completedCount} sub="за всё время" sparkColor={PALETTE.green} />
          <KpiCard label="Смен на работника" value={d.kpi.avgShiftsPerWorker}
            sub="в среднем среди отработавших" sparkColor={PALETTE.orange} />
          <KpiCard label="Вернулись за второй" value={d.kpi.returningWorkers}
            sub="отработали две смены и больше" sparkColor={PALETTE.orange} />
          <KpiCard label="Доля вернувшихся" value={`${d.kpi.returningRate}%`}
            sub="от тех, кто отработал хоть раз" sparkColor={PALETTE.amber} />
        </div>

        {/* Воронки */}
        <div className="g-2">
          <ChartCard title="Полная активация одной когорты" sub="Профиль → просмотр → отклик → одобрение → выход · последние 7 дней дозревают">
            <FunnelBar items={d.mainFunnel} />
            {d.kpi.cohortBiggestDrop && d.kpi.cohortBiggestDrop.lost > 0 && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--negative)' }}>
                Главная потеря: {d.kpi.cohortBiggestDrop.from} → {d.kpi.cohortBiggestDrop.to}
                {' · '}−{d.kpi.cohortBiggestDrop.lost} ({d.kpi.cohortBiggestDrop.rate}%)
              </div>
            )}
          </ChartCard>

          <ChartCard title="Воронка по событиям" sub="Всего событий на каждом шаге · справа доля от предыдущего">
            <FunnelBar items={d.eventFunnel} />
          </ChartCard>
        </div>

        {/* Тренд 30 дней */}
        <ChartCard title="Динамика воронки" sub="30 дней — лайки, матчи, завершённые смены">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={d.daily30} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="gFL" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE.blue} stopOpacity={0.18} /><stop offset="95%" stopColor={PALETTE.blue} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gFM" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE.purple} stopOpacity={0.18} /><stop offset="95%" stopColor={PALETTE.purple} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gFC" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE.green} stopOpacity={0.18} /><stop offset="95%" stopColor={PALETTE.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} interval={3} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TT}
                formatter={(v: any, name: string) => [v, name === 'likes' ? 'Лайки' : name === 'matches' ? 'Матчи' : 'Смены']} />
              <Area type="monotone" dataKey="likes" stroke={PALETTE.blue} fill="url(#gFL)" strokeWidth={1.7} dot={false} />
              <Area type="monotone" dataKey="matches" stroke={PALETTE.purple} fill="url(#gFM)" strokeWidth={1.7} dot={false} />
              <Area type="monotone" dataKey="completed" stroke={PALETTE.green} fill="url(#gFC)" strokeWidth={1.7} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="g-2">
          {/* Активность воркеров */}
          <ChartCard title="Распределение активности" sub="Сколько лайков сделал каждый воркер">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d.activityBuckets} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TT} formatter={(v: any) => [v, 'Воркеров']} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {d.activityBuckets.map((e, i) => (
                    <Cell key={i} fill={i === 0 ? PALETTE.gray : i === 1 ? PALETTE.amber : i <= 3 ? PALETTE.orange : PALETTE.green} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Смены по воркерам */}
          <ChartCard title="Смены по воркерам" sub="Сколько смен завершил каждый воркер">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d.shiftBuckets} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TT} formatter={(v: any) => [v, 'Воркеров']} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {d.shiftBuckets.map((e, i) => (
                    <Cell key={i} fill={[PALETTE.amber, PALETTE.orange, PALETTE.cyan, PALETTE.green][i] ?? PALETTE.blue} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Постоянные вакансии */}
        <ChartCard title="Постоянные вакансии — воронка заявок" sub="Подано → Одобрено / Отклонено">
          <FunnelBar items={d.permFunnel} />
          <div style={{ marginTop: 16, display: 'flex', gap: 32, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>% одобрения</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: PALETTE.green, fontFamily: 'Geist Mono, monospace' }}>
                {d.kpi.permApplications > 0
                  ? ((d.kpi.permApproved / d.kpi.permApplications) * 100).toFixed(1)
                  : 0}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Всего заявок</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'Geist Mono, monospace' }}>
                {d.kpi.permApplications.toLocaleString('ru')}
              </div>
            </div>
          </div>
        </ChartCard>
      </div>
    </div>
  )
}

