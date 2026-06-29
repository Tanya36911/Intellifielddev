import type { SelectHTMLAttributes } from 'react'
import styles from './form.module.css'

// Dropdown. Ports the prototype .input select styling. Children (the <option>s)
// and extra props pass through.
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={className ? `${styles.input} ${styles.select} ${className}` : `${styles.input} ${styles.select}`}
      {...props}
    />
  )
}
