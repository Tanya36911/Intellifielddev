import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import { ResponsesListModal } from './ResponsesListModal'
import type { Survey } from './useSurveys'
import type { ResponseRow } from './useResponses'

const SURVEY: Survey = {
  id: 's1', name: 'Velvet Lip Shelf Check', type: null,
  status: 'published', created_at: '', latest_version: 2, assigned: true,
}

const ROW: ResponseRow = {
  id: 'r1', survey_version_id: 'v1', survey_id: 's1', store_node_id: 'n1',
  store_path: '/lumen/west/sf/', user_id: 'u1', online: true,
  submitted_at: '2026-06-01T10:00:00Z', created_at: '2026-06-01T10:00:00Z',
  store_name: 'SF Flagship', survey_name: 'Velvet Lip Shelf Check',
  survey_version_number: 2, rep_name: 'Marcus Bell', overall: true,
  scored: 2, passed: 2,
}

const OFFLINE_ROW: ResponseRow = {
  ...ROW, id: 'r2', online: false, overall: false, rep_name: 'Jane Doe',
  scored: 2, passed: 0,
}

describe('ResponsesListModal', () => {
  it('renders empty state when no rows', () => {
    renderApp(
      <ResponsesListModal open survey={SURVEY} rows={[]} onClose={vi.fn()} onOpenDetail={vi.fn()} />,
      { session: adminSession() },
    )
    expect(screen.getByText(/no responses captured/i)).toBeInTheDocument()
  })

  it('renders rows with rep name, store, and status chip', () => {
    renderApp(
      <ResponsesListModal open survey={SURVEY} rows={[ROW]} onClose={vi.fn()} onOpenDetail={vi.fn()} />,
      { session: adminSession() },
    )
    expect(screen.getByText('SF Flagship')).toBeInTheDocument()
    expect(screen.getByText(/marcus bell/i)).toBeInTheDocument()
    expect(screen.getByText('Pass')).toBeInTheDocument()
  })

  it('shows offline label for offline rows', () => {
    renderApp(
      <ResponsesListModal open survey={SURVEY} rows={[OFFLINE_ROW]} onClose={vi.fn()} onOpenDetail={vi.fn()} />,
      { session: adminSession() },
    )
    expect(screen.getByText(/queued offline/i)).toBeInTheDocument()
    expect(screen.getByText('Fail')).toBeInTheDocument()
  })

  it('calls onOpenDetail when a row is clicked', () => {
    const onOpenDetail = vi.fn()
    renderApp(
      <ResponsesListModal open survey={SURVEY} rows={[ROW]} onClose={vi.fn()} onOpenDetail={onOpenDetail} />,
      { session: adminSession() },
    )
    const rowBtn = screen.getByRole('button', { name: /sf flagship/i })
    fireEvent.click(rowBtn)
    expect(onOpenDetail).toHaveBeenCalledWith(ROW)
  })

  it('calls onClose when backdrop or close button is clicked', () => {
    const onClose = vi.fn()
    renderApp(
      <ResponsesListModal open survey={SURVEY} rows={[ROW]} onClose={onClose} onOpenDetail={vi.fn()} />,
      { session: adminSession() },
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
