import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import TreeNode from './TreeNode'
import type { OrgNode, OrgLevel, TreeIndex, Coverage } from './useHierarchy'
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

describe('TreeNode coverage mode', () => {
  it('shows the manager chip and rep counts in coverage mode', () => {
    const cov: Coverage = {
      managerByNode: { r1: { name: 'Pat Manager' } },
      repCountByNode: { r1: 2, d1: 2 },
      districtGaps: 0,
    }
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
        coverage
        cov={cov}
      />,
      { session: adminSession() }
    )
    // manager pinned at the region shows their name; region + district show rep counts
    expect(screen.getByText('Pat Manager')).toBeTruthy()
    expect(screen.getAllByText('2 reps').length).toBeGreaterThan(0)
  })

  it('shows "No reps yet" for a district with no reps', () => {
    const cov: Coverage = { managerByNode: {}, repCountByNode: {}, districtGaps: 1 }
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
        coverage
        cov={cov}
      />,
      { session: adminSession() }
    )
    expect(screen.getAllByText('No reps yet').length).toBeGreaterThan(0)
  })
})

describe('TreeNode edit actions', () => {
  // A fixture with a real company root (parent_id null) plus a middle node and a store.
  const ROOTED: OrgNode[] = [
    mkNode({ id: 'co', name: 'Lumen Beauty', level_order: 0, parent_id: null }),
    mkNode({ id: 'r1', name: 'West Region', level_order: 1, parent_id: 'co' }),
    mkNode({ id: 'd1', name: 'Bay Area', level_order: 2, parent_id: 'r1' }),
    mkNode({ id: 's1', name: 'CVS Palo Alto', level_order: 3, parent_id: 'd1', chain: 'CVS' }),
  ]
  const ROOTED_IDX: TreeIndex = buildTreeIndex(ROOTED)

  function renderEdit() {
    renderApp(
      <TreeNode
        id="co"
        idx={ROOTED_IDX}
        levels={LEVELS}
        expanded={{ co: true, r1: true, d1: true }}
        onToggle={vi.fn()}
        onSelectStore={vi.fn()}
        depth={0}
        keepIds={null}
        editMode
        onAddChild={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
      { session: adminSession() }
    )
  }

  it('hides Rename and Delete on the company root, but keeps Add child', () => {
    renderEdit()
    expect(screen.queryByRole('button', { name: /rename lumen beauty/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete lumen beauty/i })).toBeNull()
    expect(screen.getByRole('button', { name: /add child under lumen beauty/i })).toBeTruthy()
  })

  it('keeps Rename and Delete on a middle node and a store (store editing is intended)', () => {
    renderEdit()
    expect(screen.getByRole('button', { name: /rename bay area/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /delete bay area/i })).toBeTruthy()
    // a store is editable by design (name, chain, address)
    expect(screen.getByRole('button', { name: /rename cvs palo alto/i })).toBeTruthy()
    // but a store is a leaf, so it gets no add-child
    expect(screen.queryByRole('button', { name: /add child under cvs palo alto/i })).toBeNull()
  })
})
