import styles from './Segmented.module.css'

// A segmented control (e.g. 4w / 12w / YTD). Each option is a button; the active
// one is marked with aria-pressed and the active style.
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className={styles.segmented}>
      {options.map((opt) => {
        const active = opt === value
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            className={active ? styles.active : undefined}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}
