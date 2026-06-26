# Setup Wizard Design Spec (Slice 2: the UI)

**Date:** 2026-06-26
**Screen:** Setup Wizard (fullscreen, at `/setup`)
**Status:** Self-directed (Tanya: "build it"). Ports the prototype `apps/admin/screens/wizard.jsx`.

## What it is

A fullscreen, 5-step guided flow that assembles the bricks already built (org
levels, nodes, payroll/company config, users) into a single onboarding/configure
experience. It is reachable from a "Setup" item in the sidebar (org group) and
opens fullscreen over the app (a left stepper rail, the step content, and a footer
with Back / Continue / Finish), matching the prototype. Admin-only.

Honest reality: our only demo company (Lumen) is already populated, and there is no
"create a new empty company" flow yet. So the wizard must work for BOTH a fresh
company (full editing) and a populated one (some steps become review/extend). Each
step reflects the real backend constraints rather than pretending.

## The five steps

1. **Choose a starting point.** Pick a hierarchy template (a small frontend
   constant: a few common structures, e.g. "Company / Region / District / Store").
   Selecting one pre-fills the level list for step 2. Pure frontend; nothing is
   saved here.
2. **Name your levels.** Edit the level list (top and bottom locked; rename, and
   when allowed add / remove / reorder the middle). A "confirm this structure"
   checkbox gates Continue. On Continue, save via `PUT /org-levels`. If the company
   already has real nodes, the backend's re-map guard refuses structural changes, so
   the step disables add/remove/reorder and shows a clear note ("Your stores already
   exist, so you can rename levels but not add or remove them here"); renaming still
   saves. On a fresh company, all editing is enabled.
3. **Payroll.** Choose "configure payroll" or "skip". The real, saved part is the
   on/off switch via `PATCH /tenants` (payroll_enabled). The detailed period config
   from the prototype (length, cutoff, lock rules) is shown as "coming soon", exactly
   as on the Settings screen (do not fake it).
4. **Build the tree.** Add org nodes using `POST /nodes` (contextual add: choose a
   parent, name the child; its level follows the parent; store-level rows collect
   chain/address). Shows the current tree and lets the admin add to it. CSV import and
   system sync are shown as "coming soon". Reuses the node-add contract from slice 1.
5. **Invite people.** Add users and pin them to a node via `POST /users` (name,
   email, role, node, starting password), reusing the Users brick. Shows the queued/
   added people. The "email invite" framing stays "coming soon"; v1 sets a starting
   password (same as the Users screen).

Finish returns to the dashboard (`/`). Exit/Cancel also returns to `/`.

## Routing and entry point

- A `/setup` route OUTSIDE the Shell layout route (the wizard is fullscreen, like
  `/login`), rendering `<SetupWizard/>`. Admins reach it from a new sidebar "Setup"
  nav item (org group); a non-admin who navigates to `/setup` is redirected to `/`.
- The wizard saves as it goes (steps 2-5 each call their endpoint), so closing
  midway never loses what was already saved. No "forced first-run gate" in v1 (the
  prototype mentions one; deferred, since our demo company is already set up).

## Backend

No new backend. Uses `PUT /org-levels` (slice 1b), `PATCH /tenants` (Settings brick),
`POST /nodes` (slice 1), `POST /users` (Users brick). All admin-only and scoped.

## Frontend

New `apps/admin/src/pages/Setup/`:
- `SetupWizard.tsx` (the fullscreen shell: stepper rail, content switch, footer,
  exit), holding the cross-step state.
- One component per step: `StepTemplate.tsx`, `StepLevels.tsx`, `StepPayroll.tsx`,
  `StepTree.tsx`, `StepInvite.tsx`.
- `useSetup.ts` (templates constant; the `useSetOrgLevels` PUT mutation; small pure
  helpers like the level-list editor reducer and a "structural editing allowed?"
  check based on whether non-root nodes exist; reuses `useCreateNode`, `useUpdateTenant`,
  `useCreateUser`, `useHierarchy` for nodes/levels).
- `*.module.css` + tests.
- `App.tsx` gains the `/setup` route (outside Shell); `shell/nav.ts` gains the Setup item.

Role-gating: admin only (the route redirects non-admins; the backend is the real guard).
Pure helpers are unit-tested; an integration test covers stepping through and that
each step calls its endpoint, plus the populated-company rename-only state.

## Deferred (honest "coming soon")
- Forced first-run gate; creating a brand-new empty company.
- Real emailed invites (step 5 sets a starting password instead).
- Detailed payroll period config (step 3 on/off only).
- CSV import / system sync for building the tree (step 4 type-in only).
- Re-parenting nodes; the live preview niceties from the prototype beyond a simple list.
