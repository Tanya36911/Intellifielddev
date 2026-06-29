import { useState } from 'react'
import { Button, Icon, Modal } from '@intelli/ui'
import type { TimeEntry, PayPeriod } from './usePayroll'
import styles from './ReopenModal.module.css'

// Inner form gets its own component so state resets cleanly when the modal
// unmounts or a different row is chosen (same pattern as dm-payroll.jsx).
function ReopenForm({
  entry,
  period,
  onConfirm,
  onClose,
  isPending,
}: {
  entry: TimeEntry
  period: PayPeriod
  onConfirm: (entry: TimeEntry, reason: string) => void
  onClose: () => void
  isPending: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <>
      <div className={styles.warnStrip}>
        <Icon name="alert" size={16} />
        <div>
          This reopens <strong>{entry.rep_name}'s</strong> entry only. It grants a{' '}
          <strong>{period.grace_hours}-hour grace window</strong> to correct the submission, then
          re-seals automatically. Every reopen is{' '}
          <strong>recorded in the audit log</strong>.
        </div>
      </div>
      <div className={styles.reasonLabel}>Reason (required, saved to audit log)</div>
      <textarea
        className={styles.reasonInput}
        rows={3}
        placeholder="e.g. Correct mis-logged drive time for the Memphis run on Jun 3."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label="Reopen reason"
      />
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={!reason.trim() || isPending}
          onClick={() => onConfirm(entry, reason.trim())}
        >
          <Icon name="lock" size={14} /> Reopen with grace window
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </>
  )
}

export function ReopenModal({
  open,
  entry,
  period,
  onClose,
  onConfirm,
  isPending,
}: {
  open: boolean
  entry: TimeEntry | null
  period: PayPeriod | null
  onClose: () => void
  onConfirm: (entry: TimeEntry, reason: string) => void
  isPending: boolean
}) {
  if (!entry || !period) return null
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={480}
      title="Reopen period for one rep"
      subtitle={`${entry.rep_name}, ${entry.region} region`}
    >
      <ReopenForm
        entry={entry}
        period={period}
        onConfirm={onConfirm}
        onClose={onClose}
        isPending={isPending}
      />
    </Modal>
  )
}
