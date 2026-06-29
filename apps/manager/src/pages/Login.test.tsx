import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '@intelli/api-client'
import { makeStore } from '../store'
import { sarah, fakeToken, HOUR } from '../test/fixtures'
import Login from './Login'

vi.mock('@intelli/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@intelli/api-client')>()),
  login: vi.fn(),
}))

import { login } from '@intelli/api-client'
const mockedLogin = vi.mocked(login)

function renderLogin() {
  const store = makeStore()
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>HOME PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
  return store
}

describe('the Manager login page', () => {
  it('shows the Manager wordmark and subtitle', () => {
    renderLogin()
    expect(screen.getByText('Manager')).toBeInTheDocument()
    expect(screen.getByText('Sign in to review and run your branch.')).toBeInTheDocument()
  })

  it('catches an empty password before sending anything', async () => {
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'sarah@lumenbeauty.com')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your password')).toBeInTheDocument()
    expect(mockedLogin).not.toHaveBeenCalled()
  })

  it('shows the backend message on a wrong password and keeps the typing', async () => {
    mockedLogin.mockRejectedValue(new ApiError(401, 'Invalid email or password'))
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'sarah@lumenbeauty.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(screen.getByLabelText('Email')).toHaveValue('sarah@lumenbeauty.com')
  })

  it('stores the session and moves to the home page on success', async () => {
    const session = { token: fakeToken(Date.now() + HOUR), user: sarah }
    mockedLogin.mockResolvedValue(session)
    const store = renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'sarah@lumenbeauty.com')
    await userEvent.type(screen.getByLabelText('Password'), 'demo1234')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('HOME PAGE')).toBeInTheDocument()
    expect(store.getState().auth.session).toEqual(session)
  })

  it('shows the demo hint while we develop', () => {
    renderLogin()
    expect(screen.getByText(/sarah@lumenbeauty\.com \/ demo1234/)).toBeInTheDocument()
  })
})
