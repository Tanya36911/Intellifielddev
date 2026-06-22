import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { makeStore } from '../store'
import type { Session } from '../store/auth'
import { SESSION_KEY } from '../lib/session'

// Wrap a component in the same providers the app uses, with retries off so a
// failing query fails fast in tests. Pass `session` to render as a signed-in user
// (seeded before the store is built, which is how makeStore() picks it up).
export function renderApp(
  ui: ReactElement,
  { route = '/', session }: { route?: string; session?: Session } = {},
) {
  if (session !== undefined) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  const store = makeStore()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    </Provider>
  )
  return { store, ...render(ui, { wrapper: Wrapper }) }
}
