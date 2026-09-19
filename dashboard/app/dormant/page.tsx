'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import PageHeader from '@/components/PageHeader'
import KpiCard from '@/components/KpiCard'
import { downloadCSV } from '@/lib/csv-export'
import { sendBothToUser } from '@/lib/admin-actions'
import FilterChips from '@/components/FilterChips'
import Button from '@/components/Button'
import Chip from '@/components/Chip'
import { IconPhone } from '@/components/icons'

/**
 * Кто зарегистрировался и не вернулся.
 *
 * Таких почти три сотни — больше половины всех, кто вообще завёл здесь
 * учётную запись. Это не «неактивные пользователи», это люди, которые
 * однажды решили, что им нужна подработка, дошли до регистрации и не
 * получили от нас ни одной причины вернуться.
 *
 * Страница существует ради одного числа, которого нигде больше нет: скольким
 * из них мы физически можем что-то сказать через push/web-push. Если такого
 * канала нет, остаётся телефон. Планировать рассылку, не разделив эти группы,
 * значит выдумать себе охват, которого нет.
 */

type Row = {
  id: string
  role: 'worker' | 'employer'
  first_name: string | null
  last_name: string | null
  phone: string | null
  company: string | null
  metro_station: string | null
  created_at: string
  push_token: string | null
}

type Reach = 'push' | 'phone'

const REACH_LABEL: Record<Reach, string> = {
  push: 'Пуш на устройство',
  phone: 'Только телефон',
}

/** Чем до человека вообще можно достучаться. Порядок — по надёжности.
 *
 *  Веб-пуш учитывается наравне с токеном приложения: до подписчика с айфона
 *  сообщение доходит так же. Раньше он здесь не проверялся вовсе, и такие
 *  люди попадали в «только телефон» — охват на этой странице выходил меньше,
 *  чем на «Сводке», где те же три канала считались правильно. */
function reachOf(r: Row, webPush: Set<string>): Reach {
  if (r.push_token || webPush.has(r.id)) return 'push'
  return 'phone'
}

const DAY = 86_400_000

/**
 * Заготовки сообщений.
 *
 * Писать такое с нуля каждый раз — значит либо не написать вовсе, либо
 * отправить наспех трёмстам людям. Поэтому текст лежит готовый, а поле
 * остаётся обычным: вставили и правьте.
 *
 * Тон здесь не продающий, а спрашивающий, и это осознанно. Это люди,
 * которые однажды дошли до регистрации и не вернулись. Почему — мы не
 * знаем; пока не знаем, любое «выходите на смену» это угадывание, на
 * которое не отвечают. Второй шаблон прямо спрашивает, и ответ на него
 * ценнее, чем выход одного человека.
 *
 * Обещаем только то, что правда: смены рядом с метро, отклик в два тапа,
 * отклики в тот же день. Ни слова про сроки выплат и заработки — этого
 * никто не проверял, а обещание, за которое не отвечаешь, стоит дороже
 * молчания.
 */
const DRAFTS: { key: string; label: string; role: 'worker' | 'employer' | 'any'; text: string }[] = [
  {
    key: 'remind',
    label: 'Напомнить о себе',
    role: 'worker',
    text: `{name}, здравствуйте! Это JobToo — подработки на складах в Москве.

Вы у нас регистрировались, но так ни разу и не зашли. Смены появляются каждый день, часть из них рядом с вашим метро. Откликнуться можно в два тапа, без резюме и собеседований.

Загляните — вдруг подойдёт.`,
  },
  {
    key: 'ask',
    label: 'Спросить, что не так',
    role: 'any',
    text: `{name}, здравствуйте! Это Никита из JobToo.

Вы зарегистрировались у нас, но так ни разу и не зашли. Хочу понять почему: не нашли подходящих смен, что-то было непонятно в приложении — или просто передумали?

Ответьте одной строкой, как есть. Мне это нужно, чтобы починить.`,
  },
  {
    key: 'install',
    label: 'Как установить',
    role: 'any',
    text: `{name}, здравствуйте! Это JobToo.

Вы у нас регистрировались, но так ни разу и не зашли. Возможно, просто не поставилось приложение — расскажу, как.

Андроид: установите из RuStore — https://www.rustore.ru/catalog/app/com.nikidav23.onspaceapp

Айфон: откройте jobtoo.ru в Safari, нажмите «Поделиться» → «На экран «Домой»». Появится иконка, дальше работает как обычное приложение — в App Store нас нет, туда российских разработчиков не пускают.

Если не получится — напишите, помогу.`,
  },
  {
    key: 'employer',
    label: 'Работодателю',
    role: 'employer',
    text: `{name}, здравствуйте! Это JobToo — здесь находят людей на смену.

Вы регистрировались как работодатель, но вакансию так и не разместили. Разместить — минута, отклики обычно приходят в тот же день.

Если что-то мешает, напишите — разберёмся.`,
  },
]

