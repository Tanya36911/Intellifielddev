import { useState } from 'react'
import type { ReactNode } from 'react'
import { Bar, Icon } from '../../ui'
import { useComplianceDrill, type ComplianceRow } from './useDashboard'
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

// The drill panel for one expanded assignment row. Fetches the children for the
// row's (target_node_id, survey_version_id) only while open.
function DrillPanel({ row }: { row: ComplianceRow }) {
  const drill = useComplianceDrill(row.target_node_id, row.survey_version_id, true)
  if (drill.isLoading) return <div className={styles.drillNote}>Loading...</div>
  const data = drill.data
  if (!data) return <div className={styles.drillNote}>No detail available.</div>

  if (data.is_store) {
    if (!data.responded) return <div className={styles.drillNote}>No response from this store yet.</div>
    const items = data.items ?? []
    // questions is an object map { question_id: verdict }, not an array; walk it
    // with Object.entries (calling .map on it would throw).
    const questionEntries = Object.entries(data.questions ?? {})
    if (items.length === 0 && questionEntries.length === 0)
      return <div className={styles.drillNote}>No per-product detail.</div>
    return (
      <div className={styles.drill}>
        {/* Per-product lines: one row per answered (question, product). */}
        {items.map((it, i) => {
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
        {questionEntries.map(([questionId, ok]) => (
          <div key={`q${questionId}`} className={styles.drillRow}>
            {verdictIcon(ok)}
            <div className={styles.drillName}>{questionId}</div>
          </div>
        ))}
      </div>
    )
  }

  const children = data.children ?? []
  if (children.length === 0) return <div className={styles.drillNote}>No child nodes.</div>
  return (
    <div className={styles.drill}>
      {children.map((c) => (
        <div key={c.node_id} className={styles.drillRow}>
          <Icon name={c.is_store ? 'store' : 'branch'} size={13} color="var(--text-4)" />
          <div className={styles.drillName}>{c.name}</div>
          <div className={styles.drillBar}>
            <Bar value={(c.pass_pct ?? 0) / 100} tone={tone(c.pass_pct)} height={6} />
          </div>
          <div className={styles.drillPct}>{pctLabel(c.pass_pct)}</div>
        </div>
      ))}
    </div>
  )
}

// The compliance-by-node list: one row per survey assignment. Clicking a row
// toggles a drill into its child nodes (or, for a store, its per-product detail).
export default function ComplianceList({ rows }: { rows: ComplianceRow[] }) {
  const [open, setOpen] = useState<string | null>(null)

  if (rows.length === 0) {
    return <div className={styles.empty}>No assignments in scope yet.</div>
  }

  return (
    <div className={styles.list}>
      {rows.map((row) => {
        const isOpen = open === row.assignment_id
        return (
          <div key={row.assignment_id}>
            <div
              className={styles.row}
              role="button"
              tabIndex={0}
              onClick={() => setOpen(isOpen ? null : row.assignment_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setOpen(isOpen ? null : row.assignment_id)
                }
              }}
            >
              <Icon name={isOpen ? 'chevD' : 'chevR'} size={14} color="var(--text-3)" />
              <div className={styles.name}>
                <div className={styles.survey}>{row.survey_name}</div>
                <div className={styles.node}>{row.target_node_name}</div>
              </div>
              <div className={styles.bar}>
                <Bar value={(row.pass_pct ?? 0) / 100} tone={tone(row.pass_pct)} height={7} />
              </div>
              <div className={styles.pct}>{pctLabel(row.pass_pct)}</div>
              <div className={styles.count}>
                {row.responded}/{row.expected}
              </div>
            </div>
            {isOpen && <DrillPanel row={row} />}
          </div>
        )
      })}
    </div>
  )
}
