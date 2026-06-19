import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { makeStore } from '../store'

// Wrap a component in the same providers the app uses, with retries off so a
// failing query fails fast in tests.
export function renderApp(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
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
