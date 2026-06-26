import { useMemo, useState } from 'react'
import { Button, Card, Icon } from '../../ui'
import { Topbar } from '../../shell/Topbar'
import { selectSession, useAppSelector } from '../../store'
import {
  useHierarchy,
  useDeleteNode,
  buildTreeIndex,
  filterNodes,
  hierarchyStats,
  uniqueChains,
  type OrgNode,
} from './useHierarchy'
import { ApiError } from '../../lib/api'
import TreeNode from './TreeNode'
import StoreDetailModal from './StoreDetailModal'
import NodeFormModal from './NodeFormModal'
import styles from './Hierarchy.module.css'

// Level dot colours for the legend
const LEGEND_LEVELS = [
  { name: 'Company', color: '#1B4F8A', square: false },
  { name: 'Region', color: '#0ea5e9', square: false },
  { name: 'District', color: '#16a34a', square: false },
  { name: 'Store', color: '#d97706', square: true, note: 'locked level' },
]

function StatTile({ icon, value, label }: { icon: 'tree' | 'globe' | 'building' | 'store'; value: number; label: string }) {
  return (
    <Card className={styles.stat}>
      <div className={styles.statIcon}>
        <Icon name={icon} size={18} />
      </div>
      <div>
        <div className={styles.statValue}>{value}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
    </Card>
  )
}

