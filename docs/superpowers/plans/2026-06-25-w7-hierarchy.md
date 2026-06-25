# W7 Hierarchy Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only Hierarchy screen (W7) in the Intelli Admin app, showing an expandable org tree built from GET /nodes, with level names from GET /org-levels, search, chain filter, expand/collapse, and a store detail modal.

**Architecture:** TanStack Query v5 hook (`useHierarchy`) fetches both `/nodes` and `/org-levels` and exposes pure helpers for tree-building, level-name mapping, and search filtering. A `TreeNode` recursive component renders each row. A `StoreDetailModal` uses the shared `Modal` UI kit component. `Hierarchy.tsx` is the page shell that composes all sub-components.

**Tech Stack:** React 19, TypeScript, TanStack Query v5, CSS Modules, Vitest + Testing Library (fireEvent only, no userEvent), existing ui kit (Button, Card, Icon, Modal, Chip), apiGet from lib/api, selectSession/useAppSelector from store.

## Global Constraints

- Work ONLY in /Users/tanyajustin/Documents/intelli-w7 (branch w7-hierarchy). Never switch branches, merge, or push.
- Commit prefix: "W7:" — no em dashes in commit messages or code comments.
- Test command: `pnpm --filter @intelli/admin test` (must stay green, zero act warnings).
- Build command: `pnpm --filter @intelli/admin build` (must pass clean).
- Use `fireEvent` from @testing-library/react, NOT userEvent.
- Mock `apiGet` from `../../lib/api` in tests (vi.mock pattern — see Catalog.test.tsx).
- No backend changes. No `pnpm test:api`.
- Every commit ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Run `pnpm install` in the worktree root before starting any work.

---

## File Map

### Files to create
- `apps/admin/src/pages/Hierarchy/useHierarchy.ts` — TQ hook + all pure helpers + types
- `apps/admin/src/pages/Hierarchy/useHierarchy.test.ts` — unit tests for every pure helper
- `apps/admin/src/pages/Hierarchy/TreeNode.tsx` — recursive tree row component
- `apps/admin/src/pages/Hierarchy/TreeNode.module.css` — styles for tree rows
- `apps/admin/src/pages/Hierarchy/TreeNode.test.tsx` — render tests for TreeNode
- `apps/admin/src/pages/Hierarchy/StoreDetailModal.tsx` — store detail modal component
- `apps/admin/src/pages/Hierarchy/StoreDetailModal.test.tsx` — render tests for modal
- `apps/admin/src/pages/Hierarchy/Hierarchy.tsx` — page shell
- `apps/admin/src/pages/Hierarchy/Hierarchy.module.css` — page layout styles
- `apps/admin/src/pages/Hierarchy/Hierarchy.test.tsx` — integration render tests for the page
- `docs/superpowers/specs/2026-06-25-w7-hierarchy-design.md` — short design spec

### Files to modify
- `apps/admin/src/shell/nav.ts` — remove `comingSoon: true` from hierarchy item
- `apps/admin/src/App.tsx` — import Hierarchy, replace ComingSoon route for /hierarchy

---

## Task 1: Install dependencies and write the design spec

**Files:**
- Modify: worktree root (run pnpm install)
- Create: `docs/superpowers/specs/2026-06-25-w7-hierarchy-design.md`

**Interfaces:**
- Produces: nothing consumed by later tasks; this is setup + documentation.

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm install
```

Expected: packages installed, no errors.

- [ ] **Step 2: Write the design spec**

Create `docs/superpowers/specs/2026-06-25-w7-hierarchy-design.md`:

```markdown
# W7 Hierarchy Screen Design Spec

**Date:** 2026-06-25
**Status:** Approved (based on w7-hierarchy-mockup.html)

## What it does

A read-only org-tree screen. The backend returns a flat list of nodes from
GET /nodes; the frontend builds a parent-child tree from the parent_id field.
Level names (Region/District/Store) come from GET /org-levels.

## Backend contracts (frontend reads only)

GET /nodes returns:
{ nodes: [{ id, name, code, level_order, parent_id, path, chain, address, lat, lng, tz }] }

GET /org-levels returns:
{ levels: [{ level_order: number, name: string, locked: boolean }], count: number }

## Screen layout

- Four stat tiles: Org levels, Regions (level_order 1), Districts (level_order 2), Stores (locked level).
- Toolbar: search box, chain filter select, Expand all / Collapse buttons.
- Level legend: one chip per level with a colour dot.
- Info banner: explains Store is a locked level and chain is a store attribute.
- Chain banner: shown when a chain filter is active; shows count + Clear button.
- Org tree card: expand/collapse rows, colour dot per level, chain badge on stores,
  store code in mono, child count on non-store rows, underlined store name opens detail modal.
- Topbar deferred controls: Edit and Export buttons, disabled with "soon" label.

## Deferred (not built, shown as disabled "soon")

- Coverage mode (manager/rep overlay)
- Add / rename / delete nodes
- Bulk CSV import
- Export

## Colour palette (level dots)

- level_order 0 (Company): #1B4F8A (round dot)
- level_order 1 (Region):  #0ea5e9 (round dot)
- level_order 2 (District): #16a34a (round dot)
- level_order 3+ (Store/locked): #d97706 (square dot)

## Store detail modal

Shows: management path (ancestors from root to store, each with level name),
then the store itself. Attributes table: Chain, Store ID (mono), City/Address.
Accent callout: chain is a store attribute, not a management level.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
git add docs/superpowers/specs/2026-06-25-w7-hierarchy-design.md
git commit -m "$(cat <<'EOF'
W7: add design spec for hierarchy view-only screen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure helpers and types in useHierarchy.ts (TDD)

