import type { ReactNode } from 'react'
import styles from './form.module.css'

// A labelled field. The <label> wraps its single control, so the label is
// associated with it (clicking the label focuses the control).
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  )
}
