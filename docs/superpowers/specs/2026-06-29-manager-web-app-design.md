# Manager Web App v1 Design Spec

**Date:** 2026-06-29
**Status:** Approved (design agreed in brainstorm; mockups per screen still to come)

## What it is and who uses it

A new web app for branch managers (district / region managers), a sibling to the
Admin app. The demo user is Sarah Mitchell, pinned at Central Region
(`sarah@lumenbeauty.com` / `demo1234`, already in the seed, with a rep beneath her
so approvals are real). It looks like the Admin app and rides the same backend, but
it has a shorter menu and makes one thing loud on every screen: **you see only your
branch.** The branch limit is enforced by the existing backend scope guard (scope
follows the pin); the Manager app adds no scope logic of its own. That is the centre
of the demo: log in as Sarah and the same screens show Central only.

## v1 scope

**Built for real (4 screens):** Dashboard, Compliance Review, Survey Assignment,
Payroll Approval.

**In the menu as honest "coming soon" (greyed, same pattern as Admin's deferred
items):** Route Planning, Announcements.

**No new backend endpoints and no migration.** Every screen rides endpoints the
Admin app already uses, all already branch-scoped and already role-gated to allow a
manager.

## Architecture and code sharing

Two web apps already share `@intelli/tokens` (colours / fonts). v1 extends the
monorepo so Admin and Manager share the two other stable layers, with one source of
truth instead of copies that drift.

**Lane 0 (done and verified green before any Manager screen):** extract from
`apps/admin/src/` into shared workspace packages that both web apps import:

- A web UI-kit package (working name `@intelli/ui`): the contents of
  `apps/admin/src/ui/` (Button, Card, Chip, Modal, Field, Input, Select, Icon,
  Avatar, Segmented, Switch, Spark, Bar, plus `icons.ts` and the CSS modules). It
  already has `ui.test.tsx`, which moves with it.
- An API-client package (working name `@intelli/api-client`): the contents of
  `apps/admin/src/lib/` (`api.ts` with `apiGet` / `apiSend` / `apiDelete` /
  `downloadCsv` / `login` / `health` / `ApiError` / `API_BASE`, and the session
  token reader). It already has `api.test.ts`, which moves with it.

Packages follow the `@intelli/tokens` pattern exactly: `package.json` with
`main` / `types` / `exports` pointing at `src/index.ts`, consumed directly as
TypeScript (Vite compiles it, no separate build step).

**Login isolation (decided, implementation detail recorded so it is not missed):**
the session token key is currently `intelli-admin-session`, hardcoded in the lib.
Because the two apps can share a browser origin in production, they must NOT share a
login. So the shared API-client reads the token through a per-app session key
(Admin keeps `intelli-admin-session`; Manager uses `intelli-manager-session`),
injected once at app startup rather than hardcoded in the shared package. `API_BASE`
stays the same approach Admin already uses.

**The Admin app keeps all of its tests green through Lane 0.** The move is mechanical
(re-point imports), the moved code carries its own tests, and Lane 0 is committed and
verified on its own before any Manager screen is built.

**Per-screen reuse:** Manager screens live in `apps/manager/src/`. Where a Manager
screen reuses Admin screen logic (the dashboard cards and compliance drill, the
responses list / detail, the assign panel, the payroll table), the reusable,
scope-agnostic pieces are lifted into the shared package or a shared screen-helper;
the Manager screen itself is its own scope-aware component. We decide the exact split
per screen at build time; we do not pre-share anything that only one app uses.

## The Manager shell (the frame around every screen)

Ported from the prototype `dm-shell.jsx` so placement matches the real spec.

- **Left sidebar:** Intelli brand with a "Manager" tag; a **read-only company card**
  with a small lock (a manager cannot switch companies); a prominent **scope chip**
  ("Your scope: Central Region", from the login's `pinned_node_name`); the menu; a
  **branch-scoped footprint** (Nodes / Stores / Reps, reusing the dashboard endpoint's
  footprint, which is already scoped to the caller's subtree, labelled the same way
  Admin labels it); and the user card with Sign out.
- **Menu (6 items, prototype order):** Dashboard, Compliance Review, Survey
  Assignment, Payroll Approval (real); Route Planning, Announcements (greyed
  "coming soon").
- **Top bar** per page: title and subtitle. The prototype's "Sync" control and the
  notifications bell are trimmed / "coming soon", consistent with Admin's web trims.
- **Route guard:** managers and admins may open the app (an admin is pinned at the
  company root node, so their scope is the whole company and it just works). The
  guard is fail-closed: only the manager and admin roles reach the shell. A field
  rep who signs in (their credentials are valid; the backend authenticates any role)
  hits a friendly NoAccess wall ("this app is for managers") with a sign-out, rather
  than being let in, because reps have no web app yet. The scope chip shows the
  caller's pinned-node name (a branch like "Central" for a manager, the root node
  "Lumen Beauty" for the demo admin); a caller with no pin sees no data, so it says
  "No branch assigned" rather than implying full access.

## The four real screens

### 1. Dashboard (the scoped roll-up)

Reuses the Admin dashboard building blocks: KPI cards (average compliance, surveys
completed, overdue) with sparklines and up/down deltas; the weekly completion-trend
line; and the compliance-by-node drill (district to store to the exact product that
failed).

- **Endpoints (existing, branch-scoped, any signed-in user):** `GET /analytics/dashboard`,
  `GET /analytics/compliance/nodes`, `GET /analytics/compliance/drill`. For Sarah these
  return Central only.
- **Coming soon inside the screen:** the live rep-activity feed (needs an activity log)
  and the per-row "Remind" nudge (needs notifications). Shown as honest placeholders.

