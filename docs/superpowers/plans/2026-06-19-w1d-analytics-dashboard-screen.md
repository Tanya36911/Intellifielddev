# W1 Stage D: Analytics dashboard screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Analytics dashboard as the Admin app's landing screen, wired to real backend data: KPI cards (with sparklines + deltas), a weekly completion-trend line, a click-to-drill compliance-by-node list, an Export button, and the AI gap list badged "preview." Ported faithfully from the prototype using the Stage B UI kit.

**Architecture:** A `Dashboard` page (`apps/admin/src/pages/Dashboard/`) composed of small sub-components, fetching with TanStack Query via `apiGet` (Stage B). It mounts at `/` (the authenticated landing), replacing the old `Home`. Built standalone with its own light header for now; Stage C (the shell) will later wrap it in the sidebar/topbar and move the range/export controls into the topbar. Percentages from the backend are 0..100 (or null); the UI divides by 100 for the 0..1 `Bar`/`Spark`/trend and renders null as an em-dash / a trend gap.

**Tech Stack:** React 19 + Vite + TS, TanStack Query, the Stage B UI kit (`apps/admin/src/ui`), CSS Modules, Vitest + Testing Library (`renderApp` helper from Stage B).

**Spec:** `docs/superpowers/specs/2026-06-18-w1-shell-analytics-dashboard-design.md` (the dashboard parts). Depends on Stage A (`/analytics/dashboard`, `/analytics/compliance`, `/analytics/compliance/drill`, `/export/compliance`) and Stage B (UI kit, `apiGet`, `downloadCsv`, `renderApp`), both done.

**Backend response shapes (from Stage A + 4b), so wiring is unambiguous:**
- `GET /analytics/dashboard?date_from=&date_to=` -> `{footprint:{nodes,stores,reps}, current:{completion_pct,pass_pct,expected,responded,scored,passed,surveys_completed,overdue}, previous:{...}|null, trend:[{week_start,completion_pct,responded,expected}]}`. Percentages are 0..100 or null.
- `GET /analytics/compliance` -> `{rows:[{assignment_id,survey_id,survey_name,survey_version_id,target_node_id,target_node_name,expected,responded,scored,passed,completion_pct,pass_pct}], count}`.
- `GET /analytics/compliance/drill?node_id=&survey_version_id=` -> either `{is_store:false, children:[{node_id,name,level_order,is_store,expected,responded,scored,passed,completion_pct,pass_pct}]}` or `{is_store:true, responded:bool, items?, questions?, overall?}`.
- `GET /export/compliance?format=csv` -> a CSV download (use `downloadCsv`).

**Conventions:** Frontend commands run on the HOST: `pnpm test:admin`, `pnpm build:admin`, single file `pnpm test:admin -- src/pages/Dashboard/Dashboard.test.tsx`. The prototype `analytics.jsx` (`/Users/tanyajustin/Documents/hi-fi-intelli/project/apps/admin/screens/analytics.jsx`) is the verbatim visual source for `KpiCard`/`TrendChart`/`ComplianceCard`. Commit to `main` per task with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. No em dashes in code/comments (the on-screen "no data" glyph is a real em-dash character in JSX string content, which is fine; the rule is about prose/comments). Baseline: 39 frontend checks green.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `apps/admin/src/pages/Dashboard/useDashboard.ts` | Range -> dates; `useQuery` for dashboard + compliance + drill. | Create |
| `apps/admin/src/pages/Dashboard/Dashboard.tsx` (+ `.module.css`) | The page: header + KPI row + trend + compliance + AI preview. | Create |
| `apps/admin/src/pages/Dashboard/KpiCard.tsx` (+ `.module.css`) | One KPI card (number + delta chip + sparkline). | Create |
| `apps/admin/src/pages/Dashboard/TrendChart.tsx` (+ `.module.css`) | Hand-rolled SVG single-series completion line. | Create |
| `apps/admin/src/pages/Dashboard/ComplianceList.tsx` (+ `.module.css`) | Assignment rows + click-to-drill. | Create |
| `apps/admin/src/pages/Dashboard/AiPreview.tsx` (+ `.module.css`) | The hardcoded, badged "preview" gap list. | Create |
| `apps/admin/src/pages/Dashboard/Dashboard.test.tsx` | The screen tests (mock `../../lib/api`). | Create |
| `apps/admin/src/App.tsx` | Route `/` -> `Dashboard` (replace Home). | Modify |
| `apps/admin/src/App.test.tsx` | Journey rewritten to land on the dashboard. | Modify |
| `apps/admin/src/pages/Home.tsx`, `Home.module.css`, `Home.test.tsx` | Removed (superseded). | Delete |

