# Admin Login Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Admin app's login screen against the existing FastAPI POST /auth/login, plus the permanent frontend rails (routing, forms, session store, fonts, tests), finishing Phase 1.

**Architecture:** A `lib/api.ts` module is the only code that talks to the backend. A Redux Toolkit `auth` slice is the only holder of the session (token + user), mirrored to localStorage under one key and expiry-checked on load. React Router (declarative mode) maps `/login` and `/` with redirect guards in `App.tsx`. Pages are thin: react-hook-form + zod handle the form, CSS Modules + the shared tokens handle the look (measurements copied from the prototype's styles.css: inputs 38px/r-sm, primary button 42px/r-sm, cards r-lg).

**Tech Stack:** React 19, Vite 6, react-router-dom v7, @reduxjs/toolkit v2 + react-redux v9, react-hook-form v7 + zod v3 + @hookform/resolvers v3, Vitest v3 + jsdom + Testing Library. Spec: `docs/superpowers/specs/2026-06-12-admin-login-screen-design.md`.

**Conventions for every commit in this plan:** run from the repo root `/Users/tanyajustin/Documents/intelli-app`. Commit messages end with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. No em dashes anywhere (code comments, UI copy, commit messages). UI copy uses plain sentences.

**Note on the demo user:** the seeded account is `dana@lumenbeauty.com` / `demo1234`, display name `Dana Whitfield`, role `admin` (see `api/app/seed.py`). The backend returns `{ token, user: { name, role } }` on success and `401 { "detail": "Invalid email or password" }` on failure (see `api/app/auth.py`). Tokens expire after 12 hours (`api/app/security.py`).

---

### Task 1: Install the new tools and the test harness

**Files:**
- Modify: `apps/admin/package.json` (via pnpm + one script edit)
- Modify: `package.json` (root; add test shortcut)
- Modify: `apps/admin/vite.config.ts`
- Modify: `apps/admin/tsconfig.json`
- Create: `apps/admin/src/test/setup.ts`
- Create: `apps/admin/src/test/fixtures.ts`

- [ ] **Step 1: Install runtime libraries**

Run:
```bash
pnpm --filter @intelli/admin add react-router-dom@^7 @reduxjs/toolkit@^2 react-redux@^9 react-hook-form@^7 zod@^3.25 @hookform/resolvers@^3
```
Expected: pnpm resolves and writes them to `apps/admin/package.json` dependencies.

- [ ] **Step 2: Install test tools (dev-only)**

Run:
```bash
pnpm --filter @intelli/admin add -D vitest@^3 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```
Expected: added under devDependencies.

- [ ] **Step 3: Add test scripts**

In `apps/admin/package.json`, change the `"scripts"` block to:
```json
"scripts": {
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
},
```

In the root `package.json`, add to `"scripts"` (after `"build:admin"`):
```json
"test:admin": "pnpm --filter @intelli/admin test",
```

- [ ] **Step 4: Teach Vite about tests**

Replace the full contents of `apps/admin/vite.config.ts` with:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    clearMocks: true,
    setupFiles: './src/test/setup.ts',
  },
})
```

In `apps/admin/tsconfig.json`, change the `"types"` line to:
```json
"types": ["vite/client", "vitest/globals"]
```

- [ ] **Step 5: Create the test setup and shared fixtures**

Create `apps/admin/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})
```

Create `apps/admin/src/test/fixtures.ts`:
```ts
export const HOUR = 60 * 60 * 1000

// A fake (unsigned) wristband whose payload expires at the given moment.
// Only the middle chunk matters to the app; signatures are the backend's job.
export function fakeToken(expiresAtMs: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(expiresAtMs / 1000) }))
  return `header.${payload}.signature`
}

export const dana = { name: 'Dana Whitfield', role: 'admin' }
```

- [ ] **Step 6: Verify the harness boots**

Run:
```bash
pnpm --filter @intelli/admin exec vitest run --passWithNoTests
```
Expected: exits 0 with "No test files found" (that's fine; real tests arrive in Task 2).

- [ ] **Step 7: Commit**

```bash
git add apps/admin package.json pnpm-lock.yaml
git commit -m "Admin: install router, forms, session store, and test harness (Phase 1 rails)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The backend-talker (lib/api.ts)

