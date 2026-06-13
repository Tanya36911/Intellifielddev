import { dana, fakeToken, HOUR } from '../test/fixtures'
import { isExpired, loadSession, SESSION_KEY, signedIn, signedOut } from './auth'
import { makeStore } from './index'

describe('isExpired', () => {
  it('is false for a token that still has time left', () => {
    expect(isExpired(fakeToken(Date.now() + HOUR))).toBe(false)
  })

  it('is true for a token past its expiry', () => {
    expect(isExpired(fakeToken(Date.now() - HOUR))).toBe(true)
  })

  it('is true for garbage that is not a token', () => {
    expect(isExpired('not-a-token')).toBe(true)
  })
})

describe('the session pocket', () => {
  it('remembers a sign-in and mirrors it to localStorage', () => {
    const store = makeStore()
    const session = { token: fakeToken(Date.now() + HOUR), user: dana }
    store.dispatch(signedIn(session))
    expect(store.getState().auth.session).toEqual(session)
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual(session)
  })

  it('forgets everything on sign-out', () => {
    const store = makeStore()
    store.dispatch(signedIn({ token: fakeToken(Date.now() + HOUR), user: dana }))
    store.dispatch(signedOut())
    expect(store.getState().auth.session).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })
})

describe('loadSession (what runs when the app starts)', () => {
  it('restores a still-valid saved session', () => {
    const session = { token: fakeToken(Date.now() + HOUR), user: dana }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    expect(loadSession()).toEqual(session)
  })

  it('throws away an expired session', () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: fakeToken(Date.now() - HOUR), user: dana }),
    )
    expect(loadSession()).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('is empty-handed when nothing was saved', () => {
    expect(loadSession()).toBeNull()
  })
})
