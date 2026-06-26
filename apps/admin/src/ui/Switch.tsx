import styles from './Switch.module.css'

// A toggle switch. Rendered as an accessible role="switch" button; clicking it
// reports the next on/off state. When `disabled` (e.g. a save is in flight) it
// ignores clicks so it cannot fire overlapping changes.
export function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={on ? `${styles.switch} ${styles.on}` : styles.switch}
      onClick={() => onChange(!on)}
    />
  )
}
