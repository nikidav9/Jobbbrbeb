'use client'
import { useCallback, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/lib/useRealtime'
import { PALETTE } from '@/lib/queries'
import {
  JUPITER_COLUMNS, CAPTCHA_COLUMNS, BUCKET_LABEL, REASON_LABEL, ENGINE_LABEL, CAPTCHA_REASONS,
  UNKNOWN_REASON_LABEL, buildReport, buildEngineReport, buildCaptchaReport, buildUnknownReport, formatDuration,
  type JupiterRow, type CaptchaEvent, type CaptchaRow,
} from '@/lib/jupiterStats'
import PageHeader from '@/components/PageHeader'
import PageSkeleton from '@/components/PageSkeleton'
import KpiCard from '@/components/KpiCard'
import ChartCard from '@/components/ChartCard'
import FilterChips from '@/components/FilterChips'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { AXIS, GRID, TT } from '@/lib/chart'

/**
 * Юпитер: замер автооткликов на сайтах компаний.
 *
 * Отвечает на вопрос владельца «сколько откликов Юпитер реально отправляет
 * и где застревает» — до того, как включать новые сайты. Строка таблицы —
 * сайт, а не человек: колонок людей панель у базы не просит вовсе
 * (см. JUPITER_COLUMNS в lib/jupiterStats).
 */

async function fetchRows(): Promise<JupiterRow[]> {
  const page = 1000
  const all: JupiterRow[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('jm_jupiter_applications')
      .select(JUPITER_COLUMNS)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    all.push(...(data as unknown as JupiterRow[]))
    if (data.length < page) break
  }
  return all
}

/** События с капчей: только id заявки, причина и движок, без user_id. */
async function fetchCaptchaEvents(): Promise<CaptchaEvent[]> {
  const page = 1000
  const all: CaptchaEvent[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('jm_jupiter_events')
      .select('application_id,reason_code,engine:detail->>engine')
      .in('reason_code', CAPTCHA_REASONS)
      .order('id', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    all.push(...(data as unknown as CaptchaEvent[]))
    if (data.length < page) break
  }
  return all
}

/** Капча человеку: без user_id, без картинки и без ответа (CAPTCHA_COLUMNS). */
async function fetchCaptcha(): Promise<CaptchaRow[]> {
  const page = 1000
  const all: CaptchaRow[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('jm_jupiter_captcha')
      .select(CAPTCHA_COLUMNS)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    all.push(...(data as unknown as CaptchaRow[]))
    if (data.length < page) break
  }
  return all
}

/** captcha = null — таблица капчи не прочиталась, блок показывает прочерки. */
type Data = { rows: JupiterRow[]; events: CaptchaEvent[]; captcha: CaptchaRow[] | null }

async function fetchAll(): Promise<Data> {
  // Разрезы по капче вторичны: если они не прочитались, основной замер живёт.
  const [rows, events, captcha] = await Promise.all([
    fetchRows(),
    fetchCaptchaEvents().catch(() => [] as CaptchaEvent[]),
    fetchCaptcha().catch(() => null),
  ])
  return { rows, events, captcha }
}

type Period = '7' | '30' | 'all'
const PERIOD_DAYS: Record<Period, number> = { '7': 7, '30': 30, all: 0 }

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')

const th: React.CSSProperties = { padding: '10px 14px', fontWeight: 500, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '10px 14px', whiteSpace: 'nowrap' }

export default function JupiterPage() {
  const fetcher = useCallback(() => fetchAll(), [])
  const { data, loading, error, lastUpdated, pulse, refresh } = useRealtime(fetcher, { intervalSec: 600 })
  const [period, setPeriod] = useState<Period>('7')
  const rows = data?.rows

  const counts = useMemo(() => {
    const all = rows ?? []
    return {
      '7': buildReport(all, 7).totals.total,
      '30': buildReport(all, 30).totals.total,
      all: all.length,
    }
  }, [rows])
  const report = useMemo(() => buildReport(rows ?? [], PERIOD_DAYS[period]), [rows, period])

  const engines = useMemo(
    () => buildEngineReport(rows ?? [], data?.events ?? [], PERIOD_DAYS[period]),
    [rows, data, period],
  )

  const unknown = useMemo(() => buildUnknownReport(rows ?? [], PERIOD_DAYS[period]), [rows, period])

  const captcha = useMemo(
    () => (data?.captcha ? buildCaptchaReport(data.captcha, PERIOD_DAYS[period]) : null),
    [data, period],
  )

  if (loading && !rows) return <PageSkeleton rows={3} />

  const header = <PageHeader title="Юпитер" intervalSec={600} lastUpdated={lastUpdated} pulse={pulse} onRefresh={refresh} />

  if (error && !rows) {
    return (
      <div>
        {header}
        <div className="page-content">
          <ChartCard title="Не удалось загрузить заявки Юпитера" sub="jm_jupiter_applications">
            <div style={{ fontSize: 13, color: 'var(--negative)' }}>{error}</div>
          </ChartCard>
        </div>
      </div>
    )
  }

  const t = report.totals
  const browser = engines.find(e => e.engine === 'browser')
  const tickDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

  return (
    <div>
      {header}
      <div className="page-content">
        <FilterChips<Period>
          value={period}
          onChange={setPeriod}
          options={[
            { key: '7', label: '7 дней', count: counts['7'] },
            { key: '30', label: '30 дней', count: counts['30'] },
            { key: 'all', label: 'Всё время', count: counts.all },
          ]}
        />

        <div className="g-4">
          <KpiCard label="Свайпов по сайтам компаний" value={t.total} sub="по дате отклика" />
          <KpiCard label={BUCKET_LABEL.auto} value={t.auto} sub={`${pct(t.auto, t.total)} от свайпов`} color="var(--positive)" />
          <KpiCard label="Подтверждено сайтом" value={t.verified}
            sub={`${pct(t.verified, t.auto)} отправленных · письмо или экран успеха`} color="var(--positive)" />
          <KpiCard label={BUCKET_LABEL.human} value={t.human} sub="капча, вопрос, согласие" color="var(--accent)" />
          <KpiCard label={BUCKET_LABEL.parked} value={t.parked} sub="ждут включения сайта" color="var(--info)" />
          <KpiCard label={BUCKET_LABEL.manual} value={t.manual} sub="люди отправили из «Ждут вас»" />
          <KpiCard label={BUCKET_LABEL.working} value={t.working} sub="очередь и повторы попыток" />
          <KpiCard label={BUCKET_LABEL.failed} value={t.failed + t.duplicate}
            sub={t.duplicate ? `из них повторов: ${t.duplicate}` : 'не отправлено или исход неизвестен'}
            color="var(--negative)" />
        </div>

        <ChartCard title="По дням" sub={period === 'all' ? 'Последние 30 дней · по Москве' : `Последние ${period} дней · по Москве`}>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={report.days} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="day" tick={AXIS} tickFormatter={tickDay} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS} allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TT} labelFormatter={v => tickDay(String(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="auto" name={BUCKET_LABEL.auto} stackId="a" fill={PALETTE.green} />
                <Bar dataKey="manual" name={BUCKET_LABEL.manual} stackId="a" fill={PALETTE.cyan} />
                <Bar dataKey="human" name={BUCKET_LABEL.human} stackId="a" fill={PALETTE.orange} />
                <Bar dataKey="parked" name={BUCKET_LABEL.parked} stackId="a" fill={PALETTE.blue} />
                <Bar dataKey="other" name="Прочее" stackId="a" fill={PALETTE.gray} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="По сайтам" sub="Сайт — хост вакансии, как его различает Юпитер. Людей здесь нет.">
          {report.sites.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '4px 0 8px' }}>
              За этот период свайпов по сайтам компаний не было.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', margin: '0 -16px -14px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>
                    <th style={th}>Сайт</th>
                    <th style={{ ...th, textAlign: 'right' }}>Свайпов</th>
                    <th style={{ ...th, textAlign: 'right' }}>Отправил</th>
                    <th style={{ ...th, textAlign: 'right' }}>Подтверждено</th>
                    <th style={{ ...th, textAlign: 'right' }}>Ждут человека</th>
                    <th style={{ ...th, textAlign: 'right' }}>Подключаем</th>
                    <th style={{ ...th, textAlign: 'right' }}>Ошибки</th>
                    <th style={{ ...th, whiteSpace: 'normal', minWidth: 160 }}>Чаще всего останавливает</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sites.map(s => (
                    <tr key={s.site} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={td}>
                        <div style={{ color: 'var(--ink)' }}>{s.company || s.site}</div>
                        {s.company ? <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{s.site}</div> : null}
                      </td>
                      <td className="mono" style={{ ...td, textAlign: 'right' }}>{s.total}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right', color: s.auto ? 'var(--positive)' : 'var(--ink-3)' }}>
                        {s.auto} <span style={{ color: 'var(--ink-3)' }}>· {pct(s.auto, s.total)}</span>
                      </td>
                      <td className="mono" style={{ ...td, textAlign: 'right' }}>{s.verified}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right' }}>{s.human}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right' }}>{s.parked}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right', color: s.failed ? 'var(--negative)' : undefined }}>{s.failed}</td>
                      <td style={{ ...td, whiteSpace: 'normal', minWidth: 160, color: 'var(--ink-2)' }}>
                        {s.topReason
                          ? <>{REASON_LABEL[s.topReason] ?? s.topReason} <span className="mono" style={{ color: 'var(--ink-3)' }}>×{s.topReasonCount}</span></>
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
        <ChartCard title="По движку"
          sub={`Колонка engine заявки: HTTP по умолчанию, «Переведено на браузер» — эскалация с HTTP на Chromium${
            browser && t.total ? ` (${browser.total} · ${pct(browser.total, t.total)} свайпов)` : ''}.`}>
          {engines.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '4px 0 8px' }}>
              За этот период свайпов по сайтам компаний не было.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', margin: '0 -16px -14px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>
                    <th style={th}>Движок</th>
                    <th style={{ ...th, textAlign: 'right' }}>Свайпов</th>
                    <th style={{ ...th, textAlign: 'right' }}>Отправил</th>
                    <th style={{ ...th, textAlign: 'right' }}>Ждали капчу</th>
                    <th style={{ ...th, textAlign: 'right' }}>Капча решена</th>
                    <th style={{ ...th, whiteSpace: 'normal', minWidth: 200 }}>Топ причин остановки</th>
                  </tr>
                </thead>
                <tbody>
                  {engines.map(e => (
                    <tr key={e.engine} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ ...td, color: 'var(--ink)' }}>{ENGINE_LABEL[e.engine]}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right' }}>{e.total}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right', color: e.auto ? 'var(--positive)' : 'var(--ink-3)' }}>
                        {e.auto} <span style={{ color: 'var(--ink-3)' }}>· {pct(e.auto, e.total)}</span>
                      </td>
                      <td className="mono" style={{ ...td, textAlign: 'right' }}>{e.captchaWaited}</td>
                      <td className="mono" style={{ ...td, textAlign: 'right' }}>
                        {e.captchaSolved} <span style={{ color: 'var(--ink-3)' }}>· {pct(e.captchaSolved, e.captchaWaited)}</span>
                      </td>
                      <td style={{ ...td, whiteSpace: 'normal', minWidth: 200, color: 'var(--ink-2)' }}>
                        {e.topReasons.length
                          ? e.topReasons.map(r => (
                              <div key={r.code}>
                                {REASON_LABEL[r.code] ?? r.code} <span className="mono" style={{ color: 'var(--ink-3)' }}>×{r.count}</span>
                              </div>
                            ))
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>

        <ChartCard title="«Скорее всего, ушёл» — почему"
          sub={`Отклик ушёл на сайт, но подтверждения нет; повторять Юпитер не будет. ${unknown.total} из ${unknown.ofAll} свайпов за период · ${pct(unknown.total, unknown.ofAll)}.`}>
          {unknown.total === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '4px 0 8px' }}>
              За этот период таких откликов не было.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', padding: '0 0 10px' }}>
                {unknown.reasons.map(r => (
                  <div key={r.code}>
                    {UNKNOWN_REASON_LABEL[r.code] ?? REASON_LABEL[r.code] ?? r.code}{' '}
                    <span className="mono" style={{ color: 'var(--ink-3)' }}>×{r.count} · {pct(r.count, unknown.total)}</span>
                  </div>
                ))}
              </div>
              <div style={{ overflowX: 'auto', margin: '0 -16px -14px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>
                      <th style={th}>Сайт</th>
                      <th style={{ ...th, textAlign: 'right' }}>«Скорее всего, ушёл»</th>
                      <th style={{ ...th, textAlign: 'right' }}>Из них в браузере</th>
                      <th style={{ ...th, whiteSpace: 'normal', minWidth: 220 }}>Причина</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unknown.sites.map(s => (
                      <tr key={s.site} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={td}>
                          <div style={{ color: 'var(--ink)' }}>{s.company || s.site}</div>
                          {s.company ? <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{s.site}</div> : null}
                        </td>
                        <td className="mono" style={{ ...td, textAlign: 'right' }}>{s.total}</td>
                        <td className="mono" style={{ ...td, textAlign: 'right' }}>{s.browser}</td>
                        <td style={{ ...td, whiteSpace: 'normal', minWidth: 220, color: 'var(--ink-2)' }}>
                          {s.reasons.map(r => (
                            <div key={r.code}>
                              {UNKNOWN_REASON_LABEL[r.code] ?? REASON_LABEL[r.code] ?? r.code}{' '}
                              <span className="mono" style={{ color: 'var(--ink-3)' }}>×{r.count}</span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </ChartCard>

        <ChartCard title="Капча"
          sub={captcha
            ? 'Показано человеку в приложении — по дате показа. Капчу решает только сам кандидат.'
            : 'Таблица капчи не прочиталась — остальной замер выше верен.'}>
          <div className="g-4">
            <KpiCard label="Показано человеку" value={captcha ? captcha.shown : null}
              sub={captcha?.open ? `ещё ждут ответа: ${captcha.open}` : 'jm_jupiter_captcha'} />
            <KpiCard label="Решено" value={captcha ? captcha.solved : null}
              sub={captcha ? `${pct(captcha.solved, captcha.shown)} показанных` : '—'} color="var(--positive)" />
            <KpiCard label="Неверно" value={captcha ? captcha.failed : null}
              sub={captcha ? `${pct(captcha.failed, captcha.shown)} показанных` : '—'} color="var(--negative)" />
            <KpiCard label="Не успели" value={captcha ? captcha.expired : null}
              sub={captcha ? `${pct(captcha.expired, captcha.shown)} · 10 минут вышли` : '—'} color="var(--accent)" />
            <KpiCard label="Среднее время ответа" value={captcha?.avgAnswerSec == null ? null : formatDuration(captcha.avgAnswerSec)}
              sub="от показа до ответа человека" />
          </div>
        </ChartCard>
      </div>
    </div>
  )
}
