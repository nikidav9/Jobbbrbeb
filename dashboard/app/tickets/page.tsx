'use client'
import { useCallback, useState } from 'react'
import { supabaseAdmin } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import PageHeader from '@/components/PageHeader'
import PageSkeleton from '@/components/PageSkeleton'
import { blockUser, setComplaintStatus, addComplaintNote } from '@/lib/admin-actions'
import { sendPushToUser } from '@/lib/admin-actions'
import KpiCard from '@/components/KpiCard'
import Button from '@/components/Button'
import Chip, { type Tone } from '@/components/Chip'
import FilterChips from '@/components/FilterChips'
import { IconUser, IconBan, IconCheck, IconX, IconApp, IconChevron } from '@/components/icons'

async function fetchTickets() {
  const [{ data: complaints }, { data: users }] = await Promise.all([
    supabaseAdmin.from('jm_complaints').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('jm_users').select('id,first_name,last_name,phone,role,is_blocked,push_token'),
  ])

  const userMap: Record<string, any> = {}
  for (const u of users ?? []) userMap[u.id] = u

  function uName(u: any) {
    if (!u) return '—'
    return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.phone || '—'
  }

  const list = (complaints ?? []).map((c: any) => ({
    id: c.id,
    type: c.complaint_type ?? 'other',
    description: c.description ?? '—',
    status: c.status ?? 'pending',
    adminNote: (c as any).admin_note ?? '',
    reporterId: c.reporter_id ?? null,
    targetId: c.target_id ?? null,
    reporterName: uName(userMap[c.reporter_id]),
    reporterPhone: c.reporter_phone ?? userMap[c.reporter_id]?.phone ?? '—',
    targetName: uName(userMap[c.target_id]),
    targetPhone: c.target_phone ?? userMap[c.target_id]?.phone ?? '—',
    targetBlocked: userMap[c.target_id]?.is_blocked ?? false,
    targetHasPush: !!userMap[c.target_id]?.push_token,
    reporterHasPush: !!userMap[c.reporter_id]?.push_token,
    date: c.created_at?.slice(0, 10) ?? '',
    time: c.created_at?.slice(11, 16) ?? '',
  }))

  return { list }
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Новая',
  in_review: 'В работе',
  resolved: 'Решена',
  dismissed: 'Отклонена',
}
/** Тон вместо своего hex у каждого статуса: раньше здесь стояли цвета
 *  прошлой палитры, и подложка складывалась из того же значения с суффиксом
 *  прозрачности — «#A87020» плюс «18». К токенам такое не приводится. */
const STATUS_TONE: Record<string, Tone> = {
  pending: 'accent',
  in_review: 'info',
  resolved: 'positive',
  dismissed: 'neutral',
}

type ActionSt = 'idle' | 'loading' | 'ok' | 'err'

