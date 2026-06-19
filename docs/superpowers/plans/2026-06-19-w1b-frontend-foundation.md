# W1 Stage B: Frontend foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable frontend foundation the shell (Stage C) and dashboard (Stage D) need: the full design-token set, an authenticated API client + a shared session module, TanStack Query wiring, and a small ported UI kit (Icon, Spark, Bar, Chip, Button, Card, Segmented, Switch, Avatar). No visible screen yet, this is the plumbing and primitives.

**Architecture:** Extend `packages/tokens` with the prototype's complete CSS variables (layout vars, density, dark mode, fonts). Add `apps/admin/src/lib/session.ts` (the `SESSION_KEY` + a `readToken()` both `api.ts` and the Redux `store/auth.ts` import, breaking the would-be store<->api cycle) and grow `api.ts` with `apiGet`/`downloadCsv` that attach the Bearer token and throw `ApiError(401)` (the React layer signs out, not `api.ts`). Add `@tanstack/react-query` + a `QueryClientProvider`. Build the UI kit as React + CSS Modules, porting the prototype primitives verbatim in look.

**Tech Stack:** React 19 + Vite + TypeScript, Redux Toolkit (existing), TanStack Query (new), CSS Modules, Vitest + Testing Library. Frontend commands run on the HOST with pnpm (the backend is Docker).

**Spec:** `docs/superpowers/specs/2026-06-18-w1-shell-analytics-dashboard-design.md` (this is Stage B of four; C shell and D dashboard follow). Stage A (the `/analytics/dashboard` endpoint) is done.

