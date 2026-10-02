'use client'
import { useCallback, useState, useEffect, Fragment } from 'react'
import { fetchUsers, fetchUserProfile, PALETTE } from '@/lib/queries'
import { useRealtime } from '@/lib/useRealtime'
import KpiCard from '@/components/KpiCard'
import ChartCard from '@/components/ChartCard'
import PageHeader from '@/components/PageHeader'
import PageSkeleton from '@/components/PageSkeleton'
import { blockUser, resetPassword, sendBothToUser, deleteUser, changeRole } from '@/lib/admin-actions'
import DonutRoles from '@/components/DonutRoles'
import Avatar from '@/components/Avatar'
import Chip from '@/components/Chip'
import {
  IconBan, IconMetro, IconBuilding, IconApp, IconBell, IconUser,
  IconTrash, IconKey, IconSwap, IconCheck, IconX, IconChevron, IconStar,
} from '@/components/icons'
import { downloadCSV } from '@/lib/csv-export'
import { getVerifiedUsers, setUserVerified } from '@/lib/verification'
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { AXIS, GRID, LEGEND, TT } from '@/lib/chart'


/** Текст с копированием по клику: почта и телефон нужны, чтобы вставить их в письмо или поиск. */
function CopyText({ text, style }: { text: string; style?: React.CSSProperties }) {
  const [done, setDone] = useState(false)
  return (
    <span
      title="Скопировать"
      onClick={e => {
        e.stopPropagation()
        navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
      style={{ cursor: 'copy', wordBreak: 'break-all', ...style }}
    >
      {done ? 'Скопировано ✓' : text}
    </span>
  )
}

type ActionState = 'idle' | 'loading' | 'ok' | 'err'

function ProfileDrawer({ userId, onClose, verifiedSet, onVerifyToggle }: {
  userId: string
  onClose: () => void
  verifiedSet: Set<string>
  onVerifyToggle: (id: string) => void
}) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'likes' | 'reviews' | 'vacancies' | 'chats'>('overview')

  useEffect(() => {
    fetchUserProfile(userId).then(d => { setData(d); setLoading(false) })
  }, [userId])

  const isVerified = verifiedSet.has(userId)

  if (loading || !data) return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Загрузка…</div>
    </div>
  )

  const { user, chats, ratingsReceived, likes, vacancies, permVacancies, permApps, avgRating, totalLikes, totalMatches } = data
  if (!user) return null

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.phone || '—'
  const isWorker = user.role === 'worker'

  const tabs = [
    { id: 'overview', label: 'Обзор' },
    { id: 'likes', label: `Лайки (${totalLikes})` },
    { id: 'reviews', label: `Отзывы (${ratingsReceived.length})` },
    { id: 'vacancies', label: `Вакансии (${vacancies.length + permVacancies.length})` },
    { id: 'chats', label: `Чаты (${chats.length})` },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <Avatar name={name} phone={user.phone} role={user.role} size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{name}</span>
              {isVerified && (
                <Chip tone="positive"><IconCheck size={11} />Верифицирован</Chip>
              )}
              {user.is_blocked && (
                <Chip tone="negative"><IconBan size={11} />Заблокирован</Chip>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'Manrope, sans-serif' }}>{user.phone || '—'}</span>
              {user.email && <CopyText text={user.email} style={{ fontFamily: 'Manrope, sans-serif' }} />}
              {user.metro_station && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <IconMetro size={12} />{user.metro_station}
                </span>
              )}
              {user.company && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <IconBuilding size={12} />{user.company}
                </span>
              )}
              <span style={{ color: 'var(--ink-3)' }}>с {user.created_at?.slice(0, 10)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="jt-icon-btn" title="Закрыть" style={{ border: 0, background: 'transparent' }}
          ><IconX size={14} /></button>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
          <button
            onClick={() => { setUserVerified(userId, !isVerified); onVerifyToggle(userId) }}
            style={{
              height: 28, padding: '0 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11.5, fontWeight: 500,
              background: isVerified ? 'var(--positive-soft)' : 'var(--bg-sunken)',
              border: `1px solid ${isVerified ? 'var(--positive-line)' : 'var(--line)'}`,
              color: isVerified ? 'var(--positive)' : 'var(--ink-2)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <IconCheck size={12} />{isVerified ? 'Верифицирован' : 'Верифицировать'}
            </span>
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)', overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)} style={{
            height: 38, padding: '0 14px', border: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap',
            background: 'transparent',
            color: tab === t.id ? 'var(--ink)' : 'var(--ink-3)',
            borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
          }}>{t.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="g-3">
              <StatBox label="Лайков" value={totalLikes} />
              <StatBox label="Совпадений" value={totalMatches} />
              <StatBox label="Чатов" value={chats.length} />
              <StatBox label="Средний рейтинг" value={avgRating ?? '—'} />
              <StatBox label="Отзывов о нём" value={ratingsReceived.length} />
            </div>
            <div style={{ background: 'var(--bg-sunken)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-3)', marginBottom: 8 }}>Информация об аккаунте</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5 }}>
                {[
                  ['ID', user.id],
                  ['Роль', isWorker ? 'Работник' : 'Работодатель'],
                  ['Телефон', user.phone || '—'],
                  ['Почта', user.email ? <CopyText key="em" text={user.email} /> : '—'],
                  ['Метро', user.metro_station || '—'],
                  ['Компания', user.company || '—'],
                  ['Регистрация', user.created_at?.slice(0, 10) || '—'],
                  ['Push-токен', user.push_token ? 'Есть · Expo (Android/APK)' : 'Нет'],
                  ['iPhone Web Push', data.hasWebPush ? `Подключён ${data.webPushDate}` : 'Нет'],
                ].map(([k, v]) => (
                  <div key={k as string} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--ink-3)', minWidth: 100 }}>{k}</span>
                    <span style={{ color: 'var(--ink)', fontFamily: (k === 'ID' || k === 'Телефон' || k === 'Почта') ? 'Manrope, sans-serif' : 'inherit', fontSize: k === 'ID' ? 10.5 : 12.5, wordBreak: 'break-all' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === 'likes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {likes.length === 0 && <Empty text="Нет лайков" />}
            {likes.map((l: any) => (
              <div key={l.id} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-elev)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span aria-hidden="true" style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: l.is_match ? 'var(--positive)' : l.worker_liked ? 'var(--accent)' : 'var(--line-strong)',
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--ink)', fontWeight: 500 }}>
                    {l.is_match ? 'Совпадение' : l.worker_liked ? 'Лайк' : 'Просмотр'}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'Manrope, sans-serif' }}>{l.created_at?.slice(0, 10)}</div>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'Manrope, sans-serif', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {l.vacancy_id?.slice(0, 8)}…
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === 'reviews' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ratingsReceived.length === 0 && <Empty text="Нет отзывов" />}
            {ratingsReceived.map((r: any) => (
              <div key={r.id} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ display: 'inline-flex', gap: 1, color: 'var(--accent)' }}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <IconStar key={n} size={13} filled={n <= Number(r.rating)}
                        style={{ color: n <= Number(r.rating) ? 'var(--accent)' : 'var(--line-strong)' }} />
                    ))}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'Manrope, sans-serif' }}>{r.created_at?.slice(0, 10)}</span>
                </div>
                {r.review_text && <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{r.review_text}</div>}
              </div>
            ))}
          </div>
        )}
        {tab === 'vacancies' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {vacancies.length === 0 && permVacancies.length === 0 && <Empty text="Нет вакансий" />}
            {vacancies.map((v: any) => (
              <div key={v.id} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-elev)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <Chip tone="accent">Смена</Chip>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>{v.work_type_label || v.work_type || 'Вакансия'}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{v.address || '—'} · {v.created_at?.slice(0, 10)}</div>
                </div>
                <Chip tone={v.status === 'open' ? 'positive' : 'neutral'}>
                  {v.status === 'open' ? 'Открыта' : 'Закрыта'}
                </Chip>
              </div>
            ))}
            {permVacancies.map((v: any) => (
              <div key={v.id} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-elev)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <Chip tone="info">Постоянная</Chip>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>{v.title || 'Вакансия'}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{v.address || '—'} · {v.created_at?.slice(0, 10)}</div>
                </div>
                <Chip tone={v.status === 'open' ? 'positive' : 'neutral'}>
                  {v.status === 'open' ? 'Открыта' : 'Закрыта'}
                </Chip>
              </div>
            ))}
          </div>
        )}
        {tab === 'chats' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {chats.length === 0 && <Empty text="Нет чатов" />}
            {chats.map((c: any) => (
              <div key={c.id} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>{c.vac_title || 'Чат'}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                  {c.company_name && `${c.company_name} · `}{c.created_at?.slice(0, 10)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>{label}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>{text}</div>
}

export default function UsersPage() {
  const fetcher = useCallback(() => fetchUsers(), [])
  const { data: d, loading, lastUpdated, pulse, refresh } = useRealtime(fetcher, {
    tables: ['jm_users'], intervalSec: 30,
  })

  const [phoneSearch, setPhoneSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [actions, setActions] = useState<Record<string, { s: ActionState; msg?: string }>>({})
  const [pushText, setPushText] = useState<Record<string, string>>({})
  const [verifiedSet, setVerifiedSet] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<Record<string, boolean>>({})
  const [confirmRole, setConfirmRole] = useState<Record<string, boolean>>({})

  useEffect(() => { setVerifiedSet(getVerifiedUsers()) }, [])

  if (loading || !d) return <PageSkeleton rows={3} />

  const workerPct = Math.round(d.kpi.workers / Math.max(d.kpi.total, 1) * 100)
  const q = phoneSearch.trim().toLowerCase()
  const filteredUsers = q
    ? d.recent.filter((u: any) =>
        [u.phone, u.email, u.name].some(v => (v ?? '').toLowerCase().includes(q)))
    : d.recent

  function setA(id: string, s: ActionState, msg?: string) {
    setActions(prev => ({ ...prev, [id]: { s, msg } }))
  }

  async function handleBlock(u: any) {
    setA(u.id, 'loading')
    try {
      await blockUser(u.id, !u.blocked, u.name)
      setA(u.id, 'ok', u.blocked ? 'Разблокирован' : 'Заблокирован')
      setTimeout(refresh, 800)
    } catch (e: any) { setA(u.id, 'err', e.message) }
  }

  async function handleResetPwd(u: any) {
    setA(u.id + '_pwd', 'loading')
    try {
      const pwd = await resetPassword(u.id)
      setA(u.id + '_pwd', 'ok', `Новый пароль: ${pwd}`)
    } catch (e: any) { setA(u.id + '_pwd', 'err', e.message) }
  }

  async function handlePush(u: any) {
    const text = pushText[u.id]?.trim()
    if (!text) return
    setA(u.id + '_push', 'loading')
    try {
      await sendBothToUser(u.id, 'Сообщение от администратора', text)
      setA(u.id + '_push', 'ok', 'Отправлено')
      setPushText(prev => ({ ...prev, [u.id]: '' }))
    } catch (e: any) { setA(u.id + '_push', 'err', e.message) }
  }

  // Смена роли с подтверждением: у бывшего работодателя закроются вакансии,
  // и вернуть их обратно одним нажатием уже не выйдет.
  async function handleRole(u: any) {
    const target = u.role === 'worker' ? 'employer' : 'worker'
    if (!confirmRole[u.id]) {
      setConfirmRole(prev => ({ ...prev, [u.id]: true }))
      setTimeout(() => setConfirmRole(prev => ({ ...prev, [u.id]: false })), 4000)
      return
    }
    setConfirmRole(prev => ({ ...prev, [u.id]: false }))
    setA(u.id + '_role', 'loading')
    try {
      const { closedVacancies } = await changeRole(u.id, target, u.name)
      setA(u.id + '_role', 'ok',
        target === 'worker'
          ? `Теперь работник${closedVacancies ? `, закрыто вакансий: ${closedVacancies}` : ''}`
          : 'Теперь работодатель')
      setTimeout(refresh, 800)
    } catch (e: any) { setA(u.id + '_role', 'err', e.message) }
  }

  async function handleDelete(u: any) {
    if (!confirmDelete[u.id]) {
      setConfirmDelete(prev => ({ ...prev, [u.id]: true }))
      setTimeout(() => setConfirmDelete(prev => ({ ...prev, [u.id]: false })), 4000)
      return
    }
    setConfirmDelete(prev => ({ ...prev, [u.id]: false }))
    setA(u.id + '_del', 'loading')
    try {
      await deleteUser(u.id, u.role, u.name)
      setA(u.id + '_del', 'ok', 'Удалён')
      setTimeout(refresh, 800)
    } catch (e: any) { setA(u.id + '_del', 'err', e.message) }
  }

  function handleExportCSV() {
    const rows = filteredUsers.map((u: any) => ({
      'Имя': u.name || '',
      'Телефон': u.phone || '',
      'Почта': u.email || '',
      'Роль': u.role === 'worker' ? 'Работник' : 'Работодатель',
      'Метро': u.metro || '',
      'Компания': u.company || '',
      'Статус': u.blocked ? 'Заблокирован' : 'Активен',
      'Expo Push': u.hasPushToken ? 'Есть' : 'Нет',
      'iPhone Web Push': u.hasWebPush ? `Есть (${u.webPushDate})` : 'Нет',
      'Верифицирован': verifiedSet.has(u.id) ? 'Да' : 'Нет',
      'Дата': u.date || '',
    }))
    downloadCSV(rows, `users_${new Date().toISOString().slice(0, 10)}.csv`)
  }

  return (
    <div style={{ position: 'relative' }}>
      <PageHeader title="Пользователи" intervalSec={30} lastUpdated={lastUpdated} pulse={pulse} onRefresh={refresh} />
      <div className="page-content">
        <div className="g-6">
          <KpiCard label="Всего" value={d.kpi.total} sub="в базе" />
          <KpiCard label="Работники" value={d.kpi.workers} sub={`${d.kpi.workerPct}% базы`} sparkColor={PALETTE.orange} />
          <KpiCard label="Работодатели" value={d.kpi.employers} sub={`${d.kpi.employerPct}% базы`} sparkColor={PALETTE.blue} />
          <KpiCard label="Заблокировано" value={d.kpi.blocked}
            sub={`${d.kpi.total ? Math.round(d.kpi.blocked / d.kpi.total * 100) : 0}% базы`} sparkColor={PALETTE.red} />
          {/* Чип «+N» рядом с числом N ничего не добавлял: он повторял его же.
              Масштаб полезнее — сколько это от базы. */}
          <KpiCard label="Новых · 7 дней" value={d.kpi.newWeek}
            sub={`${d.kpi.total ? Math.round(d.kpi.newWeek / d.kpi.total * 100) : 0}% базы`} />
          <KpiCard label="Новых · 30 дней" value={d.kpi.newMonth}
            sub={`${d.kpi.total ? Math.round(d.kpi.newMonth / d.kpi.total * 100) : 0}% базы`} />
          <KpiCard label="Пуши в приложении" value={d.kpi.withPushToken} sub={`${d.kpi.total ? Math.round(d.kpi.withPushToken / d.kpi.total * 100) : 0}% базы`} sparkColor={PALETTE.green} />
          <KpiCard label="Веб-пуш · iPhone" value={d.kpi.withWebPush} sub={`+${d.kpi.webPushNewWeek} за 7 дней`} sparkColor={PALETTE.purple} />
          {/* Раньше здесь стояло «без пуш-токена — не получат пуши»: неправда,
              часть этих людей подписана веб-пушем с айфона. Считаем тех, до
              кого не достучаться ни одним каналом. */}
          <KpiCard label="Пуши не дойдут" value={d.kpi.noPushAtAll}
            sub="ни приложения, ни веб-пуша" sparkColor={PALETTE.red} />
        </div>
        <div className="g-14">
          <ChartCard title="Новые регистрации" sub="Работники vs работодатели · 90 дней">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={d.growth90} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="gW2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={PALETTE.orange} stopOpacity={0.2}/><stop offset="95%" stopColor={PALETTE.orange} stopOpacity={0}/></linearGradient>
                  <linearGradient id="gE2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={PALETTE.blue} stopOpacity={0.2}/><stop offset="95%" stopColor={PALETTE.blue} stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} interval={8} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TT} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={LEGEND} />
                <Area type="monotone" dataKey="workers" name="Работники" stroke={PALETTE.orange} fill="url(#gW2)" strokeWidth={1.7} dot={false} />
                <Area type="monotone" dataKey="employers" name="Работодатели" stroke={PALETTE.blue} fill="url(#gE2)" strokeWidth={1.7} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Соотношение ролей" sub="Доли от всей базы">
            <DonutRoles workers={d.kpi.workers} employers={d.kpi.employers} />
          </ChartCard>
        </div>
        {d.recent.length > 0 && (
          <ChartCard
            title="Все пользователи"
            sub={phoneSearch.trim() ? `Найдено ${filteredUsers.length} из ${d.recent.length}` : `${d.recent.length} пользователей · CRM`}
          >
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Поиск по телефону, почте, имени..."
                value={phoneSearch}
                onChange={e => setPhoneSearch(e.target.value)}
                style={{
                  width: '100%', maxWidth: 340, padding: '7px 12px',
                  border: '1px solid var(--line)', borderRadius: 8,
                  background: 'var(--bg-sunken)', color: 'var(--ink)',
                  fontSize: 13, outline: 'none', fontFamily: 'Manrope, sans-serif',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--line)')}
              />
              <button
                onClick={handleExportCSV}
                style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-sunken)', color: 'var(--ink-2)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2v8M5 7l3 3 3-3M3 13h10"/>
                </svg>
                Экспорт CSV
              </button>
            </div>
            <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)' }}>
                    {['Пользователь', 'Роль', 'Метро', 'Компания', 'Статус', 'Пуш', 'Верификация', 'Дата', 'Действия'].map(h => (
                      <th key={h} style={{ textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-3)', fontWeight: 500, padding: '8px 12px 10px', background: 'var(--bg)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0
                    ? <tr><td colSpan={9} style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Не найдено</td></tr>
                    : filteredUsers.map((u: any) => {
                        const isWorker = u.role === 'worker'
                        const expanded = expandedId === u.id
                        const aBlock = actions[u.id]
                        const aPwd = actions[u.id + '_pwd']
                        const aPush = actions[u.id + '_push']
                        const aDel = actions[u.id + '_del']
                        const isVerified = verifiedSet.has(u.id)
                        const isConfirmDel = confirmDelete[u.id]
                        return (
                          <Fragment key={u.id}>
                            <tr
                              style={{ borderBottom: expanded ? 'none' : '1px solid var(--line)', background: expanded ? 'var(--bg-sunken)' : undefined, cursor: 'pointer' }}
                              onClick={() => setExpandedId(expanded ? null : u.id)}
                              onMouseEnter={e => { if (!expanded) (e.currentTarget as HTMLElement).style.background = 'var(--bg-sunken)' }}
                              onMouseLeave={e => { if (!expanded) (e.currentTarget as HTMLElement).style.background = '' }}
                            >
                              <td style={{ padding: '10px 12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <Avatar name={u.name} phone={u.phone} role={u.role} />
                                  <div>
                                    <div style={{ fontWeight: 550, color: u.blocked ? 'var(--negative)' : 'var(--ink)', fontSize: 13, lineHeight: 1.2 }}>
                                      {u.name || <span style={{ color: 'var(--ink-3)' }}>Имя не указано</span>}
                                    </div>
                                    <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{u.phone || '—'}</div>
                                    {u.email && <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}><CopyText text={u.email} /></div>}
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                <Chip tone={isWorker ? 'accent' : 'info'}>
                                  {isWorker ? 'Работник' : 'Работодатель'}
                                </Chip>
                              </td>
                              <td style={{ padding: '10px 12px', color: 'var(--ink-2)', fontSize: 12.5 }}>
                                {u.metro && u.metro !== '—'
                                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconMetro size={12} style={{ color: 'var(--ink-3)' }} />{u.metro}</span>
                                  : <span style={{ color: 'var(--ink-3)' }}>—</span>}
                              </td>
                              <td style={{ padding: '10px 12px', color: u.company && u.company !== '—' ? 'var(--ink-2)' : 'var(--ink-3)', maxWidth: 140 }}>
                                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.company || '—'}</span>
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                {u.blocked
                                  ? <Chip tone="negative"><IconBan size={11} />Заблокирован</Chip>
                                  : <Chip tone="positive" dot>Активен</Chip>}
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  {u.hasPushToken && (
                                    <Chip tone="positive" title="Expo push token — приложение на Android или APK">
                                      <IconApp size={11} />Приложение
                                    </Chip>
                                  )}
                                  {u.hasWebPush && (
                                    <Chip tone="violet" title={`Веб-пуш из Safari на iPhone · подключён ${u.webPushDate}`}>
                                      <IconBell size={11} />iPhone
                                    </Chip>
                                  )}
                                  {!u.hasPushToken && !u.hasWebPush && (
                                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>не дойдут</span>
                                  )}
                                </div>
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                {isVerified
                                  ? <Chip tone="positive"><IconCheck size={11} />Да</Chip>
                                  : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>—</span>}
                              </td>
                              <td style={{ padding: '10px 12px', fontFamily: 'Manrope, sans-serif', fontSize: 11.5, color: 'var(--ink-3)' }}>{u.date || '—'}</td>
                              <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                                <div style={{ display: 'flex', gap: 5 }}>
                                  <button onClick={() => setProfileId(u.id)} title="Открыть профиль" className="jt-icon-btn">
                                    <IconUser size={13} />
                                  </button>
                                  {aBlock?.s === 'ok'
                                    ? <span style={{ fontSize: 11.5, color: 'var(--positive)', fontWeight: 500 }}>{aBlock.msg}</span>
                                    : <button onClick={() => handleBlock(u)} disabled={aBlock?.s === 'loading'}
                                        className="jt-icon-btn"
                                        style={{ width: 'auto', padding: '0 9px', background: u.blocked ? 'var(--positive-soft)' : 'var(--negative-soft)', color: u.blocked ? 'var(--positive)' : 'var(--negative)', fontWeight: 500 }}>
                                        {aBlock?.s === 'loading' ? '…' : u.blocked ? 'Разблокировать' : 'Заблокировать'}
                                      </button>}
                                  <button onClick={() => setExpandedId(expanded ? null : u.id)}
                                    title={expanded ? 'Свернуть' : 'Пароль и пуш'} className="jt-icon-btn">
                                    <IconChevron size={13} open={expanded} />
                                  </button>
                                  {(() => {
                                    const aRole = actions[u.id + '_role']
                                    if (aRole?.s === 'ok') return <span style={{ fontSize: 11, color: 'var(--positive)', fontWeight: 500 }}>{aRole.msg}</span>
                                    if (aRole?.s === 'err') return <span style={{ color: 'var(--negative)', display: 'inline-flex' }} title={aRole.msg}><IconX size={13} /></span>
                                    const target = u.role === 'worker' ? 'работодателем' : 'работником'
                                    return (
                                      <button onClick={() => handleRole(u)} disabled={aRole?.s === 'loading'}
                                        title={`Сделать ${target}. Открытые вакансии при этом закроются.`}
                                        className="jt-icon-btn"
                                        style={{
                                          width: 'auto', padding: '0 9px',
                                          borderColor: confirmRole[u.id] ? 'var(--negative-line)' : undefined,
                                          background: confirmRole[u.id] ? 'var(--negative-soft)' : undefined,
                                          color: confirmRole[u.id] ? 'var(--negative)' : 'var(--ink-2)',
                                        }}>
                                        {aRole?.s === 'loading'
                                          ? '…'
                                          : confirmRole[u.id]
                                          ? `Сделать ${target}?`
                                          : <><IconSwap size={13} />роль</>}
                                      </button>
                                    )
                                  })()}
                                  {aDel?.s === 'ok'
                                    ? <span style={{ fontSize: 11, color: 'var(--negative)', fontWeight: 500 }}>Удалён</span>
                                    : aDel?.s === 'err'
                                    ? <span style={{ color: 'var(--negative)', display: 'inline-flex' }}><IconX size={13} /></span>
                                    : isConfirmDel
                                    ? <button onClick={() => handleDelete(u)} className="jt-icon-btn"
                                        style={{ width: 'auto', padding: '0 9px', borderColor: 'var(--negative-line)', background: 'var(--negative-soft)', color: 'var(--negative)', fontWeight: 600 }}>
                                        Удалить?
                                      </button>
                                    : <button onClick={() => handleDelete(u)} disabled={aDel?.s === 'loading'} title="Удалить пользователя и все его данные"
                                        className="jt-icon-btn">
                                        {aDel?.s === 'loading' ? '…' : <IconTrash size={13} />}
                                      </button>}
                                </div>
                              </td>
                            </tr>
                            {expanded && (
                              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                                <td colSpan={9} style={{ padding: '0 12px 14px 60px', background: 'var(--bg-sunken)' }}>
                                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 10 }}>
                                    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px', minWidth: 200 }}>
                                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><IconKey size={12} />Сбросить пароль</div>
                                      {aPwd?.s === 'ok'
                                        ? <div style={{ fontSize: 13, color: 'var(--positive)' }}>
                                            <div style={{ fontWeight: 500, marginBottom: 2 }}>Новый пароль:</div>
                                            <div style={{ fontFamily: 'Manrope, sans-serif', fontSize: 18, fontWeight: 700, letterSpacing: 2, color: 'var(--ink)', background: 'var(--bg-sunken)', padding: '4px 10px', borderRadius: 6 }}>
                                              {aPwd.msg?.replace('Новый пароль: ', '')}
                                            </div>
                                          </div>
                                        : aPwd?.s === 'err'
                                          ? <div style={{ fontSize: 12, color: 'var(--negative)' }}>{aPwd.msg}</div>
                                          : <button onClick={() => handleResetPwd(u)} disabled={aPwd?.s === 'loading'}
                                              style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'var(--ink)', color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
                                              {aPwd?.s === 'loading' ? 'Генерация…' : 'Сгенерировать новый'}
                                            </button>}
                                    </div>
                                    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px', flex: 1, minWidth: 260 }}>
                                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><IconApp size={12} />Отправить пуш</div>
                                      <div style={{ display: 'flex', gap: 6 }}>
                                        <input
                                          placeholder="Текст уведомления..."
                                          value={pushText[u.id] ?? ''}
                                          onChange={e => setPushText(prev => ({ ...prev, [u.id]: e.target.value }))}
                                          style={{ flex: 1, height: 32, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--bg-sunken)', color: 'var(--ink)', fontSize: 12.5, outline: 'none' }}
                                        />
                                        <button onClick={() => handlePush(u)} disabled={!pushText[u.id]?.trim() || aPush?.s === 'loading'}
                                          style={{ padding: '0 12px', height: 32, borderRadius: 6, border: 'none', background: 'var(--ink)', color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', flexShrink: 0 }}>
                                          {aPush?.s === 'loading' ? '…' : 'Отправить'}
                                        </button>
                                      </div>
                                      {aPush?.s === 'ok' && <div style={{ fontSize: 12, color: 'var(--positive)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}><IconCheck size={12} />{aPush.msg}</div>}
                                      {aPush?.s === 'err' && <div style={{ fontSize: 12, color: 'var(--negative)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}><IconX size={12} />{aPush.msg}</div>}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                </tbody>
              </table>
            </div>
          </ChartCard>
        )}
      </div>
      {profileId && (
        <>
          <div
            onClick={() => setProfileId(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 40, backdropFilter: 'blur(2px)' }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, maxWidth: '95vw',
            background: 'var(--bg)', zIndex: 50, boxShadow: '-4px 0 32px rgba(0,0,0,.18)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <ProfileDrawer
              userId={profileId}
              onClose={() => setProfileId(null)}
              verifiedSet={verifiedSet}
              onVerifyToggle={id => setVerifiedSet(prev => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id); else next.add(id)
                return next
              })}
            />
          </div>
        </>
      )}
    </div>
  )
}

