import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/api'

// --- types ---

export type OrgNode = {
  id: string
  name: string
  code: string
  level_order: number
  parent_id: string | null
  path: string
  chain: string | null
  address: string | null
  lat: number | null
  lng: number | null
  tz: string | null
}

export type OrgLevel = {
  level_order: number
  name: string
  locked: boolean
}

export type TreeIndex = {
  byId: Record<string, OrgNode>
  children: Record<string, string[]>
  roots: string[]
}

// --- pure helpers ---

export function buildTreeIndex(nodes: OrgNode[]): TreeIndex {
  const byId: Record<string, OrgNode> = {}
  const children: Record<string, string[]> = {}

  for (const n of nodes) {
    byId[n.id] = n
    children[n.id] = children[n.id] ?? []
  }
  for (const n of nodes) {
    if (n.parent_id !== null) {
      children[n.parent_id] = children[n.parent_id] ?? []
      children[n.parent_id].push(n.id)
    }
  }

  const roots = nodes.filter(n => n.parent_id === null).map(n => n.id)
  return { byId, children, roots }
}

export function getLevelName(level_order: number, levels: OrgLevel[]): string {
  const found = levels.find(l => l.level_order === level_order)
  return found ? found.name : `Level ${level_order}`
}

export function isLocked(level_order: number, levels: OrgLevel[]): boolean {
  const found = levels.find(l => l.level_order === level_order)
  return found ? found.locked : false
}

export function hierarchyStats(
  nodes: OrgNode[],
  levels: OrgLevel[],
): { levelCount: number; regionCount: number; districtCount: number; storeCount: number } {
  const lockedOrders = new Set(levels.filter(l => l.locked).map(l => l.level_order))
  return {
    levelCount: levels.length,
    regionCount: nodes.filter(n => n.level_order === 1).length,
    districtCount: nodes.filter(n => n.level_order === 2).length,
    storeCount: nodes.filter(n => lockedOrders.has(n.level_order)).length,
  }
}

export function getAncestors(nodeId: string, idx: TreeIndex): OrgNode[] {
  const ancestors: OrgNode[] = []
  const node = idx.byId[nodeId]
  if (!node) return ancestors
  let parentId = node.parent_id
  while (parentId !== null) {
    const parent = idx.byId[parentId]
    if (!parent) break
    ancestors.unshift(parent)
    parentId = parent.parent_id
  }
  return ancestors
}

export function filterNodes(nodes: OrgNode[], query: string, chain: string): Set<string> {
  const q = query.trim().toLowerCase()
  const filterChain = chain !== 'All'

  if (!q && !filterChain) {
    return new Set(nodes.map(n => n.id))
  }

  // Start with nodes that pass both filters
  const matching = nodes.filter(n => {
    const matchesQuery = !q || n.name.toLowerCase().includes(q) || n.code.toLowerCase().includes(q)
    const matchesChain = !filterChain || n.chain === chain
    return matchesQuery && matchesChain
  })

  // Build parent and children lookup maps
  const parentMap: Record<string, string | null> = {}
  const childMap: Record<string, string[]> = {}
  for (const n of nodes) {
    parentMap[n.id] = n.parent_id
    childMap[n.id] = childMap[n.id] ?? []
    if (n.parent_id !== null) {
      childMap[n.parent_id] = childMap[n.parent_id] ?? []
      childMap[n.parent_id].push(n.id)
    }
  }

  const keep = new Set<string>()

  // For each match: include it, all ancestors, and all descendants
  function addDescendants(id: string) {
    keep.add(id)
    for (const kid of childMap[id] ?? []) {
      addDescendants(kid)
    }
  }

  for (const n of matching) {
    // Add ancestors
    let p = n.parent_id
    while (p !== null) {
      keep.add(p)
      p = parentMap[p] ?? null
    }
    // Add node itself and all descendants
    addDescendants(n.id)
  }
  return keep
}

export function uniqueChains(nodes: OrgNode[]): string[] {
  const chains = new Set<string>()
  for (const n of nodes) {
    if (n.chain !== null) chains.add(n.chain)
  }
  return [...chains].sort()
}

// --- TanStack Query hook ---

export function useHierarchy() {
  const nodesQ = useQuery({
    queryKey: ['nodes'],
    queryFn: () => apiGet<{ nodes: OrgNode[] }>('/nodes'),
  })
  const levelsQ = useQuery({
    queryKey: ['org-levels'],
    queryFn: () => apiGet<{ levels: OrgLevel[]; count: number }>('/org-levels'),
  })

  const nodes = nodesQ.data?.nodes ?? []
  const levels = levelsQ.data?.levels ?? []

  return {
    nodes,
    levels,
    isLoading: nodesQ.isLoading || levelsQ.isLoading,
    isError: nodesQ.isError || levelsQ.isError,
  }
}