---

## Task 1: The data hook

**Files:**
- Create: `apps/admin/src/pages/Dashboard/useDashboard.ts`
- Create: `apps/admin/src/pages/Dashboard/useDashboard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { rangeToDates } from './useDashboard'

describe('rangeToDates', () => {
  it('maps 4w to a 28-day window ending now', () => {
    const { date_from, date_to } = rangeToDates('4w', new Date('2026-06-19T00:00:00Z'))
    expect(date_to).toBe('2026-06-19T00:00:00.000Z')
    expect(date_from).toBe('2026-05-22T00:00:00.000Z')   // 28 days earlier
  })
  it('maps YTD to Jan 1 of the current year', () => {
    const { date_from } = rangeToDates('YTD', new Date('2026-06-19T00:00:00Z'))
    expect(date_from).toBe('2026-01-01T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- src/pages/Dashboard/useDashboard.test.ts`
Expected: FAIL (`./useDashboard` does not exist).

- [ ] **Step 3: Implement `useDashboard.ts`**

```ts
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/api'

export type Range = '4w' | '12w' | 'YTD'

export function rangeToDates(range: Range, now = new Date()) {
  const date_to = now.toISOString()
  let from: Date
  if (range === 'YTD') from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  else from = new Date(now.getTime() - (range === '4w' ? 28 : 84) * 86400000)
  return { date_from: from.toISOString(), date_to }
}

export type DashboardData = {
  footprint: { nodes: number; stores: number; reps: number }
  current: {
    completion_pct: number | null; pass_pct: number | null
    expected: number; responded: number; scored: number; passed: number
    surveys_completed: number; overdue: number
  }
  previous: DashboardData['current'] | null
  trend: { week_start: string; completion_pct: number | null; responded: number; expected: number }[]
}

export type ComplianceRow = {
  assignment_id: string; survey_id: string; survey_name: string; survey_version_id: string
  target_node_id: string; target_node_name: string
  expected: number; responded: number; scored: number; passed: number
  completion_pct: number | null; pass_pct: number | null
}

export function useDashboard(range: Range) {
  const { date_from, date_to } = rangeToDates(range)
  return useQuery({
    queryKey: ['dashboard', range],
    queryFn: () => apiGet<DashboardData>(
      `/analytics/dashboard?date_from=${encodeURIComponent(date_from)}&date_to=${encodeURIComponent(date_to)}`),
  })
}

export function useCompliance() {
  return useQuery({
    queryKey: ['compliance'],
    queryFn: () => apiGet<{ rows: ComplianceRow[]; count: number }>('/analytics/compliance'),
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:admin -- src/pages/Dashboard/useDashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/Dashboard/useDashboard.ts apps/admin/src/pages/Dashboard/useDashboard.test.ts
git commit -m "W1d: dashboard data hooks (range mapping + useQuery)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The dashboard page + sub-components

Build the page and its parts, porting the prototype `analytics.jsx` look with the
Stage B UI kit. Then route `/` to it and remove `Home`.

**Files:**
- Create: the Dashboard sub-components + `Dashboard.tsx` (+ `.module.css`) + `Dashboard.test.tsx`
- Modify: `App.tsx`, `App.test.tsx`
- Delete: `Home.tsx`, `Home.module.css`, `Home.test.tsx`

- [ ] **Step 1: Write the failing screen test**

Create `apps/admin/src/pages/Dashboard/Dashboard.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderApp } from '../../test/render'
import Dashboard from './Dashboard'

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  apiGet: vi.fn(),
  downloadCsv: vi.fn(),
}))
import { apiGet, downloadCsv } from '../../lib/api'

