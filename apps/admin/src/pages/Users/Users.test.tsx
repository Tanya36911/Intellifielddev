import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession, repSession } from '../../test/fixtures'
import Users from './Users'
import { apiGet, apiSend } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiGet: vi.fn(), apiSend: vi.fn() }
})

const USERS = {
  users: [
    { id: 'u1', name: 'Dana Whitfield', email: 'dana@lumenbeauty.com', role: 'admin', pinned_node_id: 'c', pinned_node_name: 'Lumen Beauty', pinned_node_level_order: 0 },
    { id: 'u2', name: 'Sarah Mitchell', email: 'sarah@lumenbeauty.com', role: 'manager', pinned_node_id: 'r2', pinned_node_name: 'Central', pinned_node_level_order: 1 },
    { id: 'u4', name: 'Newbie NoPin', email: 'newbie@lumenbeauty.com', role: 'rep', pinned_node_id: null, pinned_node_name: null, pinned_node_level_order: null },
  ],
  count: 3,
}
const NODES = { nodes: [
  { id: 'c', name: 'Lumen Beauty', code: 'LB', level_order: 0, parent_id: null, path: 'c/', chain: null, address: null, lat: null, lng: null, tz: null },
  { id: 'r2', name: 'Central', code: 'CE', level_order: 1, parent_id: 'c', path: 'c/r2/', chain: null, address: null, lat: null, lng: null, tz: null },
] }
const LEVELS = { levels: [
  { level_order: 0, name: 'Company', locked: false },
  { level_order: 1, name: 'Region', locked: false },
  { level_order: 2, name: 'District', locked: false },
  { level_order: 3, name: 'Store', locked: true },
], count: 4 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/users') return Promise.resolve(USERS)
    if (path === '/nodes') return Promise.resolve(NODES)
    if (path === '/org-levels') return Promise.resolve(LEVELS)
    return Promise.reject(new Error(`Unknown path: ${path}`))
  })
  vi.mocked(apiSend).mockResolvedValue({} as never)
})

describe('Users page', () => {
  it('lists the team with roles and pins', async () => {
    renderApp(<Users />, { session: adminSession() })
    expect(await screen.findByText('Dana Whitfield')).toBeTruthy()
    expect(screen.getByText('Sarah Mitchell')).toBeTruthy()
    expect(screen.getByText('Central')).toBeTruthy()
    expect(screen.getByText('No pin')).toBeTruthy()
  })

  it('admin sees the Add user button; switching to Roles shows the matrix', async () => {
    renderApp(<Users />, { session: adminSession() })
    await screen.findByText('Dana Whitfield')
    expect(screen.getByRole('button', { name: /add user/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Roles' }))
    expect(await screen.findByText('Build & edit hierarchy')).toBeTruthy()
  })

  it('opens the Add user modal and submits a create', async () => {
    renderApp(<Users />, { session: adminSession() })
    await screen.findByText('Dana Whitfield')
    fireEvent.click(screen.getByRole('button', { name: /add user/i }))
    fireEvent.change(await screen.findByPlaceholderText('Jordan Lee'), { target: { value: 'Jordan Lee' } })
    fireEvent.change(screen.getByPlaceholderText('jordan@lumenbeauty.com'), { target: { value: 'jordan@lumenbeauty.com' } })
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'changeme123' } })
    // pick the Central node (the select has a node option)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'r2' } })
    // The submit button lives inside the modal dialog (the topbar trigger shares
    // the same "Add user" label), so scope the query to the dialog.
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Add user$/ }))
    await waitFor(() => expect(apiSend).toHaveBeenCalledWith('POST', '/users', expect.objectContaining({ email: 'jordan@lumenbeauty.com' })))
  })

  it('is read-only for a rep (no Add user button)', async () => {
    renderApp(<Users />, { session: repSession() })
    await screen.findByText('Dana Whitfield')
    expect(screen.queryByRole('button', { name: /add user/i })).toBeNull()
  })
})
