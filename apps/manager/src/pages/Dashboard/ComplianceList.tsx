import { useState } from 'react'
import type { ReactNode } from 'react'
import { Bar, Icon } from '@intelli/ui'
import {
  useNodeCompliance,
  type NodeComplianceRow,
  type Range,
  type StoreSurveyBlock,
} from './useDashboard'
import styles from './ComplianceList.module.css'

// no-data glyph for a null percentage.
const DASH = '—'

// A pass/fail/no-data verdict mark. pass true = green check, false = red x,
// null/undefined = the neutral no-data dash (never renders "null" or NaN).
function verdictIcon(pass: boolean | null | undefined): ReactNode {
  if (pass == null) return <span className={styles.drillDash}>{DASH}</span>
  return (
    <Icon
      name={pass ? 'check' : 'xCircle'}
      size={13}
      color={pass ? 'var(--green)' : 'var(--red)'}
    />
  )
}

// Render a jsonb answer value (number/string/bool) as plain text. Objects fall
// back to JSON; null/undefined render nothing.
function valueText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// pass_pct >= 88 reads green, >= 78 the default accent, else amber.
function tone(pct: number | null): 'green' | 'amber' | undefined {
  if (pct == null) return undefined
  if (pct >= 88) return 'green'
  if (pct >= 78) return undefined
  return 'amber'
}

function pctLabel(pct: number | null): string {
  return pct == null ? DASH : `${Math.round(pct)}%`
}

// The bottom of the drill: a store's per-survey detail. One block per survey
// version covering the store; items/questions are always arrays/objects.
function StoreDetail({ surveys }: { surveys: StoreSurveyBlock[] }) {
  if (surveys.length === 0)
    return <div className={styles.drillNote}>No surveys cover this store.</div>
  return (
    <div className={styles.drill}>
      {surveys.map((b) => (
        <div key={b.survey_version_id}>
          <div className={styles.surveyHead}>
            {verdictIcon(b.overall)}
            <span>{b.survey_name}</span>
          </div>
          {!b.responded ? (
            <div className={styles.drillDetail}>No response in this period.</div>
          ) : (
            <>
              {/* Per-product lines: one row per answered (question, product). */}
              {b.items.map((it, i) => {
                const detail = [it.sku_id, valueText(it.value)].filter(Boolean).join(' · ')
                return (
                  <div key={`i${i}`} className={styles.drillRow}>
                    {verdictIcon(it.pass)}
                    <div className={styles.drillName}>{it.question_id}</div>
                    {detail && <div className={styles.drillDetail}>{detail}</div>}
                  </div>
                )
              })}
              {/* Per-question verdicts: the rolled-up pass/fail for each question. */}
              {Object.entries(b.questions).map(([questionId, ok]) => (
                <div key={`q${questionId}`} className={styles.drillRow}>
                  {verdictIcon(ok)}
                  <div className={styles.drillName}>{questionId}</div>
                </div>
              ))}
            </>
          )}
        </div>
      ))}
    </div>
  )
}

// The drill panel for one expanded node. Fetches that node's rollup only while
// open, then narrows on the FETCHED data.is_store (not any prop): a non-store
// renders nested NodeRows (region -> district -> store); a store renders its
// per-product detail.
function NodeDrill({ nodeId, range }: { nodeId: string; range: Range }) {
  const drill = useNodeCompliance(nodeId, range)
  if (drill.isLoading) return <div className={styles.drillNote}>Loading...</div>
  const data = drill.data
  if (!data) return <div className={styles.drillNote}>No detail available.</div>
  if (data.is_store) return <StoreDetail surveys={data.surveys} />
  const children = data.children ?? []
  if (children.length === 0) return <div className={styles.drillNote}>No child nodes.</div>
  return (
    <div className={styles.drill}>
      {children.map((c) => (
        <NodeRow key={c.node_id} node={c} range={range} />
      ))}
    </div>
  )
}

// One clickable node row: name, pass-% bar, pct, responded/expected count.
// Clicking toggles a drill into the node's children (or, for a store, its
// per-product detail).
function NodeRow({ node, range }: { node: NodeComplianceRow; range: Range }) {
  const [open, setOpen] = useState(false)
  const toggle = () => setOpen((o) => !o)
  return (
    <div>
      <div
        className={styles.row}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle()
          }
        }}
      >
        <Icon name={open ? 'chevD' : 'chevR'} size={14} color="var(--text-3)" />
        <Icon name={node.is_store ? 'store' : 'branch'} size={13} color="var(--text-4)" />
        <div className={styles.name}>
          <div className={styles.survey}>{node.name}</div>
        </div>
        <div className={styles.bar}>
          <Bar value={(node.pass_pct ?? 0) / 100} tone={tone(node.pass_pct)} height={7} />
        </div>
        <div className={styles.pct}>{pctLabel(node.pass_pct)}</div>
        <div className={styles.count}>
          {node.responded}/{node.expected}
        </div>
      </div>
      {open && <NodeDrill nodeId={node.node_id} range={range} />}
    </div>
  )
}

// The compliance-by-node list: one row per org node in the caller's scope (the
// regions for an admin at the root), each drilling region -> district -> store
// -> the per-product reason. Windowed to the dashboard's selected range.
export default function ComplianceList({ range }: { range: Range }) {
  const top = useNodeCompliance(undefined, range)
  if (top.isLoading) return <div className={styles.empty}>Loading...</div>
  const data = top.data
  const children = data && !data.is_store ? data.children : []
  if (children.length === 0) {
    return <div className={styles.empty}>No nodes in scope yet.</div>
  }
  return (
    <div className={styles.list}>
      {children.map((c) => (
        <NodeRow key={c.node_id} node={c} range={range} />
      ))}
    </div>
  )
}