const DASH = {
  footprint: { nodes: 8, stores: 3, reps: 2 },
  current: { completion_pct: 50.0, pass_pct: 64.0, expected: 4, responded: 2,
             scored: 2, passed: 1, surveys_completed: 11, overdue: 3 },
  previous: { completion_pct: 40.0, pass_pct: 60.0, expected: 4, responded: 2,
              scored: 2, passed: 1, surveys_completed: 9, overdue: 5 },
  trend: [{ week_start: '2026-06-08', completion_pct: 40, responded: 1, expected: 4 },
          { week_start: '2026-06-15', completion_pct: 50, responded: 2, expected: 4 }],
}
const COMPLIANCE = { rows: [{
  assignment_id: 'a1', survey_id: 's1', survey_name: 'Velvet Lip Shelf Check',
  survey_version_id: 'v1', target_node_id: 'n1', target_node_name: 'Central',
  expected: 1, responded: 0, scored: 0, passed: 0, completion_pct: 0.0, pass_pct: null,
}], count: 1 }

function route(path: string) {
  if (path.startsWith('/analytics/dashboard')) return Promise.resolve(DASH)
  if (path.startsWith('/analytics/compliance/drill')) return Promise.resolve({ is_store: false, children: [] })
  if (path.startsWith('/analytics/compliance')) return Promise.resolve(COMPLIANCE)
  return Promise.resolve({})
}

afterEach(() => vi.clearAllMocks())

