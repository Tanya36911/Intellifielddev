import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { ApiError } from './lib/api'
import { makeStore } from './store'
import { SESSION_KEY } from './store/auth'
import { dana, fakeToken, HOUR, adminSession } from './test/fixtures'

vi.mock('./lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/api')>()),
  login: vi.fn(),
  health: vi.fn(),
  // The dashboard fetches on mount, so the journey/redirect tests stub the
  // authenticated GET (and the CSV download) to keep the queries quiet.
  apiGet: vi.fn(),
  downloadCsv: vi.fn(),
}))

import { apiGet, health, login } from './lib/api'
const mockedLogin = vi.mocked(login)
const mockedHealth = vi.mocked(health)
const mockedApiGet = vi.mocked(apiGet)

// The dashboard reads /analytics/dashboard and /analytics/compliance on mount.
const DASH = {
  footprint: { nodes: 0, stores: 0, reps: 0 },
  current: {
    completion_pct: null,
    pass_pct: null,
    expected: 0,
    responded: 0,
    scored: 0,
    passed: 0,
    surveys_completed: 0,
    overdue: 0,
  },
  previous: null,
  trend: [],
}
function dashboardRoute(path: string) {
  if (path.startsWith('/analytics/compliance'))
    return Promise.resolve({ is_store: false, children: [] })
  if (path.startsWith('/analytics/dashboard')) return Promise.resolve(DASH)
  return Promise.resolve({})
}

function renderApp(startAt = '/') {
  const store = makeStore()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[startAt]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  )
  return store
}

beforeEach(() => {
  mockedApiGet.mockImplementation(dashboardRoute as never)
})

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
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: fakeToken(Date.now() + HOUR), user: dana }),
    )
    renderApp('/login')
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
  })

  it('sends any unknown address to the right place', () => {
    renderApp('/no-such-page')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
})

describe('the whole journey', () => {
  it('logs in, lands on the dashboard inside the shell, signs out', async () => {
    mockedHealth.mockResolvedValue(true)
    mockedLogin.mockResolvedValue({ token: fakeToken(Date.now() + HOUR), user: dana })
    renderApp('/')
    await userEvent.type(screen.getByLabelText('Email'), 'dana@lumenbeauty.com')
    await userEvent.type(screen.getByLabelText('Password'), 'demo1234')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    // The shell (sidebar brand) and the dashboard (Analytics topbar) both appear.
    expect(await screen.findByText('Intelli')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument()
    // Sign-out now lives in the sidebar's user card.
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
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

it('shows the Surveys screen at /surveys and has no Form Builder nav item', async () => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(adminSession()))
  mockedApiGet.mockImplementation(async (path: string) => {
    if (path === '/surveys') return { surveys: [] } as any
    return dashboardRoute(path) as any
  })
  renderApp('/surveys')
  expect(await screen.findByRole('heading', { name: /surveys/i })).toBeInTheDocument()
  expect(screen.queryByText(/form builder/i)).not.toBeInTheDocument()
})
