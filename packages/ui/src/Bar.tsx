// A progress bar. The value is a 0..1 float (e.g. completion/100); it is clamped
// to that range and a null/out-of-range value renders a safe 0% width. The tone
// picks the fill color, matching the prototype.
export function Bar({
  value,
  tone,
  height = 8,
}: {
  value: number
  tone?: 'green' | 'amber' | 'red'
  height?: number
}) {
  const w = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  const color =
    tone === 'red'
      ? 'var(--red)'
      : tone === 'amber'
        ? 'var(--amber)'
        : tone === 'green'
          ? 'var(--green)'
          : 'var(--accent)'
  return (
    <div
      style={{
        height,
        background: 'var(--bg-elev)',
        borderRadius: 99,
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <div
        data-fill
        style={{
          width: `${Math.round(w * 100)}%`,
          height: '100%',
          background: color,
          borderRadius: 99,
          transition: 'width .5s cubic-bezier(.2,.7,.3,1)',
        }}
      />
    </div>
  )
}
