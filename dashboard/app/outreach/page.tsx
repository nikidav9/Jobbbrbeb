'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import PageHeader from '@/components/PageHeader'
import KpiCard from '@/components/KpiCard'
import { downloadCSV } from '@/lib/csv-export'
import { getCallMarks, setCallMark, type CallMark } from '@/lib/calllog'
import FilterChips from '@/components/FilterChips'
import Button from '@/components/Button'
import Chip from '@/components/Chip'
import { IconPhone, IconCheck } from '@/components/icons'

/**
 * Обзвон директоров.
 *
 * Всё предложение JobToo держится на пятерых директорах. Ещё тридцать
 * публиковали раньше и замолчали — пока были активны, они выложили 140 смен,
 * по двенадцать на человека. Вернуть пятерых из них — вчетверо больше смен,
 * чем выкладывается сейчас за неделю.
 *
 * Достучаться до части из них внутри приложения нельзя: push/web-push есть
 * не у всех, а за месяц туда заходили семеро из тридцати. Остаётся телефон —
 * и эта страница превращает «надо бы обзвонить» в список строк, где видно,
 * кому звонить первым и с чем.
 */

type Employer = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  company: string | null
  push_token: string | null
  last_seen_at: string | null
  created_at: string
}

type Pub = { employer_id: string | null; created_at: string }
type Vac = { id: string; created_at: string; workers_found: number | null }

const DAY = 86_400_000

type Bucket = 'lapsed' | 'active' | 'never'

const BUCKET_LABEL: Record<Bucket, string> = {
  lapsed: 'Публиковали и замолчали',
  active: 'Публикуют сейчас',
  never: 'Ни разу не публиковали',
}

function ago(iso: string | null, now: number): string {
  if (!iso) return '—'
  const diff = now - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '—'
  const days = Math.floor(diff / DAY)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 30) return `${days} дн назад`
  const months = Math.floor(days / 30)
  return `${months} мес назад`
}

