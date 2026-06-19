import styles from './TrendChart.module.css'

// A hand-rolled SVG completion-trend line (single series), ported from the
// prototype TrendChart but with the second "Promo" series, legend, and hover
// tooltip dropped for W1. Backend completion_pct is 0..100 (or null); we map
// /100 onto the y axis and skip null weeks so the line never gets a NaN point.
// x labels are the week index (W1..Wn). Fewer than 2 plottable points shows a
// small empty state.
export default function TrendChart({
  points,
}: {
  points: { week_start: string; completion_pct: number | null }[]
}) {
  const W = 640
  const H = 200
  const pad = { l: 34, r: 12, t: 14, b: 24 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b

  // x position by index across all weeks; y from a 0..1 value.
  const n = points.length
  const x = (i: number) => pad.l + (n > 1 ? (i / (n - 1)) * iw : iw / 2)
  const y = (v: number) => pad.t + (1 - v) * ih

  // Keep only weeks with a real value (and their original index for x spacing).
  const plotted = points
    .map((d, i) => ({ i, v: d.completion_pct }))
    .filter((d): d is { i: number; v: number } => d.v != null && Number.isFinite(d.v))
    .map((d) => ({ i: d.i, v: d.v / 100 }))

  if (plotted.length < 2) {
    return (
      <div className={styles.empty}>Not enough data yet for a trend.</div>
    )
  }

  const line = plotted.map((d) => `${x(d.i)},${y(d.v)}`).join(' ')
  const area = `${line} ${x(plotted[plotted.length - 1].i)},${y(0)} ${x(plotted[0].i)},${y(0)}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label="Completion trend">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={pad.l} y1={y(g)} x2={W - pad.r} y2={y(g)} stroke="var(--border)" strokeWidth="1" />
          <text
            x={pad.l - 8}
            y={y(g) + 3}
            textAnchor="end"
            fontSize="10"
            fill="var(--text-4)"
            fontFamily="var(--mono)"
          >
            {Math.round(g * 100)}
          </text>
        </g>
      ))}
      <polygon points={area} fill="url(#trendFill)" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((_, i) => (
        <text
          key={i}
          x={x(i)}
          y={H - 6}
          textAnchor="middle"
          fontSize="9.5"
          fill="var(--text-4)"
          fontFamily="var(--mono)"
        >
          W{i + 1}
        </text>
      ))}
    </svg>
  )
}
