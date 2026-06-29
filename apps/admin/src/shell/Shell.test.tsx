import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { renderApp } from '../test/render'
import { SESSION_KEY } from '../store/auth'
import { fakeToken, HOUR } from '../test/fixtures'
import Shell from './Shell'

vi.mock('@intelli/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@intelli/api-client')>()),
  apiGet: vi.fn().mockResolvedValue({ footprint: { nodes: 8, stores: 3, reps: 2 } }),
}))
afterEach(() => vi.clearAllMocks())

// Seed a logged-in session so the auth slice loads a user when makeStore()
// initializes (it reads localStorage on init). A still-valid token is required
// because loadSession discards expired ones.
beforeEach(() => {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: fakeToken(Date.now() + HOUR),
      user: {
        name: 'Dana Whitfield',
        role: 'admin',
        company_name: 'Lumen Beauty',
        pinned_node_name: 'Lumen Beauty',
      },
    }),
  )
})

describe('Shell', () => {
  it('renders the sidebar and the routed outlet content', () => {
    renderApp(
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<div>OUTLET</div>} />
        </Route>
      </Routes>,
      { route: '/' },
    )
    expect(screen.getByText('Intelli')).toBeTruthy()
    expect(screen.getByText('OUTLET')).toBeTruthy()
  })
})
