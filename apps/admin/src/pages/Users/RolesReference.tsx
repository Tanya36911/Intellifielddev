import { Chip, Icon } from '@intelli/ui'
import styles from './RolesReference.module.css'

type Cell = 'Full' | 'Scoped' | 'None'
type Cap = { cap: string; note: string; admin: Cell; manager: Cell; rep: Cell }

const CAPS: Cap[] = [
  { cap: 'Build & edit hierarchy', note: 'Add, rename, move, delete nodes', admin: 'Full', manager: 'None', rep: 'None' },
  { cap: 'Add & manage users', note: 'Add users, set role + pin', admin: 'Full', manager: 'None', rep: 'None' },
  { cap: 'Create & version surveys', note: 'Build forms, publish versions', admin: 'Full', manager: 'None', rep: 'None' },
  { cap: 'Assign surveys', note: 'Push surveys to nodes / stores', admin: 'Full', manager: 'Scoped', rep: 'None' },
  { cap: 'Approve payroll', note: 'Review & seal pay periods', admin: 'Full', manager: 'Scoped', rep: 'None' },
  { cap: 'Complete surveys', note: 'Answer assigned surveys in-store', admin: 'None', manager: 'Scoped', rep: 'Full' },
  { cap: 'View reports', note: 'Compliance, completion, responses', admin: 'Full', manager: 'Scoped', rep: 'Scoped' },
]

function CapCell({ v }: { v: Cell }) {
  if (v === 'Full') return <Chip tone="green"><Icon name="check" size={11} /> Full</Chip>
  if (v === 'Scoped') return <Chip tone="amber">Scoped</Chip>
  return <span className={styles.none}>None</span>
}

export function RolesReference() {
  return (
    <div>
      <div className={styles.explainer}>
        Intelli has three fixed roles. A role decides what someone can do; their pin
        decides where. An admin pins at the company root and sees everything. A
        manager pins at a branch and is scoped to it. A rep pins at the level above
        Store. This reference is read-only.
      </div>
      <div className={styles.card}>
        <table className={styles.tbl}>
          <thead>
            <tr>
              <th>Capability</th>
              <th><Chip tone="violet">Admin</Chip></th>
              <th><Chip tone="blue">Manager</Chip></th>
              <th><Chip tone="green">Rep</Chip></th>
            </tr>
          </thead>
          <tbody>
            {CAPS.map((r) => (
              <tr key={r.cap}>
                <td><div className={styles.capName}>{r.cap}</div><div className={styles.capNote}>{r.note}</div></td>
                <td className={styles.center}><CapCell v={r.admin} /></td>
                <td className={styles.center}><CapCell v={r.manager} /></td>
                <td className={styles.center}><CapCell v={r.rep} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.soon}>
        <div><div className={styles.soonTitle}>Custom roles</div><div className={styles.soonHint}>Define your own capability sets on the same scoping model.</div></div>
        <Chip>Coming soon</Chip>
      </div>
    </div>
  )
}
