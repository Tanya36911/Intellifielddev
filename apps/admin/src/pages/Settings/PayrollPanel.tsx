import { Card, Chip, Icon, Switch } from '@intelli/ui'
import styles from './Settings.module.css'

// The Payroll section: a real on/off switch wired to tenants.payroll_enabled,
// an explanation of what it controls, and a greyed "coming soon" sub-card for
// pay-period defaults.
export function PayrollPanel({
  on,
  canEdit,
  onToggle,
}: {
  on: boolean
  canEdit: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <Card>
      <div className={styles.panel}>
        <div className={styles.payrollHead}>
          <div>
            <div className={styles.payrollTitleRow}>
              <h3 className={styles.panelTitle}>Payroll module</h3>
              {on ? <Chip tone="green">On</Chip> : <Chip>Off</Chip>}
            </div>
            <p className={styles.panelSub}>
              Reps log field-time, which rolls up into pay periods with a review-and-approve flow.
              This switch controls the Payroll screen in the sidebar.
            </p>
          </div>
          {canEdit && <Switch on={on} onChange={onToggle} label="Payroll enabled" />}
        </div>

        <div className={on ? styles.noteOn : styles.noteOff}>
          <Icon name="info" size={15} />
          <span>{on
            ? 'Payroll is on, so the Payroll screen is available and the approve / seal / reopen flow is active. Turning it off hides that screen for everyone.'
            : 'Payroll is off. The Payroll screen is hidden and the backend refuses payroll actions for this company.'}</span>
        </div>

        <div className={styles.soonBox}>
          <div className={styles.soonBoxHead}>
            <span className={styles.soonBoxLabel}>Pay-period defaults</span>
            <Chip>Coming soon</Chip>
          </div>
          <div className={styles.fieldHint}>Default period length, cutoff day/time and timezone for new pay periods. Stored once we add "create a pay period" to the screen.</div>
        </div>
      </div>
    </Card>
  )
}
