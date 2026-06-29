import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../test/render'
import { Sidebar } from './Sidebar'
import { sarah } from '../test/fixtures'

vi.mock('@intelli/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@intelli/api-client')>()),
  apiGet: vi.fn().mockResolvedValue({ footprint: { nodes: 6, stores: 4, reps: 3 } }),
}))

describe('the Manager sidebar', () => {
  it('shows the scope chip with the manager pinned node', () => {
    renderApp(<Sidebar user={sarah} onSignOut={() => {}} />)
    expect(screen.getByText('Your scope')).toBeInTheDocument()
    expect(screen.getByText('Central Region')).toBeInTheDocument()
  })

  it('shows the locked company card', () => {
    renderApp(<Sidebar user={sarah} onSignOut={() => {}} />)
    expect(screen.getByText('Lumen Beauty')).toBeInTheDocument()
  })

  it('lists all six nav items, with the two backendless ones marked soon', () => {
    renderApp(<Sidebar user={sarah} onSignOut={() => {}} />)
    for (const label of [
      'Dashboard',
      'Compliance Review',
      'Survey Assignment',
      'Route Planning',
      'Payroll Approval',
      'Announcements',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // Route Planning and Announcements are the two "soon" items
    expect(screen.getAllByText('soon')).toHaveLength(2)
  })

  it('fires onSignOut when the sign-out button is clicked', async () => {
    const onSignOut = vi.fn()
    renderApp(<Sidebar user={sarah} onSignOut={onSignOut} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledOnce()
  })
})
