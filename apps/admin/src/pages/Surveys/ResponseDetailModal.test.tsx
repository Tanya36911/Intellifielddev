import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import { ResponseDetailModal } from './ResponseDetailModal'
import * as api from '../../lib/api'
import type { BackendQuestion } from './useSurveys'
import type { Sku } from '../Catalog/useCatalog'

const QUESTIONS: BackendQuestion[] = [
  {
    id: 'q1', prompt: 'How many facings?', type: 'number', options: [],
    sku_ids: ['sku-rose', 'sku-mauve'], perSku: true,
    pass: { operator: '>=', value: 4 }, passScope: 'each', required: true,
    unit: 'facings', lines: ['Velvet Lip'],
  },
  {
    id: 'q2', prompt: 'Is the endcap present?', type: 'boolean', options: [],
    sku_ids: [], perSku: false,
    pass: { operator: '==', value: true }, passScope: 'each', required: true,
    unit: null, lines: [],
  },
  {
    id: 'q3', prompt: 'Upload shelf photo', type: 'photo', options: [],
    sku_ids: [], perSku: false, pass: null, passScope: 'each', required: false,
    unit: null, lines: [],
  },
]

const SKUS: Sku[] = [
  { id: 'sku-rose', line: 'Velvet Lip', variant: 'Rosewood', upc: 'LUM-VL-ROSE', color: '#9b5b5b', status: 'active', reference_images: [], created_at: '' },
  { id: 'sku-mauve', line: 'Velvet Lip', variant: 'Mauve', upc: 'LUM-VL-MAUVE', color: '#7e5c6f', status: 'active', reference_images: [], created_at: '' },
]

const DETAIL = {
  id: 'r1', survey_version_id: 'v1', survey_id: 's1', store_node_id: 'n1',
  store_path: '/lumen/west/sf/', user_id: 'u1', online: true,
  submitted_at: '2026-06-01T10:00:00Z', created_at: '2026-06-01T10:00:00Z',
  store_name: 'SF Flagship', survey_name: 'Velvet Lip Shelf Check',
  survey_version_number: 2, rep_name: 'Marcus Bell', overall: true,
  scored: 2, passed: 1,
  items: [
    { question_id: 'q1', sku_id: 'sku-rose', value: 5, pass: true },
    { question_id: 'q1', sku_id: 'sku-mauve', value: 3, pass: false },
    { question_id: 'q2', sku_id: null, value: true, pass: true },
  ],
  questions: { q1: false, q2: true, q3: null },
}

beforeEach(() => {
  vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
    if (path === '/responses/r1') return DETAIL as any
    return {} as any
  })
})

describe('ResponseDetailModal', () => {
  it('renders loading state initially', () => {
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} />,
      { session: adminSession() },
    )
    expect(screen.getByText(/loading response/i)).toBeInTheDocument()
  })

  it('renders rep name, store name, and verdict after loading', async () => {
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} />,
      { session: adminSession() },
    )
    expect(await screen.findByText('Marcus Bell')).toBeInTheDocument()
    const storeInstances = screen.getAllByText('SF Flagship')
    expect(storeInstances.length).toBeGreaterThan(0)
  })

  it('renders per-SKU facings grid with pass and fail cells', async () => {
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} />,
      { session: adminSession() },
    )
    await screen.findByText('Marcus Bell')
    // Rosewood passed (5 >= 4), Mauve failed (3 < 4)
    expect(screen.getByText('Rosewood')).toBeInTheDocument()
    expect(screen.getByText('Mauve')).toBeInTheDocument()
    // Values
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('applies pass styling to a passing item and fail styling to a failing item', async () => {
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} />,
      { session: adminSession() },
    )
    await screen.findByText('Marcus Bell')
    // Rosewood (pass: true) cell should carry the pass CSS class; check via closest
    const rosewood = screen.getByText('Rosewood')
    const passCell = rosewood.closest('[class*="facingCell"]')
    expect(passCell?.className).toMatch(/facingCellPass/)
    // Mauve (pass: false) cell should carry the fail CSS class
    const mauve = screen.getByText('Mauve')
    const failCell = mauve.closest('[class*="facingCell"]')
    expect(failCell?.className).toMatch(/facingCellFail/)
  })

  it('renders photo placeholder for photo questions', async () => {
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} />,
      { session: adminSession() },
    )
    await screen.findByText('Marcus Bell')
    expect(screen.getByTestId('photo-placeholder')).toBeInTheDocument()
    expect(screen.getByText(/photo coming soon/i)).toBeInTheDocument()
  })

  it('shows "All responses" back button when onBack is provided', async () => {
    const onBack = vi.fn()
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} onBack={onBack} />,
      { session: adminSession() },
    )
    expect(screen.getByRole('button', { name: /all responses/i })).toBeInTheDocument()
  })

  it('does not show back button when onBack is not provided', async () => {
    renderApp(
      <ResponseDetailModal open responseId="r1" questions={QUESTIONS} skus={SKUS} onClose={vi.fn()} />,
      { session: adminSession() },
    )
    expect(screen.queryByRole('button', { name: /all responses/i })).toBeNull()
  })
})
