import { Modal, Avatar, Chip, Icon } from '@intelli/ui'
import { useResponseDetail, responseStatus, skuGapSummary, type ResponseDetail } from './useResponses'
import type { BackendQuestion } from './useSurveys'
import type { Sku } from '../Catalog/useCatalog'
import styles from './ResponseDetailModal.module.css'

// ---- Status helpers ----
const STATUS_TONE = {
  pass: 'green',
  fail: 'red',
  partial: 'amber',
  na: undefined,
} as const

const STATUS_LABEL = {
  pass: 'Compliant',
  fail: 'Failed',
  partial: 'Partial',
  na: 'Not scored',
}

const STATUS_ICON = {
  pass: 'checkCircle',
  fail: 'xCircle',
  partial: 'alert',
  na: 'info',
} as const

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ---- Per-question answer renderers ----

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    boolean: 'Yes/No', number: 'Number', single_choice: 'Choice',
    multi_choice: 'Multi', photo: 'Photo', text: 'Text',
  }
  return <span className={styles.typeBadge}>{labels[type] ?? type}</span>
}

function ResultBadge({ verdict }: { verdict: boolean | null }) {
  if (verdict === null) {
    return <Chip>Not scored</Chip>
  }
  return verdict ? (
    <Chip tone="green"><Icon name="check" size={11} /> Pass</Chip>
  ) : (
    <Chip tone="red"><Icon name="x" size={11} /> Fail</Chip>
  )
}

