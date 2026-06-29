import type { ReactNode } from 'react'
import { Icon } from '@intelli/ui'
import styles from './Topbar.module.css'

// The per-page top bar. Each screen renders its own at the top of its content:
// a title (+ optional subtitle) on the left, the page's controls in the middle
// slot (the `children`), and a notifications bell on the far right that is a
// plain "coming soon" affordance for the web app: disabled, no red dot, no
// dropdown (web trims the prototype's "Synced" control and the live bell).
export function Topbar({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <header className={styles.bar}>
      <div className={styles.heading}>
        <h2 className={styles.title}>{title}</h2>
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </div>
      {children && <div className={styles.controls}>{children}</div>}
      <button
        type="button"
        className={styles.bell}
        disabled
        title="Notifications (coming soon)"
        aria-label="Notifications (coming soon)"
      >
        <Icon name="bell" size={16} />
      </button>
    </header>
  )
}
