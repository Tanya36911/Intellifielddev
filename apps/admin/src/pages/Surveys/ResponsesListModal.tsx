import { Modal, Avatar, Chip, Icon } from '../../ui'
import { responseStatus, type ResponseRow } from './useResponses'
import type { Survey } from './useSurveys'
import styles from './ResponsesListModal.module.css'

const STATUS_TONE = {
  pass: 'green',
  fail: 'red',
  partial: 'amber',
  na: undefined,
} as const

const STATUS_LABEL = {
  pass: 'Pass',
  fail: 'Fail',
  partial: 'Partial',
  na: 'Not scored',
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

export function ResponsesListModal({
  open,
  survey,
  rows,
  onClose,
  onOpenDetail,
}: {
  open: boolean
  survey: Survey
  rows: ResponseRow[]
  onClose: () => void
  onOpenDetail: (row: ResponseRow) => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Submitted responses"
      subtitle={`${survey.name}: the raw records behind the compliance number`}
      width={560}
    >
      <div className={styles.body}>
        {rows.length === 0 ? (
          <div className={styles.empty}>No responses captured yet</div>
        ) : (
          <div className={styles.list}>
            {rows.map((r) => {
              const sum = responseStatus({ ...r, items: [], questions: {} } as any)
              // Use overall boolean to determine a simple status for list view
              const listStatus =
                r.overall === true ? 'pass' : r.overall === false ? 'fail' : 'na'
              const tone = STATUS_TONE[listStatus]
              const pctColor = tone ? `var(--${tone}-fg)` : 'var(--text-2)'
              return (
                <button
                  key={r.id}
                  className={styles.row}
                  onClick={() => onOpenDetail(r)}
                  type="button"
                >
                  <Avatar name={r.rep_name} size={32} />
                  <div className={styles.rowInfo}>
                    <div className={styles.rowName}>
                      {r.store_name}
                    </div>
                    <div className={styles.rowMeta}>
                      {r.rep_name}, {formatDate(r.submitted_at)}
                      {!r.online && ' (queued offline)'}
                    </div>
                  </div>
                  <div className={styles.rowRight}>
                    <div className={styles.rowPct} style={{ color: pctColor }}>
                      {r.overall === true ? '100%' : r.overall === false ? '0%' : ''}
                    </div>
                    <div className={styles.rowStatus}>
                      <Chip tone={tone}>{STATUS_LABEL[listStatus]}</Chip>
                    </div>
                  </div>
                  <Icon name="chevR" size={16} />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
