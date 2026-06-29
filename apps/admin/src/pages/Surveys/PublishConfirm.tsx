import { Button, Modal } from '@intelli/ui'
import styles from './PublishConfirm.module.css'

// Modal shown before the Builder publishes a survey. Publishing freezes the
// version permanently -- this screen makes that clear before the rep proceeds.
export function PublishConfirm({
  open,
  version,
  onCancel,
  onConfirm,
}: {
  open: boolean
  version: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Publish this survey?"
      width={480}
    >
      <div className={styles.body}>
        <p className={styles.warning}>
          Publishing <strong>freezes v{version} forever.</strong> Reps who start
          this survey will be pinned to v{version}. You cannot edit a published
          version -- future edits create a new version.
        </p>
        <div className={styles.actions}>
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            Publish v{version}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
