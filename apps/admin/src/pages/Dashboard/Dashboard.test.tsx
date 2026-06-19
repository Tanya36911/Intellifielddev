import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderApp } from '../../test/render'
import Dashboard from './Dashboard'

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  apiGet: vi.fn(),
  downloadCsv: vi.fn(),
}))
import { apiGet, downloadCsv } from '../../lib/api'

const DASH = {
  footprint: { nodes: 8, stores: 3, reps: 2 },
  current: {
    completion_pct: 50.0,
    pass_pct: 64.0,
    expected: 4,
    responded: 2,
    scored: 2,
    passed: 1,
    surveys_completed: 11,
    overdue: 3,
  },
  previous: {
    completion_pct: 40.0,
    pass_pct: 60.0,
    expected: 4,
    responded: 2,
    scored: 2,
    passed: 1,
    surveys_completed: 9,
    overdue: 5,
  },
  trend: [
    { week_start: '2026-06-08', completion_pct: 40, responded: 1, expected: 4 },
    { week_start: '2026-06-15', completion_pct: 50, responded: 2, expected: 4 },
  ],
}
// The root compliance-by-node rollup: one region row (West).
const NODES = {
  is_store: false,
  children: [
    {
      node_id: 'west',
      name: 'West',
      level_order: 1,
      is_store: false,
      expected: 2,
      responded: 2,
      scored: 2,
      passed: 1,
      completion_pct: 100.0,
      pass_pct: 50.0,
    },
  ],
}
// What a drill (?node_id=...) returns: a store's per-product detail.
const STORE_BLOCK = {
  is_store: true,
  name: 'SF store',
  surveys: [
    {
      survey_version_id: 'v1',
      survey_name: 'Velvet Lip Shelf Check',
      responded: true,
      items: [{ question_id: 'q1', sku_id: 'sku-1', value: 3, pass: false }],
      questions: { q1: false },
      overall: false,
    },
  ],
}

function route(path: string) {
  if (path.startsWith('/analytics/dashboard')) return Promise.resolve(DASH)
  // The root list and the drill share the /compliance/nodes prefix; branch on the
  // node_id query string FIRST so the bare prefix does not shadow the drill.
  if (path.startsWith('/analytics/compliance/nodes') && path.includes('node_id='))
    return Promise.resolve(STORE_BLOCK)
  if (path.startsWith('/analytics/compliance/nodes')) return Promise.resolve(NODES)
  return Promise.resolve({})
}

afterEach(() => vi.clearAllMocks())

describe('Dashboard', () => {
  it('renders the KPI numbers from the dashboard payload', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    expect(await screen.findByText('64%')).toBeTruthy() // Avg compliance = pass_pct
    expect(screen.getByText('11')).toBeTruthy() // Surveys completed
    expect(screen.getByText('3')).toBeTruthy() // Overdue
  })

  it('renders a compliance-by-node region row with its pass-%', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    expect(await screen.findByText('West')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
  })

  it('shows the AI gap list with a preview badge', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    expect(await screen.findByText(/preview/i)).toBeTruthy()
    expect(screen.getByText('Rosewood')).toBeTruthy()
  })

  it('changing the range re-queries the dashboard', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    await screen.findByText('64%')
    const before = vi
      .mocked(apiGet)
      .mock.calls.filter((c) => String(c[0]).startsWith('/analytics/dashboard')).length
    fireEvent.click(screen.getByRole('button', { name: 'YTD' }))
    await waitFor(() => {
      const after = vi
        .mocked(apiGet)
        .mock.calls.filter((c) => String(c[0]).startsWith('/analytics/dashboard')).length
      expect(after).toBeGreaterThan(before)
    })
  })

  it('Export triggers the CSV download', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    await screen.findByText('64%')
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(vi.mocked(downloadCsv)).toHaveBeenCalledWith(
      expect.stringContaining('/export/compliance?format=csv'),
      expect.any(String),
    )
  })

  it('drilling a node renders the per-product store detail without throwing', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    // Open the region row, which drills (?node_id=) into the store block.
    fireEvent.click(await screen.findByText('West'))
    // The store block renders the question id twice (per-product item row + the
    // per-question verdict row) plus the failed item's sku/value, and the survey
    // name as the block header.
    expect((await screen.findAllByText('q1')).length).toBe(2)
    expect(screen.getByText(/sku-1/)).toBeTruthy()
    expect(screen.getByText('Velvet Lip Shelf Check')).toBeTruthy()
  })
})
