import { Icon } from '../../ui'
import { getLevelName, isLocked, type OrgNode, type OrgLevel, type TreeIndex } from './useHierarchy'
import styles from './TreeNode.module.css'

// Level dot colours matching the mockup palette
const LEVEL_COLORS: Record<number, string> = {
  0: '#1B4F8A',
  1: '#0ea5e9',
  2: '#16a34a',
}
const STORE_COLOR = '#d97706'

function levelColor(level_order: number, locked: boolean): string {
  if (locked) return STORE_COLOR
  return LEVEL_COLORS[level_order] ?? '#71717a'
}

export default function TreeNode({
  id,
  idx,
  levels,
  expanded,
  onToggle,
  onSelectStore,
  depth,
  keepIds,
}: {
  id: string
  idx: TreeIndex
  levels: OrgLevel[]
  expanded: Record<string, boolean>
  onToggle: (id: string) => void
  onSelectStore: (node: OrgNode) => void
  depth: number
  keepIds: Set<string> | null
}) {
  const node = idx.byId[id]
  if (!node) return null

  // When a filter is active and this node is not in the keep set, hide it
  if (keepIds !== null && !keepIds.has(id)) return null

  const rawKids = idx.children[id] ?? []
  // Only show kids that are in the keep set (when filter active)
  const kids = keepIds !== null ? rawKids.filter(k => keepIds.has(k)) : rawKids

  const isOpen = expanded[id] ?? false
  const locked = isLocked(node.level_order, levels)
  const levelName = getLevelName(node.level_order, levels)
  const isStore = locked
  const color = levelColor(node.level_order, locked)
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
          className={`${styles.lvDot}${locked ? ` ${styles.lvDotSquare}` : ''}`}
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
        />
      ))}
    </div>
  )
}
