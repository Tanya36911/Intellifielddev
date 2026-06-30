import { Modal } from '@intelli/ui'
import { chainColor, getAncestors, getLevelName, isLocked, levelColor, type OrgNode, type OrgLevel, type TreeIndex } from './useHierarchy'

export default function StoreDetailModal({
  open,
  node,
  idx,
  levels,
  onClose,
}: {
  open: boolean
  node: OrgNode | null
  idx: TreeIndex
  levels: OrgLevel[]
  onClose: () => void
}) {
  if (!node) return null

  const ancestors = getAncestors(node.id, idx)
  const allInPath = [...ancestors, node]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={node.name}
      subtitle="Store node: management position + attributes"
      width={460}
    >
      {/* management position */}
      <div style={{ marginBottom: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>Management position</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 20 }}>
        {allInPath.map((n, i) => {
          const locked = isLocked(n.level_order, levels)
          const levelName = getLevelName(n.level_order, levels)
          const color = levelColor(n.level_order, locked)
          const isStoreSelf = n.id === node.id
          return (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: i * 16, paddingTop: 4, paddingBottom: 4 }}>
              {i > 0 && (
                <span style={{ color: 'var(--text-4)', fontSize: 12, marginLeft: -16 }}>&#8595;</span>
              )}
              <span style={{ width: 7, height: 7, borderRadius: locked ? 2 : 99, background: color, flexShrink: 0, display: 'inline-block' }} />
              <span style={{ fontSize: 13, fontWeight: isStoreSelf || n.level_order <= 1 ? 600 : 500 }}>{n.name}</span>
              <span style={{ fontSize: 10, fontWeight: 600, border: '1px solid var(--border)', borderRadius: 'var(--r-full)', padding: '0 6px', height: 17, display: 'inline-flex', alignItems: 'center', color: 'var(--text-3)' }}>{levelName}</span>
            </div>
          )
        })}
      </div>

      {/* store attributes */}
      <div style={{ marginBottom: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>Store attributes</div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--border-faint)', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Chain</span>
          <span style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {node.chain && (
              <span style={{ width: 7, height: 7, borderRadius: 99, background: chainColor(node.chain), display: 'inline-block' }} />
            )}
            {node.chain ?? 'N/A'}
          </span>
        </div>
        <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--border-faint)', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Store ID</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{node.code}</span>
        </div>
        <div style={{ padding: '9px 14px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Address</span>
          <span style={{ fontSize: 13 }}>{node.address ?? 'N/A'}</span>
        </div>
      </div>

      {/* accent callout */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '11px 13px', background: 'var(--accent-subtle)', borderRadius: 'var(--r-md)' }}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
          Chain is a store attribute used for survey targeting and filtering. It is <strong>not a management level</strong>, so no one is pinned to a chain.
        </div>
      </div>
    </Modal>
  )
}
