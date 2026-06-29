import type { HTMLAttributes } from 'react'
import styles from './Card.module.css'

// A plain surface container (border + radius + subtle shadow). Extra props and an
// optional className pass through.
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={className ? `${styles.card} ${className}` : styles.card} {...props} />
}
