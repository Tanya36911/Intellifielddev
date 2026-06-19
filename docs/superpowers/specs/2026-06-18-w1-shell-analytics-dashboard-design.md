# W1: Admin app shell + Analytics dashboard design

Approved in design by Tanya on 2026-06-18 (after studying the prototype frontend
in depth), then tightened on 2026-06-19 after a 3-reviewer adversarial pass. This
is the first piece of the screens-first roadmap (see
[ROADMAP.md](../../../ROADMAP.md)): the production Admin web app gets its real
shell (the navigation frame every screen lives in) and its landing screen, the
Analytics dashboard, ported faithfully from the prototype and wired to the
existing backend. Plain-English throughout.

## The goal, in one paragraph

Turn the Admin web app from "a login plus a near-empty welcome card" into a real,
branded product a stakeholder can look at. You log in and land on the Analytics
dashboard inside the app shell: a left navigation (Intelli brand, your company,
your screens, your name and role) and a top bar, matching the prototype's look.
The dashboard shows live headline numbers (compliance, surveys completed,
overdue), a weekly completion-trend line, and a compliance-by-node list you click
to drill from a survey's coverage down to a single store and the exact product
that failed, plus an Export button and the AI gap list clearly badged "preview."
It is faithful to the prototype's design system (same tokens, components, layout)
and every number is real, computed by the backend and branch-scoped (a manager
only sees their branch). One small read-only backend endpoint and two small
login-response fields are added; no new tables.

## Decisions made with Tanya (2026-06-18) and corrections from review (2026-06-19)

1. **One combined first screen: the shell + the Analytics dashboard as the
   landing.** The prototype lands directly on Analytics; there is no separate
   plain home, so we do not build one (and the old `Home.tsx` is replaced).
2. **Make the numbers real.** A small `/analytics/dashboard` endpoint backs the
   headline KPIs, the weekly trend, and the footprint counts; compliance-by-node
   reuses the endpoints that already exist.
3. **Faithful port of the prototype design system** (tokens, components, layout),
   with intentional, enumerated content deviations (below). "Looks like the
   prototype" means the design system + shell layout, not identical content.
4. **Web-appropriate shell trims:** no tenant switcher (one company per login),
   no "Synced" control (offline sync is a phone/Phase-5 concept). The setup
   wizard, notifications bell, and Proof pack render as plain "coming soon"
   (a disabled nav row / a no-badge bell), and unbuilt nav items open a shared
   `ComingSoon` placeholder page so nothing dead-ends.
5. **The sidebar company name and the user's "pinned to ..." need a real source,
   so we add it.** Today `/auth/login` returns only `{name, role}` and the JWT
   carries a tenant UUID, no display names. We add `company_name` and
   `pinned_node_name` to the login response `user` object (a small lookup in
   `auth.py`, no new table). The shell reads them.
6. **Compliance-by-node is assignment-oriented** (this is a correction). The real
   `GET /analytics/compliance` returns one row per survey assignment (survey name
   + target node + completion%/pass% + counts), not the prototype's per-region
   rollup. So the card lists those assignment rows; clicking one drills via its
   `(target_node_id, survey_version_id)` through `GET /analytics/compliance/drill`
   to child nodes, then to a store's per-product why-it-failed. The prototype's
   per-region delta column is dropped (no per-node delta exists in the data).
7. **Out-of-stock-by-SKU is DEFERRED out of W1** (this changes the earlier plan).
   `GET /analytics/oos` needs a specific `survey_version_id` + `question_id`, which
   needs a survey/question picker that belongs with the Surveys screen. For W1 the
   "Per-SKU AI intelligence" section is **only** the labeled "preview" gap list
   (Restock/Replenish, wired to nothing). OOS comes back, real, in a later step.
8. **Dropped: "Avg. completion time"** (survey duration is never recorded). Three
   KPI cards, not four.
9. **Deferred (need shelf-photo storage 5-BE-c, or secondary):** the photo
   gallery, Proof pack, response-detail modal, and the detailed overdue *list*
   (the overdue *count* shows now).
10. **W1 is built in four staged, separately-checkable phases** (see the plan):
    (A) backend endpoint + repo methods + tests; (B) frontend foundation (tokens,
    UI kit, TanStack Query, auth client); (C) the shell; (D) the dashboard screen.

## What gets built

### Backend: a small login-response addition
`POST /auth/login`'s returned `user` object gains `company_name` (the tenant's
name) and `pinned_node_name` (the name of the node the user is pinned to, or null
if unpinned). `auth.py` looks these up at login (tenant by id; the pinned node via
the same `assignments -> nodes` join `scope_path_for` already uses). No new table,
no JWT change. The frontend `SessionUser` type grows to match.

