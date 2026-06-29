import type { ReactNode } from 'react'
import styles from './Chip.module.css'

export type ChipTone = 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'accent'

// A small pill badge. The tone sets the color; an optional leading dot uses the
// current text color.
export function Chip({
  children,
  tone,
  dot,
}: {
  children: ReactNode
  tone?: ChipTone
  dot?: boolean
}) {
  const className = tone ? `${styles.chip} ${styles[tone]}` : styles.chip
  return (
    <span className={className}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  )
}
