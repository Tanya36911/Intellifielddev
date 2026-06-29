# The MANAGER FRONTEND, explained for a non-coder (apps/manager/)

This is the "dining room" for a branch manager (a district or region manager
like Sarah Mitchell). It is a separate web app from the Admin app, built the
same way: **React** screens served by **Vite**, talking to the same backend
waiter, never touching the database directly.

The one idea this whole app is built around: **a manager sees only their own
branch.** That limit is enforced by the backend (the same "scope follows the
pin" rule the Admin app uses), so this app adds no security logic of its own; it
just shows what the backend hands back, which for a manager is already narrowed
to their branch. The app makes that loud on every screen with a "Your scope"
chip in the sidebar.

It reuses the shared building blocks so it looks and behaves like the Admin app:
the UI kit (`@intelli/ui`), the backend helper (`@intelli/api-client`), and the
brand colors and fonts (`@intelli/tokens`). It keeps its **own separate login**
(a different storage slot, `intelli-manager-session`) so signing into the
Manager app and the Admin app never collide.

To run it: `pnpm dev:manager` (it opens on http://localhost:5174, a different
port from Admin's 5173, so both can run at once). Demo login:
`sarah@lumenbeauty.com / demo1234`. Tests: `pnpm test:manager`.

---

## What is built so far

**The shell (the frame) is done.** The four real screens are placeholders for
now; each one is built in its own step next.

- **The sidebar** (`src/shell/Sidebar.tsx`): the Intelli "Manager" brand; a
  **locked company card** (a manager cannot switch companies, shown with a small
  padlock); the prominent **"Your scope" chip** showing the branch the manager is
  pinned to (for example "Central"); the menu; a **branch-scoped footprint**
  (Nodes / Stores / Reps, the manager's own branch numbers, read from the
  dashboard endpoint); and the user card with Sign out.
- **The menu** (`src/shell/nav.ts`): six items in the prototype's order.
  **Dashboard, Compliance Review, Survey Assignment, and Payroll Approval** are
  the real screens (placeholders until their own steps land). **Route Planning**
  and **Announcements** are greyed "soon", because they need backends that do not
  exist yet (geo/routing and messaging).
- **The top bar** (`src/shell/Topbar.tsx`): the page title and a disabled
  notifications bell, the same web trims as the Admin app.
- **The doorman** (`src/App.tsx`): an unauthenticated visitor goes to the login
  screen; a manager or admin gets the shell; a **field rep** who signs in hits a
  friendly **NoAccess wall** ("this app is for managers"), because reps have no
  web app yet. The guard is fail-closed: only the manager and admin roles reach
  the shell.
- **The login** (`src/pages/Login.tsx`): Manager-branded, with its own session.

---

## The files

The layout mirrors the Admin app on purpose, so the two are easy to keep in step.

- `src/main.tsx`: the front door. It tells the shared backend helper which login
  slot this app uses (`configureSession('intelli-manager-session')`) before any
  request, then mounts the app with the same providers as Admin (Redux store,
  React Query, the router).
- `src/App.tsx`: the doorman (which web address shows which screen, and the
  manager/admin-only guard).
- `src/store/`: the session pocket (who is signed in), mirrored to the browser so
  you stay signed in. `store/auth.ts` holds the Manager's session key.
- `src/shell/`: the frame (Shell, Sidebar, Topbar, and `nav.ts` the menu list).
- `src/pages/`: `Login.tsx` (the login screen), `ComingSoon.tsx` (the placeholder
  the four real screens use until they are built), and `NoAccess.tsx` (the wall a
  field rep sees).
- `src/test/`: the test helpers (a render wrapper, the demo user fixtures, and the
  setup that points the backend helper at the Manager session key).
- `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json`: the project
  setup (Vite on port 5174, the same tooling as Admin).

---

## What is next

Each of the four real screens is built in its own step, reusing the Admin app's
screen logic over the same branch-scoped backend: the **Dashboard** (the manager's
scoped roll-up), **Compliance Review** (drill into a store and see exactly what a
rep submitted), **Survey Assignment** (assign a published survey inside the
branch), and **Payroll Approval** (approve the branch's reps' hours). Route
Planning and Announcements stay "coming soon" until their backends exist. Full
design: `docs/superpowers/specs/2026-06-29-manager-web-app-design.md`.
