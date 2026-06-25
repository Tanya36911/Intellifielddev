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
    expect(screen.getAllByText('CVS Palo Alto').length).toBeGreaterThan(0)
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
