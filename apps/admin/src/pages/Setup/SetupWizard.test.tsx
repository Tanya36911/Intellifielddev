import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession, repSession } from '../../test/fixtures'
import SetupWizard from './SetupWizard'
import { apiGet, apiSend } from '../../lib/api'
import type { OrgLevel, OrgNode } from '../Hierarchy/useHierarchy'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiGet: vi.fn(), apiSend: vi.fn() }
})

type NodesResponse = { nodes: OrgNode[] }

// A populated company: a root plus real nodes below it. structuralEditingAllowed
// returns false here, so step 2 should be rename-only.
const POPULATED_NODES: NodesResponse = {
  nodes: [
    { id: 'company', name: 'Lumen Beauty', code: 'LB', level_order: 0, parent_id: null, path: 'company', chain: null, address: null, lat: null, lng: null, tz: null },
    { id: 'r1', name: 'West Region', code: 'WR', level_order: 1, parent_id: 'company', path: 'company/r1', chain: null, address: null, lat: null, lng: null, tz: null },
    { id: 's1', name: 'CVS Palo Alto', code: 'ST001', level_order: 2, parent_id: 'r1', path: 'company/r1/s1', chain: 'CVS', address: '1 Main', lat: null, lng: null, tz: null },
  ],
}

// A fresh company: only the root exists, so structural editing is allowed.
const FRESH_NODES: NodesResponse = {
  nodes: [
    { id: 'company', name: 'New Co', code: 'NC', level_order: 0, parent_id: null, path: 'company', chain: null, address: null, lat: null, lng: null, tz: null },
  ],
}

// A fresh company has no saved levels yet, so step 2 falls back to the template
// default (Company / Region / District / Store).
const FRESH_LEVELS_RESPONSE = { levels: [] as OrgLevel[], count: 0 }

// A populated company's REAL saved levels. Deliberately a 4-level shape with
// real names so we can prove step 2 seeds from these and not the template.
const POPULATED_LEVELS_RESPONSE = {
  levels: [
    { level_order: 0, name: 'Company', locked: true },
    { level_order: 1, name: 'Region', locked: false },
    { level_order: 2, name: 'District', locked: false },
    { level_order: 3, name: 'Store', locked: true },
  ],
  count: 4,
}

const TENANT = { id: 't1', name: 'Lumen Beauty', code: 'LB', payroll_enabled: false }

function mockApi(nodes: NodesResponse, levels = FRESH_LEVELS_RESPONSE) {
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/nodes') return Promise.resolve(nodes)
    if (path === '/org-levels') return Promise.resolve(levels)
    if (path === '/tenants') return Promise.resolve(TENANT)
    if (path === '/analytics/dashboard')
      return Promise.resolve({ footprint: { nodes: 1, stores: 0, reps: 0 } })
    return Promise.reject(new Error(`Unknown path: ${path}`))
  })
  vi.mocked(apiSend).mockResolvedValue(POPULATED_LEVELS_RESPONSE as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi(FRESH_NODES)
})

describe('SetupWizard', () => {
  it('renders step 1 for an admin and can advance to step 2', async () => {
    renderApp(<SetupWizard />, { session: adminSession(), route: '/setup' })
    expect(
      await screen.findByRole('heading', { name: 'Choose a starting point' }),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByRole('heading', { name: 'Name your levels' })).toBeTruthy()
  })

  it('step 2 Continue saves via PUT /org-levels after the structure is confirmed', async () => {
    renderApp(<SetupWizard />, { session: adminSession(), route: '/setup' })
    await screen.findByRole('heading', { name: 'Choose a starting point' })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByRole('heading', { name: 'Name your levels' })

    // Continue is gated until the structure is confirmed.
    const confirm = screen.getByRole('checkbox')
    fireEvent.click(confirm)

    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith(
        'PUT',
        '/org-levels',
        expect.objectContaining({ levels: expect.any(Array) }),
      ),
    )
    // and it advances to step 3 (Payroll)
    expect(await screen.findByRole('heading', { name: 'Payroll' })).toBeTruthy()
  })

  it('on a populated company, step 2 seeds the real saved levels and hides add/remove', async () => {
    mockApi(POPULATED_NODES, POPULATED_LEVELS_RESPONSE)
    renderApp(<SetupWizard />, { session: adminSession(), route: '/setup' })
    await screen.findByRole('heading', { name: 'Choose a starting point' })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByRole('heading', { name: 'Name your levels' })

    // The rename-only note is shown...
    expect(screen.getByText(/your stores already exist/i)).toBeTruthy()
    // ...the level inputs carry the company's REAL saved names (not template
    // placeholders), seeded from /org-levels (Company / Region / District / Store).
    await waitFor(() => {
      const inputs = screen.getAllByLabelText(/level \d+ name/i) as HTMLInputElement[]
      expect(inputs.map((el) => el.value)).toEqual(['Company', 'Region', 'District', 'Store'])
    })
    // ...and there is no "Add a level" button or remove control.
    expect(screen.queryByRole('button', { name: /add a level/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /remove level/i })).toBeNull()
  })

  it('on a fresh company, step 2 allows adding levels', async () => {
    renderApp(<SetupWizard />, { session: adminSession(), route: '/setup' })
    await screen.findByRole('heading', { name: 'Choose a starting point' })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await screen.findByRole('heading', { name: 'Name your levels' })
    expect(screen.getByRole('button', { name: /add a level/i })).toBeTruthy()
  })

  it('redirects a non-admin away from the wizard', async () => {
    renderApp(<SetupWizard />, { session: repSession(), route: '/setup' })
    // The wizard content never renders for a rep.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Choose a starting point' })).toBeNull(),
    )
    expect(screen.queryByText('Intelli setup')).toBeNull()
  })
})
