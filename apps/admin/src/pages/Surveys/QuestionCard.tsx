import { useState } from 'react'
import { Button, Chip, Icon, Switch } from '../../ui'
import { PassConditionEditor } from './PassConditionEditor'
import {
  SCORABLE,
  expandLinesToSkuIds,
  passSummary,
  type BuilderQuestion,
  type QType,
} from './useSurveys'
import type { Sku } from '../Catalog/useCatalog'
import styles from './QuestionCard.module.css'

// Friendly labels for each question type
const TYPE_LABELS: Record<QType, string> = {
  boolean: 'Yes / No',
  number: 'Number',
  single_choice: 'Single choice',
  multi_choice: 'Multiple choice',
  photo: 'Photo',
  text: 'Short text',
}

// Icon name per question type
const TYPE_ICONS: Record<QType, keyof typeof import('../../ui/icons').ICONS> = {
  boolean: 'toggle',
  number: 'hash',
  single_choice: 'list',
  multi_choice: 'list',
  photo: 'camera',
  text: 'text',
}

const ALL_TYPES: QType[] = [
  'boolean',
  'number',
  'single_choice',
  'multi_choice',
  'photo',
  'text',
]

export function QuestionCard({
  q,
  index,
  total,
  catalog,
  onChange,
  onDelete,
  onDup,
  onMove,
}: {
  q: BuilderQuestion
  index: number
  total: number
  catalog: Sku[]
  onChange: (q: BuilderQuestion) => void
  onDelete: () => void
  onDup: () => void
  onMove: (index: number, dir: -1 | 1) => void
}) {
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [passOpen, setPassOpen] = useState(false)

  // Unique line names from the catalog (active only)
  const catalogLines = Array.from(
    new Set(catalog.filter((s) => s.status === 'active').map((s) => s.line)),
  )

  const summary = passSummary(q)
  const scored = SCORABLE.has(q.type)

  function toggleLine(line: string) {
    const lines = q.lines.includes(line)
      ? q.lines.filter((l) => l !== line)
      : [...q.lines, line]
    onChange({ ...q, lines, skuIds: expandLinesToSkuIds(lines, catalog) })
  }

  function handleTypeChange(type: QType) {
    // Reset options for choice types; clear otherwise
    const options =
      type === 'single_choice' || type === 'multi_choice' ? ['Option 1'] : []
    // Pass only valid for scorable types
    const pass = null
    onChange({ ...q, type, options, pass, passScope: 'each', unit: '' })
    setTypeMenuOpen(false)
  }

  function addOption() {
    onChange({ ...q, options: [...q.options, `Option ${q.options.length + 1}`] })
  }

  function removeOption(i: number) {
    onChange({ ...q, options: q.options.filter((_, idx) => idx !== i) })
  }

  function updateOption(i: number, val: string) {
    const options = [...q.options]
    options[i] = val
    onChange({ ...q, options })
  }

  return (
    <div className={styles.card}>
      {/* Header row */}
      <div className={styles.header}>
        {/* Type badge + type menu */}
        <div className={styles.typeBadgeWrap}>
          <button
            type="button"
            className={styles.typeBadge}
            onClick={() => setTypeMenuOpen((o) => !o)}
            aria-label="Change question type"
          >
            <Icon name={TYPE_ICONS[q.type]} size={14} />
            <span>{TYPE_LABELS[q.type]}</span>
            <Icon name="chevD" size={12} />
          </button>
          {typeMenuOpen && (
            <div className={styles.typeMenu}>
              {ALL_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.typeOption} ${t === q.type ? styles.active : ''}`}
                  onClick={() => handleTypeChange(t)}
                >
                  <Icon name={TYPE_ICONS[t]} size={13} />
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status chips */}
        <div className={styles.chips}>
          {q.required && <Chip tone="blue">Required</Chip>}
          {q.perSku && (
            <Chip tone="violet">Per product ({q.skuIds.length})</Chip>
          )}
          {/* Pass condition chip */}
          <button
            type="button"
            className={`${styles.passChip} ${passOpen ? styles.passOpen : ''}`}
            onClick={() => setPassOpen((o) => !o)}
          >
            {summary ? (
              <Chip tone="green">{summary}</Chip>
            ) : scored ? (
              <Chip>Set pass condition</Chip>
            ) : (
              <Chip>Logged, not scored</Chip>
            )}
          </button>
        </div>

        {/* Reorder + actions */}
        <div className={styles.actions}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
          >
            <Icon name="arrowUp" size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Move down"
            disabled={index === total - 1}
            onClick={() => onMove(index, 1)}
          >
            <Icon name="arrowDown" size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Duplicate"
            title="Duplicate"
            onClick={onDup}
          >
            <Icon name="copy" size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Delete"
            title="Delete"
            onClick={onDelete}
          >
            <Icon name="trash" size={14} />
          </Button>
        </div>
      </div>

      {/* Inline pass condition editor */}
      {passOpen && (
        <div className={styles.passEditor}>
          <PassConditionEditor q={q} onChange={onChange} />
        </div>
      )}

      {/* Prompt input */}
      <div className={styles.promptRow}>
        <input
          type="text"
          className={styles.promptInput}
          placeholder={`Question ${index + 1} - enter your question here`}
          value={q.prompt}
          onChange={(e) => onChange({ ...q, prompt: e.target.value })}
        />
      </div>

      {/* Type-specific config */}
      {(q.type === 'single_choice' || q.type === 'multi_choice') && (
        <div className={styles.optionsList}>
          {q.options.map((opt, i) => (
            <div key={i} className={styles.optionRow}>
              <input
                type="text"
                className={styles.optionInput}
                value={opt}
                onChange={(e) => updateOption(i, e.target.value)}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Remove option"
                onClick={() => removeOption(i)}
              >
                <Icon name="minus" size={13} />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={addOption}>
            <Icon name="plus" size={13} />
            Add option
          </Button>
        </div>
      )}

      {q.type === 'number' && (
        <div className={styles.unitRow}>
          <label className={styles.unitLabel}>Unit</label>
          <input
            type="text"
            className={styles.unitInput}
            placeholder="e.g. facings"
            value={q.unit}
            onChange={(e) => onChange({ ...q, unit: e.target.value })}
          />
        </div>
      )}

      {/* Settings area */}
      <div className={styles.settingsToggle}>
        <button
          type="button"
          className={styles.settingsBtn}
          onClick={() => setSettingsOpen((o) => !o)}
        >
          <Icon name="settings" size={13} />
          Settings
          <Icon name={settingsOpen ? 'chevUp' : 'chevD'} size={12} />
        </button>
      </div>

      {settingsOpen && (
        <div className={styles.settingsPanel}>
          <div className={styles.switchRow}>
            <span className={styles.switchLabel}>Required to submit</span>
            <Switch
              on={q.required}
              onChange={(v) => onChange({ ...q, required: v })}
              label="Required to submit"
            />
          </div>
          <div className={styles.switchRow}>
            <span className={styles.switchLabel}>Ask per product</span>
            <Switch
              on={q.perSku}
              onChange={(v) =>
                onChange({ ...q, perSku: v, lines: v ? q.lines : [], skuIds: [] })
              }
              label="Ask per product"
            />
          </div>
        </div>
      )}

      {/* Line picker is always visible when perSku is on */}
      {q.perSku && (
        <div className={styles.linePicker}>
          <p className={styles.linePickerLabel}>
            Select product lines to ask about:
          </p>
          <div className={styles.lineChips}>
            {catalogLines.length === 0 ? (
              <span className={styles.muted}>No catalog lines found.</span>
            ) : (
              catalogLines.map((line) => {
                const active = q.lines.includes(line)
                return (
                  <button
                    key={line}
                    type="button"
                    className={`${styles.lineChip} ${active ? styles.lineActive : ''}`}
                    onClick={() => toggleLine(line)}
                  >
                    {line}
                  </button>
                )
              })
            )}
          </div>
          {q.lines.length > 0 && (
            <p className={styles.lineNote}>
              1 question expands to {q.skuIds.length} per-product answers
            </p>
          )}
          {q.skuIds.length === 0 && (
            <p className={styles.lineWarning}>
              The selected lines have no active products. Add active products or choose different lines.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
