import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@intelli/tokens/tokens.css'
import './index.css'
import App from './App'
import { store } from './store'
import { configureSession } from '@intelli/api-client'
import { SESSION_KEY } from './store/auth'

// Tell the shared API client which localStorage key holds this app's login, so
// the Admin and Manager apps never read each other's session.
configureSession(SESSION_KEY)

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>,
)