export default function TicketsPage() {
  const fetcher = useCallback(() => fetchTickets(), [])
  const { data: d, loading, lastUpdated, pulse, refresh } = useRealtime(fetcher, {
    tables: ['jm_complaints', 'jm_users'],
    intervalSec: 30,
  })

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [noteText, setNoteText] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [actions, setActions] = useState<Record<string, { s: ActionSt; msg?: string }>>({})

  function setA(id: string, s: ActionSt, msg?: string) {
    setActions(prev => ({ ...prev, [id]: { s, msg } }))
  }

  if (loading || !d) return <PageSkeleton rows={3} />

  const list = d.list.filter((c: any) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (typeFilter !== 'all' && c.type !== typeFilter) return false
    return true
  })

  const byStatus = (st: string) => d.list.filter((c: any) => c.status === st).length
  const pending = byStatus('pending')
  const inReview = byStatus('in_review')
  const resolved = byStatus('resolved')
  const dismissed = byStatus('dismissed')

  const types = Array.from(new Set(d.list.map((c: any) => c.type))) as string[]
  const typeCount = (t: string) => d.list.filter((c: any) => c.type === t).length

  async function handleBlock(c: any) {
    if (!c.targetId) return
    setA(c.id + '_block', 'loading')
    try {
      await blockUser(c.targetId, !c.targetBlocked, c.targetName)
      setA(c.id + '_block', 'ok', c.targetBlocked ? 'Разблокирован' : 'Заблокирован')
      setTimeout(refresh, 800)
    } catch (e: any) { setA(c.id + '_block', 'err', e.message) }
  }

  async function handleStatus(c: any, status: 'pending' | 'in_review' | 'resolved' | 'dismissed') {
    setA(c.id + '_st', 'loading')
    try {
      await setComplaintStatus(c.id, status)
      setA(c.id + '_st', 'ok', STATUS_LABEL[status])
      setTimeout(refresh, 600)
    } catch (e: any) { setA(c.id + '_st', 'err', e.message) }
  }

  async function handleNote(c: any) {
    const note = noteText[c.id]?.trim()
    if (!note) return
    setA(c.id + '_note', 'loading')
    try {
      await addComplaintNote(c.id, note)
      setA(c.id + '_note', 'ok', 'Сохранено')
      setTimeout(refresh, 600)
    } catch (e: any) { setA(c.id + '_note', 'err', e.message) }
  }

  async function handlePushTarget(c: any) {
    if (!c.targetId) return
    setA(c.id + '_push', 'loading')
    try {
      await sendPushToUser(c.targetId, 'Жалоба на ваш аккаунт', 'Ваш аккаунт рассматривается администрацией. Пожалуйста, соблюдайте правила сервиса.')
      setA(c.id + '_push', 'ok', 'Пуш отправлен')
    } catch (e: any) { setA(c.id + '_push', 'err', e.message) }
  }

  return (
    <div>
      <PageHeader title="Тикеты / Жалобы" intervalSec={30} lastUpdated={lastUpdated} pulse={pulse} onRefresh={refresh} />
      <div className="page-content">

        {/* «Всего» раньше не сходилось с суммой соседей: отклонённые не
            показывались вовсе, и четыре числа в ряду не складывались в
            первое. */}
        <div className="g-5">
          <KpiCard label="Всего" value={d.list.length} sub="за всё время" />
          <KpiCard label="Новых" value={pending} sub="ещё не смотрели" />
          <KpiCard label="В работе" value={inReview} sub="разбираемся" />
          <KpiCard label="Решено" value={resolved}
            sub={d.list.length ? `${Math.round(resolved / d.list.length * 100)}% всех` : '—'} />
          <KpiCard label="Отклонено" value={dismissed} sub="без последствий" />
        </div>

        {/* Filters */}
        <div style={{ display: 'grid', gap: 8 }}>
          <FilterChips
            options={[
              { key: 'all', label: 'Любой статус', count: d.list.length },
              ...['pending', 'in_review', 'resolved', 'dismissed'].map(st => ({
                key: st, label: STATUS_LABEL[st], count: byStatus(st),
              })),
            ]}
            value={statusFilter}
            onChange={setStatusFilter}
          />
          {types.length > 1 && (
            <FilterChips
              options={[
                { key: 'all', label: 'Любой тип', count: d.list.length },
                ...types.map(t => ({ key: t, label: t, count: typeCount(t) })),
              ]}
              value={typeFilter}
              onChange={setTypeFilter}
            />
          )}
        </div>

        {/* Ticket list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.length === 0 && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              {d.list.length === 0 ? 'Жалоб не поступало' : 'Под выбранные фильтры ничего не подошло'}
            </div>
          )}
          {list.map((c: any) => {
            const expanded = expandedId === c.id
            const tone = STATUS_TONE[c.status] ?? 'neutral'
            const aBlock = actions[c.id + '_block']
            const aSt = actions[c.id + '_st']
            const aNote = actions[c.id + '_note']
            const aPush = actions[c.id + '_push']

            return (
              <div key={c.id} className="jt-card" style={{
                overflow: 'hidden',
                borderColor: c.status === 'pending' ? 'var(--accent-line)' : 'var(--line)',
              }}>
                {/* Card header */}
                <div
                  style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12 }}
                  onClick={() => setExpandedId(expanded ? null : c.id)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Top row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <Chip tone={tone} dot={c.status === 'pending'}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </Chip>
                      <Chip tone="neutral">{c.type}</Chip>
                      <span className="num" style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 'auto' }}>
                        {c.date} {c.time}
                      </span>
                    </div>

                    {/* Description */}
                    <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, marginBottom: 8 }}>
                      {c.description}
                    </div>

                    {/* Parties */}
                    <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--ink-3)', flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <IconUser size={12} />От:&nbsp;<strong style={{ color: 'var(--ink)' }}>{c.reporterName}</strong>
                        <span className="num">{c.reporterPhone}</span>
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <IconUser size={12} />На:&nbsp;<strong style={{ color: c.targetBlocked ? 'var(--negative)' : 'var(--ink)' }}>{c.targetName}</strong>
                        <span className="num">{c.targetPhone}</span>
                        {c.targetBlocked && <Chip tone="negative"><IconBan size={11} />Заблокирован</Chip>}
                      </span>
                    </div>

                    {c.adminNote && (
                      <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--info-soft)', border: '1px solid var(--info-line)', fontSize: 13, color: 'var(--info)' }}>
                        Заметка: {c.adminNote}
                      </div>
                    )}
                  </div>

                  <IconChevron size={14} open={expanded} style={{ color: 'var(--ink-3)', marginTop: 2 }} />
                </div>

                {/* Expanded actions */}
                {expanded && (
                  <div style={{ borderTop: '1px solid var(--line)', padding: '14px 16px', background: 'var(--bg-sunken)', display: 'flex', flexDirection: 'column', gap: 14 }}>

                    {/* Status actions */}
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-3)', marginBottom: 8, fontFamily: 'Manrope, sans-serif' }}>Изменить статус</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(['pending', 'in_review', 'resolved', 'dismissed'] as const).filter(s => s !== c.status).map(s => (
                          <Button key={s} onClick={() => handleStatus(c, s)} disabled={aSt?.s === 'loading'}
                            style={{ height: 30 }}>
                            {aSt?.s === 'loading' ? '…' : STATUS_LABEL[s]}
                          </Button>
                        ))}
                        {aSt?.s === 'ok' && <span style={{ fontSize: 13, color: 'var(--positive)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconCheck size={13} />{aSt.msg}</span>}
                        {aSt?.s === 'err' && <span style={{ fontSize: 13, color: 'var(--negative)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconX size={13} />{aSt.msg}</span>}
                      </div>
                    </div>

                    {/* Target actions */}
                    {c.targetId && (
                      <div>
                        <div style={{ fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-3)', marginBottom: 8, fontFamily: 'Manrope, sans-serif' }}>Действия с обвиняемым</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          {aBlock?.s === 'ok'
                            ? <span style={{ fontSize: 13, color: 'var(--positive)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconCheck size={13} />{aBlock.msg}</span>
                            : aBlock?.s === 'err'
                            ? <span style={{ fontSize: 13, color: 'var(--negative)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconX size={13} />{aBlock.msg}</span>
                            : <Button variant={c.targetBlocked ? 'secondary' : 'danger'} style={{ height: 30 }}
                                onClick={() => handleBlock(c)} disabled={aBlock?.s === 'loading'}>
                                {aBlock?.s === 'loading' ? '…' : c.targetBlocked ? 'Разблокировать' : 'Заблокировать'}
                              </Button>}

                          {c.targetHasPush && (
                            aPush?.s === 'ok'
                              ? <span style={{ fontSize: 13, color: 'var(--positive)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconCheck size={13} />Пуш отправлен</span>
                              : <Button style={{ height: 30 }} icon={<IconApp size={13} />}
                                  onClick={() => handlePushTarget(c)} disabled={aPush?.s === 'loading'}>
                                  {aPush?.s === 'loading' ? '…' : 'Предупредить пушем'}
                                </Button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Admin note */}
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-3)', marginBottom: 8, fontFamily: 'Manrope, sans-serif' }}>Заметка администратора</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          placeholder="Добавить заметку к тикету..."
                          value={noteText[c.id] ?? c.adminNote ?? ''}
                          onChange={e => setNoteText(prev => ({ ...prev, [c.id]: e.target.value }))}
                          className="jt-input" style={{ flex: 1, height: 32 }}
                        />
                        <Button variant="primary" style={{ height: 32 }}
                          onClick={() => handleNote(c)} disabled={!noteText[c.id]?.trim() || aNote?.s === 'loading'}>
                          {aNote?.s === 'loading' ? '…' : aNote?.s === 'ok' ? 'Сохранено' : 'Сохранить'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

