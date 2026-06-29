import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderApp } from '../../test/render'
import Compliance from './Compliance'
import { managerSession } from '../../test/fixtures'

vi.mock('@intelli/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@intelli/api-client')>()),
  apiGet: vi.fn(),
  downloadCsv: vi.fn(),
}))
import { apiGet, downloadCsv } from '@intelli/api-client'

const SKUS = {
  skus: [
    { id: 'sku-1', variant: 'Rosewood', color: '#9b5b5b', line: 'Velvet Lip' },
    { id: 'sku-2', variant: 'Mauve', color: '#a9748c', line: 'Velvet Lip' },
  ],
}
// root (the branch) -> one district
const ROOT = {
  is_store: false,
  children: [
    { node_id: 'district-1', name: 'Chicago', level_order: 2, is_store: false, expected: 3, responded: 3, scored: 3, passed: 2, completion_pct: 100, pass_pct: 74, stores: 3, reps: 1, failing_stores: 1, delta: 4 },
  ],
}
// the district -> one store
const DISTRICT = {
  is_store: false,
  children: [
    { node_id: 'store-1', name: 'Chicago store', level_order: 3, is_store: true, expected: 1, responded: 1, scored: 1, passed: 0, completion_pct: 100, pass_pct: 50 },
  ],
}
// the store -> one failed survey with two short shades
const STORE = {
  is_store: true,
  name: 'Chicago store',
  surveys: [
    {
      survey_version_id: 'sv1',
      survey_name: 'Velvet Lip Shelf Check',
      responded: true,
      items: [
        { question_id: 'q1', sku_id: 'sku-1', value: 2, pass: false },
        { question_id: 'q1', sku_id: 'sku-2', value: 0, pass: false },
        { question_id: 'q1', sku_id: 'sku-3', value: 5, pass: true },
      ],
      questions: { q1: false, q2: true },
      overall: false,
    },
  ],
}

function route(path: string) {
  if (path.startsWith('/skus')) return Promise.resolve(SKUS)
  if (path.includes('node_id=store-1')) return Promise.resolve(STORE)
  if (path.includes('node_id=district-1')) return Promise.resolve(DISTRICT)
  if (path.startsWith('/analytics/compliance/nodes')) return Promise.resolve(ROOT)
  return Promise.resolve({})
}

describe('Compliance Review', () => {
  it('opens at the branch root with the scope crumb and a district card', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Compliance />, { session: managerSession() })
    // breadcrumb root is the manager's pinned node, then the district card
    expect(await screen.findByText('Chicago')).toBeTruthy()
    expect(screen.getByText('Central')).toBeTruthy()
    expect(screen.getByText('74%')).toBeTruthy()
    // the prototype-style card extras: footprint subtitle, fail chip, delta
    expect(screen.getByText('3 stores, 1 rep')).toBeTruthy()
    expect(screen.getByText('1 store with failures')).toBeTruthy()
    expect(screen.getByText('4%')).toBeTruthy()
  })

  it('drills district -> store -> the store-detail review of the failed survey', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Compliance />, { session: managerSession() })
    fireEvent.click(await screen.findByText('Chicago'))
    fireEvent.click(await screen.findByText('Chicago store'))
    // the failed survey, its failing shades by name, and the review-only follow-up
    expect(await screen.findByText('Velvet Lip Shelf Check')).toBeTruthy()
    // shade names come from a separate /skus query, so wait for it to resolve
    expect(await screen.findByText('Rosewood')).toBeTruthy()
    expect(screen.getByText('out of stock')).toBeTruthy()
    expect(screen.getByText('1 of 2 checks passed')).toBeTruthy()
    expect(screen.getByText(/Assign follow-up to rep/)).toBeTruthy()
  })

  it('Export downloads the branch-scoped compliance CSV', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Compliance />, { session: managerSession() })
    await screen.findByText('Chicago')
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(vi.mocked(downloadCsv)).toHaveBeenCalledWith(
      expect.stringContaining('/export/compliance?format=csv'),
      expect.any(String),
    )
  })
})
