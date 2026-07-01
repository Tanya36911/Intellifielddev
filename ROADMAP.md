# Intelli roadmap (revamped 2026-06-18): screens first, so people see results

Read this with [START_HERE.md](START_HERE.md) (how to run it) and
[CONTEXT.md](CONTEXT.md) (what is built). This file is the plan for what we build
next and in what order, rewritten so every step puts something on a screen that
stakeholders can actually look at.

## Why we changed the order

For eight phases we built the engine: login, the org tree, the catalog, surveys,
responses, analytics, payroll, and export, all proven by automated checks. But
for a long time the only screen that existed was the login page and a near-empty
welcome page. Leadership and partners read *screens*, not databases, and the
thing that sells Intelli (self-serve configurability) literally *is* the screens:
the survey builder, the catalog, the dashboards. So the plan now is:

1. **Build the Admin web screens first**, over the backend that already exists.
   This is low-risk, high-visibility work: the hard part (the data and the
   security) is done and tested.
2. **Defer the Field mobile app + offline sync (Phase 5)** to after the screens.
   It is the longest, hardest, riskiest stretch in the whole project (months, and
   it needs a second set of expert eyes on the sync logic). Spending months on it
   before anyone has seen a dashboard is the wrong order for what we need now.

Nothing already built is thrown away. The backend (Phases 1 through 4d) and the
one Phase 5 brick we finished (5-BE-a, the idempotency keys) all stay banked and
keep passing their tests. We are changing the order of what comes next, not
redoing anything.

## The two tracks from here

- **Web Screens track (the priority now):** the Admin web app screens, built in
  the order below for the most demo impact. The prototype in `../hi-fi-intelli`
  is the exact visual spec for each one.
- **Field Mobile track (Phase 5, deferred):** the rep's phone app plus offline
  sync. Picks back up after the web screens give us something to show. The
  backend groundwork for it (idempotency keys) is already done.

## The Web Screens sequence (each step is something you can demo)

Every screen goes through the same flow we have used all along: a quick mockup you
approve, then a test-first build, then it is committed. The prototype screen it
ports from is named for each.

**W1: The app shell + the Analytics dashboard (DONE).** The sidebar, the top bar,
the brand, and the headline screen all in one, instead of a stub Home followed by
a separate dashboard. We **merged the old W1 and W2** here: rather than ship an
empty Home and then the dashboard, the shell ships with the real Analytics
dashboard as its first screen. Delivered: the persistent left sidebar (brand,
company card, nav with unbuilt screens shown as "coming soon", the
Nodes/Stores/Reps footprint, user card + sign out) and per-page top bar; a small
UI kit ported from the prototype; and the dashboard itself: headline cards (avg
compliance, surveys completed, overdue) with sparklines and deltas, a weekly
completion-trend line, a compliance-by-node list with click-to-drill (region to
store to the per-product reason it failed), and an Export-to-CSV button, plus an
AI gap list badged "preview". To feed it in one call, the backend gained a
read-only `GET /analytics/dashboard` (branch-scoped, no new tables) and the login
response now also returns the company and pinned-node names. Out-of-stock by SKU
was deferred (needs a survey/question picker) and avg-completion-time was dropped
(no duration data). Gate: 183 backend tests + 48 frontend checks, all green. This
is the frame every other screen hangs on, so it went first. After this: it looks
and feels like a real product you log into and land inside, with live numbers and
drill-down in front of leadership.

**W3: The Catalog (DONE).** The company's product list at `/catalog`, ported from
the prototype's catalog screen and wired to the existing `/skus` backend. Delivered:
the product list grouped by product line in a List view and a Gallery view; search
(by variant name, line, or UPC barcode, with UPC search whitespace-insensitive);
a status filter (All / Active / Discontinued); three stat tiles (product lines,
total products, active products); admin-only add/edit via a shared pop-up form
(five fields: line, variant, UPC, colour, status); read-only mode for managers and
reps (no Add button, rows do nothing when clicked). One company never sees another's
catalog (enforced by the existing backend). No backend API or schema change. The UI
kit gained Modal, Field, Input, and Select for reuse by future screens. The demo
seed was enriched to 33 products across 6 lines (Velvet Lip, Silk Foundation, Lash
Volume, Glow Blush, Cushion Compact, Brow Define) with one discontinued product
(Glow Blush Bronze) so the filter and grouping have real content. Frontend: 80
automated checks, all green. Deliberately deferred with honest "coming soon" labels:
real photo upload (needs object storage, 5-BE-c), CSV import, PIM/API sync, the
"used in N surveys" badge, catalog CSV export, and the "New" status. After this: a
self-managed product catalog on screen, the foundation surveys point at.