**Files:**
- Create: `apps/admin/src/lib/api.ts`
- Test: `apps/admin/src/lib/api.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/lib/api.test.ts`:
```ts
import { health, login } from './api'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('login', () => {
  it('returns the token and user when the backend accepts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, { token: 'abc', user: { name: 'Dana Whitfield', role: 'admin' } }),
      ),
    )
    const result = await login('dana@lumenbeauty.com', 'demo1234')
    expect(result.token).toBe('abc')
    expect(result.user.name).toBe('Dana Whitfield')
  })

  it('passes through the backend message on a wrong password', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { detail: 'Invalid email or password' })),
    )
    await expect(login('dana@lumenbeauty.com', 'nope')).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email or password',
    })
  })

  it('explains plainly when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(login('a@b.com', 'x')).rejects.toMatchObject({
      status: 0,
      message: "Can't reach the backend. Is it running? (docker compose up -d)",
    })
  })
})

describe('health', () => {
  it('is true when the backend answers ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' })))
    expect(await health()).toBe(true)
  })

  it('is false when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await health()).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @intelli/admin test`
Expected: FAIL, cannot resolve `./api` (file does not exist yet).

- [ ] **Step 3: Implement the module**

Create `apps/admin/src/lib/api.ts`:
```ts
// The one place the frontend talks to the backend. Screens import these
// helpers; nothing else in the app calls fetch directly.
export const API_BASE = 'http://localhost:8000'

export type SessionUser = { name: string; role: string }
export type LoginResult = { token: string; user: SessionUser }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const CANT_REACH = "Can't reach the backend. Is it running? (docker compose up -d)"

export async function login(email: string, password: string): Promise<LoginResult> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch {
    throw new ApiError(0, CANT_REACH)
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => d?.detail)
      .catch(() => null)
    throw new ApiError(
      res.status,
      typeof detail === 'string' ? detail : 'Something went wrong. Try again.',
    )
  }
  return res.json()
}

export async function health(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`)
    const data = await res.json()
    return data.status === 'ok'
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @intelli/admin test`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib
git commit -m "Admin: api helper owns all backend talk (login + health), tested

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The session pocket (Redux auth slice + store)

**Files:**
- Create: `apps/admin/src/store/auth.ts`
- Create: `apps/admin/src/store/index.ts`
- Test: `apps/admin/src/store/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/store/auth.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @intelli/admin test`
Expected: FAIL, cannot resolve `./auth` and `./index`.

- [ ] **Step 3: Implement the slice**

Create `apps/admin/src/store/auth.ts`:
```ts
// The session pocket: the one place the app remembers who is signed in.
// Mirrored into localStorage so it survives closing the browser, and
// expiry-checked every time the app starts.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { SessionUser } from '../lib/api'

export const SESSION_KEY = 'intelli-admin-session'

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
```

Create `apps/admin/src/store/index.ts`:
```ts
import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import auth from './auth'

// makeStore exists so tests can build a fresh, isolated store each time.
export function makeStore() {
  return configureStore({ reducer: { auth } })
}

export const store = makeStore()

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()

