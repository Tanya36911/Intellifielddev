import { Card, Field, Input } from '@intelli/ui'
import styles from './Settings.module.css'

// The Company section: an editable company name and a read-only company code.
export function CompanyPanel({
  name,
  code,
  canEdit,
  onName,
}: {
  name: string
  code: string
  canEdit: boolean
  onName: (v: string) => void
}) {
  return (
    <Card>
      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Company</h3>
          <p className={styles.panelSub}>Your company's basic details. Shown across the app and on the sign-in sidebar.</p>
        </div>
        <Field label="Company name">
          <Input value={name} disabled={!canEdit} onChange={(e) => onName(e.target.value)} className={styles.nameInput} />
        </Field>
        <div className={styles.spacer} />
        <Field label="Company code">
          <Input value={code} disabled className={styles.codeInput} />
        </Field>
        <div className={styles.fieldHint}>A short permanent id used internally. Cannot be changed.</div>
      </div>
    </Card>
  )
}
