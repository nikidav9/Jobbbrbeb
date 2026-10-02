import type { CSSProperties, ReactNode } from 'react'

/**
 * Пометка у строки: роль, статус, канал связи.
 *
 * Раньше каждая такая пометка писалась на месте — с собственным `rgba(...)`,
 * собственным скруглением и собственным размером. Их набралось под сотню, и
 * одинаковых среди них не было: где 999, где 5, где 6; зелень подложки от
 * прошлой палитры, зелень текста от нынешней.
 *
 * Здесь тон выбирает и цвет, и подложку, и границу разом — разойтись им
 * больше негде.
 */

export type Tone = 'neutral' | 'positive' | 'negative' | 'accent' | 'info' | 'violet'

const TONES: Record<Tone, { fg: string; bg: string; line: string }> = {
  neutral:  { fg: 'var(--ink-2)',    bg: 'var(--neutral-soft)',  line: 'var(--neutral-line)' },
  positive: { fg: 'var(--positive)', bg: 'var(--positive-soft)', line: 'var(--positive-line)' },
  negative: { fg: 'var(--negative)', bg: 'var(--negative-soft)', line: 'var(--negative-line)' },
  accent:   { fg: 'var(--accent)',   bg: 'var(--accent-soft)',   line: 'var(--accent-line)' },
  info:     { fg: 'var(--info)',     bg: 'var(--info-soft)',     line: 'var(--info-line)' },
  violet:   { fg: 'var(--violet)',   bg: 'var(--violet-soft)',   line: 'var(--violet-line)' },
}

export default function Chip({
  tone = 'neutral', dot = false, title, style, children,
}: {
  tone?: Tone
  /** Точка в цвет тона — для «живых» состояний вроде «активен». */
  dot?: boolean
  title?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const t = TONES[tone]
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 999,
      fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
      color: t.fg, background: t.bg, border: `1px solid ${t.line}`,
      ...style,
    }}>
      {dot && (
        <span aria-hidden="true" style={{
          width: 5, height: 5, borderRadius: '50%', background: t.fg, flexShrink: 0,
        }} />
      )}
      {children}
    </span>
  )
}
