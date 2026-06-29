import { Modal, Avatar, Chip, Icon } from '@intelli/ui'
import { type ResponseRow } from './useResponses'
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
              // Compute status from scored/passed counts returned by the backend
              const scored = r.scored ?? 0
              const passed = r.passed ?? 0
              const pct = scored > 0 ? Math.round((passed / scored) * 100) : null
              let listStatus: 'pass' | 'partial' | 'fail' | 'na'
              if (scored === 0) listStatus = 'na'
              else if (passed === scored) listStatus = 'pass'
              else if (passed === 0) listStatus = 'fail'
              else listStatus = 'partial'
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
                      {pct !== null ? `${pct}%` : ''}
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
