'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getToken } from '@/lib/adminApi'
import PageHeader from '@/components/PageHeader'
import KpiCard from '@/components/KpiCard'
import Button from '@/components/Button'
import Chip from '@/components/Chip'
import FilterChips from '@/components/FilterChips'
import { IconCheck, IconUser, IconSend } from '@/components/icons'

/**
 * Поддержка.
 *
 * Обращения из приложения: человек нажал «Помощь и поддержка» и написал.
 * О каждом первом сообщении бот пишет в телеграм, но отвечать удобнее
 * здесь — видно всю переписку и кто ждёт дольше всех.
 *
 * Ответ уходит человеку в приложение и всеми каналами, какие у него есть:
 * он ждёт именно его, а не «мы приняли обращение».
 *
 * Ответить и закрыть — разные вещи. На «а когда смена?» отвечают и разговор
 * идёт дальше; на «спасибо, разобрался» отвечать нечего, но обращение должно
 * уйти из списка, иначе оно висит и мешает видеть тех, кто правда ждёт.
 * Поэтому у каждого разговора есть закрытие — с прощальным словом, а не
 * молча. После закрытия помощник продолжает работать; в очередь разговор
 * вернётся только по новому явному «Позвать оператора».
 */

const FROM_HOUR = 10
const TO_HOUR = 21

/** Заготовка прощального слова. Её можно дописать под случай перед отправкой. */
const CLOSING_TEXT =
  'Спасибо, что написали! Обращение закрыто — если вопрос вернётся или появится новый, пишите сюда же.'

type Msg = {
  id: string
  user_id: string
  direction: string
  sender: 'user' | 'assistant' | 'operator' | 'system' | null
  text: string
  created_at: string
}

type Thread = {
  user_id: string
  closed_at: string | null
  operator_requested_at: string | null
}

type User = {
  id: string
  first_name: string | null
  last_name: string | null
  role: string | null
  phone: string | null
  metro_station: string | null
}

type Filter = 'open' | 'closed' | 'all'

