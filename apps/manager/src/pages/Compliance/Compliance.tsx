import { useState, type KeyboardEvent } from 'react'
import { Bar, Button, Card, Icon } from '@intelli/ui'
import { downloadCsv } from '@intelli/api-client'
import { Topbar } from '../../shell/Topbar'
import { selectSession, useAppSelector } from '../../store'
import {
  useNodeCompliance,
  useSkuMap,
  checkCounts,
  failingItems,
  valueLabel,
  type Crumb,
  type NodeComplianceRow,
  type StoreSurveyBlock,
  type Range,
} from './useCompliance'
import styles from './Compliance.module.css'

const DASH = '—'
const RANGE: Range = '12w' // compliance is reviewed over a wide window; no toggle in v1

function pctLabel(v: number | null): string {
  return v == null ? DASH : `${Math.round(v)}%`
}
// The fill/text tone for a pass %. undefined = the neutral default accent.
function tone(v: number | null): 'green' | 'amber' | 'red' | undefined {
  if (v == null) return undefined
  if (v >= 88) return 'green'
  if (v >= 78) return undefined
  if (v >= 70) return 'amber'
  return 'red'
}
const TONE_COLOR: Record<'green' | 'amber' | 'red', string> = {
  green: 'var(--green-fg)',
  amber: 'var(--amber-fg)',
  red: 'var(--red-fg)',
}
function pctColor(v: number | null): string {
  const t = tone(v)
  return t ? TONE_COLOR[t] : 'var(--text)'
}

// Make a click-handler also fire on Enter/Space, so a card or row that acts like
// a button is reachable by keyboard (matches the Admin ComplianceList pattern).
function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }
}