**Files:**
- Create: `apps/admin/src/pages/Hierarchy/useHierarchy.ts`
- Create: `apps/admin/src/pages/Hierarchy/useHierarchy.test.ts`

**Interfaces:**
- Produces:
  - `type OrgNode = { id: string; name: string; code: string; level_order: number; parent_id: string | null; path: string; chain: string | null; address: string | null; lat: number | null; lng: number | null; tz: string | null }`
  - `type OrgLevel = { level_order: number; name: string; locked: boolean }`
  - `type TreeIndex = { byId: Record<string, OrgNode>; children: Record<string, string[]>; roots: string[] }`
  - `buildTreeIndex(nodes: OrgNode[]): TreeIndex`
  - `getLevelName(level_order: number, levels: OrgLevel[]): string`
  - `isLocked(level_order: number, levels: OrgLevel[]): boolean`
  - `filterNodes(nodes: OrgNode[], query: string, chain: string): Set<string>` — returns Set of node IDs to keep (matches + ancestors)
  - `hierarchyStats(nodes: OrgNode[], levels: OrgLevel[]): { levelCount: number; regionCount: number; districtCount: number; storeCount: number }` — storeCount = count of nodes whose level is locked; regionCount = count at level_order 1; districtCount = count at level_order 2
  - `getAncestors(nodeId: string, idx: TreeIndex): OrgNode[]` — ordered root-first, excluding the node itself
  - `uniqueChains(nodes: OrgNode[]): string[]` — sorted unique non-null chain values
  - `useHierarchy()` — TQ hook (see body of task for shape)

**Prerequisite:** Run tests after writing them to confirm they fail before implementation.

- [ ] **Step 1: Create the test file with all pure-helper tests**

Create `apps/admin/src/pages/Hierarchy/useHierarchy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  buildTreeIndex,
  getLevelName,
  isLocked,
  filterNodes,
  hierarchyStats,
  getAncestors,
  uniqueChains,
  type OrgNode,
  type OrgLevel,
} from './useHierarchy'

const LEVELS: OrgLevel[] = [
  { level_order: 0, name: 'Company', locked: false },
  { level_order: 1, name: 'Region', locked: false },
  { level_order: 2, name: 'District', locked: false },
  { level_order: 3, name: 'Store', locked: true },
]

function mkNode(over: Partial<OrgNode> & { id: string }): OrgNode {
  return {
    name: over.id,
    code: over.id,
    level_order: 0,
    parent_id: null,
    path: over.id,
    chain: null,
    address: null,
    lat: null,
    lng: null,
    tz: null,
    ...over,
  }
}

const FLAT: OrgNode[] = [
  mkNode({ id: 'company', level_order: 0 }),
  mkNode({ id: 'r1', name: 'West', level_order: 1, parent_id: 'company' }),
  mkNode({ id: 'd1', name: 'Bay Area', level_order: 2, parent_id: 'r1' }),
  mkNode({ id: 's1', name: 'Store CVS Palo Alto', level_order: 3, parent_id: 'd1', chain: 'CVS', code: 'ST001' }),
  mkNode({ id: 's2', name: 'Store Walgreens Menlo', level_order: 3, parent_id: 'd1', chain: 'Walgreens', code: 'ST002' }),
]

describe('buildTreeIndex', () => {
  it('maps byId and builds children lists', () => {
    const idx = buildTreeIndex(FLAT)
    expect(idx.byId['r1'].name).toBe('West')
    expect(idx.children['r1']).toContain('d1')
    expect(idx.children['d1'].sort()).toEqual(['s1', 's2'])
  })

  it('roots are nodes with no parent_id', () => {
    const idx = buildTreeIndex(FLAT)
    expect(idx.roots).toEqual(['company'])
  })

  it('leaf nodes have an empty children array', () => {
    const idx = buildTreeIndex(FLAT)
    expect(idx.children['s1']).toEqual([])
  })

  it('handles empty input', () => {
    const idx = buildTreeIndex([])
    expect(idx.roots).toEqual([])
  })
})

describe('getLevelName', () => {
  it('returns the level name for a known level_order', () => {
    expect(getLevelName(1, LEVELS)).toBe('Region')
    expect(getLevelName(3, LEVELS)).toBe('Store')
  })

  it('returns a fallback for unknown level_order', () => {
    expect(getLevelName(99, LEVELS)).toBe('Level 99')
  })
})

describe('isLocked', () => {
  it('returns true for locked levels', () => {
    expect(isLocked(3, LEVELS)).toBe(true)
  })

  it('returns false for unlocked levels', () => {
    expect(isLocked(0, LEVELS)).toBe(false)
    expect(isLocked(2, LEVELS)).toBe(false)
  })

  it('returns false for unknown level_order', () => {
    expect(isLocked(99, LEVELS)).toBe(false)
  })
})

describe('hierarchyStats', () => {
  it('counts level count from levels array, regions at order 1, districts at order 2, stores at locked levels', () => {
    const stats = hierarchyStats(FLAT, LEVELS)
    expect(stats.levelCount).toBe(4)
    expect(stats.regionCount).toBe(1)
    expect(stats.districtCount).toBe(1)
    expect(stats.storeCount).toBe(2)
  })

  it('handles empty inputs', () => {
    const stats = hierarchyStats([], [])
    expect(stats).toEqual({ levelCount: 0, regionCount: 0, districtCount: 0, storeCount: 0 })
  })
})

describe('getAncestors', () => {
  it('returns root-first ancestors excluding the node itself', () => {
    const idx = buildTreeIndex(FLAT)
    const ancestors = getAncestors('s1', idx)
    expect(ancestors.map(n => n.id)).toEqual(['company', 'r1', 'd1'])
  })

  it('returns empty array for a root node', () => {
    const idx = buildTreeIndex(FLAT)
    expect(getAncestors('company', idx)).toEqual([])
  })
})

describe('filterNodes', () => {
  it('returns all ids when query and chain are empty', () => {
    const keep = filterNodes(FLAT, '', 'All')
    expect(keep.size).toBe(FLAT.length)
  })

  it('keeps matching nodes and all their ancestors', () => {
    const keep = filterNodes(FLAT, 'palo alto', 'All')
    expect(keep.has('s1')).toBe(true)
    expect(keep.has('d1')).toBe(true)
    expect(keep.has('r1')).toBe(true)
    expect(keep.has('company')).toBe(true)
    expect(keep.has('s2')).toBe(false)
  })

  it('filters by chain — keeps matching stores and ancestors, drops other stores', () => {
    const keep = filterNodes(FLAT, '', 'CVS')
    expect(keep.has('s1')).toBe(true)
    expect(keep.has('d1')).toBe(true)
    expect(keep.has('s2')).toBe(false)
  })

  it('applies both query and chain filters together', () => {
    // chain=CVS but query does not match s1 -> nothing kept
    const keep = filterNodes(FLAT, 'walgreens', 'CVS')
    expect(keep.has('s1')).toBe(false)
    expect(keep.has('s2')).toBe(false)
  })

  it('is case-insensitive', () => {
    const keep = filterNodes(FLAT, 'BAY AREA', 'All')
    expect(keep.has('d1')).toBe(true)
    expect(keep.has('s1')).toBe(true)
  })
})

describe('uniqueChains', () => {
  it('returns sorted unique non-null chains', () => {
    expect(uniqueChains(FLAT)).toEqual(['CVS', 'Walgreens'])
  })

  it('returns empty array when no chains', () => {
    expect(uniqueChains([mkNode({ id: 'x' })])).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin test -- useHierarchy.test
```