function ago(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(d)) / 86_400_000)
  const p2 = (n: number) => n.toString().padStart(2, '0')
  if (days <= 0) return `${p2(d.getHours())}:${p2(d.getMinutes())}`
  if (days < 7) return `${days}д`
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}`
}

/** Сколько человек ждёт ответа — в часах, чтобы было видно просрочку. */
function waitingHours(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
}

export default function SupportPage() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [closedAt, setClosedAt] = useState<Record<string, string | null>>({})
  const [requestedAt, setRequestedAt] = useState<Record<string, string | null>>({})
  const [users, setUsers] = useState<Record<string, User>>({})
  const [loading, setLoading] = useState(true)
  // По умолчанию — открытые. Раньше стоял фильтр «только ждущие», и страница
  // встречала пустотой даже когда обращения были; закрытые же, наоборот,
  // незачем держать перед глазами — они уже разобраны.
  const [filter, setFilter] = useState<Filter>('open')
  const [updated, setUpdated] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [sending, setSending] = useState<string | null>(null)
  const [notice, setNotice] = useState<Record<string, string>>({})
  // Чей разговор сейчас закрываем: у него вместо кнопки открыто поле с текстом.
  const [closingFor, setClosingFor] = useState<string | null>(null)
  const [closeDrafts, setCloseDrafts] = useState<Record<string, string>>({})
  const [closing, setClosing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)

    // В операторскую очередь попадают только диалоги, где человек явно нажал
    // «Позвать оператора». Обычные разговоры с помощником дашборд не засоряют.
    const { data: th } = await supabase
      .from('jm_support_threads')
      .select('user_id,closed_at,operator_requested_at')
      .not('operator_requested_at', 'is', null)
      .order('operator_requested_at', { ascending: false })

    const escalated = ((th ?? []) as Thread[])
    const ids = escalated.map(t => t.user_id)
    const cl: Record<string, string | null> = {}
    const rq: Record<string, string | null> = {}
    for (const t of escalated) {
      cl[t.user_id] = t.closed_at
      rq[t.user_id] = t.operator_requested_at
    }
    setClosedAt(cl)
    setRequestedAt(rq)

    let rows: Msg[] = []
    if (ids.length) {
      const { data } = await supabase
        .from('jm_support_messages')
        .select('id,user_id,direction,sender,text,created_at')
        .in('user_id', ids)
        .order('created_at', { ascending: false })
        .limit(1000)
      rows = (data ?? []) as Msg[]
    }
    setMsgs(rows)

    if (ids.length) {
      const { data: us } = await supabase
        .from('jm_users').select('id,first_name,last_name,role,phone,metro_station').in('id', ids)
      const map: Record<string, User> = {}
      for (const u of (us ?? []) as User[]) map[u.id] = u
      setUsers(map)
    } else {
      setUsers({})
    }

    setUpdated(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  // Обращение может прийти в любой момент — подтягиваем сами.
  useEffect(() => {
    const t = setInterval(load, 5_000)
    return () => clearInterval(t)
  }, [load])

  const send = async (userId: string) => {
    const text = (drafts[userId] ?? '').trim()
    if (!text || sending) return
    setSending(userId)
    setNotice(n => ({ ...n, [userId]: '' }))
    try {
      const res = await fetch('/api/admin/support-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': getToken() },
        body: JSON.stringify({ userId, text }),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.error ?? 'Не отправилось')
      setDrafts(d => ({ ...d, [userId]: '' }))
      setNotice(n => ({ ...n, [userId]: 'Отправлено' }))
      await load()
    } catch (e: any) {
      setNotice(n => ({ ...n, [userId]: e.message ?? 'Не отправилось' }))
    } finally {
      setSending(null)
    }
  }

  const close = async (userId: string) => {
    const text = (closeDrafts[userId] ?? CLOSING_TEXT).trim()
    if (!text || closing) return
    setClosing(userId)
    setNotice(n => ({ ...n, [userId]: '' }))
    try {
      const res = await fetch('/api/admin/support-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': getToken() },
        body: JSON.stringify({ userId, text }),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.error ?? 'Не закрылось')
      setClosingFor(null)
      setCloseDrafts(d => ({ ...d, [userId]: '' }))
      setNotice(n => ({
        ...n,
        [userId]: body.marked === false
          ? 'Письмо ушло, но отметка «закрыто» не сохранилась — обращение вернётся в список'
          : 'Обращение закрыто',
      }))
      await load()
    } catch (e: any) {
      setNotice(n => ({ ...n, [userId]: e.message ?? 'Не закрылось' }))
    } finally {
      setClosing(null)
    }
  }

  const reopen = async (userId: string) => {
    if (closing) return
    setClosing(userId)
    try {
      const res = await fetch('/api/admin/support-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': getToken() },
        body: JSON.stringify({ userId, reopen: true }),
      })
      const body = await res.json()
      if (!res.ok || body.error) throw new Error(body.error ?? 'Не получилось')
      await load()
    } catch (e: any) {
      setNotice(n => ({ ...n, [userId]: e.message ?? 'Не получилось' }))
    } finally {
      setClosing(null)
    }
  }

  const threads = useMemo(() => {
    const by = new Map<string, Msg[]>()
    for (const m of msgs) {
      const list = by.get(m.user_id) ?? []
      list.push(m)
      by.set(m.user_id, list)
    }
    const out = Array.from(by.entries()).map(([uid, list]) => {
      const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))
      const last = sorted[sorted.length - 1]
      const lastIn = [...sorted].reverse().find(m => m.direction === 'in')
      const stamp = closedAt[uid] ?? null
      const requestStamp = requestedAt[uid] ?? null
      // Теперь человек может продолжить разговор с помощником после закрытия.
      // Это НЕ должно само возвращать его оператору: повторная очередь
      // появляется только после нового явного «Позвать оператора».
      const closed = !!stamp && !(requestStamp && requestStamp > stamp)
      const waiting = !closed && last.direction === 'in'
      return {
        uid, user: users[uid], msgs: sorted, last, waiting, closed, closedStamp: stamp,
        hours: waiting && lastIn ? waitingHours(lastIn.created_at) : 0,
      }
    })
    out.sort((a, b) => {
      if (a.waiting !== b.waiting) return a.waiting ? -1 : 1
      return b.last.created_at.localeCompare(a.last.created_at)
    })
    if (filter === 'open') return out.filter(t => !t.closed)
    if (filter === 'closed') return out.filter(t => t.closed)
    return out
  }, [msgs, users, closedAt, requestedAt, filter])

  // Считаем по всем разговорам, а не по отфильтрованным: иначе включённый
  // фильтр прятал бы и сам счётчик того, что он прячет.
  const counts = useMemo(() => {
    const lastByUser = new Map<string, Msg>()
    for (const m of msgs) {                      // msgs идут свежими первыми
      if (!lastByUser.has(m.user_id)) lastByUser.set(m.user_id, m)
    }
    let open = 0, closed = 0, waiting = 0
    for (const [uid, last] of Array.from(lastByUser.entries())) {
      const stamp = closedAt[uid] ?? null
      const requestStamp = requestedAt[uid] ?? null
      const isClosed = !!stamp && !(requestStamp && requestStamp > stamp)
      if (isClosed) { closed++; continue }
      open++
      if (last.direction === 'in') waiting++
    }
    return { open, closed, waiting, total: open + closed }
  }, [msgs, closedAt, requestedAt])

  const mskHour = (new Date().getUTCHours() + 3) % 24
  const openNow = mskHour >= FROM_HOUR && mskHour < TO_HOUR

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'open',   label: 'Открытые', count: counts.open },
    { key: 'closed', label: 'Закрытые', count: counts.closed },
    { key: 'all',    label: 'Все',      count: counts.total },
  ]

  return (
    <div>
      <PageHeader title="Поддержка" intervalSec={5} lastUpdated={updated} onRefresh={load} />

      <div className="page-content">
        <div className="g-4">
          <KpiCard label="Открытых обращений" value={counts.open}
            sub={counts.total ? `из ${counts.total} за всё время` : 'обращений не было'} />
          <KpiCard label="Ждут ответа" value={counts.waiting}
            sub="последнее слово за человеком" />
          <KpiCard label="Закрыто" value={counts.closed}
            sub="повторный вызов оператора откроет снова" />
          <KpiCard label="Сейчас" value={openNow ? 'Рабочее время' : 'Нерабочее'}
            sub={`приём с ${FROM_HOUR}:00 до ${TO_HOUR}:00 по Москве`} />
        </div>

        <FilterChips
          options={tabs.map(t => ({ key: t.key, label: t.label, count: t.count }))}
          value={filter}
          onChange={setFilter}
        />

        {!loading && threads.length === 0 ? (
          <div style={{ color: 'var(--ink-3)', fontSize: 14 }}>
            {filter === 'open' ? 'Открытых обращений нет.'
              : filter === 'closed' ? 'Закрытых обращений пока нет.'
              : 'Обращений пока нет.'}
          </div>
        ) : null}

        {threads.map(t => {
          const name = [t.user?.first_name, t.user?.last_name].filter(Boolean).join(' ') || 'Без имени'
          const late = t.waiting && t.hours >= 12
          return (
            <div key={t.uid} className="jt-card" style={{
              padding: 14,
              borderColor: late ? 'var(--negative-line)' : 'var(--line)',
              // Закрытое обращение приглушается фоном, а не прозрачностью:
              // его перечитывают, когда человек возвращается с тем же вопросом.
              background: t.closed ? 'var(--bg-sunken)' : 'var(--bg-elev)',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15 }}>{name}</strong>
                {t.closed ? (
                  <Chip tone="neutral">Закрыто</Chip>
                ) : t.waiting ? (
                  <Chip tone={late ? 'negative' : 'accent'} dot>
                    {t.hours < 1 ? 'Ждёт ответа' : `Ждёт ${t.hours} ч`}
                  </Chip>
                ) : (
                  <Chip tone="positive"><IconCheck size={11} />Отвечено</Chip>
                )}
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  {[t.user?.role === 'worker' ? 'работник' : t.user?.role === 'employer' ? 'работодатель' : null,
                    t.user?.phone, t.user?.metro_station].filter(Boolean).join(' · ') || '—'}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink-3)' }}>
                  {ago(t.last.created_at)}
                </span>
              </div>

              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {t.msgs.slice(-12).map(m => (
                  <div key={m.id} style={{ display: 'flex', gap: 8, fontSize: 13.5, lineHeight: 1.45 }}>
                    <span className="num" style={{ flexShrink: 0, width: 52, color: 'var(--ink-3)', fontSize: 12 }}>
                      {ago(m.created_at)}
                    </span>
                    <span style={{ flexShrink: 0, color: m.direction === 'out' ? 'var(--accent)' : 'var(--ink-3)' }}>
                      {m.direction === 'out' ? <IconSend size={13} /> : <IconUser size={13} />}
                    </span>
                    <span style={{ flexShrink: 0, width: 66, fontSize: 11.5, color: 'var(--ink-3)' }}>
                      {m.sender === 'assistant' ? 'помощник'
                        : m.sender === 'system' ? 'система'
                        : m.direction === 'out' ? 'оператор' : 'человек'}
                    </span>
                    <span style={{
                      whiteSpace: 'pre-wrap', minWidth: 0,
                      color: m.direction === 'out' ? 'var(--ink-2)' : 'var(--ink)',
                    }}>{m.text}</span>
                  </div>
                ))}
              </div>

              {t.closed ? (
                <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                    Закрыто {t.closedStamp ? ago(t.closedStamp) : ''}. Напишет снова — откроется само.
                  </span>
                  <Button onClick={() => reopen(t.uid)} disabled={closing === t.uid} style={{ marginLeft: 'auto' }}>
                    {closing === t.uid ? '…' : 'Открыть снова'}
                  </Button>
                </div>
              ) : closingFor === t.uid ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 6 }}>
                    Это уйдёт человеку — можно дописать под случай.
                  </div>
                  <textarea
                    value={closeDrafts[t.uid] ?? CLOSING_TEXT}
                    onChange={e => setCloseDrafts(d => ({ ...d, [t.uid]: e.target.value }))}
                    rows={3}
                    className="jt-input" style={{ width: '100%', minHeight: 60 }}
                  />
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <Button variant="primary"
                      onClick={() => close(t.uid)}
                      disabled={closing === t.uid || !(closeDrafts[t.uid] ?? CLOSING_TEXT).trim()}>
                      {closing === t.uid ? '…' : 'Отправить и закрыть'}
                    </Button>
                    <Button onClick={() => setClosingFor(null)}>Отмена</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea
                      value={drafts[t.uid] ?? ''}
                      onChange={e => setDrafts(d => ({ ...d, [t.uid]: e.target.value }))}
                      placeholder="Ответ уйдёт в приложение, а также в телеграм и пушем"
                      rows={2}
                      className="jt-input" style={{ flex: 1, minHeight: 44 }}
                    />
                    <Button variant="primary"
                      onClick={() => send(t.uid)}
                      disabled={sending === t.uid || !(drafts[t.uid] ?? '').trim()}>
                      {sending === t.uid ? '…' : 'Ответить'}
                    </Button>
                  </div>
                  <Button onClick={() => setClosingFor(t.uid)} style={{ marginTop: 8 }}>
                    Закрыть обращение
                  </Button>
                </>
              )}

              {notice[t.uid] ? (
                <div style={{
                  marginTop: 6, fontSize: 13,
                  color: notice[t.uid] === 'Отправлено' || notice[t.uid] === 'Обращение закрыто'
                    ? 'var(--positive)' : 'var(--negative)',
                }}>{notice[t.uid]}</div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