// The store-level review: one block per survey covering the store, with the
// failing shades surfaced. Photos and the follow-up action are "coming soon".
function StoreDetail({ surveys }: { surveys: StoreSurveyBlock[] }) {
  const skuMap = useSkuMap()
  const responded = surveys.filter((s) => s.responded)
  if (responded.length === 0) {
    return (
      <Card className={styles.card}>
        <div className={styles.emptyNote}>No surveys have been submitted for this store yet.</div>
      </Card>
    )
  }
  return (
    <Card className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitle}>Assigned surveys</div>
        <div className={styles.cardSub}>What the rep submitted, scored live against the survey's pass rules</div>
      </div>
      <div className={styles.svList}>
        {responded.map((block) => {
          const { passed, scored } = checkCounts(block)
          const fails = failingItems(block, skuMap.data ?? {})
          const ok = block.overall !== false
          return (
            <div key={block.survey_version_id} className={styles.svRow}>
              <div className={styles.svHead}>
                <Icon name="file" size={16} className={styles.svFileIcon} />
                <div className={styles.svHeadText}>
                  <div className={styles.svName}>{block.survey_name}</div>
                  <div className={styles.svMeta}>
                    {scored > 0 ? `${passed} of ${scored} checks passed` : 'Not scored'}
                  </div>
                </div>
                {ok ? (
                  <span className={`${styles.chip} ${styles.chipGreen}`}>
                    <Icon name="check" size={11} /> Passed
                  </span>
                ) : (
                  <span className={`${styles.chip} ${styles.chipRed}`}>
                    <Icon name="x" size={11} /> Failed
                  </span>
                )}
              </div>

              <div className={styles.svBody}>
                <div className={styles.blockEyebrow}>Submitted photos</div>
                <div className={styles.photoSoon}>
                  <Icon name="image" size={16} /> Shelf photos coming soon
                </div>

                {fails.length > 0 ? (
                  <>
                    <div className={styles.fixesHead}>
                      <Icon name="alert" size={15} className={styles.alertIcon} />
                      <span>
                        {fails.length} product{fails.length === 1 ? '' : 's'} short at this store
                      </span>
                    </div>
                    <div className={styles.fixList}>
                      {fails.map((f) => (
                        <div key={f.sku_id} className={styles.fixItem}>
                          <span
                            className={styles.swatch}
                            style={{ background: f.color ?? 'var(--text-4)' }}
                          />
                          <span className={styles.fixName}>{f.variant}</span>
                          <span className={styles.fixVal}>{valueLabel(f.value)}</span>
                          <Icon name="x" size={12} className={styles.fixX} />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className={styles.allClear}>
                    <Icon name="check" size={14} /> No product gaps in this survey
                  </div>
                )}

                <div className={styles.soonRow}>
                  <button className={styles.soonBtn} type="button" disabled title="Coming soon">
                    <Icon name="send" size={13} /> Assign follow-up to rep
                    <span className={styles.soonChip}>soon</span>
                  </button>
                  <span className={styles.soonNote}>
                    Sending a fix to the rep needs the field app (Phase 5).
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// A non-store level: districts render as cards, stores as a compact table.
function NodeLevel({
  rows,
  onDrill,
}: {
  rows: NodeComplianceRow[]
  onDrill: (row: NodeComplianceRow) => void
}) {
  if (rows.length === 0) {
    return (
      <Card className={styles.card}>
        <div className={styles.emptyNote}>Nothing in your branch to show here yet.</div>
      </Card>
    )
  }
  const allStores = rows.every((r) => r.is_store)
  if (allStores) {
    return (
      <Card className={`${styles.card} ${styles.tableCard}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Store</th>
              <th>Responded</th>
              <th>Compliance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.node_id}
                className={styles.clickable}
                role="button"
                tabIndex={0}
                onClick={() => onDrill(r)}
                onKeyDown={onActivate(() => onDrill(r))}
              >
                <td className={styles.storeName}>{r.name}</td>
                <td className={styles.mono}>
                  {r.responded} / {r.expected}
                </td>
                <td className={styles.mono} style={{ color: pctColor(r.pass_pct) }}>
                  {pctLabel(r.pass_pct)}
                </td>
                <td className={styles.chevCell}>
                  <Icon name="chevR" size={15} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    )
  }
  return (
    <div className={styles.cardGrid}>
      {rows.map((r) => (
        <Card
          key={r.node_id}
          className={`${styles.card} ${styles.nodeCard}`}
          role="button"
          tabIndex={0}
          onClick={() => onDrill(r)}
          onKeyDown={onActivate(() => onDrill(r))}
        >
          <div className={styles.nodeCardTop}>
            <div className={styles.nodeName}>{r.name}</div>
            <div className={styles.nodePct} style={{ color: pctColor(r.pass_pct) }}>
              {pctLabel(r.pass_pct)}
            </div>
          </div>
          <div className={styles.nodeSub}>
            {r.responded} of {r.expected} expected responses
          </div>
          <div className={styles.nodeBar}>
            <Bar value={r.pass_pct == null ? 0 : r.pass_pct / 100} tone={tone(r.pass_pct)} height={8} />
          </div>
          <div className={styles.drillIn}>
            Drill in <Icon name="arrowRight" size={13} />
          </div>
        </Card>
      ))}
    </div>
  )
}

export default function Compliance() {
  const session = useAppSelector(selectSession)
  const rootName = session?.user.pinned_node_name ?? 'Your branch'
  // The drill path BELOW the branch root. Empty = at the root.
  const [path, setPath] = useState<Crumb[]>([])
  const currentId = path.length ? path[path.length - 1].id : undefined
  const q = useNodeCompliance(currentId, RANGE)

  const crumbs: Crumb[] = [{ id: undefined, name: rootName }, ...path]

  function goTo(index: number) {
    // index 0 = root; clicking a crumb pops the path back to it.
    setPath(index === 0 ? [] : path.slice(0, index))
  }
  function drill(row: NodeComplianceRow) {
    setPath([...path, { id: row.node_id, name: row.name }])
  }

  return (
    <>
      <Topbar title="Compliance Review" subtitle="Drill from your branch to a store and review pass/fail">
        <Button
          size="sm"
          onClick={() => downloadCsv('/export/compliance?format=csv', 'intelli_compliance.csv')}
        >
          <Icon name="download" size={14} /> Export
        </Button>
      </Topbar>

      <div className={styles.scroll}>
        <div className={styles.page}>
          {/* breadcrumb */}
          <div className={styles.crumbs}>
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1
              return (
                <span key={i} className={styles.crumbWrap}>
                  {i > 0 && <Icon name="chevR" size={13} className={styles.crumbSep} />}
                  <button
                    type="button"
                    className={`${styles.crumb} ${last ? styles.crumbActive : ''}`}
                    disabled={last}
                    onClick={() => goTo(i)}
                  >
                    {c.name}
                  </button>
                </span>
              )
            })}
          </div>

          {q.isLoading && <Card className={styles.card}><div className={styles.emptyNote}>Loading...</div></Card>}
          {q.isError && (
            <Card className={styles.card}>
              <div className={styles.emptyNote}>Could not load compliance for your branch.</div>
            </Card>
          )}
          {q.data &&
            (q.data.is_store ? (
              <StoreDetail surveys={q.data.surveys} />
            ) : (
              <NodeLevel rows={q.data.children} onDrill={drill} />
            ))}
        </div>
      </div>
    </>
  )
}
