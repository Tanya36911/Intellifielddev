import { Button, Card, Icon, Input } from '../../ui'
import { StepHead, dotColor } from './StepHead'
import {
  addLevelAfter,
  moveLevel,
  removeLevel,
  renameLevel,
  type DraftLevel,
} from './useSetup'
import styles from './steps.module.css'

// Step 2: name (and, on a fresh company, reshape) the org levels. The top and
// bottom are always locked: renameable but never removed or reordered. When the
// company already has nodes, structural edits are disabled and only renames save.
export function StepLevels({
  levels,
  setLevels,
  confirmed,
  setConfirmed,
  structuralAllowed,
  saveError,
}: {
  levels: DraftLevel[]
  setLevels: (next: DraftLevel[]) => void
  confirmed: boolean
  setConfirmed: (next: boolean) => void
  structuralAllowed: boolean
  saveError: string | null
}) {
  // Any edit invalidates a prior confirmation, so the admin re-confirms the
  // structure before continuing.
  function edit(next: DraftLevel[]) {
    setLevels(next)
    setConfirmed(false)
  }

  return (
    <div>
      <StepHead
        title="Name your levels"
        sub="Company and Store are locked. Every company needs a top and a bottom. Rename, add, remove, or reorder the levels in between."
      />

      {!structuralAllowed && (
        <div className={styles.lockedNote} role="note">
          <Icon name="lock" size={15} />
          <span>
            Your stores already exist, so you can rename levels but not add, remove, or reorder
            them here. Renaming still saves.
          </span>
        </div>
      )}

      {saveError && (
        <div className={styles.stepError} role="alert">
          {saveError}
        </div>
      )}

      <div className={styles.levelsLayout}>
        <div className={styles.levelList}>
          {levels.map((l, i) => {
            const isMiddle = i > 0 && i < levels.length - 1
            return (
              <div key={i} className={styles.levelRow}>
                <span className={styles.levelTag}>L{i + 1}</span>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: i === levels.length - 1 ? 2 : 99,
                    background: dotColor(i),
                    flexShrink: 0,
                  }}
                />
                {l.locked ? (
                  <span className={styles.levelLocked}>
                    <Input
                      value={l.name}
                      aria-label={`Level ${i} name`}
                      onChange={(e) => edit(renameLevel(levels, i, e.target.value))}
                    />
                    <Icon name="lock" size={12} />
                  </span>
                ) : (
                  <Input
                    className={styles.levelInput}
                    value={l.name}
                    aria-label={`Level ${i} name`}
                    onChange={(e) => edit(renameLevel(levels, i, e.target.value))}
                  />
                )}
                {isMiddle && structuralAllowed && (
                  <div className={styles.levelActions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Move level ${i} up`}
                      disabled={i <= 1}
                      onClick={() => edit(moveLevel(levels, i, -1))}
                    >
                      <Icon name="chevUp" size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Move level ${i} down`}
                      disabled={i >= levels.length - 2}
                      onClick={() => edit(moveLevel(levels, i, 1))}
                    >
                      <Icon name="chevD" size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove level ${i}`}
                      onClick={() => edit(removeLevel(levels, i))}
                    >
                      <Icon name="trash" size={13} />
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
          {structuralAllowed && levels.length < 7 && (
            <Button
              className={styles.addBtn}
              onClick={() => edit(addLevelAfter(levels, levels.length - 2))}
            >
              <Icon name="plus" size={14} /> Add a level
            </Button>
          )}
        </div>

        <div className={styles.preview}>
          <Card style={{ padding: 18 }}>
            <div className={styles.eyebrow} style={{ marginBottom: 12 }}>
              Live preview
            </div>
            <div className={styles.previewLevels}>
              {levels.map((l, i) => (
                <div key={i} className={styles.previewRow} style={{ marginLeft: i * 16 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: i === levels.length - 1 ? 1.5 : 99,
                      background: dotColor(i),
                      flexShrink: 0,
                    }}
                  />
                  <span
                    className={styles.previewName}
                    style={{ fontWeight: i === 0 ? 600 : 500 }}
                  >
                    {l.name || 'Unnamed'}
                  </span>
                </div>
              ))}
            </div>
            <div className={styles.divider} />
            <label className={styles.confirm}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
              />
              <span
                className={
                  confirmed ? `${styles.confirmBox} ${styles.confirmBoxOn}` : styles.confirmBox
                }
              >
                {confirmed && <Icon name="check" size={13} />}
              </span>
              <span className={styles.confirmLabel}>Yes, this structure looks right</span>
            </label>
            <p className={styles.previewHint}>
              Levels can be edited later, but changing them after stores exist requires a re-map.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
