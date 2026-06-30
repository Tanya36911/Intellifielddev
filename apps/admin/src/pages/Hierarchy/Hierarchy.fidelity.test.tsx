import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import Hierarchy from './Hierarchy'
import { apiGet } from '@intelli/api-client'

vi.mock('@intelli/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intelli/api-client')>()
  return { ...actual, apiGet: vi.fn() }
})

const NODES_RESPONSE = {
  nodes: [
    { id: 'company', name: 'Lumen Beauty', code: 'LB', level_order: 0, parent_id: null, path: 'company', chain: null, address: null, lat: null, lng: null, tz: null },
    { id: 'r1', name: 'West Region', code: 'WR', level_order: 1, parent_id: 'company', path: 'company/r1', chain: null, address: null, lat: null, lng: null, tz: null },
    { id: 'd1', name: 'Bay Area', code: 'BA', level_order: 2, parent_id: 'r1', path: 'company/r1/d1', chain: null, address: null, lat: null, lng: null, tz: null },
    { id: 's1', name: 'CVS Palo Alto', code: 'ST001', level_order: 3, parent_id: 'd1', path: 'company/r1/d1/s1', chain: 'CVS', address: '123 Main St', lat: null, lng: null, tz: null },
  ],
}
const LEVELS_RESPONSE = {
  levels: [
    { level_order: 0, name: 'Company', locked: true },
    { level_order: 1, name: 'Region', locked: false },
    { level_order: 2, name: 'District', locked: false },
    { level_order: 3, name: 'Store', locked: true },
  ],
  count: 4,
}
const USERS_RESPONSE = {
  users: [
    { id: 'u1', name: 'Pat Manager', email: 'pat@x.com', role: 'manager', pinned_node_id: 'r1', pinned_node_name: 'West Region', pinned_node_level_order: 1 },
    { id: 'u2', name: 'Rep One', email: 'rep@x.com', role: 'rep', pinned_node_id: 'd1', pinned_node_name: 'Bay Area', pinned_node_level_order: 2 },
  ],
  count: 2,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/nodes') return Promise.resolve(NODES_RESPONSE)
    if (path === '/org-levels') return Promise.resolve(LEVELS_RESPONSE)
    if (path === '/users') return Promise.resolve(USERS_RESPONSE)
    return Promise.reject(new Error(`Unknown path: ${path}`))
  })
})

describe('Hierarchy fidelity: banners + coverage', () => {
  it('shows the two structure info banners (locked levels + chain attribute)', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Hierarchy')
    expect(screen.getByText(/are locked levels/i)).toBeTruthy()
    expect(screen.getByText(/used for survey targeting and filtering/i)).toBeTruthy()
  })

  it('switches to Coverage mode: staffing summary + manager chip, structure banner gone', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    fireEvent.click(screen.getByRole('button', { name: /expand all/i }))
    await screen.findByText('West Region')

    fireEvent.click(screen.getByRole('tab', { name: 'Coverage' }))

    await waitFor(() => expect(screen.getByText('Every district has a rep.')).toBeTruthy())
    expect(screen.getByText('Pat Manager')).toBeTruthy()
    // the structure-only locked-levels banner is hidden in coverage mode
    expect(screen.queryByText(/are locked levels/i)).toBeNull()
  })
})
