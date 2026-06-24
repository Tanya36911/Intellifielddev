import { useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Topbar } from '../../shell/Topbar'
import { Button, Card, Segmented, Switch } from '../../ui'
import { useNodes, useCreateAssignment, useSurvey, type Node } from './useSurveys'
import styles from './AssignPanel.module.css'

// Find the published version id by picking the version with the highest
// version_number that has a non-null published_at.
function pickPublishedVersionId(versions: { id: string; version_number: number; published_at: string | null }[]): string | null {
  const published = versions
    .filter((v) => v.published_at !== null)
    .sort((a, b) => b.version_number - a.version_number)
  return published.length > 0 ? published[0].id : null
}

const TZ_OPTIONS = ['Rep-local', 'Corporate (ET)']
const TZ_VALUE: Record<string, string> = {
  'Rep-local': 'rep-local',
  'Corporate (ET)': 'corporate',
}

export default function AssignPanel() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()

  // useParams only returns :id when rendered inside a matching Route definition.
  // When rendered in isolation (tests, bare MemoryRouter), fall back to parsing
  // the pathname: /surveys/<id>/assign
  const id: string | undefined =
    params.id ??
    (() => {
      const m = location.pathname.match(/^\/surveys\/([^/]+)\/assign/)
      return m ? m[1] : undefined
    })()

  // Router state supplied when coming from the Builder (after publish)
  const stateVersionId: string | undefined = (location.state as any)?.versionId
  const stateName: string | undefined = (location.state as any)?.name

  // Fallback: fetch the survey when router state is absent (e.g. in isolated tests).
  // Pass `id` whenever stateVersionId is not available so the query fires.
  const { data: surveyDetail, isLoading: surveyLoading } = useSurvey(!stateVersionId ? id : undefined)

  const versionId: string | null =
    stateVersionId ??
    (surveyDetail ? pickPublishedVersionId(surveyDetail.versions) : null)
  const surveyName: string =
    stateName ?? surveyDetail?.name ?? ''

  const { data: nodesData, isLoading: nodesLoading } = useNodes()
  const createAssignment = useCreateAssignment()

  // Find the "all stores" node: the one with the lowest level_order
  const nodes: Node[] = nodesData?.nodes ?? []
  const rootNode: Node | undefined = nodes.length > 0
    ? nodes.reduce((a, b) => (a.level_order <= b.level_order ? a : b))
    : undefined
  const otherNodes: Node[] = rootNode
    ? nodes.filter((n) => n.id !== rootNode.id)
    : nodes

  // Selection state: when allStores is on, only the root node is selected
  const [allStores, setAllStores] = useState(true)
  const [selectedOthers, setSelectedOthers] = useState<Set<string>>(new Set())

  // Deadline state
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')

  // Timezone basis
  const [tzLabel, setTzLabel] = useState('Rep-local')

  const [error, setError] = useState<string | null>(null)

  const selectedNodeIds: string[] = allStores && rootNode
    ? [rootNode.id]
    : Array.from(selectedOthers)

  const deadline: string | null =
    date && time ? new Date(`${date}T${time}`).toISOString() : null

  const timezone_basis = TZ_VALUE[tzLabel] ?? 'rep-local'

  async function handleAssign() {
    if (!versionId) {
      setError('No published version found for this survey.')
      return
    }
    if (selectedNodeIds.length === 0) {
      setError('Select at least one location to assign to.')
      return
    }
    setError(null)
    try {
      for (const nodeId of selectedNodeIds) {
        await createAssignment.mutateAsync({
          survey_version_id: versionId,
          target_node_id: nodeId,
          deadline,
          timezone_basis,
        })
      }
      navigate('/surveys')
    } catch (err: any) {
      setError(err?.message ?? 'Assignment failed. Please try again.')
    }
  }

  function toggleOther(nodeId: string) {
    setSelectedOthers((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  const isPending = createAssignment.isPending
  const isDataLoading = nodesLoading || (!stateVersionId && surveyLoading)
  // The button is enabled when "all stores" is selected or specific nodes are
  // chosen, data has loaded, and a published version is known.
  const hasSelection = allStores || selectedOthers.size > 0
  const canAssign = !isPending && hasSelection && !isDataLoading && !!versionId

  return (
    <>
      <Topbar
        title="Assign Survey"
        subtitle={surveyName || undefined}
      />
      <div className={styles.scroll}>
        <div className={styles.page}>
          {!versionId && !nodesLoading && (
            <div className={styles.warn}>
              No published version found. Publish the survey before assigning.
            </div>
          )}

          <Card className={styles.section}>
            <div className={styles.sectionTitle}>Who receives this survey?</div>

            {nodesLoading && <div className={styles.hint}>Loading locations...</div>}

            {rootNode && (
              <div className={styles.nodeRow}>
                <div className={styles.nodeInfo}>
                  <div className={styles.nodeName}>All stores you manage</div>
                  <div className={styles.nodeHint}>{rootNode.name}</div>
                </div>
                <Switch
                  on={allStores}
                  onChange={(next) => {
                    setAllStores(next)
                    if (next) setSelectedOthers(new Set())
                  }}
                  label="Select all stores you manage"
                />
              </div>
            )}

            {otherNodes.map((n) => (
              <div
                key={n.id}
                className={`${styles.nodeRow} ${allStores ? styles.nodeRowDisabled : ''}`}
              >
                <div className={styles.nodeInfo}>
                  <div className={styles.nodeName}>{n.name}</div>
                  {n.code && <div className={styles.nodeHint}>{n.code}</div>}
                </div>
                <Switch
                  on={!allStores && selectedOthers.has(n.id)}
                  onChange={() => {
                    if (!allStores) toggleOther(n.id)
                  }}
                  label={`Select ${n.name}`}
                />
              </div>
            ))}
          </Card>

          <Card className={styles.section}>
            <div className={styles.sectionTitle}>Deadline (optional)</div>
            <div className={styles.deadlineRow}>
              <div className={styles.deadlineField}>
                <label className={styles.label} htmlFor="assign-date">Date</label>
                <input
                  id="assign-date"
                  type="date"
                  className={styles.dateInput}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className={styles.deadlineField}>
                <label className={styles.label} htmlFor="assign-time">Time</label>
                <input
                  id="assign-time"
                  type="time"
                  className={styles.dateInput}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.tzRow}>
              <Segmented
                options={TZ_OPTIONS}
                value={tzLabel}
                onChange={setTzLabel}
              />
            </div>
            <div className={styles.hint}>
              Stored as a preference; it does not change when the deadline lands per store yet.
            </div>
          </Card>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <Button variant="default" onClick={() => navigate('/surveys')}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleAssign}
              disabled={!canAssign}
            >
              {isPending ? 'Assigning...' : isDataLoading ? 'Loading...' : 'Assign'}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