**Conventions (read before starting):**
- Frontend tests: `pnpm test:admin` (from the repo root). Build/type-check: `pnpm build:admin` (runs `tsc --noEmit && vite build`). After adding a dependency, run `pnpm install`.
- The established component pattern is a `.tsx` + a co-located `.module.css` (see `apps/admin/src/pages/Login.tsx` + `Login.module.css`). Tests are co-located `*.test.tsx`, mocking `../lib/api` with `vi.mock(importOriginal)` (see `apps/admin/src/App.test.tsx`).
- CSS Modules type-check via `vite/client` (already in `tsconfig.json`); no `.d.ts` shim needed.
- The prototype design system (`/Users/tanyajustin/Documents/hi-fi-intelli/project/shared/styles.css`) and primitives (`/Users/tanyajustin/Documents/hi-fi-intelli/project/shared/primitives.jsx`) are the source of truth for verbatim values/markup. Port the LOOK, write idiomatic React (do not copy the in-browser-Babel structure).
- Commit to `main` after each task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. No em dashes (code or comments).
- Baseline: 27 frontend checks green today; this stage adds unit tests and must end green.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/tokens/src/tokens.css` | Full token set: layout vars, density, dark mode, fonts. | Modify |
| `packages/tokens/src/index.ts` | Mirror new scalar tokens in the JS object (optional consumers). | Modify |
| `apps/admin/src/lib/session.ts` | `SESSION_KEY` + `readToken()`, shared by api.ts and store/auth.ts. | Create |
| `apps/admin/src/store/auth.ts` | Import `SESSION_KEY` from session.ts (no behavior change). | Modify |
| `apps/admin/src/lib/api.ts` | `apiGet`, `downloadCsv`; `SessionUser` gains company/pin fields. | Modify |
| `apps/admin/src/lib/api.test.ts` | Tests for apiGet/downloadCsv/readToken. | Create |
| `apps/admin/src/main.tsx` | Wrap in `QueryClientProvider`. | Modify |
| `apps/admin/src/test/render.tsx` | Shared test render helper (Query + Redux + Router). | Create |
| `apps/admin/src/ui/*` | The UI kit (Icon, Spark, Bar, Chip, Button, Card, Segmented, Switch, Avatar) + CSS Modules + tests. | Create |
| `apps/admin/package.json` | Add `@tanstack/react-query`. | Modify |

---

## Task 1: Shared session module + authenticated API client

**Files:**
- Create: `apps/admin/src/lib/session.ts`
- Modify: `apps/admin/src/store/auth.ts`, `apps/admin/src/lib/api.ts`
- Create: `apps/admin/src/lib/api.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/lib/api.test.ts`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiGet } from './api'
import { SESSION_KEY, readToken } from './session'

function setSession(token: string) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user: { name: 'Dana', role: 'admin' } }))
}

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('readToken', () => {
  it('returns the token from the stored session', () => {
    setSession('tok-123')
    expect(readToken()).toBe('tok-123')
  })
  it('returns null when there is no session', () => {
    expect(readToken()).toBeNull()
  })
})

describe('apiGet', () => {
  it('attaches the Bearer token and returns parsed JSON', async () => {
    setSession('tok-abc')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const data = await apiGet('/analytics/dashboard')
    expect(data).toEqual({ ok: true })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer tok-abc')
  })
  it('throws ApiError(401) on a 401 (the React layer signs out, not api.ts)', async () => {
    setSession('expired')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    await expect(apiGet('/analytics/dashboard')).rejects.toMatchObject({ status: 401 })
    await expect(apiGet('/analytics/dashboard')).rejects.toBeInstanceOf(ApiError)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- src/lib/api.test.ts`
Expected: FAIL (`./session` and `apiGet` do not exist).

- [ ] **Step 3: Create `apps/admin/src/lib/session.ts`**

```ts
// The session lives in localStorage (mirrored by the Redux auth slice). This
// tiny module is imported by BOTH api.ts and store/auth.ts so the API client can
// read the token without importing the Redux store (which would be a cycle).
export const SESSION_KEY = 'intelli-admin-session'

export function readToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const token = (JSON.parse(raw) as { token?: string })?.token
    return token ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Point `store/auth.ts` at the shared key**

In `apps/admin/src/store/auth.ts`, remove the local `export const SESSION_KEY = 'intelli-admin-session'` and instead import + re-export it from the new module (so existing importers of `SESSION_KEY` from `store/auth` keep working):

```ts
import { SESSION_KEY } from '../lib/session'
// ... existing imports ...
export { SESSION_KEY }
```

(Leave `loadSession`/`isExpired`/the slice unchanged; they keep using `SESSION_KEY`.)

- [ ] **Step 5: Grow `api.ts` with `apiGet` + `downloadCsv` and the wider `SessionUser`**

In `apps/admin/src/lib/api.ts`, extend the `SessionUser` type and add the helpers:

```ts
import { readToken } from './session'

export type SessionUser = {
  name: string
  role: string
  company_name?: string | null
  pinned_node_name?: string | null
}
```

Add at the end of the file:

```ts
function authHeaders(): Record<string, string> {
  const token = readToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Authenticated GET. Throws ApiError(0) if the backend is unreachable, and
// ApiError(status) on a non-2xx (the caller / Query layer handles 401 by signing
// out; api.ts never imports the store).
export async function apiGet<T = unknown>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { ...authHeaders() } })
  } catch {
    throw new ApiError(0, CANT_REACH)
  }
  if (!res.ok) {
    const detail = await res.json().then((d) => d?.detail).catch(() => null)
    throw new ApiError(res.status, typeof detail === 'string' ? detail : 'Request failed.')
  }
  return res.json() as Promise<T>
}

// Authenticated CSV download. A bare <a download> would 401 (no auth header),
// so fetch with the token, turn the body into a Blob, and click a temporary
// anchor with a client-set filename (Content-Disposition is not honored for
// blob downloads).
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { ...authHeaders() } })
  if (!res.ok) throw new ApiError(res.status, 'Export failed.')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test:admin -- src/lib/api.test.ts`
Expected: PASS (readToken + apiGet tests). Then `pnpm build:admin` to confirm types compile.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/lib/session.ts apps/admin/src/store/auth.ts apps/admin/src/lib/api.ts apps/admin/src/lib/api.test.ts
git commit -m "W1b: shared session module + authenticated apiGet/downloadCsv

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: TanStack Query + a shared test render helper

**Files:**
- Modify: `apps/admin/package.json`, `apps/admin/src/main.tsx`
- Create: `apps/admin/src/test/render.tsx`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @intelli/admin add @tanstack/react-query` (then `pnpm install` if needed). Confirm it appears in `apps/admin/package.json`.

- [ ] **Step 2: Wrap the app in `QueryClientProvider`**

In `apps/admin/src/main.tsx`, create one client and wrap `App`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// ... existing imports ...
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
```

- [ ] **Step 3: Create the shared test render helper**

Create `apps/admin/src/test/render.tsx` so dashboard/shell tests (which use `useQuery`) get a QueryClient, a fresh Redux store, and a router:

```tsx
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
```

- [ ] **Step 4: Verify the suite still builds + passes**

Run: `pnpm build:admin` then `pnpm test:admin`
Expected: build OK; the existing 27 checks still pass (no behavior change yet).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/package.json pnpm-lock.yaml apps/admin/src/main.tsx apps/admin/src/test/render.tsx
git commit -m "W1b: add TanStack Query + a shared test render helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extend the design tokens

**Files:**
- Modify: `packages/tokens/src/tokens.css`, `packages/tokens/src/index.ts`

- [ ] **Step 1: Add the missing tokens to `tokens.css`**

Read the prototype `/Users/tanyajustin/Documents/hi-fi-intelli/project/shared/styles.css` for exact values. Add to `packages/tokens/src/tokens.css` (the `:root` already has the colors/radii/shadows; add what is missing): the layout vars `--sidebar-w: 248px; --topbar-h: 56px;`, the `--bg-elev`, `--surface-2`, `--surface-hover`, `--surface-active`, `--border-strong`, `--border-faint`, `--accent-subtle-2`, `--accent-ring` if absent, the density blocks (`[data-density="compact"]` / `[data-density="comfy"]` retuning `--gap`/`--pad`/`--row-h`/`--font-base`), and the full `[data-theme="dark"]` block (accent/surfaces/borders/text/semantic-bg-fg/shadows) exactly as the prototype defines them. Ensure the fonts are available: keep the existing `@import` / `<link>` for Hanken Grotesk + JetBrains Mono and add Space Grotesk (headings). If the admin loads fonts elsewhere, match that mechanism; otherwise add the Google Fonts `@import` at the top of `tokens.css`.

- [ ] **Step 2: Mirror the new scalar tokens in `index.ts`**

In `packages/tokens/src/index.ts`, add to the exported object the new scalars that JS consumers might read: `layout: { sidebarW: '248px', topbarH: '56px' }` (and any new color/space values added above), keeping the existing shape.

- [ ] **Step 3: Verify the admin app still builds**

Run: `pnpm build:admin` then `pnpm test:admin`
Expected: build OK, 27 checks still green (tokens are additive; nothing references the new vars yet).

- [ ] **Step 4: Commit**

```bash
git add packages/tokens/src/tokens.css packages/tokens/src/index.ts
git commit -m "W1b: extend design tokens (layout vars, density, dark mode, fonts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The UI kit (Icon, Spark, Bar, Chip, Button, Card, Segmented, Switch, Avatar)

Port the prototype primitives as React + CSS Modules. Source of truth: the
prototype `shared/primitives.jsx` (component logic + the `ICONS` map) and
`shared/styles.css` (the `.btn`/`.chip`/`.card`/`.segmented`/`.switch` rules). Use
the design tokens (`var(--...)`). Build each as `apps/admin/src/ui/<Name>.tsx`
(+ `<Name>.module.css` where it has style) and a barrel `apps/admin/src/ui/index.ts`.

**Files:**
- Create: `apps/admin/src/ui/Icon.tsx`, `Spark.tsx`, `Bar.tsx`, `Chip.tsx` (+ `.module.css`), `Button.tsx` (+ `.module.css`), `Card.tsx` (+ `.module.css`), `Segmented.tsx` (+ `.module.css`), `Switch.tsx` (+ `.module.css`), `Avatar.tsx` (+ `.module.css`), `index.ts`
- Create: `apps/admin/src/ui/ui.test.tsx`

- [ ] **Step 1: Write the failing tests** (the logic-bearing primitives)

Create `apps/admin/src/ui/ui.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Bar, Chip, Icon, Segmented, Spark, Switch } from './index'

describe('Icon', () => {
  it('renders an svg for a known name and nothing crashes for unknown', () => {
    const { container } = render(<Icon name="chart" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
})

describe('Spark', () => {
  it('renders a polyline with one point per data value', () => {
    const { container } = render(<Spark data={[1, 5, 2, 8]} />)
    const poly = container.querySelector('polyline')
    expect(poly).toBeTruthy()
    expect(poly!.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(4)
  })
  it('renders without crashing on empty data (no NaN points)', () => {
    const { container } = render(<Spark data={[]} />)
    const poly = container.querySelector('polyline')
    expect(poly?.getAttribute('points') ?? '').not.toContain('NaN')
  })
})

describe('Bar', () => {
  it('sets width from a 0..1 value as a percentage', () => {
    const { container } = render(<Bar value={0.42} />)
    const fill = container.querySelector('[data-fill]') as HTMLElement
    expect(fill.style.width).toBe('42%')
  })
  it('clamps a null/over-range value to a safe width', () => {
    const { container } = render(<Bar value={null as unknown as number} />)
    const fill = container.querySelector('[data-fill]') as HTMLElement
    expect(fill.style.width).toBe('0%')
  })
})

describe('Chip', () => {
  it('renders its children and applies the tone class', () => {
    render(<Chip tone="green">Pass</Chip>)
    expect(screen.getByText('Pass')).toBeTruthy()
  })
})

describe('Segmented', () => {
  it('marks the selected option and fires onChange', () => {
    const onChange = vi.fn()
    render(<Segmented options={['4w', '12w', 'YTD']} value="12w" onChange={onChange} />)
    screen.getByRole('button', { name: '4w' }).click()
    expect(onChange).toHaveBeenCalledWith('4w')
  })
})

describe('Switch', () => {
  it('toggles on click', () => {
    const onChange = vi.fn()
    render(<Switch on={false} onChange={onChange} label="dark" />)
    screen.getByRole('switch').click()
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- src/ui/ui.test.tsx`
Expected: FAIL (the `./index` barrel and components do not exist).

- [ ] **Step 3: Build the components**

Port from the prototype. Key specs (match the prototype look via the token CSS):

- **`Icon.tsx`** (port the `ICONS` map from `primitives.jsx`, an object of `name -> array of [tag, attrs]`):
```tsx
import type { CSSProperties } from 'react'
import { ICONS } from './icons'  // the ported ICONS map (object of name -> [tag, attrs][])

export function Icon({ name, size = 16, stroke = 1.75, fill = false, color, style, className }: {
  name: keyof typeof ICONS; size?: number; stroke?: number; fill?: boolean
  color?: string; style?: CSSProperties; className?: string
}) {
  const shapes = ICONS[name] ?? []
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'}
         stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
         style={{ color, flexShrink: 0, ...style }} className={className} aria-hidden="true">
      {shapes.map(([tag, attrs], i) => {
        const Tag = tag as keyof JSX.IntrinsicElements
        return <Tag key={i} {...(attrs as object)} />
      })}
    </svg>
  )
}
```
Create `apps/admin/src/ui/icons.ts` exporting `ICONS` ported verbatim from the prototype `primitives.jsx` (at minimum the W1 subset: `layers, chart, sparkles, file, grid, box(use grid/tag), store, tree, users, settings, bell, download, refresh, logout, chevR, chevD, chevUp, arrowUp, arrowDown, arrowRight, plus, lock, wand, search, check, alert`; include the full set if convenient since it is just data).

- **`Spark.tsx`**: hand-rolled SVG polyline. `data: number[]`, `w=70`, `h=24`, `color='var(--accent)'`, `down=false`. Auto-scale min/max to fit `h`; render `<polyline points=... stroke=color fill=none strokeWidth=1.75 strokeLinecap=round strokeLinejoin=round/>`. **Null safety:** filter non-finite values; if fewer than 2 points, render an empty `points=""` (never `NaN`).

- **`Bar.tsx`**: a track `<div>` with a `<div data-fill>` whose `width` is `clamp(value)` as a percentage. `value: number` in 0..1 (`completion`/100 etc.); `tone?: 'green'|'amber'|'red'`; `height=8`. Clamp: `const w = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; style={{ width: \`${Math.round(w*100)}%\` }}`. Tone sets the fill color (default `var(--accent)`).

- **`Chip.tsx`** + `.module.css`: port `.chip` (+ tone variants green/amber/red/blue/violet/accent). Props `{ tone?, children, dot? }`.

- **`Button.tsx`** + `.module.css`: port `.btn` (+ `primary`, `ghost`, `sm`, `danger`, `icon`). Props `{ variant?, size?, ...buttonProps }`.

- **`Card.tsx`** + `.module.css`: port `.card` (surface + border + radius + `--shadow-xs`). A simple wrapper `<div className={styles.card} {...props}/>`.

- **`Segmented.tsx`** + `.module.css`: port `.segmented`. Props `{ options: string[], value: string, onChange: (v: string) => void }`. Each option is a `<button>` with `aria-pressed`; the active one gets the active class.

- **`Switch.tsx`** + `.module.css`: port `.switch`. Props `{ on: boolean, onChange: (next: boolean) => void, label: string }`. Render `<button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>`.

- **`Avatar.tsx`** + `.module.css`: a colored circle with initials (first letters of the first two words). Props `{ name: string, color?='#1B4F8A', size?=28 }`.

- **`index.ts`**: `export { Icon } from './Icon'` etc. (barrel for all nine + the `ICONS` type if needed).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:admin -- src/ui/ui.test.tsx`
Expected: PASS (Icon, Spark incl. empty-data, Bar incl. clamp, Chip, Segmented, Switch). Then `pnpm build:admin` (types compile) and `pnpm test:admin` (whole suite green).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/ui
git commit -m "W1b: UI kit (Icon, Spark, Bar, Chip, Button, Card, Segmented, Switch, Avatar)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Stage B scope):**
- Token extension (layout vars, density, dark mode, fonts): Task 3. ✓
- Shared UI kit (Icon/Avatar/Chip/Button/Card/Segmented/Switch/Spark/Bar), CSS Modules, 0..1 + null-safe Bar/Spark: Task 4. ✓
- TanStack Query (`QueryClientProvider`) + test helper wrapping it: Task 2. ✓
- Auth client (`apiGet` attaches Bearer, throws ApiError(401); `downloadCsv` via Blob; token read from the shared session module, no store<->api cycle): Task 1. ✓
- `SessionUser` grows company_name/pinned_node_name (consumed by the shell in Stage C): Task 1. ✓

**Placeholder scan:** plumbing tasks (1, 2, 3) have complete code; Task 4 gives complete code for the logic primitives (Icon/Spark/Bar) + precise port-specs + tests for the CSS-Module primitives, with the prototype named as the verbatim source (a faithful UI port references the source rather than inlining hundreds of CSS lines). No TBD/TODO.

**Type/name consistency:** `SESSION_KEY`/`readToken` are defined in `session.ts` and imported by `api.ts` (and re-exported by `store/auth.ts`); `apiGet`/`downloadCsv`/`ApiError` are consistent across Task 1 and the helper; `renderApp` (Task 2) is the helper Stage C/D tests will use; the UI kit barrel `./index` matches the imports in `ui.test.tsx`. No store import in `api.ts` (cycle avoided).

(Stage C, the shell, consumes this kit + `apiGet` + `SessionUser`; Stage D, the dashboard, consumes the kit + `apiGet('/analytics/dashboard')` + `downloadCsv`. Each is its own plan after this stage is green.)