export const selectSession = (state: RootState) => state.auth.session
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @intelli/admin test`
Expected: PASS, 13 tests total (5 from Task 2 + 8 new).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/store
git commit -m "Admin: session pocket (Redux auth slice), localStorage mirror + 12h expiry, tested

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Brand fonts and heading lettering

**Files:**
- Modify: `apps/admin/index.html`
- Modify: `apps/admin/src/index.css`

- [ ] **Step 1: Load the three brand fonts**

In `apps/admin/index.html`, inside `<head>` right after the `<meta name="viewport" ...>` line, add:
```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
```
(Self-hosting these files comes with production hardening, per TECH_STACK.txt.)

- [ ] **Step 2: Point headings at Space Grotesk and set the base text size**

In `apps/admin/src/index.css`, change the `body` block to add one line, and append the heading rule, so the file reads:
```css
* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  font-family: var(--sans);
  font-size: var(--font-base);
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 {
  font-family: 'Space Grotesk', var(--sans);
}
```

- [ ] **Step 3: Eyeball it**

Run: `pnpm dev:admin` then open http://localhost:5173 and confirm the Phase 0 card's heading renders in Space Grotesk (letterforms look geometric, the capital W has no middle serif). Stop the dev server with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/index.html apps/admin/src/index.css
git commit -m "Admin: load brand fonts (Space Grotesk headings, Hanken Grotesk body, JetBrains Mono)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: The login page

**Files:**
- Create: `apps/admin/src/pages/Login.tsx`
- Create: `apps/admin/src/pages/Login.module.css`
- Test: `apps/admin/src/pages/Login.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/pages/Login.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { makeStore } from '../store'
import { dana, fakeToken, HOUR } from '../test/fixtures'
import Login from './Login'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  login: vi.fn(),
}))

import { login } from '../lib/api'
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @intelli/admin test`
Expected: FAIL, cannot resolve `./Login`.

- [ ] **Step 3: Implement the page**

Create `apps/admin/src/pages/Login.tsx`:
```tsx
import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { ApiError, login } from '../lib/api'
import { useAppDispatch } from '../store'
import { signedIn } from '../store/auth'
import styles from './Login.module.css'

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email')
    .email('That does not look like an email address'),
  password: z.string().min(1, 'Enter your password'),
})

type FormValues = z.infer<typeof schema>

export default function Login() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setServerError(null)
    try {
      const result = await login(email, password)
      dispatch(signedIn({ token: result.token, user: result.user }))
      navigate('/', { replace: true })
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    }
  })

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={onSubmit} noValidate>
        <div className={styles.wordmark}>
          Intelli <span className={styles.badge}>Admin</span>
        </div>
        <p className={styles.sub}>Sign in to manage your workspace.</p>

        {serverError && (
          <div className={styles.serverError} role="alert">
            {serverError}
          </div>
        )}

        <label className={styles.label} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className={styles.input}
          {...register('email')}
        />
        {errors.email && <div className={styles.fieldError}>{errors.email.message}</div>}

        <label className={styles.label} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className={styles.input}
          {...register('password')}
        />
        {errors.password && <div className={styles.fieldError}>{errors.password.message}</div>}

        <button className={styles.submit} type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>

        <div className={styles.devHint}>
          <span className={styles.devTag}>DEV</span>
          <span>
            Demo login: <code>dana@lumenbeauty.com / demo1234</code>
          </span>
        </div>
      </form>
    </div>
  )
}
```

Create `apps/admin/src/pages/Login.module.css` (measurements match the prototype's styles.css: `.input` 38px / r-sm, `.btn.lg` 42px / r-sm, `.card` r-lg):
```css
.wrap {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.card {
  width: 360px;
  max-width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  padding: 30px 28px;
}

.wordmark {
  display: flex;
  align-items: center;
  gap: 9px;
  font-family: 'Space Grotesk', var(--sans);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.badge {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--accent);
  background: var(--accent-subtle);
  padding: 3px 8px;
  border-radius: var(--r-full);
  position: relative;
  top: 1px;
}

.sub {
  margin: 7px 0 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--text-2);
}

.label {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
  margin: 18px 0 6px;
}

.input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  font-family: var(--sans);
  transition: border-color 0.14s, box-shadow 0.14s;
  outline: none;
}
.input::placeholder {
  color: var(--text-4);
}
.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.fieldError {
  margin-top: 5px;
  font-size: 12px;
  color: var(--red-fg);
}

.serverError {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  background: var(--red-bg);
  border: 1px solid rgba(220, 38, 38, 0.25);
  border-radius: var(--r-sm);
  font-size: 13px;
  color: var(--red-fg);
}

