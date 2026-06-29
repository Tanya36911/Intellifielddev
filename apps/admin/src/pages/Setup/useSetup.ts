import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiSend } from '@intelli/api-client'
import type { OrgLevel, OrgNode } from '../Hierarchy/useHierarchy'

// Turn the company's real saved levels into the wizard's editable draft shape,
// ordered by level_order, carrying their saved locked flags. Used to seed step 2
// for a company that already has org levels (so it sees its actual names, not a
// template's placeholder names).
export function savedLevelsToDraft(levels: OrgLevel[]): DraftLevel[] {
  return [...levels]
    .sort((a, b) => a.level_order - b.level_order)
    .map((l) => ({ name: l.name, locked: l.locked }))
}

// A draft level the wizard edits in step 2. `locked` marks the top (Company) and
// bottom (Store) levels, which can be renamed but never removed or reordered.
export type DraftLevel = { name: string; locked: boolean }

// A starting structure offered in step 1. `levels` is the ordered list of level
// names (first = company root, last = the store/bottom level). Picking one
// pre-fills step 2's editable list; nothing is saved until step 2 Continue.
export type Template = {
  id: string
  name: string
  desc: string
  tag?: string
  levels: string[]
}

// A few common shapes. The first and last name in each list become locked
// levels in step 2 (every company needs a top and a bottom).
export const TEMPLATES: Template[] = [
  {
    id: 'cpg4',
    name: 'Retail field team',
    desc: 'Company, regions, districts, and the stores reps visit.',
    tag: 'Common',
    levels: ['Company', 'Region', 'District', 'Store'],
  },
  {
    id: 'flat3',
    name: 'Simple region split',
    desc: 'One layer of regions sitting directly above the stores.',
    levels: ['Company', 'Region', 'Store'],
  },
  {
    id: 'deep5',
    name: 'Large multi-tier org',
    desc: 'An extra division layer for big national footprints.',
    levels: ['Company', 'Division', 'Region', 'District', 'Store'],
  },
]

// --- pure helpers (unit-tested) ---

// Turn an ordered list of level names into draft levels, locking the first and
// last (the top and the bottom). A single-name list locks that one entry.
export function templateToDraftLevels(names: string[]): DraftLevel[] {
  return names.map((name, i) => ({
    name,
    locked: i === 0 || i === names.length - 1,
  }))
}

// Rename the level at `i`. (Locked levels can still be renamed, just not moved
// or removed, so this does not check `locked`.)
export function renameLevel(levels: DraftLevel[], i: number, name: string): DraftLevel[] {
  return levels.map((l, j) => (j === i ? { ...l, name } : l))
}

// Insert a new middle level just after index `i`. The new level is unlocked.
// Refuses to add past the cap (7) so the list stays within the backend's range.
export function addLevelAfter(levels: DraftLevel[], i: number): DraftLevel[] {
  if (levels.length >= 7) return levels
  const next = [...levels]
  next.splice(i + 1, 0, { name: 'New level', locked: false })
  return next
}

// Remove a middle level. The first and last (locked) levels can never be
// removed, and the list never drops below 2 entries (a top and a bottom).
export function removeLevel(levels: DraftLevel[], i: number): DraftLevel[] {
  if (levels.length <= 2) return levels
  if (i <= 0 || i >= levels.length - 1) return levels
  return levels.filter((_, j) => j !== i)
}

// Move a middle level up (dir -1) or down (dir +1), keeping it strictly between
// the locked top and bottom. Out-of-range moves are no-ops.
export function moveLevel(levels: DraftLevel[], i: number, dir: -1 | 1): DraftLevel[] {
  const j = i + dir
  // Both i and its target must be middle slots (1 .. length-2).
  if (i <= 0 || i >= levels.length - 1) return levels
  if (j <= 0 || j >= levels.length - 1) return levels
  const next = [...levels]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

// Structural editing (add / remove / reorder) is only allowed while the company
// is empty, meaning no real nodes exist below the root. Once stores exist the
// backend refuses a re-map, so the wizard offers rename-only. A lone root (or no
// nodes at all) still counts as empty.
export function structuralEditingAllowed(nodes: OrgNode[]): boolean {
  return nodes.every((n) => n.parent_id === null)
}

// The body PUT /org-levels expects: just the ordered names.
export function draftLevelsToNames(levels: DraftLevel[]): string[] {
  return levels.map((l) => l.name.trim())
}

// --- mutation ---

export type SetOrgLevelsResult = { levels: OrgLevel[]; count: number }

// Save the level structure. Invalidates both org-levels (the names) and nodes
// (a fresh-company save can change what add-child labels say).
export function useSetOrgLevels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (levels: string[]) =>
      apiSend<SetOrgLevelsResult>('PUT', '/org-levels', { levels }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-levels'] })
      qc.invalidateQueries({ queryKey: ['nodes'] })
    },
  })
}
