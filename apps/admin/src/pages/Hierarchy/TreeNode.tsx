import { Icon } from '@intelli/ui'
import { getLevelName, isBottomLevel, levelColor, type OrgNode, type OrgLevel, type TreeIndex } from './useHierarchy'
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

        {/* chain badge on stores */}
        {isStore && node.chain && (
          <span className={styles.chainBadge}>{node.chain}</span>
        )}

        {/* store code in mono */}
        {node.code && (
          <span className={styles.code}>{node.code}</span>
        )}

        {/* child count on non-store rows */}
        {!isStore && rawKids.length > 0 && (
          <span className={styles.childCount}>{rawKids.length}</span>
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
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => onRename?.(node)}
              aria-label={`Rename ${node.name}`}
              title="Rename"
            >
              <Icon name="edit" size={13} />
            </button>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionDanger}`}
              onClick={() => onDelete?.(node)}
              aria-label={`Delete ${node.name}`}
              title="Delete"
            >
              <Icon name="trash" size={13} />
            </button>
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
        />
      ))}
    </div>
  )
}
