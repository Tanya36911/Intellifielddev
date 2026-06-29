import type { CSSProperties, JSX } from 'react'
import { createElement } from 'react'
import { ICONS } from './icons'

// A stroke-based SVG icon drawn with currentColor. Pass a name from the ICONS
// map; unknown names render an empty (but valid) svg rather than crashing.
export function Icon({
  name,
  size = 16,
  stroke = 1.75,
  fill = false,
  color,
  style,
  className,
}: {
  name: keyof typeof ICONS
  size?: number
  stroke?: number
  fill?: boolean
  color?: string
  style?: CSSProperties
  className?: string
}) {
  const shapes = ICONS[name] ?? []
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color, flexShrink: 0, ...style }}
      className={className}
      aria-hidden="true"
    >
      {shapes.map(([tag, attrs], i) =>
        createElement(tag as keyof JSX.IntrinsicElements, { key: i, ...attrs }),
      )}
    </svg>
  )
}
