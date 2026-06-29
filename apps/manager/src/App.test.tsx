import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from './test/render'
import App from './App'
import { managerSession, adminSession, repSession } from './test/fixtures'

// The sidebar fetches the footprint from /analytics/dashboard; stub it so no
// real network happens. Everything else (login, configureSession) stays real.
vi.mock('@intelli/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@intelli/api-client')>()),
  apiGet: vi.fn().mockResolvedValue({ footprint: { nodes: 6, stores: 4, reps: 3 } }),
}))

describe('the Manager app doorman', () => {
  it('sends an unauthenticated visitor to the login screen', () => {
    renderApp(<App />, { route: '/' })
    expect(screen.getByText('Sign in to review and run your branch.')).toBeInTheDocument()
  })

  it('shows the shell with the loud scope chip for a signed-in manager', () => {
    renderApp(<App />, { route: '/', session: managerSession() })
    expect(screen.getByText('Your scope')).toBeInTheDocument()
    expect(screen.getAllByText('Central Region').length).toBeGreaterThan(0)
    // a real nav item and a coming-soon one both render
    expect(screen.getByText('Compliance Review')).toBeInTheDocument()
    expect(screen.getByText('Route Planning')).toBeInTheDocument()
  })

  it('lets an admin in, scoped to the whole company', () => {
    renderApp(<App />, { route: '/', session: adminSession() })
    expect(screen.getByText('Your scope')).toBeInTheDocument()
    expect(screen.getByText('Whole company')).toBeInTheDocument()
  })

  it('bounces a field rep to the no-access wall (no shell)', () => {
    renderApp(<App />, { route: '/', session: repSession() })
    expect(screen.getByText('This app is for managers')).toBeInTheDocument()
    expect(screen.queryByText('Your scope')).not.toBeInTheDocument()
  })

  it('redirects a signed-in manager away from /login', () => {
    renderApp(<App />, { route: '/login', session: managerSession() })
    // lands on the dashboard placeholder inside the shell, not the login form
    expect(screen.queryByText('Sign in to review and run your branch.')).not.toBeInTheDocument()
    expect(screen.getByText('Your scope')).toBeInTheDocument()
  })
})
