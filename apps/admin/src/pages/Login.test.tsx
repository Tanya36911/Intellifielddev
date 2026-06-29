import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '@intelli/api-client'
import { makeStore } from '../store'
import { dana, fakeToken, HOUR } from '../test/fixtures'
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

describe('the login page', () => {
  it('catches an empty password before sending anything', async () => {
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'dana@lumenbeauty.com')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your password')).toBeInTheDocument()
    expect(mockedLogin).not.toHaveBeenCalled()
  })

  it('catches text that is not shaped like an email', async () => {
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email')
    await userEvent.type(screen.getByLabelText('Password'), 'demo1234')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(
      await screen.findByText('That does not look like an email address'),
    ).toBeInTheDocument()
    expect(mockedLogin).not.toHaveBeenCalled()
  })

  it('shows the backend message on a wrong password and keeps the typing', async () => {
    mockedLogin.mockRejectedValue(new ApiError(401, 'Invalid email or password'))
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'dana@lumenbeauty.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(screen.getByLabelText('Email')).toHaveValue('dana@lumenbeauty.com')
  })

  it('stores the session and moves to the home page on success', async () => {
    const session = { token: fakeToken(Date.now() + HOUR), user: dana }
    mockedLogin.mockResolvedValue(session)
    const store = renderLogin()
    await userEvent.type(screen.getByLabelText('Email'), 'dana@lumenbeauty.com')
    await userEvent.type(screen.getByLabelText('Password'), 'demo1234')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('HOME PAGE')).toBeInTheDocument()
    expect(store.getState().auth.session).toEqual(session)
  })

  it('shows the demo hint while we develop', () => {
    renderLogin()
    expect(screen.getByText(/dana@lumenbeauty\.com \/ demo1234/)).toBeInTheDocument()
  })
})