### Backend: one new read-only endpoint
`GET /analytics/dashboard?node_id=<optional>&date_from=<optional>&date_to=<optional>`
in `api/app/analytics.py`, branch-scoped through `ScopedRepo`, no new tables
(reads `responses` / `survey_assignments` / `nodes` / `users` / `assignments`).
Returns:

```
{
  "footprint": { "nodes": int, "stores": int, "reps": int },
  "current":  { "completion_pct": float|null, "pass_pct": float|null,
                "expected": int, "responded": int, "scored": int, "passed": int,
                "surveys_completed": int, "overdue": int },
  "previous": { ...same shape... } | null,
  "trend":    [ { "week_start": "YYYY-MM-DD", "completion_pct": float|null,
                  "responded": int, "expected": int } ]
}
```

Computation (the review corrected several of these; they are NOT a sum over
`assignment_compliance`):
- **footprint** (all filtered to the scope base path, so a `node_id` narrows them):
  `nodes` = count of nodes under the base path; `stores` = count of max-level
  nodes (`org_level_definitions` max `level_order`) under it; `reps` = count of
  users with `role = 'rep'` whose pin (`assignments.node_id -> nodes.path`) is
  under the base path. Unpinned reps (no `assignments` row) are excluded. No
  "active" filter (the users table has no status column).
- **compliance aggregate** (`completion_pct`, `pass_pct`, and the four counts):
  computed over the **distinct set of (store, survey_version) coverage
  obligations** in scope, NOT by summing per-assignment rows (which would
  double-count a store covered by two assignments). Gather each covered max-level
  store under each in-scope assignment's measured path, dedupe to distinct
  `(store_node_id, survey_version_id)` pairs; `expected` = count of those pairs;
  for `current`/`previous`, take each store's **latest response within the date
  window** for that version and score it once via the existing `_overall_for`
  (reusable as-is); `responded` = pairs with such a response, `scored`/`passed`
  from the verdict; percentages via the existing `_pct` (null when the denominator
  is 0). A store under two different versions counts once per version; a store
  under two assignments of the same version counts once.
- **surveys_completed** = count of `responses` in scope within the date window.
- **overdue** (as of now, NOT date-filtered): for each in-scope assignment with
  `deadline IS NOT NULL AND deadline < now()`, count its covered max-level stores
  that have zero responses for that `survey_version_id`; sum across assignments. A
  NULL deadline is never overdue (the seed assignments have no deadline, so a test
  must seed a past deadline to exercise this).
- **previous** = the same `current` block recomputed over the equal-length window
  immediately before `date_from`; `null` when no date range is supplied (then the
  KPI cards show no delta).
- **trend**: weekly buckets over the selected range. Week boundary = ISO week,
  `week_start` = Monday 00:00 UTC (responses bucketed by `submitted_at` in UTC,
  consistent with `facings_trend`). Per week: `expected` = the constant distinct
  covered-store count in scope; `responded` = distinct stores with at least one
  response in that week; `completion_pct` = `_pct(responded, expected)`.
- **scope semantics:** a `node_id` outside scope returns `None` -> the endpoint
  404s (like the other analytics endpoints). An unpinned caller (`scope_path` is
  None) returns a fully-populated **zero payload** (footprint 0s, current counts 0
  with pct null, previous null, trend []) at 200, never None.

New `ScopedRepo` methods (analytics section): `dashboard(node_id, date_from,
date_to)` plus private helpers for the footprint counts, the date-bounded
distinct-coverage aggregate, the overdue count, and the weekly trend. `_overall_for`
and `_pct` are reused; `_metrics_for_stores` is NOT used (it is latest-only and
has no date bound).

### Frontend foundation (the reusable pieces the shell and later screens need)
- **Design tokens + global CSS:** extend `packages/tokens` (already imported at the
  admin root, exposing `./tokens.css` + a JS object) to the full prototype set: add
  `--sidebar-w` (248px), `--topbar-h` (56px), the `data-density` variants, the
  `data-theme="dark"` block, and the fonts (Space Grotesk headings, Hanken Grotesk
  body, JetBrains Mono). Exact values captured from the prototype `styles.css`.
- **A shared UI kit** in `apps/admin/src/ui/` (promoted to a package when the
  Manager app arrives), porting the prototype primitives as React + CSS Modules:
  `Icon` (the SVG icon map), `Avatar`, `Chip`, `Button`, `Card`, `Segmented`,
  `Switch`, `Spark`, `Bar`. **Numeric convention:** `Bar`/`Spark`/the trend chart
  consume 0..1 floats; the backend emits 0..100 or null, so the screen converts
  (divide by 100) and handles null as "no data" (an em-dash in a KPI/bar label; a
  dropped point/gap in the trend and sparkline, never a `NaN` SVG coordinate).
- **Server state with TanStack Query** (new dependency `@tanstack/react-query`):
  `QueryClientProvider` at the app root (a clean one-level add in `main.tsx`).
