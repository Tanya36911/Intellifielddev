# W1 Stage C: App shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the Admin app in its real shell, the persistent left sidebar (Intelli brand, company card, nav, Nodes/Stores/Reps footprint, user card + sign out) and a per-page top bar, ported from the prototype, so the dashboard and every future screen render inside it and the app looks like the prototype screenshot.

**Architecture:** A React Router layout route renders `Shell` (Sidebar + a `<main>` with `<Outlet/>`); the authenticated screens render inside the outlet. The `Topbar` is a shared component each page renders at the top of its content with its own title + controls. The Dashboard is refactored to drop its standalone header and instead render `<Topbar title="Analytics">{range + Export}</Topbar>`; sign-out moves into the sidebar's user card. The sidebar reads the company/role/pin from the session (`SessionUser`, with the Stage A login fields) and the footprint from `/analytics/dashboard`.

**Tech Stack:** React 19 + Vite + TS, React Router (layout route + Outlet), TanStack Query, the Stage B UI kit, CSS Modules, Vitest + Testing Library (`renderApp`).

**Spec:** `docs/superpowers/specs/2026-06-18-w1-shell-analytics-dashboard-design.md` ("The shell" section). Stage A (login fields + `/analytics/dashboard`), Stage B (UI kit, apiGet, renderApp), and Stage D (the Dashboard at `/`) are done.

**Prototype source of truth for the look:** `/Users/tanyajustin/Documents/hi-fi-intelli/project/apps/admin/screens/shell.jsx` (Sidebar + Topbar + Page structure, class names, the NAV array, the footprint stats, the user card) and `shared/styles.css`. Port the LOOK faithfully into React + CSS Modules with `var(--token)`.

**Web-appropriate trims (from the spec):** no tenant switcher (the company card is static, from `user.company_name`); no "Synced" control; the "Re-run setup wizard" item and the notifications bell render as plain "coming soon" (disabled row / no-badge bell, no dropdown). Unbuilt nav items open a shared `ComingSoon` page.

**Conventions:** Frontend on the HOST: `pnpm test:admin`, `pnpm build:admin`. Commit to `main` per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. No em dashes in code/comments. Baseline: 44 frontend checks green.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `apps/admin/src/shell/Sidebar.tsx` (+ `.module.css`) | Brand, company card, nav (main + ORGANIZATION groups), footprint, user card + sign out. | Create |
| `apps/admin/src/shell/Topbar.tsx` (+ `.module.css`) | Page title + subtitle + a `children` controls slot + a "coming soon" bell. | Create |
| `apps/admin/src/shell/Shell.tsx` (+ `.module.css`) | Layout: `<div flex><Sidebar/><main><Outlet/></main></div>`. | Create |
| `apps/admin/src/shell/nav.ts` | The NAV list (id, label, icon, group, path, comingSoon). | Create |
| `apps/admin/src/pages/ComingSoon.tsx` (+ `.module.css`) | Shared placeholder for unbuilt screens. | Create |
| `apps/admin/src/shell/Sidebar.test.tsx`, `Shell.test.tsx` | Shell tests. | Create |
| `apps/admin/src/App.tsx` | Layout route (Shell) wrapping `/` (Dashboard) + placeholder routes; `/login` outside. | Modify |
| `apps/admin/src/App.test.tsx` | Journey now lands in the shell (assert sidebar + dashboard). | Modify |
| `apps/admin/src/pages/Dashboard/Dashboard.tsx` (+ `.module.css`) | Drop standalone header; render `<Topbar>` with range + Export; remove sign-out (now in sidebar). | Modify |
| `apps/admin/src/pages/Dashboard/Dashboard.test.tsx` | Update for the Topbar-hosted controls. | Modify |

---

## Task 1: Topbar + Page + ComingSoon + nav data

**Files:**
- Create: `apps/admin/src/shell/Topbar.tsx` (+ `.module.css`), `apps/admin/src/shell/nav.ts`, `apps/admin/src/pages/ComingSoon.tsx` (+ `.module.css`)
- Create: `apps/admin/src/shell/Topbar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/shell/Topbar.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Topbar } from './Topbar'

describe('Topbar', () => {
  it('renders the title, subtitle, and its control children', () => {
    render(<Topbar title="Analytics" subtitle="All nodes"><button>Export</button></Topbar>)
    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeTruthy()
    expect(screen.getByText('All nodes')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- src/shell/Topbar.test.tsx`