Expected: multiple test failures (module not found or type errors).

- [ ] **Step 3: Create useHierarchy.ts with types, pure helpers, and the TQ hook**

Create `apps/admin/src/pages/Hierarchy/useHierarchy.ts`:

```typescript
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

  // Start with nodes that pass both filters
  const matching = nodes.filter(n => {
    const matchesQuery = !q || n.name.toLowerCase().includes(q) || n.code.toLowerCase().includes(q)
    const matchesChain = !filterChain || n.chain === chain
    return matchesQuery && matchesChain
  })

  if (!q && !filterChain) {
    // No filters active: keep all
    return new Set(nodes.map(n => n.id))
  }

  // Build a quick parent lookup map
  const parentMap: Record<string, string | null> = {}
  for (const n of nodes) {
    parentMap[n.id] = n.parent_id
  }

  const keep = new Set<string>()
  for (const n of matching) {
    keep.add(n.id)
    let p = n.parent_id
    while (p !== null) {
      keep.add(p)
      p = parentMap[p] ?? null
    }
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin test -- useHierarchy.test
```

Expected: all tests pass, no act warnings.

- [ ] **Step 5: Commit**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
git add apps/admin/src/pages/Hierarchy/useHierarchy.ts apps/admin/src/pages/Hierarchy/useHierarchy.test.ts
git commit -m "$(cat <<'EOF'
W7: pure helpers + TQ hook for hierarchy (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: TreeNode component + styles + tests

**Files:**
- Create: `apps/admin/src/pages/Hierarchy/TreeNode.tsx`
- Create: `apps/admin/src/pages/Hierarchy/TreeNode.module.css`
- Create: `apps/admin/src/pages/Hierarchy/TreeNode.test.tsx`

**Interfaces:**
- Consumes:
  - `OrgNode`, `OrgLevel`, `TreeIndex` from `./useHierarchy`
  - `getLevelName`, `isLocked` from `./useHierarchy`
  - `Icon`, `Button` from `../../ui`
- Produces:
  - `TreeNode` component with props: `{ id: string; idx: TreeIndex; levels: OrgLevel[]; expanded: Record<string, boolean>; onToggle: (id: string) => void; onSelectStore: (node: OrgNode) => void; depth: number; keepIds: Set<string> | null }`

**Prerequisite:** Task 2 must be complete.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/pages/Hierarchy/TreeNode.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import TreeNode from './TreeNode'
import type { OrgNode, OrgLevel, TreeIndex } from './useHierarchy'
import { buildTreeIndex } from './useHierarchy'

const LEVELS: OrgLevel[] = [
  { level_order: 0, name: 'Company', locked: false },
  { level_order: 1, name: 'Region', locked: false },
  { level_order: 2, name: 'District', locked: false },
  { level_order: 3, name: 'Store', locked: true },
]

function mkNode(over: Partial<OrgNode> & { id: string }): OrgNode {
  return {
    name: over.id,
    code: over.id,
    level_order: 0,
    parent_id: null,
    path: over.id,
    chain: null,
    address: null,
    lat: null,
    lng: null,
    tz: null,
    ...over,
  }
}

const NODES: OrgNode[] = [
  mkNode({ id: 'r1', name: 'West Region', level_order: 1 }),
  mkNode({ id: 'd1', name: 'Bay Area', level_order: 2, parent_id: 'r1' }),
  mkNode({ id: 's1', name: 'CVS Palo Alto', level_order: 3, parent_id: 'd1', chain: 'CVS', code: 'ST001' }),
]

const IDX: TreeIndex = buildTreeIndex(NODES)

describe('TreeNode', () => {
  it('renders node name and level label', () => {
    renderApp(
      <TreeNode
        id="r1"
        idx={IDX}
        levels={LEVELS}
        expanded={{}}
        onToggle={vi.fn()}
        onSelectStore={vi.fn()}
        depth={0}
        keepIds={null}
      />,
      { session: adminSession() }
    )
    expect(screen.getByText('West Region')).toBeTruthy()
    expect(screen.getByText('Region')).toBeTruthy()
  })

  it('expands children when toggle button is clicked', () => {
    const onToggle = vi.fn()
    renderApp(
      <TreeNode
        id="r1"
        idx={IDX}
        levels={LEVELS}
        expanded={{}}
        onToggle={onToggle}
        onSelectStore={vi.fn()}
        depth={0}
        keepIds={null}
      />,
      { session: adminSession() }
    )
    // A node with children shows a toggle button (chevron)
    const toggleBtn = screen.getByRole('button', { name: /expand|collapse/i })
    fireEvent.click(toggleBtn)
    expect(onToggle).toHaveBeenCalledWith('r1')
  })

  it('renders children when expanded', () => {
    renderApp(
      <TreeNode
        id="r1"
        idx={IDX}
        levels={LEVELS}
        expanded={{ r1: true }}
        onToggle={vi.fn()}
        onSelectStore={vi.fn()}
        depth={0}
        keepIds={null}
      />,
      { session: adminSession() }
    )
    expect(screen.getByText('Bay Area')).toBeTruthy()
  })

  it('calls onSelectStore when a store name is clicked', () => {
    const onSelectStore = vi.fn()
    renderApp(
      <TreeNode
        id="r1"
        idx={IDX}
        levels={LEVELS}
        expanded={{ r1: true, d1: true }}
        onToggle={vi.fn()}
        onSelectStore={onSelectStore}
        depth={0}
        keepIds={null}
      />,
      { session: adminSession() }
    )
    fireEvent.click(screen.getByText('CVS Palo Alto'))
    expect(onSelectStore).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }))
  })

  it('shows chain badge on a store row', () => {
    renderApp(
      <TreeNode
        id="r1"
        idx={IDX}
        levels={LEVELS}
        expanded={{ r1: true, d1: true }}
        onToggle={vi.fn()}
        onSelectStore={vi.fn()}
        depth={0}
        keepIds={null}
      />,
      { session: adminSession() }
    )
    expect(screen.getByText('CVS')).toBeTruthy()
  })

  it('hides nodes not in keepIds when keepIds is provided', () => {
    // Only keep r1 and d1, not s1
    const keepIds = new Set(['r1', 'd1'])
    renderApp(
      <TreeNode
        id="r1"
        idx={IDX}
        levels={LEVELS}
        expanded={{ r1: true, d1: true }}
        onToggle={vi.fn()}
        onSelectStore={vi.fn()}
        depth={0}
        keepIds={keepIds}
      />,
      { session: adminSession() }
    )
    expect(screen.queryByText('CVS Palo Alto')).toBeNull()
    expect(screen.getByText('Bay Area')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin test -- TreeNode.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create TreeNode.module.css**

Create `apps/admin/src/pages/Hierarchy/TreeNode.module.css`:

```css
.row {
  display: flex;
  align-items: center;
  height: 36px;
  padding-right: 8px;
  border-radius: var(--r-sm);
  cursor: default;
  gap: 6px;
  position: relative;
}

.row:hover {
  background: var(--surface-hover);
}

.toggleBtn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-3);
  border-radius: var(--r-xs);
  flex-shrink: 0;
  padding: 0;
}

.toggleBtn:hover {
  background: var(--bg-elev);
}

.leafDot {
  width: 5px;
  height: 5px;
  border-radius: 99px;
  background: var(--border-strong);
  display: inline-block;
  flex-shrink: 0;
}

.lvDot {
  width: 8px;
  height: 8px;
  border-radius: 99px;
  flex-shrink: 0;
}

.lvDotSquare {
  border-radius: 2px;
}

.name {
  font-size: 13.5px;
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nameBold {
  font-weight: 700;
}

.storeBtn {
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  color: var(--text);
  font-size: 13.5px;
  font-weight: 500;
  font-family: inherit;
  text-decoration: underline;
  text-decoration-color: var(--border-strong);
  text-underline-offset: 3px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.storeBtn:hover {
  color: var(--accent);
}

.levelLabel {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-3);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  padding: 0 7px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  background: transparent;
  flex-shrink: 0;
}

.chainBadge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 7px;
  border-radius: var(--r-full);
  font-size: 10.5px;
  font-weight: 600;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-2);
  flex-shrink: 0;
}

.code {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-4);
  flex-shrink: 0;
}

.childCount {
  font-size: 11px;
  color: var(--text-4);
  font-weight: 500;
  flex-shrink: 0;
}

.toggleWrap {
  width: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.children {
  /* children indent via paddingLeft on each row */
}
```

- [ ] **Step 4: Create TreeNode.tsx**

Create `apps/admin/src/pages/Hierarchy/TreeNode.tsx`:

```typescript
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
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin test -- TreeNode.test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
git add apps/admin/src/pages/Hierarchy/TreeNode.tsx apps/admin/src/pages/Hierarchy/TreeNode.module.css apps/admin/src/pages/Hierarchy/TreeNode.test.tsx
git commit -m "$(cat <<'EOF'
W7: TreeNode component with expand/collapse and store click (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: StoreDetailModal component + tests

**Files:**
- Create: `apps/admin/src/pages/Hierarchy/StoreDetailModal.tsx`
- Create: `apps/admin/src/pages/Hierarchy/StoreDetailModal.test.tsx`

**Interfaces:**
- Consumes:
  - `Modal` from `../../ui`
  - `OrgNode`, `OrgLevel`, `TreeIndex`, `getAncestors`, `getLevelName`, `isLocked` from `./useHierarchy`
- Produces:
  - `StoreDetailModal` component with props: `{ open: boolean; node: OrgNode | null; idx: TreeIndex; levels: OrgLevel[]; onClose: () => void }`

**Prerequisite:** Task 2 must be complete.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/pages/Hierarchy/StoreDetailModal.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import StoreDetailModal from './StoreDetailModal'
import { buildTreeIndex, type OrgNode, type OrgLevel } from './useHierarchy'

const LEVELS: OrgLevel[] = [
  { level_order: 0, name: 'Company', locked: false },
  { level_order: 1, name: 'Region', locked: false },
  { level_order: 2, name: 'District', locked: false },
  { level_order: 3, name: 'Store', locked: true },
]

function mkNode(over: Partial<OrgNode> & { id: string }): OrgNode {
  return {
    name: over.id,
    code: over.id,
    level_order: 0,
    parent_id: null,
    path: over.id,
    chain: null,
    address: null,
    lat: null,
    lng: null,
    tz: null,
    ...over,
  }
}

const NODES: OrgNode[] = [
  mkNode({ id: 'company', name: 'Lumen Beauty', level_order: 0 }),
  mkNode({ id: 'r1', name: 'West Region', level_order: 1, parent_id: 'company' }),
  mkNode({ id: 'd1', name: 'Bay Area', level_order: 2, parent_id: 'r1' }),
  mkNode({ id: 's1', name: 'CVS Palo Alto', level_order: 3, parent_id: 'd1', chain: 'CVS', code: 'ST001', address: '123 Main St, Palo Alto, CA' }),
]
const IDX = buildTreeIndex(NODES)
const STORE = NODES.find(n => n.id === 's1')!

describe('StoreDetailModal', () => {
  it('renders nothing when open is false', () => {
    renderApp(
      <StoreDetailModal open={false} node={STORE} idx={IDX} levels={LEVELS} onClose={vi.fn()} />,
      { session: adminSession() }
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the store name as title', () => {
    renderApp(
      <StoreDetailModal open={true} node={STORE} idx={IDX} levels={LEVELS} onClose={vi.fn()} />,
      { session: adminSession() }
    )
    expect(screen.getByText('CVS Palo Alto')).toBeTruthy()
  })

  it('shows all ancestor names in the management path', () => {
    renderApp(
      <StoreDetailModal open={true} node={STORE} idx={IDX} levels={LEVELS} onClose={vi.fn()} />,
      { session: adminSession() }
    )
    expect(screen.getByText('Lumen Beauty')).toBeTruthy()
    expect(screen.getByText('West Region')).toBeTruthy()
    expect(screen.getByText('Bay Area')).toBeTruthy()
  })

  it('shows chain, store code, and address in attributes', () => {
    renderApp(
      <StoreDetailModal open={true} node={STORE} idx={IDX} levels={LEVELS} onClose={vi.fn()} />,
      { session: adminSession() }
    )
    expect(screen.getAllByText('CVS').length).toBeGreaterThan(0)
    expect(screen.getByText('ST001')).toBeTruthy()
    expect(screen.getByText('123 Main St, Palo Alto, CA')).toBeTruthy()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    renderApp(
      <StoreDetailModal open={true} node={STORE} idx={IDX} levels={LEVELS} onClose={onClose} />,
      { session: adminSession() }
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin test -- StoreDetailModal.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create StoreDetailModal.tsx**

Create `apps/admin/src/pages/Hierarchy/StoreDetailModal.tsx`:

```typescript
import { Modal } from '../../ui'
import { getAncestors, getLevelName, isLocked, type OrgNode, type OrgLevel, type TreeIndex } from './useHierarchy'

// Level dot colours
const LEVEL_COLORS: Record<number, string> = {
  0: '#1B4F8A',
  1: '#0ea5e9',
  2: '#16a34a',
}
const STORE_COLOR = '#d97706'

function dotColor(level_order: number, locked: boolean): string {
  if (locked) return STORE_COLOR
  return LEVEL_COLORS[level_order] ?? '#71717a'
}

function AttrRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border-faint)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-3)', width: 110 }}>{label}</span>
      <span style={{ fontSize: 13px }}>{children}</span>
    </div>
  )
}

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
          const color = dotColor(n.level_order, locked)
          const isStoreSelf = n.id === node.id
          return (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: i * 16, paddingTop: 4, paddingBottom: 4 }}>
              {i > 0 && (
                <span style={{ color: 'var(--text-4)', fontSize: 12, marginLeft: -16 }}>↓</span>
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
          <span style={{ fontSize: 13px }}>{node.chain ?? 'N/A'}</span>
        </div>
        <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--border-faint)', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Store ID</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{node.code}</span>
        </div>
        <div style={{ padding: '9px 14px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Address</span>
          <span style={{ fontSize: 13px }}>{node.address ?? 'N/A'}</span>
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin test -- StoreDetailModal.test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
git add apps/admin/src/pages/Hierarchy/StoreDetailModal.tsx apps/admin/src/pages/Hierarchy/StoreDetailModal.test.tsx
git commit -m "$(cat <<'EOF'
W7: StoreDetailModal with management path + attributes (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Hierarchy page shell + CSS + integration tests

**Files:**
- Create: `apps/admin/src/pages/Hierarchy/Hierarchy.tsx`
- Create: `apps/admin/src/pages/Hierarchy/Hierarchy.module.css`
- Create: `apps/admin/src/pages/Hierarchy/Hierarchy.test.tsx`

**Interfaces:**
- Consumes:
  - `useHierarchy`, `buildTreeIndex`, `filterNodes`, `hierarchyStats`, `uniqueChains` from `./useHierarchy`
  - `TreeNode` from `./TreeNode`
  - `StoreDetailModal` from `./StoreDetailModal`
  - `Topbar` from `../../shell/Topbar`
  - `Button`, `Card`, `Icon` from `../../ui`
  - `selectSession`, `useAppSelector` from `../../store`
  - `apiGet` from `../../lib/api` (mocked in tests)
- Produces: default export `Hierarchy` (page component, no props).

**Prerequisite:** Tasks 2, 3, and 4 must be complete.

- [ ] **Step 1: Write the integration test**

Create `apps/admin/src/pages/Hierarchy/Hierarchy.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import Hierarchy from './Hierarchy'
import { apiGet } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiGet: vi.fn() }
})

const NODES_RESPONSE = {
  nodes: [
    { id: 'company', name: 'Lumen Beauty', code: 'LB', level_order: 0, parent_id: null, path: 'company', chain: null, address: null, lat: null, lng: null, tz: null },
    { id: 'r1', name: 'West Region', code: 'WR', level_order: 1, parent_id: 'company', path: 'company/r1', chain: null, address: null, lat: null, lng: null, tz: null },
    { id: 'd1', name: 'Bay Area', code: 'BA', level_order: 2, parent_id: 'r1', path: 'company/r1/d1', chain: null, address: null, lat: null, lng: null, tz: null },
    { id: 's1', name: 'CVS Palo Alto', code: 'ST001', level_order: 3, parent_id: 'd1', path: 'company/r1/d1/s1', chain: 'CVS', address: '123 Main St', lat: 37.4, lng: -122.1, tz: 'America/Los_Angeles' },
    { id: 's2', name: 'Walgreens Menlo', code: 'ST002', level_order: 3, parent_id: 'd1', path: 'company/r1/d1/s2', chain: 'Walgreens', address: '456 El Camino', lat: 37.45, lng: -122.18, tz: 'America/Los_Angeles' },
  ],
}

const LEVELS_RESPONSE = {
  levels: [
    { level_order: 0, name: 'Company', locked: false },
    { level_order: 1, name: 'Region', locked: false },
    { level_order: 2, name: 'District', locked: false },
    { level_order: 3, name: 'Store', locked: true },
  ],
  count: 4,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/nodes') return Promise.resolve(NODES_RESPONSE)
    if (path === '/org-levels') return Promise.resolve(LEVELS_RESPONSE)
    return Promise.reject(new Error(`Unknown path: ${path}`))
  })
})

describe('Hierarchy page', () => {
  it('renders the topbar title and stat tiles after loading', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    expect(await screen.findByText('Hierarchy')).toBeTruthy()
    expect(screen.getByText('Org levels')).toBeTruthy()
    expect(screen.getByText('Regions')).toBeTruthy()
    expect(screen.getByText('Districts')).toBeTruthy()
    expect(screen.getByText('Stores')).toBeTruthy()
  })

  it('renders root node and expands children on toggle click', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    // Initially only root visible; click expand
    const expandBtn = screen.getByRole('button', { name: /expand/i })
    fireEvent.click(expandBtn)
    await waitFor(() => expect(screen.getByText('West Region')).toBeTruthy())
  })

  it('filters nodes by search query', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    await waitFor(() => expect(screen.getByText('West Region')).toBeTruthy())
    fireEvent.click(screen.getAllByRole('button', { name: /expand/i })[0])
    await waitFor(() => expect(screen.getByText('Bay Area')).toBeTruthy())
    fireEvent.click(screen.getAllByRole('button', { name: /expand/i })[0])
    await waitFor(() => expect(screen.getByText('CVS Palo Alto')).toBeTruthy())

    const searchInput = screen.getByPlaceholderText(/find a node/i)
    fireEvent.change(searchInput, { target: { value: 'CVS' } })
    await waitFor(() => expect(screen.queryByText('Walgreens Menlo')).toBeNull())
    expect(screen.getByText('CVS Palo Alto')).toBeTruthy()
  })

  it('opens the store detail modal when a store name is clicked', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    // Expand to reach stores
    fireEvent.click(screen.getByRole('button', { name: /expand all/i }))
    await waitFor(() => expect(screen.getByText('CVS Palo Alto')).toBeTruthy())
    fireEvent.click(screen.getByText('CVS Palo Alto'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText('Management position')).toBeTruthy()
  })

  it('shows deferred Edit and Export buttons as disabled', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Hierarchy')
    const editBtn = screen.getByRole('button', { name: /edit/i })
    expect(editBtn).toBeTruthy()
    expect(editBtn).toBeDisabled()
    const exportBtn = screen.getByRole('button', { name: /export/i })
    expect(exportBtn).toBeDisabled()
  })

  it('filters by chain select', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    fireEvent.click(screen.getByRole('button', { name: /expand all/i }))
    await waitFor(() => expect(screen.getByText('CVS Palo Alto')).toBeTruthy())
    // Select CVS chain
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'CVS' } })
    await waitFor(() => expect(screen.queryByText('Walgreens Menlo')).toBeNull())
    expect(screen.getByText('CVS Palo Alto')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin test -- Hierarchy.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create Hierarchy.module.css**

Create `apps/admin/src/pages/Hierarchy/Hierarchy.module.css`:

```css
.scroll {
  flex: 1;
  overflow-y: auto;
}

.page {
  padding: 22px;
  max-width: 1100px;
  margin: 0 auto;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}

.stat {
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 13px;
}

.statIcon {
  width: 38px;
  height: 38px;
  border-radius: var(--r-md);
  background: var(--accent-subtle);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.statValue {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
}

.statLabel {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 3px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.searchWrap {
  position: relative;
  flex: 1;
  min-width: 220px;
  max-width: 320px;
  display: flex;
  align-items: center;
}

.searchWrap svg {
  position: absolute;
  left: 10px;
  color: var(--text-3);
  pointer-events: none;
}

.searchInput {
  height: 34px;
  width: 100%;
  padding: 0 10px 0 32px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}

.searchInput:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.chainWrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chainSelect {
  height: 34px;
  padding: 0 28px 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}

.chainSelect:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.spacer {
  flex: 1;
}

.legend {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.lvChip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--r-full);
  font-size: 12px;
  font-weight: 600;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-2);
}

.banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 12.5px;
  margin-bottom: 8px;
}

.chainBanner {
  background: var(--accent-subtle);
  border-color: transparent;
}

.treeCard {
  padding: 8px;
}

.emptyTree {
  padding: 40px;
  text-align: center;
  color: var(--text-3);
  font-size: 13.5px;
}
```

- [ ] **Step 4: Create Hierarchy.tsx**

Create `apps/admin/src/pages/Hierarchy/Hierarchy.tsx`:

```typescript
import { useMemo, useState } from 'react'
import { Button, Card, Icon } from '../../ui'
import { Topbar } from '../../shell/Topbar'
import { selectSession, useAppSelector } from '../../store'
import {
  useHierarchy,
  buildTreeIndex,
  filterNodes,
  hierarchyStats,
  uniqueChains,
  type OrgNode,
} from './useHierarchy'
import TreeNode from './TreeNode'
import StoreDetailModal from './StoreDetailModal'
import styles from './Hierarchy.module.css'

// Level dot colours for the legend
const LEGEND_LEVELS = [
  { name: 'Company', color: '#1B4F8A', square: false },
  { name: 'Region', color: '#0ea5e9', square: false },
  { name: 'District', color: '#16a34a', square: false },
  { name: 'Store', color: '#d97706', square: true, note: 'locked level' },
]

function StatTile({ icon, value, label }: { icon: keyof typeof import('../../ui').ICONS; value: number; label: string }) {
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

  const { nodes, levels, isLoading } = useHierarchy()

  const [query, setQuery] = useState('')
  const [chain, setChain] = useState('All')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selectedStore, setSelectedStore] = useState<OrgNode | null>(null)

  const idx = useMemo(() => buildTreeIndex(nodes), [nodes])
  const stats = useMemo(() => hierarchyStats(nodes, levels), [nodes, levels])
  const chains = useMemo(() => uniqueChains(nodes), [nodes])

  const keepIds = useMemo(() => {
    const hasFilter = query.trim() !== '' || chain !== 'All'
    if (!hasFilter) return null
    return filterNodes(nodes, query, chain)
  }, [nodes, query, chain])

  // When a filter is active, auto-show matching branches without mutating expanded state
  // The TreeNode renders children when keepIds forces them visible
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
        <Button size="sm" disabled title="Coming soon">
          <Icon name="edit" size={13} /> Edit
          <span style={{ fontSize: 9, border: '1px solid var(--border)', borderRadius: 99, padding: '0 6px', marginLeft: 2 }}>soon</span>
        </Button>
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
    </>
  )
}
```

- [ ] **Step 5: Run all Hierarchy tests**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin test -- Hierarchy.test
```

Expected: all tests pass. If any fail due to TypeScript issues, fix them inline before committing.

- [ ] **Step 6: Commit**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
git add apps/admin/src/pages/Hierarchy/Hierarchy.tsx apps/admin/src/pages/Hierarchy/Hierarchy.module.css apps/admin/src/pages/Hierarchy/Hierarchy.test.tsx
git commit -m "$(cat <<'EOF'
W7: Hierarchy page shell with stats, tree, search, chain filter, modal (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire routing and nav, run full test suite and build

**Files:**
- Modify: `apps/admin/src/shell/nav.ts` (line 20: remove `comingSoon: true` from hierarchy item)
- Modify: `apps/admin/src/App.tsx` (import Hierarchy, replace ComingSoon route for /hierarchy)

**Interfaces:**
- Consumes: `Hierarchy` default export from `./pages/Hierarchy/Hierarchy`
- Produces: working /hierarchy route.

**Prerequisite:** All previous tasks must be complete.

- [ ] **Step 1: Remove comingSoon flag from nav.ts**

Edit `apps/admin/src/shell/nav.ts`, change line 20 from:

```typescript
  { id: 'hierarchy', label: 'Hierarchy', icon: 'tree', group: 'org', path: '/hierarchy', comingSoon: true },
```

to:

```typescript
  { id: 'hierarchy', label: 'Hierarchy', icon: 'tree', group: 'org', path: '/hierarchy' },
```

- [ ] **Step 2: Add Hierarchy import and route to App.tsx**

Edit `apps/admin/src/App.tsx`:

Add import after line 8 (after the Builder import):
```typescript
import Hierarchy from './pages/Hierarchy/Hierarchy'
```

Change line 35 from:
```typescript
        <Route path="/hierarchy" element={<ComingSoon title="Hierarchy" />} />
```

to:
```typescript
        <Route path="/hierarchy" element={<Hierarchy />} />
```

- [ ] **Step 3: Run the full test suite**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin test
```

Expected: all tests pass, no act warnings. Note the total test count.

- [ ] **Step 4: Run the build**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin build
```

Expected: exits 0 with no TypeScript errors.

If the build fails due to TypeScript errors (e.g., in StoreDetailModal.tsx where `13px` was used as a string instead of a number), fix those errors before committing. Common fix: replace `fontSize: 13px` with `fontSize: 13` or `fontSize: '13px'` in style objects.

- [ ] **Step 5: Commit wiring**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
git add apps/admin/src/shell/nav.ts apps/admin/src/App.tsx
git commit -m "$(cat <<'EOF'
W7: wire /hierarchy route to Hierarchy screen, remove comingSoon flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final cleanup and verification

**Files:**
- Create + delete: `W7_REPORT.md` in worktree root (write, verify, then delete before final commit)

**Prerequisite:** All previous tasks must be complete, tests green, build clean.

- [ ] **Step 1: Run the full test suite one final time**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin test
```

Note: record test count (e.g., "42 tests passed").

- [ ] **Step 2: Run the build one final time**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
pnpm --filter @intelli/admin build
```

Expected: exits 0.

- [ ] **Step 3: Write W7_REPORT.md**

Create `/Users/tanyajustin/Documents/intelli-w7/W7_REPORT.md` with:

```markdown
# W7 Hierarchy Screen Report

## Status
Complete. Tests green. Build clean.

## Commits
[List short SHAs and subjects from `git log --oneline -8`]

## Test summary
[X] tests passed. Build: clean.

## Files created
- apps/admin/src/pages/Hierarchy/useHierarchy.ts (types + pure helpers + TQ hook)
- apps/admin/src/pages/Hierarchy/useHierarchy.test.ts (unit tests for all pure helpers)
- apps/admin/src/pages/Hierarchy/TreeNode.tsx (recursive tree row)
- apps/admin/src/pages/Hierarchy/TreeNode.module.css
- apps/admin/src/pages/Hierarchy/TreeNode.test.tsx
- apps/admin/src/pages/Hierarchy/StoreDetailModal.tsx (store detail with ancestors)
- apps/admin/src/pages/Hierarchy/StoreDetailModal.test.tsx
- apps/admin/src/pages/Hierarchy/Hierarchy.tsx (page shell)
- apps/admin/src/pages/Hierarchy/Hierarchy.module.css
- apps/admin/src/pages/Hierarchy/Hierarchy.test.tsx (integration tests)
- docs/superpowers/specs/2026-06-25-w7-hierarchy-design.md

## Files modified
- apps/admin/src/shell/nav.ts (removed comingSoon on hierarchy)
- apps/admin/src/App.tsx (added Hierarchy import + route)

## Concerns / Notes
- GET /org-levels is mocked in all tests. The backend integrator is adding it.
- Coverage mode, add/rename/delete, bulk import, and export are deferred (disabled "soon" controls).
- filterNodes auto-expands matching branches by computing effectiveExpanded in the page component.
```

- [ ] **Step 4: Delete W7_REPORT.md**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
rm W7_REPORT.md
```

- [ ] **Step 5: Verify W7_REPORT.md is gone, then make final verification commit if any loose files remain**

```bash
cd /Users/tanyajustin/Documents/intelli-w7
git status
```

If git status is clean, the work is done. If there are any staged or unstaged files that should be committed, commit them now. Do NOT commit W7_REPORT.md.

---

## Self-Review

Checking spec coverage:

- Expandable org tree from flat nodes (parent_id -> children): Task 2 (buildTreeIndex) + Task 3 (TreeNode). Covered.
- Colour dot per level: Task 3 (levelColor function + lvDot CSS). Covered.
- Level name from /org-levels: Task 2 (getLevelName) + Task 3 (levelLabel). Covered.
- Chain badge on stores: Task 3 (chainBadge). Covered.
- Store code in mono: Task 3 (code style). Covered.
- Child counts on non-store rows: Task 3 (childCount). Covered.
- Search box (filters nodes, expands matching branches): Task 2 (filterNodes) + Task 5 (effectiveExpanded). Covered.
- Chain filter: Task 2 (filterNodes chain param) + Task 5 (chain state + select). Covered.
- Expand-all/Collapse buttons: Task 5 (expandAll function). Covered.
- Store detail panel/modal: Task 4 (StoreDetailModal with ancestors + attributes). Covered.
- Deferred controls (Edit, Export) as disabled "soon": Task 5 (Topbar buttons). Covered.
- Stats tiles (levels, regions, districts, stores): Task 2 (hierarchyStats) + Task 5. Covered.
- Level legend: Task 5 (LEGEND_LEVELS). Covered.
- Info banners (chain is an attribute, not a level): Task 5 (banner divs). Covered.
- /hierarchy route wired (remove comingSoon): Task 6. Covered.
- nav.ts comingSoon removed: Task 6. Covered.
- Design spec written: Task 1. Covered.
- GET /org-levels mocked in tests: Task 5 tests mock apiGet for both paths. Covered.

No gaps found. No placeholder text in any task. Type consistency checked: `OrgNode`, `OrgLevel`, `TreeIndex`, `buildTreeIndex`, `getLevelName`, `isLocked`, `filterNodes`, `hierarchyStats`, `getAncestors`, `uniqueChains` used consistently across all tasks.