.submit {
  width: 100%;
  height: 42px;
  margin-top: 20px;
  border: none;
  border-radius: var(--r-sm);
  background: var(--accent);
  color: var(--accent-fg);
  font-size: 14.5px;
  font-weight: 600;
  font-family: var(--sans);
  letter-spacing: -0.005em;
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  transition: background 0.14s;
}
.submit:hover {
  background: var(--accent-hover);
}
.submit:active {
  background: var(--accent-press);
}
.submit:disabled {
  opacity: 0.45;
  pointer-events: none;
}

.devHint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 9px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-sm);
  font-size: 11.5px;
  color: var(--text-3);
}
.devHint code {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-2);
}

.devTag {
  flex-shrink: 0;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--amber-fg);
  background: var(--amber-bg);
  padding: 2px 6px;
  border-radius: var(--r-full);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @intelli/admin test`
Expected: PASS, 18 tests total.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages
git commit -m "Admin: login page (validated form, busy state, honest error messages, DEV hint)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: The home page (welcome placeholder)

**Files:**
- Create: `apps/admin/src/pages/Home.tsx`
- Create: `apps/admin/src/pages/Home.module.css`
- Test: `apps/admin/src/pages/Home.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/pages/Home.test.tsx`:
```tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @intelli/admin test`
Expected: FAIL, cannot resolve `./Home`.

- [ ] **Step 3: Implement the page**

Create `apps/admin/src/pages/Home.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { health } from '../lib/api'
import { selectSession, useAppDispatch, useAppSelector } from '../store'
import { signedOut } from '../store/auth'
import styles from './Home.module.css'

type ApiState = 'checking' | 'ok' | 'down'

