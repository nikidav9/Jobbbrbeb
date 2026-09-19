'use client'
import { useState, useEffect, useCallback } from 'react'
import PageHeader from '@/components/PageHeader'
import KpiCard from '@/components/KpiCard'
import Chip from '@/components/Chip'
import { IconApp, IconBell } from '@/components/icons'
import { broadcastBoth, broadcastWebPush, sendBothToUser, sendInAppToUser } from '@/lib/admin-actions'
import { supabaseAdmin } from '@/lib/supabase'
import { logActivity } from '@/lib/activity-log'

type Target = 'all' | 'workers' | 'employers' | 'metro' | 'webpush'
type St = 'idle' | 'loading' | 'ok' | 'err'

interface UserRow {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string
  role: string
  metro_station: string | null
  created_at: string
  push_token: string | null
  last_seen_at: string | null
  is_blocked: boolean | null
}

interface NotifRow {
  id: string
  user_id: string
  title: string
  body: string
  is_read: boolean
  created_at: string
  jm_users?: { first_name: string | null; last_name: string | null; phone: string }
}

const TARGETS: { value: Target; label: string; desc: string }[] = [
  { value: 'all',       label: 'Все пользователи',  desc: 'Работники + работодатели' },
  { value: 'workers',   label: 'Работники',          desc: 'Только работники' },
  { value: 'employers', label: 'Работодатели',       desc: 'Только работодатели' },
  { value: 'metro',     label: 'По метро',           desc: 'Пользователи конкретной станции' },
  { value: 'webpush',   label: 'Веб-пуш · iPhone',    desc: 'Только подписчики PWA (Safari/iOS)' },
]

interface Trigger {
  id: string
  label: string
  desc: string
  target: Target
  title: string
  body: string
}

const TRIGGERS: Trigger[] = [
  {
    id: 'inactive_workers',
    label: 'Неактивные работники',
    desc: 'Работники без активности 30+ дней — напомнить о себе',
    target: 'workers',
    title: '👋 Возвращайтесь в JobToo',
    body: 'Вы давно не заходили в JobToo. Откройте приложение и проверьте доступные предложения. Если сообщения больше не нужны, напишите «Не присылать».',
  },
  {
    id: 'new_week',
    label: 'Новые пользователи недели',
    desc: 'Приветственный пуш новым пользователям',
    target: 'all',
    title: '🎉 Добро пожаловать в JobToo!',
    body: 'Мы рады вас видеть. Заполните профиль и находите работу ещё быстрее.',
  },
  {
    id: 'reactivate_employers',
    label: 'Реактивация работодателей',
    desc: 'Работодатели без новых вакансий 14+ дней',
    target: 'employers',
    title: '🔔 Нужны сотрудники?',
    body: 'Разместите вакансию за 2 минуты — наши работники уже ищут подработку рядом с вами.',
  },
  {
    id: 'push_workers_match',
    label: 'Мотивация для работников',
    desc: 'Работники с 0 совпадений — помочь активироваться',
    target: 'workers',
    title: '💡 Совет: повысьте шансы!',
    body: 'Добавьте фото профиля и укажите станцию метро — работодатели охотнее выбирают заполненные анкеты.',
  },
  {
    id: 'week_summary',
    label: 'Еженедельный дайджест',
    desc: 'Сводка активности за неделю — всем пользователям',
    target: 'all',
    title: '📊 Итоги недели в JobToo',
    body: 'Новые вакансии, новые работники. Загляните — возможно, ваш идеальный вариант уже ждёт!',
  },
]

