import { getLevelName, type OrgLevel, type OrgNode } from '../Hierarchy/useHierarchy'

export type PinOption = { id: string; label: string; levelName: string }

// Path-ordered, indented by level so the <select> reads like an org tree.
export function pinOptions(nodes: OrgNode[], levels: OrgLevel[]): PinOption[] {
  return [...nodes]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((n) => {
      const levelName = getLevelName(n.level_order, levels)
      const indent = ' '.repeat(n.level_order)
      return { id: n.id, label: `${indent}${n.name}`, levelName }
    })
}
