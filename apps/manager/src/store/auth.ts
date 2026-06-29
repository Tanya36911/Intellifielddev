// The session pocket: the one place the app remembers who is signed in.
// Mirrored into localStorage so it survives closing the browser, and
// expiry-checked every time the app starts.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { SessionUser } from '@intelli/api-client'
// The Manager app's session-storage key. It is DIFFERENT from the Admin app's
// key on purpose, so the two apps never share a login even on the same origin.
// The shared API client is told this key once at startup (configureSession).
export const SESSION_KEY = 'intelli-manager-session'

export type Session = { token: string; user: SessionUser }

// A JWT is three base64url chunks joined by dots; the middle one is the
// payload and carries exp, the expiry moment in seconds since 1970.
export function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    )
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as Session
    if (!session?.token || isExpired(session.token)) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

type AuthState = { session: Session | null }

const authSlice = createSlice({
  name: 'auth',
  initialState: (): AuthState => ({ session: loadSession() }),
  reducers: {
    signedIn(state, action: PayloadAction<Session>) {
      state.session = action.payload
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(action.payload))
      } catch {
        // Storage being unavailable only costs the stay-signed-in nicety.
      }
    },
    signedOut(state) {
      state.session = null
      try {
        localStorage.removeItem(SESSION_KEY)
      } catch {
        // Same: losing storage access never breaks sign-out itself.
      }
    },
  },
})

export const { signedIn, signedOut } = authSlice.actions
export default authSlice.reducer
