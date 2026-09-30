interface Props {
  title: string
  sub?: string
  children: React.ReactNode
  className?: string
  action?: React.ReactNode
  chip?: { label: string; tone?: 'pos' | 'neg' | 'acc' | 'default' }
}

export default function ChartCard({ title, sub, children, action, chip }: Props) {
  const chipStyle = chip ? {
    pos: { color: 'var(--positive)', bg: 'var(--positive-soft)', border: 'var(--positive-line)' },
    neg: { color: 'var(--negative)', bg: 'var(--negative-soft)', border: 'var(--negative-line)' },
    acc: { color: 'var(--accent)', bg: 'var(--accent-soft)', border: 'var(--accent-line)' },
    default: { color: 'var(--ink-2)', bg: 'var(--bg-sunken)', border: 'var(--line)' },
  }[chip.tone ?? 'default'] : null

  return (
    <div style={{
      background: 'var(--bg-elev)',
      border: '2px solid var(--ink)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px 10px',
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{title}</div>
          {sub && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {chip && chipStyle && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '2px 8px', borderRadius: 999, fontSize: 11,
              color: chipStyle.color, background: chipStyle.bg,
              border: `1px solid ${chipStyle.border}`,
            }}>{chip.label}</span>
          )}
          {action}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '0 16px 16px' }}>
        {children}
      </div>
    </div>
  )
}