- **Authenticated API client:** extend `apps/admin/src/lib/api.ts` with
  `apiGet(path)` and a `downloadCsv(path)` helper. The Bearer token is read from
  `localStorage[SESSION_KEY]` (the key `auth.ts` already exports and mirrors the
  session to); `api.ts` must NOT import the Redux store (that would create a
  store<->api cycle), so `SESSION_KEY` (and a tiny `readToken()`) move to a small
  non-Redux module both can import. On a 401, `apiGet` throws `ApiError(401)`; a
  thin React-side handler (the QueryClient `onError`, or an effect) dispatches
  `signedOut()` and routes to `/login`. `downloadCsv` fetches with the Bearer
  header (a bare `<a download>` would 401), reads the body as a Blob, and triggers
  the download with a client-set filename (Content-Disposition is not honored for
  blob downloads).

### The shell (`apps/admin/src/shell/`)
Ported from the prototype `shell.jsx` as React Router layout components:
- **`Sidebar`:** the Intelli brand + "Field Execution"; a static company card
  (`user.company_name`, no switcher); the nav in the prototype's two groups
  (main: Analytics, Form Builder w/ "AI" badge, Surveys, Catalog; ORGANIZATION:
  Hierarchy, Users & Roles, Settings); the Nodes/Stores/Reps footprint (from
  `/analytics/dashboard`); the user card (`user.name`, `user.role`, "pinned to
  {user.pinned_node_name}") with a working Sign out. The "Re-run setup wizard"
  shows as a disabled "coming soon" row.
- **`Topbar`:** page title + subtitle, a slot for per-screen controls, and a
  notifications bell rendered "coming soon" (no badge, no dropdown; no "Synced").
- **`Page`:** the scrolling, max-width content wrapper.
- **Routing (`App.tsx`):** the authenticated area becomes a layout route that
  renders the shell with an `<Outlet/>`. `/` is the Analytics dashboard; add
  routes for `/catalog`, `/surveys`, `/forms`, `/hierarchy`, `/users`,
  `/settings`, each rendering a shared `ComingSoon` page (the nav item's
  label/icon + one line of copy). `/login` stays outside the shell. The nav
  highlights the active route.

### The Analytics dashboard screen (`apps/admin/src/pages/Analytics/`)
Ported from the prototype `analytics.jsx`, wired to real data:
- **3 KPI cards** (Avg. compliance = `pass_pct`; Surveys completed; Overdue
  surveys), each a big number + a `Spark` sparkline + a delta chip when `previous`
  exists. **Delta rules:** Avg. compliance delta = percentage-point difference
  (`current.pass_pct - previous.pass_pct`, shown like "+2.1 pts"); the count KPIs
  use the absolute difference; **Overdue is "good when down"** (a decrease is
  green). When `previous` is null the card hides the delta chip (a new
  delta-absent variant the prototype lacks).
- **Completion trend** line chart (hand-rolled SVG), **single series** = branch
  completion % from `trend` (values /100; null weeks are gaps). The prototype's
  second "Promo" series, its two-line legend, and the per-week hover tooltip are
  dropped for W1 (an intentional deviation); x labels are the week index (W1..Wn).
- **Compliance by node** (assignment-oriented, per decision 6): rows from
  `GET /analytics/compliance` (survey name @ target node, a `Bar` of `pass_pct`/100,
  the %, and the store count); clicking a row drills via its `(target_node_id,
  survey_version_id)` through `GET /analytics/compliance/drill` to child nodes and
  then a store's per-product why-it-failed. No per-node delta.
- **Per-SKU AI intelligence:** ONLY the rep-facing real-time gap list (Rosewood
  "2 facings short", Restock/Replenish), a hardcoded sample, clearly badged "AI
  fast-follow, preview", wired to nothing. (OOS-by-SKU deferred, decision 7.)
- **Top-bar controls:** a `4w / 12w / YTD` segmented control that sets the date
  range and re-queries the dashboard; an **Export** button that downloads the
  compliance CSV via `downloadCsv('/export/compliance?format=csv')`.

## The tests (the gate for W1)
- **Backend (`api/tests/test_dashboard.py`):** the login response now carries
  `company_name`/`pinned_node_name`; `/analytics/dashboard` returns correct
  footprint counts (nodes/stores/reps under scope, unpinned reps excluded), a
  compliance aggregate that does NOT double-count a store covered by two
  assignments (seed a second overlapping assignment and assert `expected` counts
  the store once per version), the surveys-completed count, an overdue count that
  is 0 with NULL deadlines and non-zero once a past deadline is seeded, a `previous`
  block over the prior window (and null without a range), a weekly `trend` bucketed
  by ISO week, a `node_id` out of scope -> 404, a manager sees only their branch,
  and an unpinned caller gets the zero payload (200). Full backend suite stays
  green.
- **Frontend (Vitest + Testing Library):** a shared render helper wraps components
  in `QueryClientProvider` (fresh client, retries off) + `Provider` + router,
  mocking `./lib/api` (the established `vi.mock(importOriginal)` style). The shell
  renders the company, the user's name/role/pin, and the nav; Sign out works; an
  unbuilt nav item shows the `ComingSoon` page. The dashboard renders the three KPI
  numbers (and an em-dash for a null pct), a compliance row and a drill
  interaction, and the AI section with its "preview" badge; the range control
  re-queries; Export calls `downloadCsv`. **`Home.tsx`, `Home.module.css`, and
  `Home.test.tsx` are removed** (superseded by the dashboard), and the
  `App.test.tsx` login journey is rewritten to land on the dashboard (it currently
  asserts "Welcome, Dana"). The frontend check count therefore changes (some of
  the 27 are rewritten/removed and new ones added); the suite ends green.

## The new and changed files
- `api/app/auth.py` - add `company_name` + `pinned_node_name` to the login user.
  Modify.
- `api/app/analytics.py` - add `GET /analytics/dashboard`. Modify.
- `api/app/scope.py` - add the dashboard repo methods (footprint, date-bounded
  distinct-coverage aggregate, overdue, weekly trend, previous-window). Modify.
- `api/tests/test_dashboard.py` - the backend tests (incl. a seeded second
  overlapping assignment and a past-deadline assignment). New.
- `api/app/seed.py` - if a test needs a past-deadline assignment / a second
  overlapping assignment that the existing seed lacks. Modify if needed.
- `packages/tokens/` - the full token set + density + dark mode + layout vars +
  fonts. Modify.
- `apps/admin/src/ui/` - the shared UI kit (Icon, Avatar, Chip, Button, Card,
  Segmented, Switch, Spark, Bar) + CSS Modules. New.
- `apps/admin/src/lib/api.ts` + a small `apps/admin/src/lib/session.ts`
  (`SESSION_KEY`, `readToken`) shared by `api.ts` and `store/auth.ts` to avoid a
  cycle. Modify/New.
- `apps/admin/src/shell/` - Sidebar, Topbar, Page, layout. New.
- `apps/admin/src/App.tsx` - the layout route + screen routes + placeholders.
  Modify. `apps/admin/src/pages/ComingSoon.tsx` - the shared placeholder. New.
- `apps/admin/src/pages/Analytics/` - the dashboard + sub-components. New.
- `apps/admin/src/pages/Home.tsx` / `Home.module.css` / `Home.test.tsx` - removed.
- `apps/admin/src/App.test.tsx` - journey rewritten to the dashboard. Modify.
- `apps/admin/src/main.tsx` - mount `QueryClientProvider`. Modify.
- `apps/admin/package.json` - add `@tanstack/react-query`. Modify.
- Docs updated in the same breath: `apps/admin/README.md`, `CODEBASE_MAP.md`,
  `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`, the prototype handoff
  CHANGELOG, and tick W1 in `ROADMAP.md`.

## Deliberately NOT in W1 (so nothing is silently missing)
- **Out-of-stock-by-SKU panel:** deferred (needs a survey/question picker; pairs
  with the Surveys screen). W1's AI section is the labeled preview gap list only.
- **The photo gallery, Proof pack, response-detail modal:** need shelf-photo
  storage (5-BE-c).
- **The detailed overdue list:** the count shows now; the list comes later.
- **The rich, scoped Export modal:** W1 has a one-click compliance-CSV download.
- **The second trend series ("Promo"), per-node compliance delta, the trend hover
  tooltip:** dropped for W1 (intentional content deviations from the prototype).
- **Avg. completion time KPI:** dropped (no duration data).
- **Tenant switcher, "Synced", real notifications, the setup wizard, and the
  Catalog/Surveys/Form Builder/Hierarchy/Users/Settings screens:** "coming soon"
  placeholders now; each is its own later W step.
- **Dark mode / density UI toggles:** tokens support them; no toggle in W1.
- **The Manager web app:** a later track.

## How we will know W1 is done
The `/analytics/dashboard` tests are green and its compliance aggregate matches a
hand-computed distinct-store figure (no double-count); the login response carries
the company/pin names; the frontend builds, the shell renders with working
navigation, the company/user/pin, and sign-out, and the dashboard shows the live
KPIs (with null handled as an em-dash), the single-series trend, and the
compliance drill, with the AI gap list badged "preview"; the full backend suite
and the updated frontend suite end green; and a live browser walk-through (log in,
land on the dashboard, drill an assignment row to a failing store, switch the
4w/12w/YTD range, download the CSV) behaves as described and uses the prototype's
design system. The screen looks like the prototype's design language, with the
content deviations enumerated above. All guides updated.