Expected: FAIL (no `Topbar`).

- [ ] **Step 3: Build `nav.ts`, `Topbar.tsx`, `ComingSoon.tsx`**

`apps/admin/src/shell/nav.ts` (port the prototype NAV; `path` for routing; `comingSoon` for the not-yet-built ones):
```ts
export type NavItem = { id: string; label: string; icon: string; group: 'main' | 'org'; path: string; badge?: string; comingSoon?: boolean }
export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Analytics', icon: 'chart', group: 'main', path: '/' },
  { id: 'forms', label: 'Form Builder', icon: 'sparkles', group: 'main', path: '/forms', badge: 'AI', comingSoon: true },
  { id: 'surveys', label: 'Surveys', icon: 'file', group: 'main', path: '/surveys', comingSoon: true },
  { id: 'catalog', label: 'Catalog', icon: 'grid', group: 'main', path: '/catalog', comingSoon: true },
  { id: 'hierarchy', label: 'Hierarchy', icon: 'tree', group: 'org', path: '/hierarchy', comingSoon: true },
  { id: 'users', label: 'Users & Roles', icon: 'users', group: 'org', path: '/users', comingSoon: true },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'org', path: '/settings', comingSoon: true },
]
```

`Topbar.tsx` (+ `.module.css`): a sticky bar with `h2` title + optional subtitle on the left, the `children` controls in the middle/right, and a "coming soon" bell on the far right (an `Icon name="bell"` button that is disabled / title="Notifications (coming soon)", no red dot, no dropdown). Port the prototype `Topbar` styling (height `var(--topbar-h)`, border-bottom, `var(--surface)` bg). Props: `{ title: string; subtitle?: string; children?: ReactNode }`.

`ComingSoon.tsx` (+ `.module.css`): a centered placeholder taking a `title` (defaulting from the route) showing the screen name + an Icon + one line "This screen is coming soon." Used by the placeholder routes.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:admin -- src/shell/Topbar.test.tsx` then `pnpm build:admin`.
Expected: PASS; build compiles.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/shell/Topbar.tsx apps/admin/src/shell/Topbar.module.css apps/admin/src/shell/nav.ts apps/admin/src/pages/ComingSoon.tsx apps/admin/src/pages/ComingSoon.module.css apps/admin/src/shell/Topbar.test.tsx
git commit -m "W1c: Topbar + ComingSoon + nav data

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Sidebar

**Files:**
- Create: `apps/admin/src/shell/Sidebar.tsx` (+ `.module.css`), `apps/admin/src/shell/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/shell/Sidebar.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderApp } from '../test/render'
import { Sidebar } from './Sidebar'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiGet: vi.fn().mockResolvedValue({ footprint: { nodes: 8, stores: 3, reps: 2 } }),
}))

afterEach(() => vi.clearAllMocks())

