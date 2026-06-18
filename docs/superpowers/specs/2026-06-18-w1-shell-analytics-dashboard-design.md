# W1: Admin app shell + Analytics dashboard design

Approved in design by Tanya on 2026-06-18 (after studying the prototype frontend
in depth). This is the first piece of the screens-first roadmap (see
[ROADMAP.md](../../../ROADMAP.md)): the production Admin web app gets its real
shell (the navigation frame every screen lives in) and its landing screen, the
Analytics dashboard, ported faithfully from the prototype and wired to the
existing backend. Plain-English throughout.

## The goal, in one paragraph

Turn the Admin web app from "a login plus a near-empty welcome card" into a real,
branded product a stakeholder can look at. You log in and land on the Analytics
dashboard inside the app shell: a left navigation (Intelli brand, your company,
your screens, your name and role) and a top bar, exactly matching the prototype's
look. The dashboard shows live headline numbers (compliance, surveys completed,
overdue), a weekly completion-trend line, a compliance-by-node list you click to
drill from region to district to store, an out-of-stock-by-product panel, an
Export button, and the AI gap list clearly badged "preview." It is faithful to
the prototype's design system (same tokens, components, layout) and every number
is real, computed by the backend and branch-scoped (a manager only sees their
branch). One small read-only backend endpoint is added; no new tables.

## Decisions made with Tanya (2026-06-18)

1. **One combined first screen: the shell + the Analytics dashboard as the
   landing.** The prototype lands directly on Analytics; there is no separate
   plain home, so we do not build one.
2. **Make the numbers real, do not fake them.** A small `/analytics/dashboard`
   endpoint backs the headline KPIs, the weekly trend, and the footprint counts;
   compliance-by-node and out-of-stock reuse the endpoints that already exist.
3. **Faithful port of the prototype design system.** Same tokens (deep ocean blue
   `#1B4F8A` accent, Space Grotesk headings, Hanken Grotesk body, the radii /
   shadows / spacing), same shell structure, same components (KPI cards with
   sparklines, the hand-rolled SVG trend line and bars, the drill list).
4. **Web-appropriate trims to the shell:** no tenant switcher (each login is one
   company), and no "Synced" control (that is the phone's offline sync, a Phase 5
   concept; the web app is always online). The "Re-run setup wizard",
   notifications bell, and "Proof pack" appear as "coming soon" until their
   backends exist. Unbuilt nav items show a small "coming soon" panel so nothing
   dead-ends.
5. **The out-of-stock-by-SKU panel is real** (it maps to the existing
   `/analytics/oos`); only the rep-facing "fix it now" gap list (Restock /
   Replenish) stays the labeled **AI preview** (the no-fake-AI rule).
6. **Dropped: "Avg. completion time"** (survey duration is never recorded; it
   would need the Field app to time surveys, a Phase 5 thing). Shown as three KPI
   cards, not four.
7. **Deferred to later screens (need the shelf-photo storage, 5-BE-c, or are
   secondary):** the photo gallery, the Proof pack, the response-detail modal, and
   the detailed overdue *list* (the overdue *count* shows now; the full list fits
   with the Surveys/Responses screen later).

## What gets built

### Backend: one new read-only endpoint
`GET /analytics/dashboard?node_id=<optional>&date_from=<optional>&date_to=<optional>`
in `api/app/analytics.py`, branch-scoped through the shared `ScopedRepo`, no new
tables (reads `responses` / `survey_assignments` / `nodes` / `users`). It returns
the headline figures in one call. Shape:

```
{
  "footprint": { "nodes": int, "stores": int, "reps": int },
  "current": {
    "completion_pct": float|null,   "pass_pct": float|null,
    "expected": int, "responded": int, "scored": int, "passed": int,
    "surveys_completed": int,        // responses submitted in scope + range
    "overdue": int                   // overdue (assignment, store) pairs
  },
  "previous": { ...same shape... } | null,   // the equal-length window before date_from, for the up/down deltas; null if no range given
  "trend": [ { "week_start": "YYYY-MM-DD", "completion_pct": float|null, "responded": int, "expected": int } ]
}
```

- **compliance** (`completion_pct`, `pass_pct`, and the four raw counts): the
  branch-wide aggregate of the existing `assignment_compliance` logic (summed
  expected / responded / scored / passed across the branch's assignments, then the
  zero-safe percentages). The "Avg. compliance" KPI card shows `pass_pct`;
  `completion_pct` is available too. Reuses the one `compliance.py` evaluator, so
  it can never disagree with the dashboard's own compliance-by-node list.