### 2. Compliance Review (the per-store deep dive, review-only)

Drill to a store, see its assigned surveys and the actual submitted responses with
live pass/fail and the per-product reason, reusing the W5 responses list and detail.

- **Endpoints (existing, branch-scoped):** `GET /responses`, `GET /responses/{id}`,
  plus `GET /surveys` / `GET /survey-assignments` for context and `GET /analytics/compliance/nodes`
  for the drill entry point.
- **Review-only:** the "Assign follow-up" button is "coming soon" (needs a tasks
  backend and the Field app to receive a task). Shelf photos stay "coming soon"
  (5-BE-c).

### 3. Survey Assignment (assign within the branch)

Assign a published survey to one or more nodes inside the manager's branch, with a
deadline. Reuses the W4 assign-panel logic. A manager does not author surveys (that
stays admin-only); they pick from published surveys and target their own nodes.

- **Endpoints:** `GET /surveys` and `GET /surveys/{id}` (view, any signed-in user);
  `GET /nodes` (the branch tree, scoped); `POST /survey-assignments` and
  `DELETE /survey-assignments/{id}` (`require_manager_or_admin`); the backend already
  refuses targeting outside the branch (a sibling region returns 404).

### 4. Payroll Approval (the manager's slice)

Pick a period, see the branch's reps' hours, and approve or reject individual entries.
Reuses the W6 payroll table logic.

- **Endpoints:** `GET /pay-periods` and `GET /pay-periods/{id}/entries`
  (`require_payroll`, scoped so a manager sees only their branch's reps);
  `POST /time-entries/{id}/approve` and `/reject` (`require_manager_or_admin`);
  `GET /export/payroll` (already role-scoped: a manager gets their branch).
- **Admin-only, so the manager sees them read-only or not at all:** sealing and
  reopening a period and the audit log (`require_admin`). A manager sees a sealed
  period read-only with no Reopen button and no audit panel.
- **Payroll off:** if the company has payroll switched off, the graceful "payroll not
  enabled" state shows, same as Admin.

## Backend work

**Expected: none.** The role-guard table below confirms each screen's calls are
permitted for a manager on existing endpoints:

| Screen | Endpoint | Guard | Manager allowed? |
|--------|----------|-------|------------------|
| Dashboard | GET /analytics/dashboard, /compliance/nodes, /compliance/drill | scoped read | yes (branch only) |
| Compliance Review | GET /responses, /responses/{id} | scoped read | yes (branch only) |
| Survey Assignment | GET /surveys, /surveys/{id}, /nodes | scoped read | yes |
| Survey Assignment | POST/DELETE /survey-assignments | require_manager_or_admin | yes (out-of-branch 404) |
| Payroll Approval | GET /pay-periods, /pay-periods/{id}/entries | require_payroll, scoped | yes (branch only) |
| Payroll Approval | POST /time-entries/{id}/approve, /reject | require_manager_or_admin | yes |
| Payroll Approval | GET /export/payroll | role-scoped | yes (branch) |
| Payroll Approval | seal / reopen / GET /audit | require_admin | no (read-only / hidden) |

**One thing to verify in the plan, not a known gap:** that the sidebar footprint
counts come back correctly scoped to the manager's branch from the existing dashboard
endpoint. If any tiny read-only gap turns up there it is an additive, no-migration
addition; we do not expect one.

## Scope and security (the demo centrepiece)

The backend already enforces "see only your branch" on every endpoint above through
the shared scope guard, proven by the existing isolation tests. The Manager app relies
on that and adds no scope logic. The strongest demo beat: log in as Sarah, and the
exact same dashboard, responses, assignment, and payroll screens show Central only,
with a sibling region returning nothing.

## Deliberately deferred (recorded, not dropped)

Each appears honestly as "coming soon" where the prototype shows it:

- Route Planning (needs a geo/maps + routing backend).
- Announcements / messaging (needs a messaging backend).
- Compliance follow-up tasks (needs a tasks backend and the Field app).
- Rep-activity feed and Remind nudges (need an events / notifications backend).
- Shelf photos in responses (5-BE-c).
- Manager welcome / coachmark tour (optional polish).

## Testing, mockups, docs, git

- **Per screen:** a browser mockup for Tanya's approval first (saved in
  `docs/superpowers/mockups/`, checked against the prototype's real placement), then a
  test-first build, then an adversarial fresh-eyes review.
- **Tests:** the Manager app gets its own Vitest checks; Admin's frontend tests and the
  backend's tests stay green throughout (no backend change expected).
- **Git:** one branch plus worktree per lane; Lane 0 (shared-package extraction) first;
  I act as integrator and merge each green lane into main. Backend bricks, if any ever
  arise, are built in the MAIN folder (Docker live-mounts it); frontend lanes build in
  worktrees. I ask Tanya before pushing (push deploys).
- **Docs updated in the same change:** START_HERE.md, CONTEXT.md, CODEBASE_MAP.md,
  ROADMAP.md, a new `apps/manager/README.md`, the new shared-package READMEs, and the
  prototype handoff CHANGELOG in `../hi-fi-intelli`.

## Build sequence (lanes)

0. **Shared packages:** extract `@intelli/ui` and `@intelli/api-client` from Admin,
   re-point Admin's imports, make the session key per-app injectable. Verify Admin is
   fully green. Commit.
1. **Manager app shell:** new `apps/manager` Vite app, the sidebar (scope chip,
   read-only company card, footprint, menu with the two "coming soon" items), the top
   bar, the login + route guard, wired to the shared packages.
2. **Dashboard.**
3. **Compliance Review.**
4. **Survey Assignment.**
5. **Payroll Approval.**

Each of lanes 1 to 5 follows mockup -> approve -> test-first build -> review.
