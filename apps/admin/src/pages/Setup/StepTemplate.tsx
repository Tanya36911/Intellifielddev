import { Chip, Icon } from '../../ui'
import { TEMPLATES } from './useSetup'
import { StepHead, dotColor } from './StepHead'
import styles from './steps.module.css'

// Step 1: pick a starting structure. Selecting a template pre-fills step 2's
// editable level list. Nothing is saved here; it is purely a starting point.
// On a company that already has a structure, templates do not apply (the saved
// levels are fixed), so the cards are disabled and a short note explains why.
export function StepTemplate({
  selected,
  onSelect,
  structuralAllowed,
}: {
  selected: string
  onSelect: (id: string) => void
  structuralAllowed: boolean
}) {
  return (
    <div>
      <StepHead
        title="Choose a starting point"
        sub="Pick the structure closest to how your team is organized. You can rename and reshape everything in the next step."
      />

      {!structuralAllowed && (
        <div className={styles.lockedNote} role="note">
          <Icon name="lock" size={15} />
          <span>
            Your company already has a structure, so templates apply to new companies only.
          </span>
        </div>
      )}

      <div className={styles.templateGrid}>
        {TEMPLATES.map((t) => {
          const sel = selected === t.id
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={sel}
              disabled={!structuralAllowed}
              onClick={() => onSelect(t.id)}
              className={
                sel ? `${styles.templateCard} ${styles.templateCardSelected}` : styles.templateCard
              }
            >
              <div className={styles.templateTop}>
                <span className={styles.templateName}>{t.name}</span>
                {t.tag && <Chip tone="accent">{t.tag}</Chip>}
                {sel && !t.tag && (
                  <Icon name="checkCircle" size={18} style={{ color: 'var(--accent)' }} />
                )}
              </div>
              <div className={styles.templateLevels}>
                {t.levels.map((lv, i) => (
                  <div
                    key={i}
                    className={styles.templateLevelRow}
                    style={{ marginLeft: i * 12 }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: i === t.levels.length - 1 ? 1.5 : 99,
                        background: dotColor(i),
                      }}
                    />
                    <span className={styles.templateLevelName}>{lv}</span>
                    {(i === 0 || i === t.levels.length - 1) && (
                      <Icon name="lock" size={9} style={{ color: 'var(--text-4)' }} />
                    )}
                  </div>
                ))}
              </div>
              <div className={styles.templateDesc}>{t.desc}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