- **surveys_completed:** count of `responses` in scope (and the date range).
- **overdue:** count of (assignment, covered-store) pairs whose assignment
  `deadline` is in the past and that store has no response for that
  `survey_version`. Computed live from `survey_assignments.deadline` + the coverage
  path + `responses` (no new column).
- **previous:** the same block recomputed over the equal-length window immediately
  before `date_from` (so the cards can show the up/down delta). `null` when no date
  range is supplied (then the cards show no delta).
- **trend:** weekly buckets over the selected range; each week's `completion_pct`
  is the responded-vs-expected for the branch by that week (the rising completion
  curve the prototype shows). Feeds the trend chart and the compliance sparkline;
  the surveys-completed sparkline uses the weekly `responded` counts. (The overdue
  card shows count + delta, no sparkline.)
- **Validation/scope:** a `node_id` outside the caller's scope -> 404; an unpinned
  caller -> empty/zero figures (200), mirroring the other analytics endpoints.

### Frontend foundation (the reusable pieces the shell and every later screen need)
- **Design tokens + global CSS:** extend `packages/tokens` to the full prototype
  set (it already mirrors the colors): add `--sidebar-w` (248px), `--topbar-h`
  (56px), the density variants (`data-density`), and the dark-mode block
  (`data-theme="dark"`), plus the fonts (Space Grotesk headings, Hanken Grotesk
  body, JetBrains Mono). The exact values are in the prototype `styles.css` and
  were captured during design.
- **A small shared UI kit** in `apps/admin/src/ui/` (promoted to a package later
  when the Manager app arrives), porting the prototype primitives as React + CSS
  Modules: `Icon` (the SVG icon map), `Avatar`, `Chip`, `Button`, `Card`,
  `Segmented`, `Switch`, `Spark` (hand-rolled SVG sparkline polyline), `Bar`
  (progress bar). Same markup/classes as the prototype.
- **Server state with TanStack Query** (the decided stack for server data): add the
  `QueryClientProvider` at the app root. Screens fetch with `useQuery`.
- **Authenticated API client:** extend `apps/admin/src/lib/api.ts` with an
  `apiGet(path)` (and a CSV-download helper) that attaches the session's Bearer
  token and, on a 401, dispatches sign-out and routes to login. Keeps the
  "one file talks to the backend" rule.

