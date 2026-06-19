// A tiny hand-rolled sparkline. Auto-scales the data to fit the height. Null
// safety: any non-finite value is dropped, and fewer than 2 points renders an
// empty polyline (never a NaN SVG coordinate).
export function Spark({
  data,
  w = 70,
  h = 24,
  color = 'var(--accent)',
  down = false,
}: {
  data: number[]
  w?: number
  h?: number
  color?: string
  down?: boolean
}) {
  const clean = (data ?? []).filter((d) => Number.isFinite(d))
  let points = ''
  if (clean.length >= 2) {
    const min = Math.min(...clean)
    const max = Math.max(...clean)
    const rng = max - min || 1
    points = clean
      .map((d, i) => {
        const x = (i / (clean.length - 1)) * w
        const y = h - ((d - min) / rng) * (h - 3) - 1.5
        return `${x},${y}`
      })
      .join(' ')
  }
  return (
    <svg
      width={w}
      height={h}
      style={{ display: 'block', overflow: 'visible' }}
      aria-hidden="true"
      data-down={down ? 'true' : undefined}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
