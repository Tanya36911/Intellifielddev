import styles from './Switch.module.css'

// A toggle switch. Rendered as an accessible role="switch" button; clicking it
// reports the next on/off state.
export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? `${styles.switch} ${styles.on}` : styles.switch}
      onClick={() => onChange(!on)}
    />
  )
}