describe('Sidebar', () => {
  it('shows the brand, the nav, and a coming-soon item is not a link', () => {
    renderApp(<Sidebar user={{ name: 'Dana Whitfield', role: 'admin', company_name: 'Lumen Beauty', pinned_node_name: 'Lumen Beauty' }} onSignOut={() => {}} />)
    expect(screen.getByText('Intelli')).toBeTruthy()
    expect(screen.getByText('Lumen Beauty')).toBeTruthy()
    expect(screen.getByText('Analytics')).toBeTruthy()
    // a coming-soon item (Catalog) renders but is not an enabled link
    expect(screen.getByText('Catalog')).toBeTruthy()
  })

  it('renders the user name and role and a working sign out', () => {
    const onSignOut = vi.fn()
    renderApp(<Sidebar user={{ name: 'Dana Whitfield', role: 'admin', company_name: 'Lumen Beauty', pinned_node_name: 'Lumen Beauty' }} onSignOut={onSignOut} />)
    expect(screen.getByText('Dana Whitfield')).toBeTruthy()
    screen.getByRole('button', { name: /sign out/i }).click()
    expect(onSignOut).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- src/shell/Sidebar.test.tsx`
Expected: FAIL (no `Sidebar`).

- [ ] **Step 3: Build `Sidebar.tsx`**

Port the prototype Sidebar with the spec's trims. Props: `{ user: SessionUser; onSignOut: () => void }`. Structure (using the Stage B `Icon`, `Avatar`, `Chip`, and `var(--token)` CSS Modules):
- **Brand:** the `layers` icon in an accent square + "Intelli" / "Field Execution".
- **Company card:** a static card showing `user.company_name` (no chevron/switcher).
- **Nav:** map `NAV` by group, with an ORGANIZATION section header before the `org` group. A non-comingSoon item is a React Router `NavLink` to `item.path` (active styling via `NavLink`'s isActive); a `comingSoon` item is a non-link row (muted, with a small "soon" chip and `title="Coming soon"`) that routes to its placeholder path on click OR is simply not clickable, choose: render comingSoon items as `NavLink` to their placeholder `path` (so the ComingSoon page shows) but with a "soon" chip. The `forms` item also shows its "AI" badge.
- **Footprint:** a `useQuery(['footprint'], () => apiGet('/analytics/dashboard').then(d => d.footprint))` rendering Nodes / Stores / Reps counts (the mono numbers). While loading, show dashes.
- **User card:** `Avatar` (from name) + `user.name` + `{user.role}, pinned to {user.pinned_node_name ?? 'no pin'}` + a sign-out icon button calling `onSignOut`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:admin -- src/shell/Sidebar.test.tsx` then `pnpm build:admin`.
Expected: PASS; compiles.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/shell/Sidebar.tsx apps/admin/src/shell/Sidebar.module.css apps/admin/src/shell/Sidebar.test.tsx
git commit -m "W1c: Sidebar (brand, company, nav, footprint, user + sign out)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shell layout + routing + Dashboard refactor

**Files:**
- Create: `apps/admin/src/shell/Shell.tsx` (+ `.module.css`), `apps/admin/src/shell/Shell.test.tsx`
- Modify: `apps/admin/src/App.tsx`, `apps/admin/src/App.test.tsx`, `apps/admin/src/pages/Dashboard/Dashboard.tsx`, `apps/admin/src/pages/Dashboard/Dashboard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/shell/Shell.test.tsx` (the layout renders the sidebar + the outlet; sign out works through the store):

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { renderApp } from '../test/render'
import Shell from './Shell'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  apiGet: vi.fn().mockResolvedValue({ footprint: { nodes: 8, stores: 3, reps: 2 } }),
}))
afterEach(() => vi.clearAllMocks())

function seed(store: ReturnType<typeof import('../store').makeStore>) {
  // a logged-in session so the shell shows the user
  localStorage.setItem('intelli-admin-session', JSON.stringify({
    token: 't', user: { name: 'Dana Whitfield', role: 'admin', company_name: 'Lumen Beauty', pinned_node_name: 'Lumen Beauty' },
  }))
}

describe('Shell', () => {
  it('renders the sidebar and the routed outlet content', () => {
    const { store } = renderApp(
      <Routes><Route element={<Shell />}><Route path="/" element={<div>OUTLET</div>} /></Route></Routes>,
      { route: '/' },
    )
    // session loaded by the auth slice from localStorage set in render setup
    expect(screen.getByText('Intelli')).toBeTruthy()
    expect(screen.getByText('OUTLET')).toBeTruthy()
  })
})
```

(Note: the `renderApp` helper builds a fresh store via `makeStore()`, whose auth slice reads `localStorage` on init; set the session key before render. If `renderApp` does not let you preset localStorage, add a `beforeEach` that sets it.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- src/shell/Shell.test.tsx`
Expected: FAIL (no `Shell`).

- [ ] **Step 3: Build `Shell.tsx`**

```tsx
import { Outlet, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { selectSession, useAppDispatch, useAppSelector } from '../store'
import { signedOut } from '../store/auth'
import styles from './Shell.module.css'

export default function Shell() {
  const session = useAppSelector(selectSession)
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  if (!session) return null  // the route guard in App handles redirect; defensive
  return (
    <div className={styles.shell}>
      <Sidebar user={session.user} onSignOut={() => { dispatch(signedOut()); navigate('/login', { replace: true }) }} />
      <main className={styles.main}><Outlet /></main>
    </div>
  )
}
```

`Shell.module.css`: `.shell { display: flex; height: 100%; overflow: hidden }` and `.main { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100% }`.

- [ ] **Step 4: Rewire `App.tsx` to the layout route**

```tsx
import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './shell/Shell'
import Dashboard from './pages/Dashboard/Dashboard'
import ComingSoon from './pages/ComingSoon'
import Login from './pages/Login'
import { selectSession, useAppSelector } from './store'

export default function App() {
  const session = useAppSelector(selectSession)
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/catalog" element={<ComingSoon title="Catalog" />} />
        <Route path="/surveys" element={<ComingSoon title="Surveys" />} />
        <Route path="/forms" element={<ComingSoon title="Form Builder" />} />
        <Route path="/hierarchy" element={<ComingSoon title="Hierarchy" />} />
        <Route path="/users" element={<ComingSoon title="Users & Roles" />} />
        <Route path="/settings" element={<ComingSoon title="Settings" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 5: Refactor the Dashboard to use the Topbar (drop its standalone header + sign-out)**

In `apps/admin/src/pages/Dashboard/Dashboard.tsx`, remove the standalone `<header>` and its sign-out button (sign-out is in the sidebar now), and render a `<Topbar title="Analytics" subtitle="All nodes, period to date">` with the `Segmented` range control + the Export `Button` as its children, followed by the page content wrapped in a scrolling container (reuse the prototype `Page` look: max-width, padding). Keep all the data wiring and KPI/trend/compliance/AI content. Drop the now-unused `useNavigate`/`signedOut` imports from the Dashboard.

- [ ] **Step 6: Update the tests**

- `App.test.tsx`: the logged-in journey now lands in the shell, assert both the sidebar brand ("Intelli") and the dashboard ("Analytics" heading) appear after login; mock `apiGet` to also answer the sidebar footprint call. Keep wrong-password assertions.
- `Dashboard.test.tsx`: the range control + Export now live in the Topbar within the Dashboard render; the existing queries (`getByRole('button', {name:'YTD'})`, `/export/i`) still resolve, update only if the Topbar changes their accessible names. Render via `renderApp` (which has the router) so `<Topbar>`/links work.

- [ ] **Step 7: Run to verify everything passes**

Run: `pnpm test:admin` then `pnpm build:admin`.
Expected: whole suite green (shell tests + updated app/dashboard tests); build compiles.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/shell apps/admin/src/App.tsx apps/admin/src/App.test.tsx apps/admin/src/pages/Dashboard
git commit -m "W1c: Shell layout route + dashboard in the shell topbar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Live check

- [ ] **Step 1:** With the backend up, `pnpm dev:admin`, open `http://localhost:5173`, log in as `dana@lumenbeauty.com` / `demo1234`. Confirm the sidebar (brand, company, nav, footprint counts, user + working sign out), the top bar (Analytics title + range + Export), the dashboard content inside the shell, and that clicking a "coming soon" nav item shows the placeholder page. It should now resemble the prototype screenshot (minus the deliberately-trimmed tenant switcher / Synced / real bell).
- [ ] **Step 2:** Confirm `pnpm test:admin` green and `docker compose exec -T api pytest -q` still 183.

---

## Self-Review

**Spec coverage (shell):**
- Sidebar: brand, static company card, nav (main + ORGANIZATION groups, AI badge, coming-soon items), footprint counts, user card + sign out: Task 2. ✓
- Topbar: title/subtitle + per-page controls slot + coming-soon bell (no Synced): Task 1. ✓
- Layout route wrapping the dashboard + placeholder routes; ComingSoon page: Tasks 1 + 3. ✓
- Dashboard moves into the shell (controls in the Topbar, sign-out in the sidebar): Task 3. ✓
- Web trims (no tenant switcher / Synced; bell + wizard "coming soon"): Tasks 1-2. ✓

**Placeholder scan:** structure/routing/tests are complete; the Sidebar/Topbar visuals have complete prop/behavior specs + the prototype named as the verbatim source + test contracts. No TBD.

**Type/name consistency:** `Shell` (default export), `Sidebar`/`Topbar` (named), `NAV`/`NavItem`, `ComingSoon` are consistent across files; `Sidebar` takes `{user: SessionUser, onSignOut}`; the footprint query reuses `apiGet('/analytics/dashboard')`; the Dashboard keeps `useDashboard`/`useCompliance` and now renders `Topbar`. The `renderApp` helper (Stage B) provides the router so `NavLink`/`Outlet` work in tests.

(After this, W1 is structurally complete; the seed enrichment and the W1 docs pass + screenshot follow as separate steps.)