export default function BroadcastPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [notifs, setNotifs] = useState<NotifRow[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [tab, setTab] = useState<'send' | 'history' | 'users'>('send')

  // broadcast form
  const [target, setTarget] = useState<Target>('workers')
  const [metro, setMetro] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [st, setSt] = useState<St>('idle')
  const [result, setResult] = useState('')

  // per-user send
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null)
  const [userTitle, setUserTitle] = useState('')
  const [userBody, setUserBody] = useState('')
  const [userSt, setUserSt] = useState<St>('idle')
  const [search, setSearch] = useState('')

  const [webPushCount, setWebPushCount] = useState(0)

  const load = useCallback(async () => {
    setDataLoading(true)
    const [{ data: u }, { data: n }, { data: wpSubs }] = await Promise.all([
      supabaseAdmin.from('jm_users')
        .select('id, first_name, last_name, phone, role, metro_station, created_at, push_token, last_seen_at, is_blocked')
        .order('created_at', { ascending: false }),
      supabaseAdmin.from('jm_notifications')
        .select('id, user_id, title, body, is_read, created_at, jm_users(first_name, last_name, phone)')
        .order('created_at', { ascending: false })
        .limit(100),
      supabaseAdmin.from('jm_web_push_subscriptions').select('user_id'),
    ])
    setUsers(u ?? [])
    setNotifs((n ?? []) as any)
    setWebPushCount((wpSubs ?? []).length)
    setDataLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const withPush = users.filter(u => u.push_token).length
  const withoutPush = users.filter(u => !u.push_token).length
  async function handleBroadcast() {
    if (!title.trim() || !body.trim()) return
    setSt('loading'); setResult('')
    try {
      if (target === 'webpush') {
        const { sent, failed } = await broadcastWebPush(title, body)
        setSt('ok'); setResult(`Веб-пуш отправлен: ${sent}${failed > 0 ? `, ошибок: ${failed}` : ''}`)
      } else {
        const { pushCount, inappCount } = await broadcastBoth(target as 'all' | 'workers' | 'employers' | 'metro', title, body, metro || undefined)
        logActivity('Рассылка', `Цель: ${target}, push: ${pushCount}, inapp: ${inappCount}`)
        setSt('ok'); setResult(`Пуш: ${pushCount}, уведомлений в приложении: ${inappCount}`)
      }
      load()
    } catch (e: any) {
      setSt('err'); setResult('Не отправилось: ' + e.message)
    }
    setTimeout(() => setSt('idle'), 5000)
  }

  function applyTemplate(t: Trigger) {
    setTarget(t.target)
    setTitle(t.title)
    setBody(t.body)
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }

  async function handleSendToUser() {
    if (!selectedUser || !userTitle.trim() || !userBody.trim()) return
    setUserSt('loading')
    try {
      if (selectedUser.push_token) {
        await sendBothToUser(selectedUser.id, userTitle, userBody)
      } else {
        await sendInAppToUser(selectedUser.id, userTitle, userBody)
      }
      setUserSt('ok')
      setUserTitle(''); setUserBody(''); setSelectedUser(null)
      load()
    } catch {
      setUserSt('err')
    }
    setTimeout(() => setUserSt('idle'), 3000)
  }

  const filteredUsers = users.filter(u => {
    if (!search) return true
    const q = search.toLowerCase()
    return (u.first_name + ' ' + u.last_name + ' ' + u.phone).toLowerCase().includes(q)
  })

  const inp = (label: string, value: string, onChange: (v: string) => void, placeholder?: string, area?: boolean) => (
    <div>
      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 5 }}>{label}</label>
      {area
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3}
            className="jt-input" style={{ width: '100%' }} />
        : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            className="jt-input" style={{ width: '100%' }} />
      }
    </div>
  )

  const pushBadge = (hasPush: boolean) => (
    <Chip tone={hasPush ? 'positive' : 'neutral'} style={{ fontSize: 11, padding: '1px 6px' }}>
      {hasPush ? <><IconApp size={11} />Пуш</> : <><IconBell size={11} />Только в приложении</>}
    </Chip>
  )

  return (
    <div>
      <PageHeader title="Рассылка" />
      <div className="page-content">

        <div className="g-4">
          <KpiCard label="Всего пользователей" value={dataLoading ? null : users.length} sub="в базе" />
          <KpiCard label="Пуши в приложении" value={dataLoading ? null : withPush}
            sub={users.length ? `${Math.round(withPush / users.length * 100)}% базы` : 'Expo-токен'} />
          <KpiCard label="Без пуш-токена" value={dataLoading ? null : withoutPush}
            sub="увидят только внутри приложения" />
          <KpiCard label="Веб-пуш · iPhone" value={dataLoading ? null : webPushCount}
            sub="подписаны из Safari" />
        </div>

        {/* Вкладки. Активная подчёркивалась чёрным — тем самым чёрно-белым,
            от которого отказались; акцент здесь и означает «вы тут». */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)' }}>
          {([['send', 'Отправить'], ['history', 'История'], ['users', 'Пользователи']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 16px', border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === t ? 550 : 400, fontFamily: 'inherit',
              color: tab === t ? 'var(--accent)' : 'var(--ink-3)',
              borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1,
              transition: 'color var(--fast) var(--ease)',
            }}>{label}</button>
          ))}
        </div>

        {/* ── Send tab ── */}
        {tab === 'send' && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* Quick templates */}
            <div style={{ flex: '1 1 280px', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 10, padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--ink-3)', marginBottom: 12 }}>
                Быстрые шаблоны
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {TRIGGERS.map(t => {
                  return (
                    <div key={t.id} style={{
                      padding: '10px 12px', borderRadius: 8,
                      background: 'var(--bg-sunken)', border: '1px solid var(--line)',
                      display: 'flex', alignItems: 'flex-start', gap: 10,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t.label}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{t.desc}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>
                          → {TARGETS.find(x => x.value === t.target)?.label.replace(/[^\w\s]/g, '').trim()}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                        <button onClick={() => applyTemplate(t)}
                          style={{ height: 28, padding: '0 10px', borderRadius: 6, border: '1px solid var(--line)', cursor: 'pointer', fontSize: 11.5, background: 'var(--bg-elev)', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
                          Подготовить
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Broadcast composer */}
            <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Target */}
              <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 10, padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--ink-3)', marginBottom: 8 }}>Кому отправить</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 12 }}>
                  Push-токен есть → получат push + уведомление в приложении. Нет токена → только уведомление в приложении.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {TARGETS.map(t => (
                    <label key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 8, cursor: 'pointer', background: target === t.value ? 'var(--accent-soft)' : 'var(--bg-sunken)', border: `1px solid ${target === t.value ? 'var(--accent-line)' : 'transparent'}`, transition: 'all .1s' }}>
                      <input type="radio" name="target" value={t.value} checked={target === t.value} onChange={() => setTarget(t.value)} style={{ accentColor: 'var(--accent)' }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{t.label}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{t.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
                {target === 'metro' && (
                  <div style={{ marginTop: 10 }}>{inp('Станция метро', metro, setMetro, 'Напр.: Тульская')}</div>
                )}
              </div>

              {/* Message */}
              <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 10, padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--ink-3)', marginBottom: 14 }}>Сообщение</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {inp('Заголовок', title, setTitle, 'Напр.: 🎉 Новые вакансии рядом!')}
                  {inp('Текст', body, setBody, 'Напр.: Посмотри свежие подработки в твоём районе', true)}

                  {(title || body) && (
                    <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-sunken)', border: '1px solid var(--line)' }}>
                      <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginBottom: 6 }}>Предпросмотр</div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--ink)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>J</div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{title || '—'}</div>
                          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{body || '—'}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <button onClick={handleBroadcast} disabled={!title.trim() || !body.trim() || st === 'loading'}
                    style={{ height: 40, borderRadius: 8, border: 'none', cursor: 'pointer', background: st === 'ok' ? 'var(--positive)' : st === 'err' ? 'var(--negative)' : 'var(--ink)', color: '#fff', fontSize: 13.5, fontWeight: 500, opacity: (!title.trim() || !body.trim()) ? 0.45 : 1, transition: 'background .15s, opacity .15s' }}>
                    {st === 'loading' ? 'Отправка…' : 'Отправить'}
                  </button>

                  {result && (
                    <div style={{ padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, background: st === 'ok' ? 'var(--positive-soft)' : 'var(--negative-soft)', color: st === 'ok' ? 'var(--positive)' : 'var(--negative)', border: `1px solid ${st === 'ok' ? 'var(--positive-line)' : 'var(--negative-line)'}` }}>
                      {result}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Send to specific user */}
            <div style={{ flex: '1 1 280px', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 10, padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--ink-3)', marginBottom: 14 }}>
                Конкретному пользователю
              </div>

              <div style={{ marginBottom: 12 }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени или телефону…"
                  style={{ width: '100%', height: 36, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-sunken)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>

              {selectedUser ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', marginBottom: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                          {selectedUser.first_name} {selectedUser.last_name}
                        </span>
                        {pushBadge(!!selectedUser.push_token)}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{selectedUser.phone} · {selectedUser.role === 'worker' ? 'Работник' : 'Работодатель'}</div>
                    </div>
                    <button onClick={() => setSelectedUser(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 16 }}>×</button>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 12 }}>
                    {selectedUser.push_token ? 'Получит push-уведомление + запись в ленте.' : 'Получит только уведомление в приложении (нет push-токена).'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {inp('Заголовок', userTitle, setUserTitle, 'Заголовок уведомления')}
                    {inp('Текст', userBody, setUserBody, 'Текст уведомления', true)}
                    <button onClick={handleSendToUser} disabled={!userTitle.trim() || !userBody.trim() || userSt === 'loading'}
                      style={{ height: 38, borderRadius: 8, border: 'none', cursor: 'pointer', background: userSt === 'ok' ? 'var(--positive)' : userSt === 'err' ? 'var(--negative)' : 'var(--ink)', color: '#fff', fontSize: 13, fontWeight: 500, opacity: !userTitle.trim() || !userBody.trim() ? 0.45 : 1 }}>
                      {userSt === 'loading' ? '…' : userSt === 'ok' ? 'Отправлено' : 'Отправить'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {filteredUsers.slice(0, 50).map(u => (
                    <button key={u.id} onClick={() => setSelectedUser(u)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-sunken)', border: '1px solid transparent', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--line)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
                    >
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: u.role === 'worker' ? 'var(--info)' : 'var(--violet)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                        {(u.first_name?.[0] ?? u.phone[0]).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.first_name || u.last_name ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : '—'}
                          </span>
                          {pushBadge(!!u.push_token)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{u.phone} · {u.role === 'worker' ? 'работник' : 'работодатель'}</div>
                      </div>
                    </button>
                  ))}
                  {filteredUsers.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: 12 }}>Ничего не найдено</div>}
                  {filteredUsers.length > 50 && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', padding: '8px 12px' }}>Показано 50 из {filteredUsers.length} — уточните поиск</div>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── History tab (in-app notifications) ── */}
        {tab === 'history' && (
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 10, padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--ink-3)', marginBottom: 14 }}>
              Последние 100 in-app уведомлений
            </div>
            {dataLoading ? <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Загрузка…</div> : notifs.length === 0
              ? <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Уведомлений ещё не было</div>
              : (
                <div className="table-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--line)' }}>
                        {['Получатель', 'Заголовок', 'Текст', 'Статус', 'Время'].map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {notifs.map(n => (
                        <tr key={n.id} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={{ padding: '8px 10px', color: 'var(--ink-2)' }}>
                            {(n as any).jm_users?.first_name ?? ''} {(n as any).jm_users?.last_name ?? ''}<br />
                            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{(n as any).jm_users?.phone ?? n.user_id}</span>
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 500, color: 'var(--ink)' }}>{n.title}</td>
                          <td style={{ padding: '8px 10px', color: 'var(--ink-3)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: n.is_read ? 'var(--positive-soft)' : 'var(--info-soft)', color: n.is_read ? 'var(--positive)' : 'var(--info)' }}>
                              {n.is_read ? 'Прочитано' : 'Не прочитано'}
                            </span>
                          </td>
                          <td style={{ padding: '8px 10px', color: 'var(--ink-3)', whiteSpace: 'nowrap', fontSize: 11.5 }}>
                            {new Date(n.created_at).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </div>
        )}

        {/* ── Users tab ── */}
        {tab === 'users' && (
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 10, padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--ink-3)' }}>
                Все пользователи ({users.length})
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени или телефону…"
                style={{ width: '100%', maxWidth: 320, height: 34, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-sunken)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)' }}>
                    {['Пользователь', 'Телефон', 'Роль', 'Push', 'Метро', 'Регистрация', ''].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ fontWeight: 500, color: 'var(--ink)' }}>
                          {u.first_name || u.last_name ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : <span style={{ color: 'var(--ink-3)' }}>—</span>}
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px', color: 'var(--ink-2)' }}>{u.phone}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: u.role === 'worker' ? 'var(--info-soft)' : 'var(--violet-soft)', color: u.role === 'worker' ? 'var(--info)' : 'var(--violet)' }}>
                          {u.role === 'worker' ? 'Работник' : 'Работодатель'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px' }}>{pushBadge(!!u.push_token)}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--ink-3)', fontSize: 12 }}>{u.metro_station ?? '—'}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--ink-3)', fontSize: 12 }}>
                        {new Date(u.created_at).toLocaleDateString('ru')}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <button onClick={() => { setSelectedUser(u); setSearch(''); setTab('send') }}
                          style={{ height: 26, padding: '0 10px', borderRadius: 5, border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--ink-2)', fontSize: 11.5, cursor: 'pointer' }}>
                          Написать
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
