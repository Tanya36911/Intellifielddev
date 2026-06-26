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
    // Initially only root visible; click the tree row expand toggle (aria-label="Expand")
    const expandBtn = screen.getByRole('button', { name: 'Expand' })
    fireEvent.click(expandBtn)
    await waitFor(() => expect(screen.getByText('West Region')).toBeTruthy())
  })

  it('shows an enabled Edit toggle for admins and a still-deferred Export button', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Hierarchy')
    const editBtn = screen.getByRole('button', { name: /edit/i })
    expect(editBtn).toBeTruthy()
    expect(editBtn).not.toBeDisabled()
    const exportBtn = screen.getByRole('button', { name: /export/i })
    expect(exportBtn).toBeDisabled()
  })

  it('expands all nodes with Expand all and shows stores', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    fireEvent.click(screen.getByRole('button', { name: /expand all/i }))
    await waitFor(() => expect(screen.getByText('CVS Palo Alto')).toBeTruthy())
    expect(screen.getByText('Walgreens Menlo')).toBeTruthy()
  })

  it('opens the store detail modal when a store name is clicked', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    fireEvent.click(screen.getByRole('button', { name: /expand all/i }))
    await waitFor(() => expect(screen.getByText('CVS Palo Alto')).toBeTruthy())
    fireEvent.click(screen.getByText('CVS Palo Alto'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText('Management position')).toBeTruthy()
  })

  it('filters nodes by search query', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    // Expand all so stores are visible
    fireEvent.click(screen.getByRole('button', { name: /expand all/i }))
    await waitFor(() => expect(screen.getByText('CVS Palo Alto')).toBeTruthy())

    const searchInput = screen.getByPlaceholderText(/find a node/i)
    fireEvent.change(searchInput, { target: { value: 'CVS' } })
    await waitFor(() => expect(screen.queryByText('Walgreens Menlo')).toBeNull())
    expect(screen.getByText('CVS Palo Alto')).toBeTruthy()
  })

  it('typing in search auto-expands ancestors so a deep store becomes visible without Expand all', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    // Confirm the deep store is not yet visible (tree is collapsed)
    expect(screen.queryByText('CVS Palo Alto')).toBeNull()
    // Type the store name directly into the search box - no Expand all pressed
    const searchInput = screen.getByPlaceholderText(/find a node/i)
    fireEvent.change(searchInput, { target: { value: 'CVS Palo Alto' } })
    // effectiveExpanded should auto-expand ancestors so the match becomes visible
    await waitFor(() => expect(screen.getByText('CVS Palo Alto')).toBeTruthy())
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
