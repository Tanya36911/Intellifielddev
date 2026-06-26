import { Card, Chip, Icon, Switch } from '../../ui'
import { StepHead } from './StepHead'
import styles from './steps.module.css'

// Step 3: payroll. The "configure vs skip" cards set the on/off intent, and the
// real saved control is the Switch (PATCH /tenants payroll_enabled), wired by the
// wizard. Detailed period config stays "coming soon", matching the Settings page.
export function StepPayroll({
  enabled,
  onToggle,
  saving,
  saveError,
}: {
  enabled: boolean
  onToggle: (next: boolean) => void
  saving: boolean
  saveError: string | null
}) {
  return (
    <div>
      <StepHead
        title="Payroll"
        sub="Payroll is an optional module. Turn it on now, or skip and enable it later in Settings."
      />

      {saveError && (
        <div className={styles.stepError} role="alert">
          {saveError}
        </div>
      )}

      <div className={styles.choiceRow}>
        <button
          type="button"
          aria-pressed={enabled}
          className={
            enabled ? `${styles.choiceCard} ${styles.choiceCardSelected}` : styles.choiceCard
          }
          disabled={saving}
          onClick={() => onToggle(true)}
        >
          <Icon name="dollar" size={16} style={{ color: 'var(--accent)' }} />
          <div className={styles.choiceText}>
            <div className={styles.choiceTitle}>Configure payroll now</div>
            <div className={styles.choiceSub}>Turn on field-time tracking and pay periods</div>
          </div>
          {enabled && <Icon name="check" size={15} className={styles.choiceCheck} />}
        </button>
        <button
          type="button"
          aria-pressed={!enabled}
          className={
            !enabled ? `${styles.choiceCard} ${styles.choiceCardSelected}` : styles.choiceCard
          }
          disabled={saving}
          onClick={() => onToggle(false)}
        >
          <Icon name="clock" size={16} style={{ color: 'var(--text-3)' }} />
          <div className={styles.choiceText}>
            <div className={styles.choiceTitle}>Skip for now</div>
            <div className={styles.choiceSub}>Enable later in Settings, then Payroll</div>
          </div>
          {!enabled && <Icon name="check" size={15} className={styles.choiceCheck} />}
        </button>
      </div>

      <Card>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <div className={styles.panelTitleRow}>
                <h3 className={styles.panelTitle}>Payroll module</h3>
                {enabled ? <Chip tone="green">On</Chip> : <Chip>Off</Chip>}
              </div>
              <p className={styles.panelSub}>
                Reps log field-time, which rolls up into pay periods with a review-and-approve
                flow. This switch controls the Payroll screen in the sidebar.
              </p>
            </div>
            <Switch on={enabled} onChange={onToggle} label="Payroll enabled" />
          </div>

          <div className={enabled ? styles.noteOn : styles.noteOff}>
            <Icon name="info" size={15} />
            <span>
              {enabled
                ? 'Payroll is on, so the Payroll screen is available once you finish setup.'
                : 'Payroll is off. The Payroll screen stays hidden and payroll actions are refused.'}
            </span>
          </div>

          <div className={styles.soonBox}>
            <div className={styles.soonBoxHead}>
              <span className={styles.soonBoxLabel}>Pay-period defaults</span>
              <Chip>Coming soon</Chip>
            </div>
            <div className={styles.fieldHint}>
              Default period length, cutoff day/time and timezone for new pay periods. Set this on
              the Settings screen once it ships.
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
