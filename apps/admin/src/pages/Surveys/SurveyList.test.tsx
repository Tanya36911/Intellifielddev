import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
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
})
