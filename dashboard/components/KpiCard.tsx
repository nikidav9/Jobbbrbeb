'use client'
import Sparkline from './Sparkline'
import { useCountUp, parseKpi } from '@/lib/useCountUp'

/**
 * Карточка числа — самый частый элемент панели, около ста двадцати штук на
 * двадцати трёх разделах. Поэтому всё, что здесь неверно, неверно везде.
 *
 * Что здесь важно, кроме вида:
 *
 * — `value === null` показывается прочерком, а не нулём. «Оценок пока нет» и
 *   «средняя оценка ноль» — разные вещи, и раньше панель говорила второе,
 *   когда правдой было первое.
 * — Число докручивается при изменении, чтобы обновление было заметно.
 * — Цифры табличные: в ряду из четырёх карточек они выстраиваются по разрядам.
 * — `hint` — подпись мелким под числом, туда идёт масштаб: «из 420», «за 30
 *   дней». Число без масштаба ничего не значит.
 */

interface Props {
  label: string
  /** `null` — «не посчитано»: карточка покажет прочерк. */
  value: string | number | null | undefined
  sub?: string
  delta?: string
  deltaTone?: 'pos' | 'neg' | 'neutral'
  color?: string
  spark?: number[]
  sparkColor?: string
}

export default function KpiCard({
  label, value, sub, delta, deltaTone = 'neutral',
  color = 'var(--accent)', spark, sparkColor,
}: Props) {
  // Подложка и граница берутся из пары к самому цвету, а не пишутся числом.
  // Раньше здесь стояли rgba от прежней, более светлой зелени: текст сменил
  // оттенок, подложка осталась старой — и перестала совпадать со своим же
  // текстом. Карточка показывается на 23 страницах, так что расхождение
  // разъезжалось по всей панели разом.
  const chip = deltaTone === 'pos'
    ? { color: 'var(--positive)', bg: 'var(--positive-soft)', border: 'var(--positive-line)' }
    : deltaTone === 'neg'
    ? { color: 'var(--negative)', bg: 'var(--negative-soft)', border: 'var(--negative-line)' }
    : { color: 'var(--ink-3)', bg: 'var(--bg-sunken)', border: 'var(--line)' }

  const parsed = parseKpi(value)
  const animated = useCountUp(
    parsed.kind === 'num' ? parsed.num : 0,
    parsed.kind === 'num' ? parsed.decimals : 0,
  )

  const shown = parsed.kind === 'empty'
    ? '—'
    : parsed.kind === 'text'
    ? parsed.text
    : animated.toLocaleString('ru-RU', {
        minimumFractionDigits: parsed.decimals,
        maximumFractionDigits: parsed.decimals,
      }) + parsed.suffix

  return (
    <div className="kpi-card jt-rise" style={{
      background: 'var(--bg-elev)',
      border: '2px solid var(--ink)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-sm)',
      padding: '14px 16px 16px',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      overflow: 'hidden',
    }}>
      <div className="kpi-label" style={{
        fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.1em',
        fontFamily: 'Manrope, sans-serif',
        color: 'var(--ink-3)', fontWeight: 700,
        minWidth: 0, wordBreak: 'break-word', lineHeight: 1.35,
      }}>{label}</div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <div className="kpi-value num" style={{
          fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700,
          letterSpacing: '-0.02em',
          color: parsed.kind === 'empty' ? 'var(--ink-4)' : 'var(--ink)',
          lineHeight: 1,
        }}>{shown}</div>
        {delta && (
          <span className="kpi-delta" style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '2px 8px', borderRadius: 999,
            fontSize: 11, fontWeight: 550,
            color: chip.color, background: chip.bg,
            border: `1px solid ${chip.border}`,
            whiteSpace: 'nowrap',
          }}>{delta}</span>
        )}
      </div>

      {/* Место под подпись занято всегда: без этого карточки в ряду прыгают
          по высоте, стоит одной из них остаться без пояснения. */}
      <div className="kpi-sub" style={{
        fontSize: 12, color: 'var(--ink-3)', marginTop: 4, minHeight: 17,
      }}>{sub ?? ''}</div>

      {spark && spark.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <Sparkline data={spark} color={sparkColor ?? color} height={36} />
        </div>
      )}
    </div>
  )
}