/**
 * Как поставить приложение — две разные дороги, и это надо помнить наизусть.
 *
 * На андроиде приложение лежит в RuStore: в Google Play его нет и не будет,
 * пока российские разработчики туда не публикуются.
 *
 * На айфоне приложения нет вовсе. Не забыли выложить — App Store для
 * российского разработчика закрыт. Вместо него jobtoo.ru, добавленный на
 * рабочий стол: это то же самое приложение, с иконкой и уведомлениями, а не
 * «сайт вместо приложения». Сказать это надо именно так, иначе человек
 * слышит «нормального приложения у них нет» и закрывает разговор.
 *
 * Ссылка без хвоста ?ysclid=… намеренно: это метка поисковика, прицепившаяся
 * к чужому переходу, и в наших сообщениях ей делать нечего.
 */
const RUSTORE_URL = 'https://www.rustore.ru/catalog/app/com.nikidav23.onspaceapp'
const WEB_URL = 'https://jobtoo.ru'

const INSTALL_ANDROID =
  `Андроид: установите из RuStore — ${RUSTORE_URL}`

const INSTALL_IPHONE =
  `Айфон: откройте ${WEB_URL} в Safari, нажмите «Поделиться» → `
  + '«На экран «Домой»». Появится иконка, дальше работает как обычное приложение.'

const INSTALL_BOTH = `${INSTALL_ANDROID}\n\n${INSTALL_IPHONE}`