export default function Home() {
  const session = useAppSelector(selectSession)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [api, setApi] = useState<ApiState>('checking')

  useEffect(() => {
    let cancelled = false
    health().then((ok) => {
      if (!cancelled) setApi(ok ? 'ok' : 'down')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const apiLabel =
    api === 'checking'
      ? 'checking...'
      : api === 'ok'
        ? 'connected'
        : 'not reachable (docker compose up -d)'

  const firstName = session?.user.name.split(' ')[0] ?? 'there'

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <span className={styles.chip}>Phase 1</span>
        <h1 className={styles.welcome}>Welcome, {firstName}</h1>
        <p className={styles.sub}>
          You are signed in as <strong>{session?.user.role}</strong>. The real Admin screens get
          built here, one phase at a time.
        </p>
        <div className={styles.status}>
          <span className={styles.dot} data-state={api} />
          <span>API: {apiLabel}</span>
        </div>
        <button
          className={styles.signOut}
          type="button"
          onClick={() => {
            dispatch(signedOut())
            navigate('/login', { replace: true })
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
```

Create `apps/admin/src/pages/Home.module.css`:
```css
.wrap {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.card {
  width: 420px;
  max-width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  padding: 30px 28px;
}

.chip {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
  background: var(--accent-subtle);
  padding: 4px 9px;
  border-radius: var(--r-full);
}

.welcome {
  margin: 14px 0 4px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.sub {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-2);
}

.status {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 18px;
  padding: 11px 13px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  font-size: 13px;
  color: var(--text-2);
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: var(--r-full);
  flex-shrink: 0;
  background: var(--text-4);
}
.dot[data-state='ok'] {
  background: var(--green);
}
.dot[data-state='down'] {
  background: var(--red);
}
.dot[data-state='checking'] {
  background: var(--amber);
}

.signOut {
  margin-top: 18px;
  height: 36px;
  padding: 0 14px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  font-size: 13.5px;
  font-weight: 600;
  font-family: var(--sans);
  cursor: pointer;
  transition: background 0.14s;
}
.signOut:hover {
  background: var(--surface-hover);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @intelli/admin test`
Expected: PASS, 21 tests total.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages
git commit -m "Admin: welcome home page placeholder (name, role, API dot, sign out)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: The route map and the front door

**Files:**
- Modify: `apps/admin/src/App.tsx` (full replacement)
- Modify: `apps/admin/src/main.tsx` (full replacement)
- Delete: `apps/admin/src/App.module.css` (Home.module.css replaced it)
- Test: `apps/admin/src/App.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/App.test.tsx`:
```tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @intelli/admin test`
Expected: FAIL. The current App.tsx is the Phase 0 health card with no Sign in button or routes.

- [ ] **Step 3: Replace App.tsx, wire main.tsx, delete the old stylesheet**

Replace the full contents of `apps/admin/src/App.tsx` with:
```tsx
import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import { selectSession, useAppSelector } from './store'

// The doorman: which web address shows which page, and who gets bounced.
export default function App() {
  const session = useAppSelector(selectSession)
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={session ? <Home /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={session ? '/' : '/login'} replace />} />
    </Routes>
  )
}
```

Replace the full contents of `apps/admin/src/main.tsx` with:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import '@intelli/tokens/tokens.css'
import './index.css'
import App from './App'
import { store } from './store'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Provider>
  </React.StrictMode>,
)
```

Delete the old stylesheet:
```bash
rm apps/admin/src/App.module.css
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @intelli/admin test`
Expected: PASS, 27 tests total, all green.

- [ ] **Step 5: Commit**

```bash
git add -A apps/admin/src
git commit -m "Admin: route map with auth doorman; app wrapped in session store + router

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification (robot + live walkthrough)

**Files:** none created; this task only verifies.

- [ ] **Step 1: Full test suite**

Run: `pnpm --filter @intelli/admin test`
Expected: PASS, 27 tests.

- [ ] **Step 2: Type check + production build**

Run: `pnpm build:admin`
Expected: tsc reports no errors; Vite build completes.

- [ ] **Step 3: Start the real backend**

Run: `docker compose up -d` then `curl -s http://localhost:8000/health`
Expected: `{"status":"ok","service":"intelli-api","version":"0.0.0"}`. If the demo user is missing (fresh database), run `docker compose run --rm migrate up` then `docker compose exec api python -m app.seed`.

- [ ] **Step 4: Prove the login door works from the command line**

Run:
```bash
curl -s -X POST http://localhost:8000/auth/login -H 'Content-Type: application/json' -d '{"email":"dana@lumenbeauty.com","password":"demo1234"}'
```
Expected: JSON containing `"token":"..."` and `"user":{"name":"Dana Whitfield","role":"admin"}`.

- [ ] **Step 5: Live browser walkthrough (with Tanya)**

Run: `pnpm dev:admin`, open http://localhost:5173 and confirm, in order:
1. You are redirected to /login and see the card from the approved mockup.
2. A wrong password shows the red "Invalid email or password" box.
3. The demo login works and lands on "Welcome, Dana" with the green dot.
4. Refreshing the page keeps you signed in.
5. Sign out returns you to /login; visiting / directly bounces back to /login.

- [ ] **Step 6: Commit (only if fixes were needed)**

If anything required a code fix during verification, commit it:
```bash
git add -A apps/admin/src
git commit -m "Admin: fixes found during live login walkthrough

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation updates (Tanya's standing rule)

**Files:**
- Modify: `START_HERE.md`
- Modify: `CONTEXT.md`
- Modify: `../hi-fi-intelli/Intelli_Complete_Handoff.md` (separate git repo; separate commit there)

- [ ] **Step 1: Update START_HERE.md**

Three edits:

(a) In section 1, after the Phase 1 block, add:
```markdown
**Phase 1 - login, the screen half (done):**
- The Admin app now has a real **login page**: email + password, friendly
  errors ("Invalid email or password", or "Can't reach the backend" when
  Docker is off), and a quiet DEV box showing the demo login while we build.
- After signing in you land on a small **welcome page** (your name, your
  role, the green API dot, and Sign out). The real dashboard replaces it later.
- You **stay signed in up to 12 hours**, even if you close the browser.
- Permanent rails installed for every future screen: a page-switcher (each
  screen gets its own web address, strangers get bounced to login), a
  form-checker (catches typing mistakes before sending), a session pocket
  (one shared place that remembers who is signed in), the brand fonts, and
  a **testing robot** (27 automated checks that re-run on demand).

**What's NEXT:** Phase 2, the org hierarchy + the scope guard ("you only see
your own branch"), with its mandatory isolation tests.
```
Also delete the old line "**What's NEXT:** the login *screen* ..." from the end of the Phase 1 block.

(b) In section 4's command table, add one row:
```markdown
| Run the testing robot (frontend checks) | `pnpm test:admin` |
```

(c) In section 5's file tree, replace the `apps/` block with:
```
└── apps/
    ├── admin/           ADMIN web app (React). Has a real login now.
    │   └── src/
    │       ├── lib/api.ts        The one file that talks to the backend
    │       ├── store/            The session pocket (who is signed in)
    │       ├── pages/            Login + welcome Home screens
    │       ├── test/             Shared test helpers
    │       ├── App.tsx           The route map (which address shows what)
    │       └── main.tsx          The app's front door (wiring)
    ├── manager/         MANAGER web app  (not created yet)
    └── field/           FIELD mobile app (not created yet)
```
And in the top part of the tree, under `intelli-app/`, make sure `docs/` appears (it was added when the design was approved):
```
├── docs/
│   └── superpowers/         Design write-ups + build plans (one per feature)
```

(d) Update section 7 ("Where we are right now") to:
```markdown
## 7. Where we are right now
- Backend login: DONE and tested.
- Login screen (frontend): DONE and tested (27 automated checks).
- Phase 1 is complete. NEXT: Phase 2, hierarchy + scope guard (isolation tests).
- Everything is committed to git, so any step can be undone.
```

- [ ] **Step 2: Update CONTEXT.md**

(a) Mark Phase 1 done in the build order:
```markdown
- [x] **Phase 1** - tenancy + auth. Done: backend login + Admin login screen. Gate met: log in works; only your own tenant's user comes back. (Cross-tenant data isolation proper is Phase 2's gate.)
```

(b) Append to the progress log:
```markdown
- 2026-06-12: Phase 1 frontend - Admin login screen (approved via mockup first). React Router
  v7 route map (/login, /) with auth doorman, react-hook-form + zod validation, Redux Toolkit
  session slice mirrored to localStorage (12h expiry read from the JWT), brand fonts loaded,
  Vitest + Testing Library harness (27 tests). Spec + plan in docs/superpowers/. Phase 2 next.
```

- [ ] **Step 3: Commit (intelli-app repo)**

```bash
git add START_HERE.md CONTEXT.md
git commit -m "Docs: Phase 1 complete (login screen done); progress, file map, cheat sheet updated

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Update the prototype handoff CHANGELOG (sibling repo)**

In `../hi-fi-intelli/Intelli_Complete_Handoff.md`, add at the top of the CHANGELOG section:
```markdown
**2026-06-12 (production: Phase 1 complete):** The production repo (`intelli-app`) finished Phase 1: backend login (tenants + users, Argon2 + JWT, POST /auth/login) AND the Admin login screen (React Router doorman, react-hook-form + zod, Redux Toolkit session with 12h localStorage persistence, brand fonts, 27 Vitest/RTL checks). Login screen design was approved via browser mockup before build; spec + plan live in `intelli-app/docs/superpowers/`. Next: Phase 2 (hierarchy + scope guard + mandatory isolation tests).
```
Note: older entries in that file use em dashes after the bold date; do NOT copy that. Tanya's no-em-dash rule applies everywhere we write, so this entry uses a colon instead.

- [ ] **Step 5: Commit (hi-fi-intelli repo)**

```bash
cd /Users/tanyajustin/Documents/hi-fi-intelli
git add Intelli_Complete_Handoff.md
git commit -m "Handoff CHANGELOG: production Phase 1 complete (backend login + Admin login screen)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
cd /Users/tanyajustin/Documents/intelli-app
```
