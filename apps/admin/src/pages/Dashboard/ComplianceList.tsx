import { useState } from 'react'
import { Bar, Icon } from '../../ui'
import { useComplianceDrill, type ComplianceRow } from './useDashboard'
import styles from './ComplianceList.module.css'

// no-data glyph for a null percentage.
const DASH = '—'

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
    const items = data.items ?? []
    const questions = data.questions ?? []
    if (!data.responded) return <div className={styles.drillNote}>No response from this store yet.</div>
    if (items.length === 0 && questions.length === 0)
      return <div className={styles.drillNote}>No per-product detail.</div>
    return (
      <div className={styles.drill}>
        {items.map((it, i) => (
          <div key={`i${i}`} className={styles.drillRow}>
            <Icon name={it.ok ? 'check' : 'xCircle'} size={13} color={it.ok ? 'var(--green)' : 'var(--red)'} />
            <div className={styles.drillName}>{it.name}</div>
            {it.detail && <div className={styles.drillDetail}>{it.detail}</div>}
          </div>
        ))}
        {questions.map((q, i) => (
          <div key={`q${i}`} className={styles.drillRow}>
            <Icon name={q.ok ? 'check' : 'xCircle'} size={13} color={q.ok ? 'var(--green)' : 'var(--red)'} />
            <div className={styles.drillName}>{q.prompt}</div>
            {q.answer && <div className={styles.drillDetail}>{q.answer}</div>}
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