export default function Hierarchy() {
  const session = useAppSelector(selectSession)
  const company = session?.user.company_name ?? 'Your company'
  const isAdmin = session?.user.role === 'admin'

  const { nodes, levels, isLoading } = useHierarchy()
  const deleteNode = useDeleteNode()

  const [query, setQuery] = useState('')
  const [chain, setChain] = useState('All')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selectedStore, setSelectedStore] = useState<OrgNode | null>(null)
  const [editMode, setEditMode] = useState(false)
  // The add/rename modal: which mode, and the node it acts on (parent in add mode,
  // the target node in rename mode).
  const [formState, setFormState] = useState<{ mode: 'add' | 'rename'; node: OrgNode } | null>(null)

  function openAddChild(parent: OrgNode) {
    setFormState({ mode: 'add', node: parent })
  }
  function openRename(node: OrgNode) {
    setFormState({ mode: 'rename', node })
  }
  async function handleDelete(node: OrgNode) {
    if (!window.confirm(`Delete "${node.name}"? This cannot be undone.`)) return
    try {
      await deleteNode.mutateAsync(node.id)
    } catch (e) {
      // A 409 carries the backend's reason (not empty: has children, pinned users,
      // assigned surveys, or responses). Surface it; fall back for other errors.
      const msg = e instanceof ApiError ? e.message : 'Could not delete this node. Try again.'
      window.alert(msg)
    }
  }

  const idx = useMemo(() => buildTreeIndex(nodes), [nodes])
  const stats = useMemo(() => hierarchyStats(nodes, levels), [nodes, levels])
  const chains = useMemo(() => uniqueChains(nodes), [nodes])

  const keepIds = useMemo(() => {
    const hasFilter = query.trim() !== '' || chain !== 'All'
    if (!hasFilter) return null
    return filterNodes(nodes, query, chain)
  }, [nodes, query, chain])

  // When a filter is active, auto-show matching branches without mutating expanded state
  const effectiveExpanded = useMemo(() => {
    if (keepIds === null) return expanded
    // When filtering, expand all ancestors of kept nodes
    const e: Record<string, boolean> = { ...expanded }
    for (const id of keepIds) {
      const node = idx.byId[id]
      if (node) {
        let p = node.parent_id
        while (p !== null) {
          e[p] = true
          p = idx.byId[p]?.parent_id ?? null
        }
      }
    }
    return e
  }, [keepIds, expanded, idx])

  function toggle(id: string) {
    setExpanded(e => ({ ...e, [id]: !e[id] }))
  }

  function expandAll(open: boolean) {
    const e: Record<string, boolean> = {}
    nodes.forEach(n => { e[n.id] = open })
    setExpanded(e)
  }

  const chainCount = chain === 'All' ? 0 : nodes.filter(n => n.chain === chain).length
  const subtitle = isLoading
    ? `${company}. Loading...`
    : `${company}. ${nodes.length} nodes, ${stats.storeCount} stores, ${stats.levelCount} levels.`

  return (
    <>
      <Topbar title="Hierarchy" subtitle={subtitle}>
        {isAdmin && (
          <Button
            size="sm"
            variant={editMode ? 'primary' : 'default'}
            onClick={() => setEditMode(v => !v)}
            title={editMode ? 'Done editing' : 'Edit hierarchy'}
          >
            <Icon name={editMode ? 'check' : 'edit'} size={13} /> {editMode ? 'Done' : 'Edit'}
          </Button>
        )}
        <Button size="sm" disabled title="Coming soon">
          <Icon name="download" size={13} /> Export
          <span style={{ fontSize: 9, border: '1px solid var(--border)', borderRadius: 99, padding: '0 6px', marginLeft: 2 }}>soon</span>
        </Button>
      </Topbar>

      <div className={styles.scroll}>
        <div className={styles.page}>

          {/* stat tiles */}
          <div className={styles.stats}>
            <StatTile icon="tree" value={stats.levelCount} label="Org levels" />
            <StatTile icon="globe" value={stats.regionCount} label="Regions" />
            <StatTile icon="building" value={stats.districtCount} label="Districts" />
            <StatTile icon="store" value={stats.storeCount} label="Stores" />
          </div>

          {/* toolbar */}
          <div className={styles.toolbar}>
            <div className={styles.searchWrap}>
              <Icon name="search" size={14} />
              <input
                className={styles.searchInput}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Find a node..."
                aria-label="Find a node"
              />
            </div>
            <div className={styles.chainWrap}>
              <Icon name="tag" size={13} style={{ color: 'var(--text-3)' }} />
              <select
                className={styles.chainSelect}
                value={chain}
                onChange={e => setChain(e.target.value)}
                aria-label="Filter by chain"
              >
                <option value="All">All chains</option>
                {chains.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className={styles.spacer} />
            <Button size="sm" variant="ghost" onClick={() => expandAll(true)}>Expand all</Button>
            <Button size="sm" variant="ghost" onClick={() => expandAll(false)}>Collapse</Button>
          </div>

          {/* level legend */}
          <div className={styles.legend}>
            {LEGEND_LEVELS.map(lv => (
              <span key={lv.name} className={styles.lvChip}>
                <span style={{ width: 8, height: 8, borderRadius: lv.square ? 2 : 99, background: lv.color, display: 'inline-block' }} />
                {lv.name}
                {lv.note && <span style={{ color: 'var(--text-4)', fontWeight: 500, fontSize: 11 }}>{lv.note}</span>}
              </span>
            ))}
          </div>

          {/* info banner */}
          <div className={styles.banner}>
            <Icon name="lock" size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--text-3)' }} />
            <span>
              <strong style={{ color: 'var(--text-2)' }}>Store</strong> is a locked level. Chain (CVS, Walgreens, Target) is a store <strong style={{ color: 'var(--text-2)' }}>attribute</strong> used for survey targeting, not a management level. Click any store name to see its details.
            </span>
          </div>

          {/* chain active banner */}
          {chain !== 'All' && (
            <div className={`${styles.banner} ${styles.chainBanner}`}>
              <Icon name="tag" size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }} />
              <span style={{ flex: 1 }}>Showing {chainCount} {chain} store{chainCount !== 1 ? 's' : ''} and their management path.</span>
              <Button size="sm" variant="ghost" onClick={() => setChain('All')}>Clear</Button>
            </div>
          )}

          {/* tree */}
          <Card className={styles.treeCard}>
            {isLoading && <div className={styles.emptyTree}>Loading org tree...</div>}
            {!isLoading && idx.roots.length === 0 && (
              <div className={styles.emptyTree}>No nodes found. The org tree will appear here once nodes are added.</div>
            )}
            {!isLoading && idx.roots.map(rootId => (
              <TreeNode
                key={rootId}
                id={rootId}
                idx={idx}
                levels={levels}
                expanded={effectiveExpanded}
                onToggle={toggle}
                onSelectStore={setSelectedStore}
                depth={0}
                keepIds={keepIds}
                editMode={editMode}
                onAddChild={openAddChild}
                onRename={openRename}
                onDelete={handleDelete}
              />
            ))}
          </Card>

        </div>
      </div>

      <StoreDetailModal
        open={selectedStore !== null}
        node={selectedStore}
        idx={idx}
        levels={levels}
        onClose={() => setSelectedStore(null)}
      />

      <NodeFormModal
        open={formState !== null}
        mode={formState?.mode ?? 'add'}
        node={formState?.node ?? null}
        levels={levels}
        onClose={() => setFormState(null)}
      />
    </>
  )
}