**W4: The Survey builder + assignments (DONE).** Delivered: a Surveys area at
`/surveys` (the old "Form Builder" nav item removed; the builder lives inside
Surveys). Three panels: a surveys list (status chip Published/Draft/Archived,
version chip, Assigned indicator, three stat tiles); a by-hand builder (six
question types: Yes/No, Number, Single choice, Multiple choice, Photo, Short text;
mark required; pass rules for scoreable types using operators >=, <=, >, <, ==,
!=, in, not_in; per-product questions that freeze to specific product ids on
publish; up/down reorder); and publish plus assign (published version pointed at
one or more org nodes with a deadline and a timezone label). Backend: two additive
changes only (no migration, no new endpoint): the question model gained three
optional fields, and GET /surveys returns latest_version and a scope-aware
assigned boolean. All other data used the existing /surveys, /survey-assignments,
/skus, and /nodes endpoints. Deliberately deferred with honest notes: survey
rename (no backend endpoint), timezone deadline shifting per store, drag-and-drop
reorder, version-diff panel, phone preview, pre-assign store-count estimate,
survey templates, and the AI draft feature (a later fast-follow). Gate: 192
backend tests + 104 frontend checks, all green. After this: self-serve
configurability is on screen, the headline selling point.

**W5: Responses + the response detail (DONE).** See what reps submitted, with live
pass/fail and the per-product reason something failed. Backend: `/responses`,
`/responses/{id}` (exist; W5 added a small read-only name + scored/passed count
enrichment, no new tables). Delivered: responses are NOT a sidebar item (prototype
parity), they open as modals from the Surveys screen (each survey row shows a
"N responses" button that opens a per-survey responses list, which opens a single
response's detail with the live verdict and the per-shade facings grid). Shelf
photos shown as "coming soon" placeholders (plug in later with 5-BE-c).

**W6: Payroll (DONE).** A new Admin sidebar item at `/payroll`. Select a pay
period and see a table of every rep's hours (store/reset/drive minutes, miles,
approval status). Managers approve or reject individual entries. Admins seal the
period (locks all entries; the screen then shows a padlock and a per-rep Reopen
button). Reopening one rep requires a typed reason, written to the permanent audit
log. A Download CSV button exports the period. Role-gating: reps are redirected
away entirely, managers approve, admins seal/reopen/read-audit. If payroll is
switched off for the company the screen shows a graceful "payroll not enabled"
state. Frontend-only: all backend endpoints already existed (`/pay-periods`,
`/time-entries` + approve/reject/seal/reopen, `/audit`, `/export/payroll`). New
files in `apps/admin/src/pages/Payroll/`. Deferred: per-rep hour drill-in, inline
editing.

**W7: The org hierarchy view (DONE).** The Admin "Hierarchy" sidebar item at
`/hierarchy` is now a real screen. A read-only org tree: expand/collapse, a colour
dot and the level name per row, a chain badge on stores, the store code, and child
counts. A search box and a chain filter narrow the view. Clicking a store opens a
detail panel with the store's management path and attributes. Backed by the
existing `GET /nodes` plus a new small read-only `GET /org-levels` endpoint
(returns the company's level names, tenant-scoped; added to `api/app/hierarchy.py`
and `api/app/scope.py` with a test). New files in
`apps/admin/src/pages/Hierarchy/`. Deferred (shown as greyed "soon"): coverage
mode, bulk import, export. (Add/rename/delete nodes, originally deferred here, was
later built as setup-wizard slice 1 on 2026-06-26, below.)

