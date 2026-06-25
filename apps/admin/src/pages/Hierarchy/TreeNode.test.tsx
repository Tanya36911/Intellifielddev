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
