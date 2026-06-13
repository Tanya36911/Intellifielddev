import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { ApiError } from './lib/api'
import { makeStore } from './store'
import { SESSION_KEY } from './store/auth'
import { dana, fakeToken, HOUR } from './test/fixtures'

vi.mock('./lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/api')>()),
  login: vi.fn(),
  health: vi.fn(),
}))

import { health, login } from './lib/api'
const mockedLogin = vi.mocked(login)
const mockedHealth = vi.mocked(health)

function renderApp(startAt = '/') {
  const store = makeStore()
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[startAt]}>
        <App />
      </MemoryRouter>
    </Provider>,
  )
  return store
}

describe('the doorman rules', () => {
  it('sends a stranger who opens / to the login page', () => {
    renderApp('/')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('throws away an expired saved session at startup', () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: fakeToken(Date.now() - HOUR), user: dana }),
    )
    renderApp('/')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('lets a saved, still-valid session straight in, even at /login', async () => {
    mockedHealth.mockResolvedValue(true)
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: fakeToken(Date.now() + HOUR), user: dana }),
    )
    renderApp('/login')
    expect(await screen.findByRole('heading', { name: 'Welcome, Dana' })).toBeInTheDocument()
  })

  it('sends any unknown address to the right place', () => {
    renderApp('/no-such-page')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
})

describe('the whole journey', () => {
  it('logs in, lands home, signs out', async () => {
    mockedHealth.mockResolvedValue(true)
    mockedLogin.mockResolvedValue({ token: fakeToken(Date.now() + HOUR), user: dana })
    renderApp('/')
    await userEvent.type(screen.getByLabelText('Email'), 'dana@lumenbeauty.com')
    await userEvent.type(screen.getByLabelText('Password'), 'demo1234')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Welcome, Dana' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('shows the backend message on a wrong password', async () => {
    mockedLogin.mockRejectedValue(new ApiError(401, 'Invalid email or password'))
    renderApp('/')
    await userEvent.type(screen.getByLabelText('Email'), 'dana@lumenbeauty.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
  })
})
