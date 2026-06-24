import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession, repSession } from '../../test/fixtures'
import SurveyList from './SurveyList'
import * as api from '../../lib/api'

const SURVEYS = [
  { id: 's1', name: 'Velvet Lip Shelf Check', type: null, status: 'published', created_at: '', latest_version: 2, assigned: true },
  { id: 's2', name: 'Spring Reset', type: null, status: 'draft', created_at: '', latest_version: 1, assigned: false },
]

const SURVEYS_WITH_ARCHIVED = [
  ...SURVEYS,
  { id: 's3', name: 'Old Audit', type: null, status: 'archived', created_at: '', latest_version: 4, assigned: false },
]

beforeEach(() => {
  vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
    if (path === '/surveys') return { surveys: SURVEYS } as any
    if (path === '/responses') return { responses: [], count: 0 } as any
    if (path === '/skus') return { skus: [], count: 0 } as any
    return {} as any
  })
})

describe('SurveyList', () => {
  it('renders surveys with status, version, and assignment', async () => {
    renderApp(<SurveyList />, { session: adminSession() })
    expect(await screen.findByText('Velvet Lip Shelf Check')).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByText(/assigned/i)).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('non-admin rep sees no action buttons (read-only)', async () => {
    renderApp(<SurveyList />, { session: repSession() })
    await screen.findByText('Velvet Lip Shelf Check')
    expect(screen.queryByRole('button', { name: /new survey/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /assign/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /continue editing/i })).toBeNull()
  })

  it('archived survey row shows a disabled Edit button', async () => {
    vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
      if (path === '/surveys') return { surveys: SURVEYS_WITH_ARCHIVED } as any
      if (path === '/responses') return { responses: [], count: 0 } as any
      if (path === '/skus') return { skus: [], count: 0 } as any
      return {} as any
    })
    renderApp(<SurveyList />, { session: adminSession() })
    await screen.findByText('Old Audit')
    // The archived row renders a disabled Edit button; all other Edit buttons are enabled.
    // Use hidden:true because the disabled button may be excluded from the accessible tree.
    const allEditBtns = screen.getAllByRole('button', { name: /edit/i, hidden: true })
    const disabledEditBtn = allEditBtns.find((btn) => (btn as HTMLButtonElement).disabled)
    expect(disabledEditBtn).toBeDefined()
    expect(disabledEditBtn).toBeDisabled()
  })

  it('shows a responses button for each survey row', async () => {
    renderApp(<SurveyList />, { session: adminSession() })
    await screen.findByText('Velvet Lip Shelf Check')
    const responsesBtns = screen.getAllByRole('button', { name: /\d+ responses?/i })
    expect(responsesBtns.length).toBe(2)
  })

  it('responses button is disabled when count is 0', async () => {
    renderApp(<SurveyList />, { session: adminSession() })
    await screen.findByText('Velvet Lip Shelf Check')
    const responsesBtns = screen.getAllByRole('button', { name: /0 responses/i })
    responsesBtns.forEach((btn) => expect(btn).toBeDisabled())
  })

  it('rep user also sees the responses button (not admin-only)', async () => {
    renderApp(<SurveyList />, { session: repSession() })
    await screen.findByText('Velvet Lip Shelf Check')
    const responsesBtns = screen.getAllByRole('button', { name: /\d+ responses?/i })
    expect(responsesBtns.length).toBe(2)
  })

  it('clicking a responses button opens the list modal', async () => {
    vi.spyOn(api, 'apiGet').mockImplementation(async (path: string) => {
      if (path === '/surveys') return { surveys: SURVEYS } as any
      if (path === '/responses') return {
        responses: [{
          id: 'r1', survey_version_id: 'v1', survey_id: 's1', store_node_id: 'n1',
          store_path: '/lumen/', user_id: 'u1', online: true,
          submitted_at: '2026-06-01T10:00:00Z', created_at: '2026-06-01T10:00:00Z',
          store_name: 'SF Store', survey_name: 'Velvet Lip Shelf Check',
          survey_version_number: 2, rep_name: 'Marcus Bell', overall: true,
          scored: 2, passed: 2,
        }],
        count: 1,
      } as any
      if (path === '/skus') return { skus: [], count: 0 } as any
      return {} as any
    })
    renderApp(<SurveyList />, { session: adminSession() })
    await screen.findByText('Velvet Lip Shelf Check')
    // Wait for responses to load
    const responsesBtn = await screen.findByRole('button', { name: /1 response/i })
    fireEvent.click(responsesBtn)
    expect(await screen.findByText('Submitted responses')).toBeInTheDocument()
  })
})
