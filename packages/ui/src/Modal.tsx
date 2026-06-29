import type { ReactNode } from 'react'
import { Icon } from './Icon'
import styles from './Modal.module.css'

// The modal shell, ported from the prototype Modal (shared/primitives.jsx). Closes
// on the backdrop and the close button; a click on the panel itself is swallowed.
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = 560,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  width?: number
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className={styles.head}>
            <div>
              <h3 className={styles.title}>{title}</h3>
              {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
            </div>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}