/** Доля рядом с абсолютным числом: «41 человек» без «из 281» не читается. */
function pctOf(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}% из ${total}` : '—'
}

export default function DormantPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<'all' | 'worker' | 'employer'>('all')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [updated, setUpdated] = useState<string>('')
  const [copied, setCopied] = useState<string | null>(null)
  const [webPush, setWebPush] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: subs }] = await Promise.all([
      supabase
        .from('jm_users')
        .select('id,role,first_name,last_name,phone,company,metro_station,created_at,push_token')
        .is('last_seen_at', null)
        .order('created_at', { ascending: false }),
      supabase.from('jm_web_push_subscriptions').select('user_id'),
    ])
    setRows((data ?? []) as Row[])
    setWebPush(new Set((subs ?? []).map((x: any) => x.user_id)))
    setUpdated(new Date().toLocaleTimeString('ru-RU'))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(
    () => rows.filter(r => role === 'all' || r.role === role),
    [rows, role],
  )

  const groups = useMemo(() => {
    const g: Record<Reach, Row[]> = { push: [], phone: [] }
    for (const r of filtered) g[reachOf(r, webPush)].push(r)
    return g
  }, [filtered, webPush])

  // Сколько уже прошло с регистрации. Не украшение: человек, ушедший вчера,
  // и человек, ушедший полгода назад, — разные разговоры.
  const medianAge = useMemo(() => {
    if (!filtered.length) return 0
    const ages = filtered
      .map(r => (Date.now() - new Date(r.created_at).getTime()) / DAY)
      .sort((a, b) => a - b)
    return Math.round(ages[Math.floor(ages.length / 2)])
  }, [filtered])

  const roleCounts = useMemo(() => ({
    all: rows.length,
    worker: rows.filter(r => r.role === 'worker').length,
    employer: rows.filter(r => r.role === 'employer').length,
  }), [rows])

  async function sendPush() {
    const list = groups.push
    if (!list.length || !text.trim()) return
    if (!confirm(`Отправить пуш ${list.length} чел.? Отозвать будет нельзя.`)) return
    setBusy(true); setResult(null)
    let ok = 0, fail = 0
    // По одному, а не пачкой: у пуша нет группового способа, зато каждый
    // отказ виден отдельно. Имя подставляем так же, как в телеграме.
    for (const r of list) {
      try {
        await sendBothToUser(r.id, 'JobToo', text.replace(/\{name\}/g, r.first_name ?? ''))
        ok++
      } catch { fail++ }
    }
    setResult(`Пуш: доставлено ${ok}, не дошло ${fail}`)
    setBusy(false)
  }

  // Готовый текст можно скопировать для звонка или другого разрешённого канала.
  async function copyFor(r: Row) {
    // «Текст» должен работать сразу после открытия страницы. Если оператор
    // ещё не выбрал шаблон, используем нейтральный вопрос — раньше кнопка
    // выглядела сломанной, потому что была молча выключена пустым полем.
    const message = text.trim() || DRAFTS.find(d => d.key === 'ask')!.text
    try {
      await navigator.clipboard.writeText(message.replace(/\{name\}/g, r.first_name ?? ''))
      setCopied(r.id)
      setTimeout(() => setCopied(c => (c === r.id ? null : c)), 1500)
    } catch {
      setResult('Браузер не дал доступ к буферу обмена')
    }
  }

  /** Скопировать готовую подсказку про установку — её диктуют по телефону. */
  async function copyPlain(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    } catch {
      setResult('Браузер не дал доступ к буферу обмена')
    }
  }

  function exportPhones() {
    downloadCSV(
      groups.phone.map(r => ({
        имя: [r.first_name, r.last_name].filter(Boolean).join(' '),
        роль: r.role === 'worker' ? 'работник' : 'работодатель',
        телефон: r.phone ?? '',
        компания: r.company ?? '',
        метро: r.metro_station ?? '',
        зарегистрирован: new Date(r.created_at).toLocaleDateString('ru-RU'),
      })),
      'не-заходили-только-телефон.csv',
    )
  }

  const canSend = text.trim().length > 0 && !busy

  return (
    <div>
      <PageHeader title="Ни разу не заходили" lastUpdated={updated} onRefresh={load} />

      <div className="page-content">
        <div className="g-4">
          <KpiCard label="Всего" value={filtered.length}
                   sub={medianAge ? `медиана ${medianAge} дн. с регистрации` : 'с момента регистрации'} />
          <KpiCard label="Достижимы пушем" value={groups.push.length}
                   sub={`${pctOf(groups.push.length, filtered.length)} · приложение или веб-пуш`} />
          <KpiCard label="Только телефон" value={groups.phone.length}
                   sub={`${pctOf(groups.phone.length, filtered.length)} · доходит лишь звонок`} />
        </div>

        <FilterChips
          options={[
            { key: 'all' as const, label: 'Все', count: roleCounts.all },
            { key: 'worker' as const, label: 'Работники', count: roleCounts.worker },
            { key: 'employer' as const, label: 'Работодатели', count: roleCounts.employer },
          ]}
          value={role}
          onChange={setRole}
        />

        {/* Как поставить приложение.
            Стоит перед полем сообщения, потому что нужно ровно здесь: половина
            не заходивших не заходила не из-за отсутствия смен, а потому что
            приложение у них так и не появилось на экране. Дороги две и они
            разные — держать их в голове при звонке невозможно. */}
        <div className="jt-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Как поставить приложение</div>

          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{
              padding: '10px 12px', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-sunken)', border: '1px solid var(--line)',
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>Андроид — RuStore</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4, wordBreak: 'break-all' }}>
                <a href={RUSTORE_URL} target="_blank" rel="noreferrer">{RUSTORE_URL}</a>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
                В Google Play нас нет — туда российские разработчики не публикуются.
              </div>
              <Button style={{ height: 28, marginTop: 8 }}
                onClick={() => copyPlain('android', INSTALL_ANDROID)}>
                {copied === 'android' ? 'Скопировано' : 'Скопировать'}
              </Button>
            </div>

            <div style={{
              padding: '10px 12px', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-sunken)', border: '1px solid var(--line)',
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>Айфон — jobtoo.ru на рабочий стол</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4 }}>
                Открыть <a href={WEB_URL} target="_blank" rel="noreferrer">jobtoo.ru</a> в Safari →
                «Поделиться» → «На экран «Домой»».
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
                Получается иконка и уведомления — то же приложение, а не «сайт вместо приложения».
                Говорить лучше именно так: иначе человек слышит «нормального приложения нет».
              </div>
              <Button style={{ height: 28, marginTop: 8 }}
                onClick={() => copyPlain('iphone', INSTALL_IPHONE)}>
                {copied === 'iphone' ? 'Скопировано' : 'Скопировать'}
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button style={{ height: 30 }} onClick={() => copyPlain('both', INSTALL_BOTH)}>
              {copied === 'both' ? 'Скопировано' : 'Скопировать оба'}
            </Button>
            <Button style={{ height: 30 }} onClick={() => {
              const typed = text.trim()
              const known = DRAFTS.some(x => x.text === text)
              if (typed && !known && !confirm('Заменить набранный текст заготовкой?')) return
              setText(DRAFTS.find(d => d.key === 'install')!.text)
            }}>
              Вставить в сообщение
            </Button>
          </div>
        </div>

        <div className="jt-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            Текст сообщения. <code>{'{name}'}</code> заменится на имя человека.
            Пустое имя — подставится пустота, поэтому лучше писать так, чтобы
            фраза читалась и без него. Кнопка «Текст» в строке кладёт это
            сообщение в буфер — для тех, кому пишут вручную с личного аккаунта.
          </div>
          {/* Заготовки. Кнопка подставляет текст в поле — дальше это обычное
              поле, правьте как угодно. Написанное вручную не затираем молча:
              спрашиваем, иначе один промах мышью стирает пять минут работы. */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Вставить:</span>
            {DRAFTS.map(d => {
              // Шаблон для работников, а в фильтре работодатели — метим, но
              // не прячем: иногда нужно именно посмотреть чужой текст.
              const mismatch = d.role !== 'any' && role !== 'all' && role !== d.role
              return (
                <Button
                  key={d.key}
                  style={{ height: 30, opacity: mismatch ? 0.55 : 1 }}
                  title={mismatch
                    ? `Текст для тех, кто ${d.role === 'worker' ? 'ищет смены' : 'ищет людей'} — сейчас в списке другие`
                    : undefined}
                  onClick={() => {
                    const typed = text.trim()
                    const known = DRAFTS.some(x => x.text === text)
                    if (typed && !known && !confirm('Заменить набранный текст заготовкой?')) return
                    setText(d.text)
                  }}
                >
                  {d.label}
                </Button>
              )
            })}
            {text ? (
              <Button style={{ height: 30 }} onClick={() => setText('')}>Очистить</Button>
            ) : null}
          </div>

          <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
            placeholder="Нажмите «Вставить» или напишите своё. {name} заменится на имя."
            className="jt-input" style={{ width: '100%' }} />

          {/* Как это увидит человек: имя подставлено, длина настоящая.
              Без предпросмотра «{name}, здравствуйте» легко уходит как есть. */}
          {text.trim() ? (
            <div style={{
              padding: '10px 12px', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-sunken)', border: '1px solid var(--line)',
            }}>
              <div className="mono" style={{
                fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase',
                color: 'var(--ink-3)', marginBottom: 6,
              }}>Как увидит человек</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>
                {text.replace(/\{name\}/g, filtered[0]?.first_name?.trim() || 'Иван')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>
                {text.length} знаков{text.length > 900 ? ' — для пуша длинновато, обрежется' : ''}
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* Рассылка на три сотни человек не отзывается — поэтому вид
                «опасное», а не «главное действие». */}
            <Button variant="danger" disabled={!canSend || !groups.push.length} onClick={sendPush}>
              Отправить пушем ({groups.push.length})
            </Button>
            <Button disabled={!groups.phone.length} onClick={exportPhones}>
              Выгрузить телефоны ({groups.phone.length})
            </Button>
          </div>

          {busy && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Отправляю, не закрывайте страницу…</div>}
          {result && <div style={{ fontSize: 13, color: 'var(--ink)' }}>{result}</div>}
        </div>

        <div className="jt-card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
            <table className="jt-table">
              <thead>
                <tr>
                  {['Имя', 'Роль', 'Телефон', 'Метро', 'Зарегистрирован', 'Как достучаться', 'Написать'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7} style={{ padding: 16, color: 'var(--ink-3)' }}>Загружаю…</td></tr>
                )}
                {!loading && !filtered.length && (
                  <tr><td colSpan={7} style={{ padding: 16, color: 'var(--ink-3)' }}>Никого нет — все хоть раз заходили.</td></tr>
                )}
                {filtered.slice(0, 500).map(r => {
                  const reach = reachOf(r, webPush)
                  const digits = (r.phone ?? '').replace(/\D/g, '')
                  return (
                    <tr key={r.id}>
                      <td style={{ color: 'var(--ink)' }}>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</td>
                      <td style={{ color: 'var(--ink-2)' }}>{r.role === 'worker' ? 'Работник' : 'Работодатель'}</td>
                      <td className="num" style={{ color: 'var(--ink-2)' }}>{r.phone ?? '—'}</td>
                      <td style={{ color: 'var(--ink-2)' }}>{r.metro_station ?? '—'}</td>
                      <td className="num" style={{ color: 'var(--ink-3)' }}>{new Date(r.created_at).toLocaleDateString('ru-RU')}</td>
                      <td>
                        <Chip tone={reach === 'push' ? 'info' : 'neutral'}>
                          {REACH_LABEL[reach]}
                        </Chip>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <a className="jt-icon-btn" style={{ width: 'auto', padding: '0 9px', textDecoration: 'none' }}
                             href={`tel:+${digits}`}>
                            <IconPhone size={12} />Позвонить
                          </a>
                          <button onClick={() => copyFor(r)}
                            className="jt-icon-btn" style={{ width: 'auto', padding: '0 9px' }}
                            title="Скопировать текст, чтобы вставить в переписку вручную">
                            {copied === r.id ? 'Скопировано' : 'Текст'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 500 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-3)', borderTop: '1px solid var(--line)' }}>
              Показаны первые 500 из {filtered.length}. Отправка и выгрузка работают по всему списку.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
