import { Segmented, Select } from '@intelli/ui'
import { OP_LABEL } from './useSurveys'
import type { BuilderQuestion } from './useSurveys'
import styles from './PassConditionEditor.module.css'

// The type-adaptive inline pass-rule editor.
// boolean  -> segmented [Pass = Yes / Pass = No / No condition]
// number   -> operator select + numeric value input; optional scope segmented when perSku
// single_choice -> toggle chips for each option
// multi_choice / photo / text -> muted note only
export function PassConditionEditor({
  q,
  onChange,
}: {
  q: BuilderQuestion
  onChange: (q: BuilderQuestion) => void
}) {
  if (q.type === 'boolean') {
    const current =
      q.pass?.value === true
        ? 'Pass = Yes'
        : q.pass?.value === false
          ? 'Pass = No'
          : 'No condition'

    return (
      <div className={styles.editor}>
        <Segmented
          options={['Pass = Yes', 'Pass = No', 'No condition']}
          value={current}
          onChange={(v) => {
            const pass =
              v === 'Pass = Yes'
                ? { operator: '==', value: true as boolean | number }
                : v === 'Pass = No'
                  ? { operator: '==', value: false as boolean | number }
                  : null
            onChange({ ...q, pass })
          }}
        />
      </div>
    )
  }

  if (q.type === 'number') {
    const opValue = q.pass ? q.pass.operator : ''
    const numValue = q.pass && typeof q.pass.value === 'number' ? String(q.pass.value) : ''

    const scopeLabel = q.passScope === 'total' ? 'One combined total' : 'Each shade on its own'
    const scopeHint =
      q.passScope === 'total'
        ? 'Sums the shades that were answered; blanks are ignored.'
        : 'Every selected shade must pass on its own.'

    return (
      <div className={styles.editor}>
        <div className={styles.row}>
          <Select
            value={opValue}
            onChange={(e) => {
              const op = e.target.value
              if (!op) {
                onChange({ ...q, pass: null })
              } else {
                const val = q.pass && typeof q.pass.value === 'number' ? q.pass.value : 0
                onChange({ ...q, pass: { operator: op, value: val } })
              }
            }}
          >
            <option value="">No condition</option>
            {Object.entries(OP_LABEL).map(([op, label]) => (
              <option key={op} value={op}>
                {label}
              </option>
            ))}
          </Select>
          {opValue && (
            <input
              type="number"
              className={styles.numInput}
              value={numValue}
              onChange={(e) => {
                const val = Number(e.target.value)
                onChange({ ...q, pass: { operator: opValue, value: val } })
              }}
            />
          )}
        </div>
        {q.perSku && (
          <div className={styles.scopeRow}>
            <Segmented
              options={['Each shade on its own', 'One combined total']}
              value={scopeLabel}
              onChange={(v) => {
                const passScope = v === 'One combined total' ? 'total' : 'each'
                onChange({ ...q, passScope })
              }}
            />
            <p className={styles.hint}>{scopeHint}</p>
          </div>
        )}
      </div>
    )
  }

  if (q.type === 'single_choice') {
    const selected: string[] = Array.isArray(q.pass?.value)
      ? (q.pass.value as string[])
      : []

    return (
      <div className={styles.editor}>
        <p className={styles.label}>Passing answer(s):</p>
        <div className={styles.chipRow}>
          {q.options.map((opt) => {
            const active = selected.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                className={`${styles.toggleChip} ${active ? styles.active : ''}`}
                onClick={() => {
                  const next = active
                    ? selected.filter((s) => s !== opt)
                    : [...selected, opt]
                  const pass =
                    next.length > 0 ? { operator: 'in', value: next } : null
                  onChange({ ...q, pass })
                }}
              >
                {opt}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // multi_choice / photo / text
  return (
    <div className={styles.editor}>
      <span className={styles.muted}>
        No auto-pass condition for this type. The answer is still logged.
      </span>
    </div>
  )
}