**Setup wizard slice 1: the editable Hierarchy (DONE, 2026-06-26).** The first of
two slices toward the setup wizard: making the org tree editable. The Hierarchy
screen at `/hierarchy` (previously read-only) gained an admin-only Edit mode. In
edit mode an admin can add a child node under any node (its level is set
automatically from the parent, so a child of a Region becomes a District; a Store
gets no add-child because a store is a leaf), rename a node (and edit a store's
chain and address), and delete a node but only when it is empty (no child nodes,
nobody pinned to it, no surveys assigned, no responses; otherwise it refuses and
names the blocker). Managers and reps still see the screen read-only. The backend
brick (no migration; the `nodes` table already existed) is the node add/edit work
recorded under "Small backend bricks" below: admin-only, branch-scoped
`POST /nodes`, `PATCH /nodes/{id}`, and `DELETE /nodes/{id}` in
`api/app/hierarchy.py` plus the scope work in `api/app/scope.py`. New files:
`apps/admin/src/pages/Hierarchy/NodeFormModal.tsx` (the add/rename pop-up) plus
edit-mode wiring in `Hierarchy.tsx`, `TreeNode.tsx`, and `useHierarchy.ts`;
`apps/admin/src/lib/api.ts` gained an `apiDelete` helper. An adversarial review
caught and fixed a real bug (the Store level had been detected by the "locked"
flag, but the Company root is also locked, which had hidden the add-child action on
the root; it now detects the Store level by the deepest level, which also fixed a
latent W7 root-rendering glitch). Deferred and recorded honestly: moving a node to
a new parent (re-parenting, a later piece), editing the org LEVELS themselves (the
wizard slice), and bulk CSV import/export (still greyed "soon" on the screen). Gate
GREEN: 243 backend tests + 221 frontend tests, admin build clean (previous baseline
230 backend + 213 frontend). Spec in
`docs/superpowers/specs/2026-06-26-editable-hierarchy-design.md`. Next: the setup
wizard UI (slice 2), below.

**Setup wizard slice 2: the wizard UI (DONE, 2026-06-26).** With this slice the
**whole setup wizard feature is done**, and the Admin web app is feature-complete for
this roadmap. A fullscreen, admin-only, **5-step Setup Wizard** lives at `/setup`,
reached from a new **Setup** item in the sidebar (organization group). It walks an
admin through configuring the company by assembling the bricks built earlier the same
day: (1) **Choose a starting point** (pick a hierarchy template, a starting level
structure; on a company that is already set up, templates are disabled with a note
that they apply to new companies only); (2) **Name your levels** (rename, and on a
fresh company add / remove / reorder, the org levels, saved via `PUT /org-levels`; on
a company that already has stores it shows the company's REAL current level names in
rename-only mode, since changing the number of levels would strand existing stores,
with a clear note); (3) **Payroll** (turn the payroll module on or off, saved via
`PATCH /tenants`; the detailed pay-period settings are shown as "coming soon", same as
the Settings screen); (4) **Build the tree** (add org nodes, regions / districts /
stores, via `POST /nodes`; CSV import and system sync are "coming soon"); (5) **Invite
people** (add users and pin them to a node via `POST /users`, the admin setting a
starting password; real emailed invites are "coming soon"). The wizard saves as you
go, and Finish or Exit returns to the dashboard. It is admin-only: the route redirects
non-admins, the Setup nav item is hidden from them, and the backend still guards every
call. No new backend was needed (it reuses `PUT /org-levels`, `PATCH /tenants`,
`POST /nodes`, and `POST /users`). New files in `apps/admin/src/pages/Setup/`
(`SetupWizard.tsx`, `useSetup.ts`, `StepTemplate` / `StepLevels` / `StepPayroll` /
`StepTree` / `StepInvite`, CSS, tests); `apps/admin/src/lib/api.ts` `apiSend` now also
allows PUT; `apps/admin/src/App.tsx` has a `/setup` route outside the app shell
(fullscreen, like login); `apps/admin/src/shell/nav.ts` has the admin-only Setup item;
`apps/admin/src/shell/Sidebar.tsx` hides admin-only items from non-admins. An
adversarial review caught and fixed three things first (step 2 now seeds from the
company's real saved levels, the payroll switch can no longer fire overlapping saves,
and store-level nodes are no longer offered as parents when adding to the tree). Spec
in `docs/superpowers/specs/2026-06-26-setup-wizard-design.md`. Gate GREEN: 249 backend
tests + 247 frontend tests, admin build clean (previous baseline 249 backend + 221
frontend). With the setup wizard done, the Admin web app is feature-complete; next are
the Manager web app and Phase 5.