export default function OutreachPage() {
  const [emps, setEmps] = useState<Employer[]>([])
  const [pubs, setPubs] = useState<Pub[]>([])
  const [weekVacs, setWeekVacs] = useState<Vac[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updated, setUpdated] = useState('')
  const [now, setNow] = useState(Date.now())
  const [bucket, setBucket] = useState<Bucket>('lapsed')
  const [q, setQ] = useState('')
  const [marks, setMarks] = useState<Record<string, CallMark>>({})
  const [webPush, setWebPush] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: u }, { data: v }, { data: p }, { data: subs }] = await Promise.all([
      supabase
        .from('jm_users')
        .select('id,first_name,last_name,phone,company,push_token,last_seen_at,created_at')
        .eq('role', 'employer'),
      supabase.from('jm_vacancies').select('employer_id,created_at,id,workers_found'),
      supabase.from('jm_perm_vacancies').select('employer_id,created_at'),
      supabase.from('jm_web_push_subscriptions').select('user_id'),
    ])
    setWebPush(new Set((subs ?? []).map((x: any) => x.user_id)))
    setEmps((u ?? []) as Employer[])
    setPubs([...((v ?? []) as Pub[]), ...((p ?? []) as Pub[])])
    setWeekVacs((v ?? []) as unknown as Vac[])
    setNow(Date.now())
    setUpdated(new Date().toLocaleTimeString('ru'))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setMarks(getCallMarks()) }, [])

  const rows = useMemo(() => {
    const stat = new Map<string, { count: number; last: string | null }>()
    for (const p of pubs) {
      if (!p.employer_id) continue
      const s = stat.get(p.employer_id) ?? { count: 0, last: null }
      s.count++
      if (!s.last || p.created_at > s.last) s.last = p.created_at
      stat.set(p.employer_id, s)
    }
    return emps.map(e => {
      const s = stat.get(e.id) ?? { count: 0, last: null }
      const daysSince = s.last ? Math.floor((now - new Date(s.last).getTime()) / DAY) : null
      const b: Bucket = !s.last ? 'never' : daysSince !== null && daysSince <= 7 ? 'active' : 'lapsed'
      return {
        ...e,
        published: s.count,
        lastPublish: s.last,
        bucket: b,
        reachable: Boolean(e.push_token || webPush.has(e.id)),
      }
    })
  }, [emps, pubs, now, webPush])

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { lapsed: 0, active: 0, never: 0 }
    for (const r of rows) c[r.bucket]++
    return c
  }, [rows])

  // Сначала те, кто выкладывал больше всех: у них и привычка была, и повод
  // вернуться понятнее. Уже отмеченные звонки уходят вниз.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows
      .filter(r => r.bucket === bucket)
      .filter(r => {
        if (!needle) return true
        const hay = [r.first_name, r.last_name, r.phone, r.company].filter(Boolean).join(' ').toLowerCase()
        return hay.includes(needle)
      })
      .sort((a, b) => {
        const ma = marks[a.id] ? 1 : 0
        const mb = marks[b.id] ? 1 : 0
        if (ma !== mb) return ma - mb
        return b.published - a.published
      })
  }, [rows, bucket, q, marks])

  // Главный довод в разговоре: сколько смен за последнюю неделю нашли
  // человека. Считаем здесь же, чтобы в тексте стояло сегодняшнее число, а
  // не выдумка.
  const week = useMemo(() => {
    const since = now - 7 * DAY
    const recent = weekVacs.filter(v => new Date(v.created_at).getTime() >= since)
    return { total: recent.length, filled: recent.filter(v => (v.workers_found ?? 0) > 0).length }
  }, [weekVacs, now])

  const potential = useMemo(
    () => rows.filter(r => r.bucket === 'lapsed').reduce((s, r) => s + r.published, 0),
    [rows]
  )

  /**
   * Текст первого сообщения.
   *
   * Не продаём, а спрашиваем: у нас тридцать замолчавших директоров и ни
   * одной проверенной причины, почему они перестали. Пока причина неизвестна,
   * любое «выложите смену» — это угадывание, и человек на него не отвечает.
   *
   * Вопрос разный, потому что положения разные: у того, кто выложил двенадцать
   * смен и пропал, и у того, кто не выложил ни одной, причины не совпадают.
   */
  function messageFor(r: {
    first_name: string | null
    published: number
    lastPublish: string | null
    bucket: Bucket
  }): string {
    const name = r.first_name?.trim() || 'Здравствуйте'
    const when = r.lastPublish
      ? new Date(r.lastPublish).toLocaleDateString('ru', { day: 'numeric', month: 'long' })
      : null

    const opening = `${name}, здравствуйте! Это Никита из JobToo.`
    const closing = 'Скажите честно, как есть — мне это нужно, чтобы починить. Отвечу на любой вопрос.'

    if (r.bucket === 'never') {
      return [
        opening,
        'Вы зарегистрировались у нас как работодатель, но так ни одной смены и не выложили.',
        'Хочу понять, что помешало: не подошли условия, неудобно выкладывать, не было нужды в людях — или просто не дошли руки?',
        closing,
      ].join('\n\n')
    }

    if (r.bucket === 'active') {
      return [
        opening,
        when ? `Вижу, вы выкладываете смены — последняя ${when}, всего ${r.published}.` : 'Вижу, вы выкладываете смены.',
        'Хочу спросить: что мешает выкладывать чаще? Что в приложении неудобно или чего не хватает?',
        closing,
      ].join('\n\n')
    }

    return [
      opening,
      when
        ? `Вы выкладывали у нас смены — всего ${r.published}, последнюю ${when}. А потом перестали.`
        : 'Вы выкладывали у нас смены, а потом перестали.',
      'Хочу понять причину: люди не пришли, пришли не те, неудобно выкладывать — или что-то другое?',
      closing,
    ].join('\n\n')
  }

  async function copyMessage(r: { id: string; first_name: string | null; published: number; lastPublish: string | null; bucket: Bucket }) {
    try {
      await navigator.clipboard.writeText(messageFor(r))
      setCopied(r.id)
      setTimeout(() => setCopied(c => (c === r.id ? null : c)), 2000)
    } catch {
      // Буфер недоступен — не страшно, текст всегда можно набрать руками.
    }
  }

  function toggleCall(id: string) {
    const next = marks[id] ? null : { at: new Date().toISOString(), note: '' }
    setCallMark(id, next)
    setMarks(getCallMarks())
  }

  function exportCsv() {
    downloadCSV(
      filtered.map(r => ({
        Имя: [r.first_name, r.last_name].filter(Boolean).join(' '),
        Телефон: r.phone ?? '',
        Компания: r.company ?? '',
        'Выложил смен': r.published,
        'Последняя публикация': r.lastPublish ? new Date(r.lastPublish).toLocaleDateString('ru') : '—',
        'Последний вход': r.last_seen_at ? new Date(r.last_seen_at).toLocaleDateString('ru') : 'ни разу',
        'Есть связь': r.reachable ? 'да' : 'нет',
        Звонили: marks[r.id] ? new Date(marks[r.id].at).toLocaleDateString('ru') : '',
      })),
      'obzvon.csv'
    )
  }

  return (
    <div>
      <PageHeader title="Обзвон директоров" lastUpdated={updated} onRefresh={load} />

      <div className="page-content">
        <div className="g-5">
          <KpiCard label="Публикуют сейчас" value={counts.active}
            sub={`из ${emps.length} директоров · за 7 дней`} />
          <KpiCard label="Замолчали" value={counts.lapsed}
            sub="публиковали раньше семи дней назад" />
          <KpiCard label="Смен от замолчавших" value={potential}
            sub={counts.lapsed ? `по ${Math.round(potential / counts.lapsed)} на человека` : 'пока никого'} />
          {/* Считаются смены, опубликованные за неделю, на которые кто-то
              нашёлся, — это не «закрытые смены» в смысле статуса, и подпись
              раньше обещала именно их. */}
          <KpiCard
            label="Смены нашли людей"
            value={week.total ? `${week.filled} из ${week.total}` : null}
            sub={week.total ? 'опубликованы за 7 дней · ответ на «а люди у вас есть»' : 'за неделю не публиковали'}
          />
          <KpiCard label="Обзвонено" value={Object.keys(marks).length}
            sub="отметки хранятся в этом браузере" />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <FilterChips
            options={(Object.keys(BUCKET_LABEL) as Bucket[]).map(b => ({
              key: b, label: BUCKET_LABEL[b], count: counts[b],
            }))}
            value={bucket}
            onChange={setBucket}
          />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Имя, телефон, компания"
            className="jt-input" style={{ height: 30, minWidth: 220 }}
          />
          <Button onClick={exportCsv} style={{ height: 30 }}>Выгрузить CSV</Button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Загрузка…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>Пусто</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(r => {
              const called = marks[r.id]
              const digits = (r.phone ?? '').replace(/\D/g, '')
              return (
                <div
                  key={r.id}
                  className="jt-card"
                  style={{
                    display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
                    padding: '12px 14px',
                    // Отмеченный звонок приглушается фоном, а не прозрачностью:
                    // 0.6 поверх служебного серого делает строку нечитаемой,
                    // а она всё ещё нужна — по ней сверяются.
                    background: called ? 'var(--bg-sunken)' : 'var(--bg-elev)',
                  }}
                >
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {[r.first_name, r.last_name].filter(Boolean).join(' ') || 'Без имени'}
                      {called && (
                        <Chip tone="positive" title={`Отмечено ${new Date(called.at).toLocaleDateString('ru')}`}>
                          <IconCheck size={11} />Звонили
                        </Chip>
                      )}
                      {!r.reachable && <Chip tone="neutral">Только телефон</Chip>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{r.company || '—'}</div>
                  </div>

                  <a
                    href={`tel:+${digits}`}
                    className="num"
                    style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', flex: '0 0 auto' }}
                  >
                    {r.phone ?? '—'}
                  </a>

                  <div style={{ fontSize: 13, color: 'var(--ink-3)', flex: '0 0 auto', minWidth: 150 }}>
                    выложил <b className="num" style={{ color: 'var(--ink)' }}>{r.published}</b> смен
                    <br />
                    последняя — {ago(r.lastPublish, now)}
                  </div>

                  <div style={{ fontSize: 13, color: 'var(--ink-3)', flex: '0 0 auto', minWidth: 130 }}>
                    заходил {ago(r.last_seen_at, now)}
                  </div>

                  <Button onClick={() => copyMessage(r)} style={{ flex: '0 0 auto' }}>
                    {copied === r.id ? 'Скопировано' : 'Текст'}
                  </Button>

                  <Button
                    variant={called ? 'secondary' : 'primary'}
                    onClick={() => toggleCall(r.id)}
                    icon={called ? undefined : <IconPhone size={13} />}
                    style={{ flex: '0 0 auto' }}
                  >
                    {called ? 'Отменить' : 'Позвонил'}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
