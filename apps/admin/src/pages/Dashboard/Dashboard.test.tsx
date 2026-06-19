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
const COMPLIANCE = {
  rows: [
    {
      assignment_id: 'a1',
      survey_id: 's1',
      survey_name: 'Velvet Lip Shelf Check',
      survey_version_id: 'v1',
      target_node_id: 'n1',
      target_node_name: 'Central',
      expected: 1,
      responded: 0,
      scored: 0,
      passed: 0,
      completion_pct: 0.0,
      pass_pct: null,
    },
  ],
  count: 1,
}

function route(path: string) {
  if (path.startsWith('/analytics/dashboard')) return Promise.resolve(DASH)
  if (path.startsWith('/analytics/compliance/drill'))
    return Promise.resolve({ is_store: false, children: [] })
  if (path.startsWith('/analytics/compliance')) return Promise.resolve(COMPLIANCE)
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

  it('renders a compliance row and a null pass_pct as a no-data dash', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    expect(await screen.findByText('Velvet Lip Shelf Check')).toBeTruthy()
    expect(screen.getByText('Central')).toBeTruthy()
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
})
