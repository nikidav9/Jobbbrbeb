'use client'
export default function EngagementError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ padding: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--negative)"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5L21.5 20H2.5L12 3.5z" /><path d="M12 10v4M12 17h.01" />
      </svg>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Ошибка на странице Активность</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'Manrope, sans-serif', maxWidth: 480, textAlign: 'center', background: 'var(--bg-sunken)', padding: '12px 16px', borderRadius: 8 }}>
        {error.message || 'Неизвестная ошибка'}
      </div>
      {error.digest && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'Manrope, sans-serif' }}>digest: {error.digest}</div>
      )}
      <button onClick={reset} className="jt-btn jt-btn-secondary" style={{ marginTop: 8 }}>
        Повторить
      </button>
    </div>
  )
}
