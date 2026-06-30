import { Chip, Icon } from '@intelli/ui'
import {
  chainColor,
  getLevelName,
  isBottomLevel,
  isLocked,
  levelColor,
  type Coverage,
  type OrgNode,
  type OrgLevel,
  type TreeIndex,
} from './useHierarchy'
import styles from './TreeNode.module.css'

export default function TreeNode({
  id,
  idx,
  levels,
  expanded,
  onToggle,
  onSelectStore,
  depth,
  keepIds,
  editMode = false,
  onAddChild,
  onRename,
  onDelete,
  coverage = false,
  cov = null,
}: {
  id: string
  idx: TreeIndex
  levels: OrgLevel[]
  expanded: Record<string, boolean>
  onToggle: (id: string) => void
  onSelectStore: (node: OrgNode) => void
  depth: number
  keepIds: Set<string> | null
  // Edit-mode props (admin only). When editMode is off these are unused and the
  // row renders exactly as the read-only version.
  editMode?: boolean
  onAddChild?: (parent: OrgNode) => void
  onRename?: (node: OrgNode) => void
  onDelete?: (node: OrgNode) => void
  // Coverage mode (read-only): hides chain/code/count and shows manager/rep chips.
  coverage?: boolean
  cov?: Coverage | null
}) {
  const node = idx.byId[id]
  if (!node) return null

  // When a filter is active and this node is not in the keep set, hide it
  if (keepIds !== null && !keepIds.has(id)) return null

  const rawKids = idx.children[id] ?? []
  // Only show kids that are in the keep set (when filter active)
  const kids = keepIds !== null ? rawKids.filter(k => keepIds.has(k)) : rawKids

  const isOpen = expanded[id] ?? false
  // A store is the deepest level, not any locked level (the Company root is also
  // locked). This drives the store-link, the square dot, and the add-child gate.
  const isStore = isBottomLevel(node.level_order, levels)
  const locked = isLocked(node.level_order, levels)
  // The company root cannot be renamed or deleted here (the company name lives in
  // Settings; the root can never be removed). A store IS editable (its name, chain
  // and address) by design, so only the root hides the rename/delete actions.
  const isRoot = node.parent_id === null
  const levelName = getLevelName(node.level_order, levels)
  const color = levelColor(node.level_order, isStore)
  const isBold = node.level_order <= 1

  return (
    <div>
      <div
        className={styles.row}
        style={{ paddingLeft: depth * 22 + 6 }}
      >
        {/* expand/collapse toggle or leaf dot */}
        {rawKids.length > 0 ? (
          <button
            type="button"
            className={styles.toggleBtn}
            onClick={() => onToggle(id)}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            <Icon name={isOpen ? 'chevD' : 'chevR'} size={14} />
          </button>
        ) : (
          <div className={styles.toggleWrap}>
            <span className={styles.leafDot} />
          </div>
        )}

        {/* level colour dot */}
        <span
          className={`${styles.lvDot}${isStore ? ` ${styles.lvDotSquare}` : ''}`}
          style={{ background: color }}
        />

        {/* node name: store is a clickable button, others are a span */}
        {isStore ? (
          <button
            type="button"
            className={styles.storeBtn}
            onClick={() => onSelectStore(node)}
            title="Store details"
          >
            {node.name}
          </button>
        ) : (
          <span className={`${styles.name}${isBold ? ` ${styles.nameBold}` : ''}`}>
            {node.name}
          </span>
        )}

        {/* level label chip */}
        <span className={styles.levelLabel}>{levelName}</span>

        {/* lock icon on a locked-level row (Company root and Store) */}
        {locked && (
          <Icon name="lock" size={12} style={{ color: 'var(--text-4)', flexShrink: 0 }} />
        )}

        {/* structure view: chain badge (with retailer colour dot), code, child count */}
        {!coverage && (
          <>
            {isStore && node.chain && (
              <span className={styles.chainBadge}>
                <span className={styles.chainDot} style={{ background: chainColor(node.chain) }} />
                {node.chain}
              </span>
            )}
            {node.code && <span className={styles.code}>{node.code}</span>}
            {!isStore && rawKids.length > 0 && (
              <span className={styles.childCount}>{rawKids.length}</span>
            )}
          </>
        )}

        {/* coverage view: who manages / staffs this node */}
        {coverage && cov && (
          <span className={styles.coverage}>
            {cov.managerByNode[node.id] && (
              <Chip tone="blue">
                <Icon name="pin" size={10} /> {cov.managerByNode[node.id].name}
              </Chip>
            )}
            {(node.level_order === 1 || node.level_order === 2) &&
              ((cov.repCountByNode[node.id] ?? 0) > 0 ? (
                <Chip tone="green" dot>
                  {cov.repCountByNode[node.id]} {cov.repCountByNode[node.id] === 1 ? 'rep' : 'reps'}
                </Chip>
              ) : (
                <Chip tone="amber">No reps yet</Chip>
              ))}
          </span>
        )}

        {/* edit-mode row actions (admin only). A store is a leaf, so it gets no
            add-child button. The backend remains the real guard. */}
        {editMode && (
          <span className={styles.actions}>
            {!isStore && (
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => onAddChild?.(node)}
                aria-label={`Add child under ${node.name}`}
                title="Add child"
              >
                <Icon name="plus" size={13} />
              </button>
            )}
            {!isRoot && (
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => onRename?.(node)}
                aria-label={`Rename ${node.name}`}
                title="Rename"
              >
                <Icon name="edit" size={13} />
              </button>
            )}
            {!isRoot && (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.actionDanger}`}
                onClick={() => onDelete?.(node)}
                aria-label={`Delete ${node.name}`}
                title="Delete"
              >
                <Icon name="trash" size={13} />
              </button>
            )}
          </span>
        )}
      </div>

      {/* render children when expanded */}
      {isOpen && kids.map(kidId => (
        <TreeNode
          key={kidId}
          id={kidId}
          idx={idx}
          levels={levels}
          expanded={expanded}
          onToggle={onToggle}
          onSelectStore={onSelectStore}
          depth={depth + 1}
          keepIds={keepIds}
          editMode={editMode}
          onAddChild={onAddChild}
          onRename={onRename}
          onDelete={onDelete}
          coverage={coverage}
          cov={cov}
        />
      ))}
    </div>
  )
}