### The shell (`apps/admin/src/shell/`)
Ported from the prototype's `shell.jsx`, as React Router layout components:
- **`Sidebar`:** the Intelli brand mark + "Field Execution"; a static company card
  (the signed-in user's company, no switcher); the nav in the prototype's two
  groups (main: Analytics, Form Builder with an "AI" badge, Surveys, Catalog;
  ORGANIZATION: Hierarchy, Users & Roles, Settings); the Nodes/Stores/Reps
  footprint counts (from `/analytics/dashboard`); the user card (name, role,
  "pinned to ...") with a working Sign out. A "Re-run setup wizard" item shows as
  "coming soon".
- **`Topbar`:** page title + subtitle, a slot for per-screen controls, and a
  notifications bell shown as "coming soon" (no "Synced" control on web).
- **`Page`:** the scrolling, max-width content wrapper.
- **Routing (`App.tsx`):** the authenticated area becomes a layout route that
  renders the shell with an `<Outlet/>`. `/` is the Analytics dashboard; add routes
  for `/catalog`, `/surveys`, `/forms`, `/hierarchy`, `/users`, `/settings`, each a
  simple **"coming soon"** placeholder page for now. `/login` stays outside the
  shell. The nav highlights the active route.

### The Analytics dashboard screen (`apps/admin/src/pages/Analytics/`)
Ported from the prototype `analytics.jsx`, wired to real data:
- **3 KPI cards** (`Avg. compliance` = `pass_pct`, `Surveys completed`, `Overdue
  surveys`), each a big number + (where available) a delta chip from `previous` +
  a `Spark` sparkline.
- **Completion trend** line chart (hand-rolled SVG), from `trend`.
- **Compliance by node**: the region list with horizontal `Bar`, %, and store
  count, from `GET /analytics/compliance`; clicking a row drills into its children
  via `GET /analytics/compliance/drill`, down to a store's per-product
  why-it-failed (the data 4b already returns).
- **Out-of-stock by SKU**: the leadership-facing panel from `GET /analytics/oos`
  (real). The rep-facing **real-time gap list** (Rosewood "2 facings short",
  Restock/Replenish) stays a hardcoded, clearly **"AI fast-follow, preview"**
  badged block, wired to nothing.
- **The top-bar controls:** a `4w / 12w / YTD` segmented control that sets the date
  range (re-queries the dashboard), and an **Export** button that downloads the
  compliance CSV via the existing `/export/compliance`. (The richer scoped export
  modal and Proof pack are a later polish.)

### Data wiring map (so nothing is ambiguous)
| Dashboard element | Source |
|---|---|
| KPI: Avg. compliance, Surveys completed, Overdue (+ deltas, sparklines) | `GET /analytics/dashboard` |
| Completion trend line | `GET /analytics/dashboard` (`trend`) |
| Footprint (Nodes/Stores/Reps) | `GET /analytics/dashboard` (`footprint`) |
| Compliance by node + drill | `GET /analytics/compliance`, `GET /analytics/compliance/drill` |
| Out-of-stock by SKU | `GET /analytics/oos` |
| Export button | `GET /export/compliance` (CSV) |
| Real-time AI gap list | none (labeled preview, hardcoded sample) |

## The tests (the gate for W1)
- **Backend (`api/tests/test_dashboard.py`):** `/analytics/dashboard` returns the
  right footprint counts, the compliance aggregate matching the per-node numbers,
  the surveys-completed count, and the overdue count for a known seeded world;
  the date range filters; `previous` is the prior window (and `null` without a
  range); a `node_id` out of scope is 404; a manager sees only their branch; an
  unpinned caller gets zeros. Full backend suite stays green.
- **Frontend (Vitest + Testing Library):** the shell renders the nav, the company,
  and the user, Sign out works, and an unbuilt nav item shows the "coming soon"
  placeholder; the dashboard, with the API layer mocked, renders the three KPI
  numbers, the compliance-by-node rows and a drill interaction, the OOS rows, and
  the AI section with its "preview" badge present; the segmented range control
  re-queries; Export triggers the CSV download. The existing 27 checks stay green
  and the count grows.

## The new and changed files
- `api/app/analytics.py` - add the `/analytics/dashboard` endpoint. Modify.
- `api/app/scope.py` - add the dashboard aggregate methods to the `ScopedRepo`
  analytics section (footprint counts, the branch compliance aggregate, overdue
  count, the weekly trend, the previous-window recompute). Modify.
- `api/tests/test_dashboard.py` - the backend tests. New.
- `packages/tokens/` - the full token set + density + dark mode + layout vars +
  fonts. Modify.
- `apps/admin/src/ui/` - the shared UI kit (Icon, Avatar, Chip, Button, Card,
  Segmented, Switch, Spark, Bar) with CSS Modules. New.
- `apps/admin/src/lib/api.ts` - the authenticated `apiGet` + CSV-download helper.
  Modify.
- `apps/admin/src/shell/` - Sidebar, Topbar, Page, the shell layout. New.
- `apps/admin/src/App.tsx` - the layout route + screen routes + placeholders.
  Modify.
- `apps/admin/src/pages/Analytics/` - the dashboard screen + its sub-components
  (KpiCard, TrendChart, ComplianceCard, OosCard, the AI preview block). New.
- `apps/admin/src/pages/placeholders/` - the "coming soon" pages. New.
- `apps/admin/src/main.tsx` - mount `QueryClientProvider`. Modify.
- `apps/admin/package.json` - add `@tanstack/react-query`. Modify.
- Docs updated in the same breath: `apps/admin/README.md`, `CODEBASE_MAP.md`,
  `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`, the prototype handoff
  CHANGELOG, and tick W1 in `ROADMAP.md`.

## Deliberately NOT in W1 (so nothing is silently missing)
- **The photo gallery, Proof pack, response-detail modal:** need the shelf-photo
  storage (5-BE-c); later.
- **The detailed overdue list:** the count shows now; the list comes with the
  Surveys/Responses screen.
- **The rich, scoped Export modal:** W1 has a one-click compliance-CSV download;
  the prototype's filter-and-build modal is a later polish.
- **Tenant switcher, "Synced", real notifications, the setup wizard, Users &
  Roles / Settings / Catalog / Surveys / Form Builder / Hierarchy screens:** the
  shell shows them, but they are "coming soon" placeholders, built in later W
  steps (each its own design + spec + build).
- **Avg. completion time KPI:** dropped (no duration data).
- **Dark mode / density toggles:** the tokens support them, but no UI toggle in
  W1 (a later settings concern).
- **The Manager web app:** a later track (reuses these pieces, branch-scoped).

## How we will know W1 is done
The `/analytics/dashboard` tests are green and its numbers match the
compliance-by-node view; the frontend builds, the shell renders with working
navigation and sign-out, and the dashboard shows the live KPIs, trend,
compliance drill, and out-of-stock, with the AI gap list badged "preview"; the
full backend suite and the (grown) frontend checks stay green; and a live
walk-through in the browser (log in, land on the dashboard, drill a region to a
failing store, switch the 4w/12w/YTD range, download the CSV) behaves as
described and looks like the prototype. All guides updated.
