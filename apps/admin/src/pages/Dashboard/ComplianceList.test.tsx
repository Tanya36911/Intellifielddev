import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from '../../test/render'
import ComplianceList from './ComplianceList'

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  apiGet: vi.fn(),
}))
import { apiGet } from '../../lib/api'

function child(over: Record<string, unknown>) {
  return {
    node_id: 'n',
    name: 'Node',
    level_order: 1,
    is_store: false,
    expected: 1,
    responded: 0,
    scored: 0,
    passed: 0,
    completion_pct: 0,
    pass_pct: null,
    ...over,
  }
}

describe('ComplianceList', () => {
  it('renders a region row with its pass-% and responded/expected count', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      is_store: false,
      children: [child({ name: 'West', responded: 2, expected: 2, scored: 2, passed: 1, pass_pct: 50 })],
    } as never)
    renderApp(<ComplianceList range="12w" />)
    expect(await screen.findByText('West')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText('2/2')).toBeTruthy()
  })

  it('renders a null pass_pct as the no-data dash', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      is_store: false,
      children: [child({ name: 'Central', expected: 1, pass_pct: null })],
    } as never)
    renderApp(<ComplianceList range="12w" />)
    expect(await screen.findByText('Central')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('shows the empty state when no nodes are in scope', async () => {
    vi.mocked(apiGet).mockResolvedValue({ is_store: false, children: [] } as never)
    renderApp(<ComplianceList range="12w" />)
    expect(await screen.findByText(/no nodes in scope/i)).toBeTruthy()
  })
})