function FacingsGrid({
  q,
  items,
  skus,
  verdict,
}: {
  q: BackendQuestion
  items: ResponseDetail['items']
  skus: Sku[]
  verdict: boolean | null
}) {
  const skuMap = new Map(skus.map((s) => [s.id, s]))
  // items for this question
  const qItems = items.filter((i) => i.question_id === q.id && i.sku_id != null)
  if (qItems.length === 0) return null

  const passValue = q.pass?.value as number | undefined
  const op = q.pass?.operator

  const summaryText = (() => {
    if (!op || passValue == null) return null
    const opLabel: Record<string, string> = { '>=': '>=', '<=': '<=', '>': '>', '<': '<', '==': '=' }
    const unit = q.unit ? ` ${q.unit}` : ''
    if (q.passScope === 'total') {
      const total = qItems.reduce((a, i) => a + (typeof i.value === 'number' ? i.value : 0), 0)
      return `Total ${total}${unit}, rule ${opLabel[op] ?? op} ${passValue}`
    }
    const passing = qItems.filter((i) => i.pass === true).length
    return `${passing} of ${qItems.length} shades meet ${opLabel[op] ?? op} ${passValue}${unit}`
  })()

  return (
    <div>
      {summaryText && (
        <div
          className={styles.facingsSummary}
          style={{ color: verdict === false ? 'var(--amber-fg, #d97706)' : 'var(--green-fg, #16a34a)' }}
        >
          {summaryText}
        </div>
      )}
      <div className={styles.facingsGrid}>
        {qItems.map((item) => {
          const sku = item.sku_id ? skuMap.get(item.sku_id) : undefined
          const pass = item.pass === true
          return (
            <div
              key={item.sku_id}
              className={`${styles.facingCell} ${pass ? styles.facingCellPass : styles.facingCellFail}`}
            >
              <div
                className={styles.facingColorDot}
                style={{ background: sku?.color ?? 'var(--border)' }}
              />
              <span className={styles.facingVariant}>{sku?.variant ?? item.sku_id}</span>
              <span
                className={`${styles.facingCount} ${pass ? styles.facingCountPass : styles.facingCountFail}`}
              >
                {typeof item.value === 'number' ? item.value : String(item.value)}
              </span>
              <Icon name={pass ? 'check' : 'x'} size={13} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AnswerBody({
  q,
  detail,
  skus,
}: {
  q: BackendQuestion
  detail: ResponseDetail
  skus: Sku[]
}) {
  const verdict = detail.questions[q.id] ?? null
  // Find items for this question
  const qItems = detail.items.filter((i) => i.question_id === q.id)

  if (q.type === 'photo') {
    return (
      <div className={styles.photoPlaceholder} data-testid="photo-placeholder">
        <Icon name="camera" size={16} />
        Photo coming soon
      </div>
    )
  }

  if (qItems.length === 0) {
    return <span className={styles.answerSkipped}>Not answered</span>
  }

  if (q.perSku && q.type === 'number') {
    return <FacingsGrid q={q} items={detail.items} skus={skus} verdict={verdict} />
  }

  const firstItem = qItems[0]
  const value = firstItem?.value

  if (q.type === 'boolean') {
    const boolVal = value === true || value === 'true' || value === 'Yes'
    return <Chip tone={boolVal ? 'green' : 'red'}>{boolVal ? 'Yes' : 'No'}</Chip>
  }

  if (q.type === 'number') {
    return (
      <span className={styles.answerNumber}>
        {String(value)}{' '}
        {q.unit && <span className={styles.answerUnit}>{q.unit}</span>}
      </span>
    )
  }

  if (q.type === 'text') {
    return <div className={styles.answerText}>"{String(value)}"</div>
  }

  if (q.type === 'single_choice' || q.type === 'multi_choice') {
    const vals = Array.isArray(value) ? value : [value]
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {vals.map((v, i) => <Chip key={i}>{String(v)}</Chip>)}
      </div>
    )
  }

  return <span style={{ fontSize: 13 }}>{String(value)}</span>
}

function QuestionRow({
  q,
  index,
  detail,
  skus,
}: {
  q: BackendQuestion
  index: number
  detail: ResponseDetail
  skus: Sku[]
}) {
  const verdict = detail.questions[q.id] ?? null

  // Build pass-rule chip label (mirrors passSummary from useSurveys)
  function passRuleLabel(): string | null {
    if (!q.pass) return null
    if (q.type === 'boolean') return q.pass.value === true ? 'Pass = Yes' : 'Pass = No'
    if (q.type === 'number') {
      const opLabel: Record<string, string> = { '>=': '>=', '<=': '<=', '>': '>', '<': '<', '==': '=' }
      const op = opLabel[q.pass.operator] ?? q.pass.operator
      const unit = q.unit ? ` ${q.unit}` : ''
      const scope = q.perSku ? (q.passScope === 'total' ? 'total ' : 'each ') : ''
      return `Pass = ${scope}${op} ${q.pass.value}${unit}`
    }
    if (q.type === 'single_choice') {
      const vals = Array.isArray(q.pass.value) ? q.pass.value : [q.pass.value]
      return vals.length ? `Pass = ${vals.join(' / ')}` : null
    }
    return null
  }

  const rule = passRuleLabel()

  return (
    <div className={styles.questionRow}>
      <div className={styles.questionTop}>
        <span className={styles.questionIndex}>{String(index + 1).padStart(2, '0')}</span>
        <div className={styles.questionBody}>
          <div className={styles.questionMeta}>
            <TypeBadge type={q.type} />
            {q.perSku && <Chip tone="violet"><Icon name="box" size={11} /> Per-SKU</Chip>}
            {rule && <Chip><Icon name="target" size={10} /> {rule}</Chip>}
            <div className={styles.resultBadge}>
              <ResultBadge verdict={verdict} />
            </div>
          </div>
          <div className={styles.questionPrompt}>{q.prompt}</div>
          <AnswerBody q={q} detail={detail} skus={skus} />
        </div>
      </div>
    </div>
  )
}

// ---- Main component ----

export function ResponseDetailModal({
  open,
  responseId,
  questions,
  skus,
  onClose,
  onBack,
}: {
  open: boolean
  responseId: string | null
  questions: BackendQuestion[]
  skus: Sku[]
  onClose: () => void
  onBack?: () => void
}) {
  const { data: detail, isLoading } = useResponseDetail(responseId, open)

  const sum = detail ? responseStatus(detail) : null
  const gap = detail ? skuGapSummary(detail) : null
  const tone = sum ? STATUS_TONE[sum.status] : undefined
  const fg = tone ? `var(--${tone}-fg)` : 'var(--text-2)'
  const bg = tone ? `var(--${tone}-bg)` : 'var(--surface-2, var(--surface-hover))'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={detail?.store_name ?? 'Response'}
      subtitle={
        detail
          ? `${detail.survey_name}, v${detail.survey_version_number}, submitted ${formatDate(detail.submitted_at)}`
          : undefined
      }
      width={720}
    >
      <div className={styles.body}>
        {onBack && (
          <button type="button" className={styles.back} onClick={onBack}>
            <Icon name="chevL" size={14} /> All responses
          </button>
        )}

        {isLoading && <div className={styles.loading}>Loading response...</div>}

        {!isLoading && detail && (
          <>
            {/* Verdict header */}
            <div className={styles.verdict} style={{ background: bg }}>
              <div className={styles.verdictLeft}>
                <Avatar name={detail.rep_name} size={34} />
                <div>
                  <div className={styles.verdictName}>{detail.rep_name}</div>
                  <div className={styles.verdictSub}>
                    {[detail.store_chain, detail.store_code, detail.store_address]
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                </div>
              </div>
              <div className={styles.verdictRight}>
                <div className={styles.verdictPct} style={{ color: fg }}>
                  {sum && <Icon name={STATUS_ICON[sum.status]} size={18} />}
                  {sum?.pct != null ? `${sum.pct}%` : ''}
                </div>
                {sum && (
                  <div className={styles.verdictLabel} style={{ color: fg }}>
                    {STATUS_LABEL[sum.status]},{' '}
                    {sum.passed}/{sum.scored} scored questions
                  </div>
                )}
              </div>
            </div>

            {/* SKU gap callout: audited shades below the facings threshold */}
            {gap && gap.gaps > 0 && (
              <div className={styles.skuGap}>
                <Icon name="box" size={15} />
                <span>
                  {gap.gaps} of {gap.total} audited shades below the facings threshold.
                  These roll into the per-SKU out-of-stock analytics.
                </span>
              </div>
            )}

            {/* Meta strip */}
            <div className={styles.metaStrip}>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Node</div>
                <div className={styles.metaValue}>{detail.store_path}</div>
              </div>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Sync</div>
                <div className={styles.metaValue}>{detail.online ? 'Online, synced' : 'Offline, queued'}</div>
              </div>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Version</div>
                <div className={styles.metaValue}>v{detail.survey_version_number} (frozen)</div>
              </div>
            </div>

            {/* Per-question answers */}
            {questions.length > 0 && (
              <>
                <div className={styles.answersEyebrow}>Answers</div>
                <div>
                  {questions.map((q, i) => (
                    <QuestionRow key={q.id} q={q} index={i} detail={detail} skus={skus} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
