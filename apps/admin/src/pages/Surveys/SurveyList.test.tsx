import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession } from '../../test/fixtures'
import SurveyList from './SurveyList'
import * as api from '../../lib/api'

const SURVEYS = [
  { id: 's1', name: 'Velvet Lip Shelf Check', type: null, status: 'published', created_at: '', latest_version: 2, assigned: true },
  { id: 's2', name: 'Spring Reset', type: null, status: 'draft', created_at: '', latest_version: 1, assigned: false },
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
})
