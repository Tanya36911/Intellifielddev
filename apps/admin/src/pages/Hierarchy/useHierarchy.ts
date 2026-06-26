import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiSend } from '../../lib/api'

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

// The store level is the DEEPEST level (highest level_order), not just any
// "locked" level. Both the Company root and the Store level are locked, so
// detecting a store by `locked` would wrongly treat the root as a store (which
// would hide its add-child action and show store fields when renaming it).
export function isBottomLevel(level_order: number, levels: OrgLevel[]): boolean {
  if (levels.length === 0) return false
  const max = Math.max(...levels.map(l => l.level_order))
  return level_order === max
}

/**
 * The level name of the child you would add under a parent at the given level
 * order (parent level + 1). Used for the "New <Level> under <Parent>" label.
 * Falls back to a generic "Level N" name when the child level is unknown.
 */
export function levelChildName(parentLevelOrder: number, levels: OrgLevel[]): string {
  return getLevelName(parentLevelOrder + 1, levels)
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

// --- colour helpers ---

const LEVEL_COLORS: Record<number, string> = {
  0: '#1B4F8A',
  1: '#0ea5e9',
  2: '#16a34a',
}
const STORE_COLOR = '#d97706'

/** Returns the dot colour for a node given its level order and locked status. */
export function levelColor(level_order: number, locked: boolean): string {
  if (locked) return STORE_COLOR
  return LEVEL_COLORS[level_order] ?? '#71717a'
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

// --- edit mutations (admin only; the backend is the real guard) ---

// Shared attributes a node can carry. Chain and address only apply to stores
// (the locked bottom level); the others are accepted by the backend for any node.
export type NodeAttrs = {
  chain?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
  tz?: string | null
}

// Add a child node. The backend derives the new level (parent + 1) and the code.
export type CreateNodeInput = { parent_id: string; name: string } & NodeAttrs
// Rename / re-attribute a node. No parent, level, or code edits.
export type UpdateNodeInput = { name?: string } & NodeAttrs

export function useCreateNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateNodeInput) => apiSend<OrgNode>('POST', '/nodes', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nodes'] }),
  })
}

export function useUpdateNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateNodeInput }) =>
      apiSend<OrgNode>('PATCH', `/nodes/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nodes'] }),
  })
}

export function useDeleteNode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: true }>(`/nodes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nodes'] }),
  })
}