**Users & Roles (DONE).** The Admin "Users & Roles" sidebar item at `/users` is
now a real screen (was "coming soon"). A **People** tab (three role-count cards for
Admin / Manager / Rep, a plain-language banner that "a role is what a person can do,
their pin is where they can do it", and a team table of name, email, role, and the
pinned org node with an inheritance sentence) and a **Roles** tab (a read-only
capability matrix of Full / Scoped / None per role). Admins can add a person (name,
email, role, which node to pin to, and a starting password the admin sets), change a
role in the table, and move or remove a pin; managers and reps see it read-only.
Backend brick (no migration; the users + assignments tables already existed):
`GET /users` (the team list, branch-scoped through the existing scope-follows-pin
guard: a pinned user is visible when pinned at or under the caller's node, unpinned
users are visible only to a caller at the company root, an unpinned caller sees none),
admin-only `POST /users` (add and pin, the password stored only as an Argon2 hash, a
duplicate email is a 409, a node out of scope is a 404), and admin-only
`PATCH /users/{id}` (change role and/or move-or-remove the pin, with a "cannot remove
the last admin" guard); the pin is one row in the existing `assignments` table. New
files in `apps/admin/src/pages/Users/`. Deferred and recorded honestly: real emailed
invite links (needs an email system; v1 has the admin set a starting password),
enable/disable a user (no status column yet), manager-scoped invites (admin-only in
v1), and custom roles.

**Settings (DONE).** The Admin "Settings" sidebar item at `/settings` is now a real
screen (was "coming soon"). Real and saved in v1: the company name (editable) and a
payroll on/off switch (it genuinely controls whether the Payroll screen and its
backend actions are available). Shown honestly as "coming soon" (not faked):
pay-period defaults, work model, store chain logos, the audit log, and data &
security. Managers and reps see it read-only. Backend brick (no migration; the
tenants table already had name, code, payroll_enabled): `GET /tenants` (this
company's config, any signed-in user) and admin-only `PATCH /tenants` (update the
name and/or payroll_enabled; the company code is permanent and not editable). New
files in `apps/admin/src/pages/Settings/`. Deferred: pay-period defaults, work model,
store logos, a unified company audit feed, and the data & security panel.

**The Admin web app is now feature-complete.** W1, W3, W4, W5, W6, W7, plus Users &
Roles and Settings are all shipped, the editable hierarchy landed on top of W7, and
the **Setup wizard is done** (both slices: the editable hierarchy and the fullscreen
5-step wizard UI at `/setup`). Current green baseline: 249 backend tests + 247
frontend tests, build clean. With the Admin web app feature-complete, the larger
tracks from here are the **Manager web app** (reuses the same backend, scoped to a
manager's branch) and **Phase 5** (the Field mobile app + offline sync).

## Manager web app track (STARTED 2026-06-29)

We chose the Manager web app next over Phase 5: it is the lighter, higher-visibility
step (mostly screen work, because the backend already enforces branch scope), and it
completes the web story by showing the "see only your branch" boundary live next to
the Admin app. v1 covers **four real screens** (Dashboard, Compliance Review
review-only, Survey Assignment, Payroll Approval), all on existing branch-scoped
endpoints (no new backend); **Route Planning** and **Announcements** stay "coming
soon" because they need backends that do not exist yet. Spec:
`docs/superpowers/specs/2026-06-29-manager-web-app-design.md`. It is built in lanes:

- **Lane 0: shared packages (DONE, pushed).** Extracted the Admin UI kit into
  `@intelli/ui` and the API client into `@intelli/api-client` (in `packages/`), so
  both web apps share one copy instead of duplicating; the session key is now per-app
  so the apps never share a login. Behavior-preserving (Admin 247 tests green). Plan:
  `docs/superpowers/plans/2026-06-29-manager-lane0-shared-packages.md`.
- **Lane 1: the Manager app shell (DONE).** A new `apps/manager` app (port 5174) with
  the scope-forward sidebar ("Your scope" chip, locked company card, branch
  footprint, 6-item nav with the two "coming soon" items), a Manager-branded login
  with its own session, and a fail-closed doorman (managers/admins in; field reps hit
  a friendly NoAccess wall). The four real screens are placeholders for now. Manager:
  15 tests, build clean. Reviewed by a 4-lens adversarial pass. Demo login:
  `sarah@lumenbeauty.com / demo1234`.
- **Lane 2: the Dashboard (DONE).** The Manager Dashboard at `/`, reusing the Admin
  dashboard (headline KPIs with trends, the weekly completion trend, the
  compliance-by-node drill, CSV export, and the preview AI gap list) over the same
  branch-scoped `/analytics/*` endpoints, so a manager sees only their branch.
  Copied-and-adapted (only the top-bar copy changed; the shared primitives and API
  client are already shared); the Admin app is untouched. Manager: 26 tests, build
  clean. It skipped a fresh mockup because it mirrors the already-approved Admin
  dashboard.
- **Lane 3: Compliance Review (DONE), the hero screen.** At `/compliance`: a breadcrumb
  drill from the branch root through districts to a store, then a store-detail review of
  each submitted survey scored live, with failing products surfaced by shade name and
  colour. Reuses the dashboard's branch-scoped `/analytics/compliance/nodes` drill plus a
  small `/skus` lookup; no backend change. Review-only for v1: failures shown, but
  "Assign follow-up" and shelf photos greyed "coming soon" (Phase 5). Mockup approved
  first. Reviewed by a read-only adversarial pass. Manager: 33 tests, build clean.
  Deferred (noted): per-question text labels and the rep/last-visit metadata.
- **Lanes 4 to 5 (NEXT):** Survey Assignment, Payroll Approval, each via mockup ->
  approve -> test-first build -> adversarial review, reusing the Admin screen logic over
  the branch-scoped endpoints. Decision recorded: Manager screens are copied-and-adapted
  from Admin (not shared as whole pages), because the foundation is already shared, the
  screens genuinely diverge per app, and copying keeps the green Admin app untouched.
- **Central demo enrichment (DONE):** Sarah's Central branch was sparse (one district,
  one store, one rep), making the Manager screens look thin. The seed now adds (behind a
  `demo_extras` flag) two more districts (Detroit, Indianapolis), six more stores, two
  reps, a mix of passing/failing readings, and hours, so the Dashboard, Compliance
  Review, and (later) Payroll demos look full. The flag is dev/demo-only: the backend
  tests call `run()` without it and keep the small, asserted world, so the suite stays
  green (249) untouched. Also fixed a pre-existing date-rotted dashboard trend test
  (it hardcoded a date_to the calendar reached). NOTE: re-seed the deployed dev DB
  (`docker compose exec api python -m app.seed`) after deploy for the extras to appear
  there; the local dev DB is already re-seeded.

## Prototype fidelity pass (STARTED 2026-06-30)

A screen-by-screen pass to make every built Admin and Manager screen match the hi-fi
prototype exactly (layout, components, copy, navigation, badges, spacing, polish), at
maximum parity. Order: the Admin app first, then the Manager fidelity work, then the two
still-unbuilt Manager screens (Survey Assignment, Payroll Approval). Each screen goes
mockup -> approve -> test-first build -> read-only adversarial review, and only the
genuinely blocked items (real shelf photos, the AI reading photos, a messaging system)
stay honestly "coming soon". Specs live in `docs/superpowers/specs/`.

- **Admin Hierarchy (/hierarchy): DONE (2026-06-30).** Coloured retailer dots on chain
  badges, lock icons on locked rows + legend, the two prototype info banners, a
  Structure/Coverage staffing view (adapted to Region/District/Store, reusing `/users`),
  and a real Bulk import pop-up backed by a new admin-only `POST /nodes/bulk` (no
  migration). The company root no longer offers Rename/Delete (the company name lives in
  Settings). 257 backend + 268 admin frontend tests green. Spec:
  `docs/superpowers/specs/2026-06-30-admin-hierarchy-fidelity-design.md`.
- **Admin Responses (2026-07-01): DONE.** The response-detail pop-up gained the red
  SKU-gap callout ("N of M audited shades below the facings threshold") and a verdict
  subtitle showing the store's chain, code and address (e.g. "CVS, sf"). Small additive
  backend change: `/responses` and `/responses/{id}` now also return store_chain,
  store_code, store_address (no migration). 258 backend + 273 admin frontend tests green.
- NEXT: the remaining Admin screens (Users, Catalog, Surveys + Assign, Settings + Setup,
  the shell copy, then the Analytics dashboard), then Manager Compliance + Dashboard
  fidelity, then build the two new Manager screens.

## Small backend bricks to slot in just-in-time

A few screens need a small, quick backend addition first (each one is the same
proven pattern as every backend phase so far, a migration plus a few endpoints
plus tests). We add each only when its screen comes up, so we are never blocked:

- **Users / team screen** needed a list-and-invite endpoint (`GET /users`,
  `POST /users`). **BUILT** (2026-06-25): `GET /users` (branch-scoped team list),
  admin-only `POST /users` (add and pin a person, the password stored as an Argon2
  hash), and admin-only `PATCH /users/{id}` (change role and/or move-or-remove the
  pin, with a "cannot remove the last admin" guard), all in `api/app/users.py`
  (registered in `main.py`), with the scope work in `api/app/scope.py` and tests in
  `api/tests/test_users.py`. No migration was needed.
- **Settings screen** (payroll on/off, cutoff) needed a read/update company-config
  endpoint (`GET` / `PATCH /tenants`). **BUILT** (2026-06-25): `GET /tenants` (this
  company's config, any signed-in user) and admin-only `PATCH /tenants` (update the
  name and/or the payroll switch; the company code is permanent), in
  `api/app/tenants.py` (registered in `main.py`), with the scope work in
  `api/app/scope.py` and tests in `api/tests/test_tenants.py`. No migration was needed.
- **Editing the org tree** (add, rename, delete a node) needed node add/edit
  endpoints. **BUILT** (2026-06-26, setup-wizard slice 1): `POST /nodes` (add a
  child; the child's level is the parent's plus one, the internal code is
  auto-generated and made unique from the name, and adding below the bottom Store
  level is refused with a 400), `PATCH /nodes/{id}` (rename and edit store
  attributes; parent, level, and code are not editable), and `DELETE /nodes/{id}`
  (only when the node is empty, else a 409 naming the blocker; a 404 if out of
  scope), all admin-only and branch-scoped, in `api/app/hierarchy.py` with the
  scope work in `api/app/scope.py` (new `get_node` / `create_node` / `update_node`
  / `delete_node` plus a `_slug_code` helper). No migration was needed (the `nodes`
  table already existed). Still deferred to later: moving a node to a new parent
  (re-parenting).
- **Setting the org levels** (the wizard's "name your levels" step) needed a
  write endpoint. **BUILT** (2026-06-26): admin-only `PUT /org-levels` replaces
  the company's level structure with an ordered top-to-bottom list (top and bottom
  locked), with a re-map guard that refuses changing the NUMBER of levels once real
  nodes exist (rename/reorder labels stays allowed), while a fresh company can set
  any 2 to 7 levels. In `api/app/hierarchy.py` + `ScopedRepo.set_org_levels`, no
  migration. With this, every backend piece the setup wizard needs exists. The wizard
  UI (slice 2) was then built on 2026-06-26 (above), so the setup wizard is now DONE.
- **Shelf photos** in responses need object storage, which is **5-BE-c** in the
  Field track.

## Deliberately later (so nothing is silently dropped)

- **Phase 5: the Field mobile app + offline sync** (the rep's phone app, on-device
  database, the sync engine). The big, hard, last push. 5-BE-a (idempotency keys)
  is done; 5-BE-b (batch sync) and 5-BE-c (photo storage) and the mobile app
  itself (5-M-a through 5-M-d) come after the web screens.
- **The Manager web app.** It reuses most of the same screens and the same backend,
  automatically scoped to a manager's branch (compliance review, survey
  assignment, payroll approval). We stand it up alongside or just after the Admin
  screens; the backend already enforces the scope, so it is mostly screen work.
- **Manager Routes** (route planning) needs a geo/route backend that does not
  exist yet.
- **Announcements / messaging** needs a messages backend that does not exist yet.
- **The AI survey drafting** layer on top of the survey builder (Claude API,
  a fast-follow, never the headline).

## How we will know each step is "done"

Same bar as always: the screen is built test-first, it talks to the real backend
(a manager only ever sees their own branch, enforced by the backend), the
existing automated checks stay green, and there is a live walk-through you can do
in the browser. The difference now is that after each step there is a screen to
show, not just an endpoint to describe.