describe('Dashboard', () => {
  it('renders the KPI numbers from the dashboard payload', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    expect(await screen.findByText('64%')).toBeTruthy()        // Avg compliance = pass_pct
    expect(screen.getByText('11')).toBeTruthy()                // Surveys completed
    expect(screen.getByText('3')).toBeTruthy()                 // Overdue
  })

  it('renders a compliance row and a null pass_pct as a no-data dash', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    expect(await screen.findByText('Velvet Lip Shelf Check')).toBeTruthy()
    expect(screen.getByText('Central')).toBeTruthy()
  })

  it('shows the AI gap list with a preview badge', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    expect(await screen.findByText(/preview/i)).toBeTruthy()
    expect(screen.getByText('Rosewood')).toBeTruthy()
  })

  it('changing the range re-queries the dashboard', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    await screen.findByText('64%')
    const before = vi.mocked(apiGet).mock.calls.filter(c => String(c[0]).startsWith('/analytics/dashboard')).length
    fireEvent.click(screen.getByRole('button', { name: 'YTD' }))
    await waitFor(() => {
      const after = vi.mocked(apiGet).mock.calls.filter(c => String(c[0]).startsWith('/analytics/dashboard')).length
      expect(after).toBeGreaterThan(before)
    })
  })

  it('Export triggers the CSV download', async () => {
    vi.mocked(apiGet).mockImplementation(route as never)
    renderApp(<Dashboard />)
    await screen.findByText('64%')
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(vi.mocked(downloadCsv)).toHaveBeenCalledWith(
      expect.stringContaining('/export/compliance?format=csv'), expect.any(String))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- src/pages/Dashboard/Dashboard.test.tsx`
Expected: FAIL (no `Dashboard`).

- [ ] **Step 3: Build the sub-components**

Port from the prototype `analytics.jsx` using the Stage B UI kit (`Icon`, `Spark`, `Bar`, `Chip`, `Button`, `Card`, `Segmented`). Convert backend 0..100 to 0..1 for `Bar`/`Spark`/trend; show null as an em-dash glyph.

- **`KpiCard.tsx`** (+ `.module.css`): props `{ label: string, value: string, delta?: number | null, deltaSuffix?: string, goodWhenDown?: boolean, spark?: number[] }`. Render the label, the big `value`, a delta chip (Icon arrowUp/arrowDown + the delta) only when `delta` is a finite number, colored green/red using `goodWhenDown` to flip polarity, and a `Spark` when `spark` has points. A null/undefined value shows the em-dash glyph.
- **`TrendChart.tsx`** (+ `.module.css`): port the prototype `TrendChart` SVG but SINGLE series. Props `{ points: { week_start: string; completion_pct: number | null }[] }`. Map `completion_pct/100` to y (0 at bottom, 1 at top), x evenly spaced; gridlines at 0/25/50/75/100; draw a single accent polyline + a soft area fill; skip null points (break the line / omit, never `NaN`); x labels = `W1..Wn` (index based). Render a small empty state when there are < 2 points.
- **`ComplianceList.tsx`** (+ `.module.css`): props `{ rows: ComplianceRow[] }`. Each row: `survey_name` (bold) + `target_node_name` (muted), a `Bar value={(row.pass_pct ?? 0)/100}` toned by threshold (>=88 green, >=78 default, else amber), the pass % (or an em-dash if null), and `responded/expected` count. Clicking a row toggles a drill: call `apiGet('/analytics/compliance/drill?node_id=<target_node_id>&survey_version_id=<survey_version_id>')` (a `useQuery` enabled on expand) and render its `children` rows (name + Bar + %) indented; if `is_store`, show the per-product why-it-failed from `items`/`questions`. Keep it simple: one level of drill in W1d.
- **`AiPreview.tsx`** (+ `.module.css`): the dashed-violet-border card, header "Per-SKU AI intelligence" + a `Chip` "AI fast-follow, preview", and a hardcoded gap list (Rosewood "2 facings short of planogram" Restock, Mauve "Out of stock" Replenish, Coral "Price tag missing" Replace tag), each a colored swatch + name + issue + a disabled-looking action button. A footer line: "Preview, not yet reading live photos." Wired to nothing.

- [ ] **Step 4: Build `Dashboard.tsx`**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Icon, Segmented, Spark } from '../../ui'
import { downloadCsv } from '../../lib/api'
import { useAppDispatch } from '../../store'
import { signedOut } from '../../store/auth'
import { useDashboard, useCompliance, type Range } from './useDashboard'
import KpiCard from './KpiCard'
import TrendChart from './TrendChart'
import ComplianceList from './ComplianceList'
import AiPreview from './AiPreview'
import styles from './Dashboard.module.css'

const DASH = (v: number | null | undefined) => (v == null ? '—' : v)

export default function Dashboard() {
  const [range, setRange] = useState<Range>('12w')
  const dash = useDashboard(range)
  const comp = useCompliance()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()

  const c = dash.data?.current
  const p = dash.data?.previous
  const spark = (dash.data?.trend ?? []).map((t) => t.completion_pct).filter((v): v is number => v != null)

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div>
          <h1 className={styles.title}>Analytics</h1>
          <div className={styles.sub}>All nodes, period to date</div>
        </div>
        <div className={styles.controls}>
          <Segmented options={['4w', '12w', 'YTD']} value={range} onChange={(r) => setRange(r as Range)} />
          <Button size="sm" onClick={() => downloadCsv('/export/compliance?format=csv', 'intelli_compliance.csv')}>
            <Icon name="download" size={14} /> Export
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { dispatch(signedOut()); navigate('/login', { replace: true }) }}>
            <Icon name="logout" size={14} /> Sign out
          </Button>
        </div>
      </header>

      <div className={styles.kpis}>
        <KpiCard label="Avg. compliance"
          value={c ? `${DASH(c.pass_pct)}${c.pass_pct == null ? '' : '%'}` : '—'}
          delta={c && p && c.pass_pct != null && p.pass_pct != null ? +(c.pass_pct - p.pass_pct).toFixed(1) : null}
          deltaSuffix=" pts" spark={spark} />
        <KpiCard label="Surveys completed" value={c ? String(c.surveys_completed) : '—'}
          delta={c && p ? c.surveys_completed - p.surveys_completed : null} />
        <KpiCard label="Overdue surveys" value={c ? String(c.overdue) : '—'}
          delta={c && p ? c.overdue - p.overdue : null} goodWhenDown />
      </div>

      <div className={styles.row}>
        <Card className={styles.trendCard}>
          <div className={styles.cardTitle}>Completion trend</div>
          <TrendChart points={dash.data?.trend ?? []} />
        </Card>
        <Card className={styles.compCard}>
          <div className={styles.cardTitle}>Compliance by node</div>
          <ComplianceList rows={comp.data?.rows ?? []} />
        </Card>
      </div>

      <AiPreview />
    </div>
  )
}
```

(Adjust the KPI value/`findByText` so the tests' `64%`, `11`, `3` match: the Avg-compliance card shows `64%`, surveys `11`, overdue `3`.)

- [ ] **Step 5: Route `/` to the dashboard; remove Home; rewrite the journey test**

In `apps/admin/src/App.tsx`, replace the `Home` import and the `/` element with the dashboard:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard/Dashboard'
import Login from './pages/Login'
import { selectSession, useAppSelector } from './store'

export default function App() {
  const session = useAppSelector(selectSession)
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={session ? <Dashboard /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={session ? '/' : '/login'} replace />} />
    </Routes>
  )
}
```

Delete `apps/admin/src/pages/Home.tsx`, `Home.module.css`, `Home.test.tsx`.

Rewrite `apps/admin/src/App.test.tsx`'s logged-in journey: it must now mock `apiGet`/`downloadCsv` (the dashboard fetches on mount) and assert the dashboard appears after login (e.g. `findByText('Analytics')` or a KPI) instead of "Welcome, Dana", and that Sign out returns to the login screen. Wrap renders in the `renderApp` helper (or add `QueryClientProvider` to its existing tree) so `useQuery` works. Keep the wrong-password and validation assertions intact.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test:admin -- src/pages/Dashboard/Dashboard.test.tsx` then `pnpm test:admin` (whole suite) and `pnpm build:admin`.
Expected: dashboard tests pass; the suite is green (Home tests removed, App journey rewritten, new dashboard tests added); build compiles.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/pages/Dashboard apps/admin/src/App.tsx apps/admin/src/App.test.tsx
git rm apps/admin/src/pages/Home.tsx apps/admin/src/pages/Home.module.css apps/admin/src/pages/Home.test.tsx
git commit -m "W1d: Analytics dashboard screen (KPIs, trend, compliance drill, AI preview) at /

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Verify live in the browser

- [ ] **Step 1: Run the app against the live backend**

With the backend up (`docker compose up -d`), run `pnpm dev:admin` and open `http://localhost:5173`. Log in as `dana@lumenbeauty.com` / `demo1234`. Confirm: the dashboard loads, the KPI numbers and trend reflect the seed data (small but real), the compliance list shows the seeded assignment and a row click drills, the range control re-queries, Export downloads a CSV, and the AI section is badged "preview." Note the numbers are modest (the seed has a few responses); that is expected.

- [ ] **Step 2: Confirm the full suites**

Run: `pnpm test:admin` (green) and `docker compose exec -T api pytest -q` (still 183). No commit needed if clean; otherwise fix and commit.

---

## Self-Review

**Spec coverage (dashboard parts):**
- KPI cards (Avg compliance=pass_pct, Surveys completed, Overdue) with sparkline + delta + good-when-down + null em-dash: Task 2 KpiCard + Dashboard. ✓
- Completion trend, single series, null-safe, from `trend`: Task 2 TrendChart. ✓
- Compliance-by-node (assignment rows) + click-to-drill via `(target_node_id, survey_version_id)`: Task 2 ComplianceList + useDashboard. ✓
- AI gap list, badged preview, wired to nothing: Task 2 AiPreview. ✓
- Range control (4w/12w/YTD) re-queries; Export via downloadCsv(`?format=csv`): Task 1 + Task 2. ✓
- 0..100 -> 0..1 conversion + null handling: throughout Task 2. ✓
- Mounts at `/`, Home removed, App journey rewritten: Task 2 Step 5. ✓
- Live browser check: Task 3. ✓

**Placeholder scan:** hooks/routing/tests are complete code; the visual sub-components (KpiCard/TrendChart/ComplianceList/AiPreview) have complete prop/behavior specs + the prototype named as the verbatim visual source + a complete test contract. No TBD.

**Type/name consistency:** `Range`, `useDashboard`, `useCompliance`, `rangeToDates`, `DashboardData`, `ComplianceRow` are defined in `useDashboard.ts` and consumed by `Dashboard.tsx`/tests; the UI-kit imports (`Button`, `Card`, `Icon`, `Segmented`, `Spark`, `Bar`) match the Stage B barrel; `downloadCsv`/`apiGet` match Stage B. The em-dash glyph `—` is on-screen content, not a code comment.

(Stage C, the shell, will later wrap this page in the sidebar/topbar and move the range + export + sign-out into the shell's topbar; the Dashboard becomes the shell's `/` outlet content.)
