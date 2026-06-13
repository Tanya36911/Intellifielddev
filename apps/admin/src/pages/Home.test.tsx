import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { makeStore } from '../store'
import { SESSION_KEY, signedIn } from '../store/auth'
import { dana, fakeToken, HOUR } from '../test/fixtures'
import Home from './Home'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  health: vi.fn(),
}))

import { health } from '../lib/api'
const mockedHealth = vi.mocked(health)

function renderHome() {
  const store = makeStore()
  store.dispatch(signedIn({ token: fakeToken(Date.now() + HOUR), user: dana }))
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
  return store
}

describe('the home page', () => {
  it('greets the signed-in person by first name and shows their role', async () => {
    mockedHealth.mockResolvedValue(true)
    renderHome()
    expect(screen.getByRole('heading', { name: 'Welcome, Dana' })).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(await screen.findByText('API: connected')).toBeInTheDocument()
  })

  it('says plainly when the backend is not reachable', async () => {
    mockedHealth.mockResolvedValue(false)
    renderHome()
    expect(
      await screen.findByText('API: not reachable (docker compose up -d)'),
    ).toBeInTheDocument()
  })

  it('sign out forgets the session and returns to the login page', async () => {
    mockedHealth.mockResolvedValue(true)
    const store = renderHome()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(store.getState().auth.session).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })
})
