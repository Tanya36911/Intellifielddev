import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession, repSession } from '../../test/fixtures'
import Hierarchy from './Hierarchy'
import { apiGet, apiSend, apiDelete } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiGet: vi.fn(), apiSend: vi.fn(), apiDelete: vi.fn() }
})

// Same fixtures as Hierarchy.test.tsx so the tree shape matches.
const NODES_RESPONSE = {
  nodes: [
    { id: 'company', name: 'Lumen Beauty', code: 'LB', level_order: 0, parent_id: null, path: 'company', chain: null, address: null, lat: null, lng: null, tz: null },
    { id: 'r1', name: 'West Region', code: 'WR', level_order: 1, parent_id: 'company', path: 'company/r1', chain: null, address: null, lat: null, lng: null, tz: null },
    { id: 'd1', name: 'Bay Area', code: 'BA', level_order: 2, parent_id: 'r1', path: 'company/r1/d1', chain: null, address: null, lat: null, lng: null, tz: null },
    { id: 's1', name: 'CVS Palo Alto', code: 'ST001', level_order: 3, parent_id: 'd1', path: 'company/r1/d1/s1', chain: 'CVS', address: '123 Main St', lat: 37.4, lng: -122.1, tz: 'America/Los_Angeles' },
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/nodes') return Promise.resolve(NODES_RESPONSE)
    if (path === '/org-levels') return Promise.resolve(LEVELS_RESPONSE)
    return Promise.reject(new Error(`Unknown path: ${path}`))
  })
  // Default: writes succeed and return a node-shaped object.
  vi.mocked(apiSend).mockResolvedValue({ id: 'new', name: 'New', code: 'NEW', level_order: 2, parent_id: 'r1', path: 'x', chain: null, address: null, lat: null, lng: null, tz: null })
  vi.mocked(apiDelete).mockResolvedValue({ ok: true })
})

describe('Hierarchy edit mode', () => {
  it('a rep session shows NO Edit toggle', async () => {
    renderApp(<Hierarchy />, { session: repSession() })
    await screen.findByText('Lumen Beauty')
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull()
    // Export stays as a deferred affordance for everyone.
    expect(screen.getByRole('button', { name: /export/i })).toBeTruthy()
  })

  it('an admin sees the Edit toggle and entering edit mode reveals row actions', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    const editBtn = screen.getByRole('button', { name: /edit/i })
    fireEvent.click(editBtn)
    // Edit mode reveals an add-child button on the (non-store) company root.
    expect(await screen.findByRole('button', { name: /add child under Lumen Beauty/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /rename Lumen Beauty/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /delete Lumen Beauty/i })).toBeTruthy()
  })

  it('clicking add opens the modal and submitting POSTs /nodes with the parent_id + name', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))

    // Open the add modal with the company root as parent.
    fireEvent.click(await screen.findByRole('button', { name: /add child under Lumen Beauty/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    // Context shows the resulting child level (Region, since company is order 0).
    expect(screen.getByText('New Region')).toBeTruthy()

    // Type a name and submit.
    const nameInput = screen.getByPlaceholderText(/new Region/i)
    fireEvent.change(nameInput, { target: { value: 'North Region' } })
    fireEvent.click(screen.getByRole('button', { name: /add Region/i }))

    await waitFor(() => {
      expect(apiSend).toHaveBeenCalledWith(
        'POST',
        '/nodes',
        expect.objectContaining({ parent_id: 'company', name: 'North Region' }),
      )
    })
  })

  it('store rows get a rename + delete action but NO add-child (a store is a leaf)', async () => {
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.click(screen.getByRole('button', { name: /expand all/i }))
    await screen.findByText('CVS Palo Alto')
    expect(screen.getByRole('button', { name: /rename CVS Palo Alto/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /delete CVS Palo Alto/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /add child under CVS Palo Alto/i })).toBeNull()
  })

  it('delete confirms first then calls apiDelete with the node id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.click(screen.getByRole('button', { name: /expand all/i }))
    await screen.findByText('CVS Palo Alto')
    fireEvent.click(screen.getByRole('button', { name: /delete CVS Palo Alto/i }))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/nodes/s1'))
    confirmSpy.mockRestore()
  })

  it('a 409 on delete surfaces the backend reason to the user', async () => {
    const { ApiError } = await import('../../lib/api')
    vi.mocked(apiDelete).mockRejectedValueOnce(
      new ApiError(409, 'Cannot delete this node: it has children'),
    )
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    renderApp(<Hierarchy />, { session: adminSession() })
    await screen.findByText('Lumen Beauty')
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete Lumen Beauty/i }))
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Cannot delete this node: it has children'),
    )
    confirmSpy.mockRestore()
    alertSpy.mockRestore()
  })
})
