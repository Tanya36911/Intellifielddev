# CODEBASE MAP, Tanya (read this to understand the code)

This is your plain-English map of the whole project. START_HERE.md tells you
how to RUN things; this file explains what the CODE is and where it lives, so
you (and anyone helping you) can find your way around without being a coder.

It is kept up to date: whenever a file is added or its job changes, this map
and the per-folder README guides get updated in the same step.

---

## 1. The 30-second mental model

The app has three parts. A simple way to picture it, a restaurant:

- **The frontend** is the dining room: the screens you see and click. It runs
  in your web browser. (Built with React, a popular tool for making web
  screens.)
- **The backend** is the waiter: it takes requests from the dining room,
  fetches or saves things, and brings answers back. It is the only one allowed
  to talk to the kitchen. (Built with FastAPI, a Python tool for making
  backends.)
- **The database** is the kitchen's pantry: the app's permanent memory, where
  all the real information is stored. (PostgreSQL, a well-known database.)

The golden rule: the dining room never reaches into the pantry itself. It
always asks the waiter. So the frontend never talks to the database directly,
only to the backend. This keeps the data safe and the rules in one place.

As of Phase 2, the backend also enforces "scope follows the pin": every person
is pinned to one spot on their company's org tree and can see only that spot and
everything below it, never another company and never a sibling branch. That rule
lives in one file ([api/app/scope.py](api/app/scope.py)) so no screen can ever
forget it.

As of Phase 3a, the backend also holds each company's product catalog (its
SKUs, meaning product variants like Velvet Lip in Rosewood vs Mauve). Everyone
in a company can view the catalog; only admins can add or edit it. Like
everything else, one company never sees another's.

As of Phase 3b, the backend also holds surveys (the checklists reps fill out in
stores), kept as frozen versions so published results can never be silently
rewritten, plus assignments that point a survey at a spot on the org tree.
Admins build surveys; admins and branch managers assign them; which stores an
assignment covers is worked out live from the tree, so stores added later are
included automatically.

As of Phase 4a, the backend stores reps' completed surveys as atomic rows, one
tiny row per product per question per submission (see
[api/app/responses.py](api/app/responses.py)). Pass/fail is worked out fresh
from the survey's rules every time you read a response (see
[api/app/compliance.py](api/app/compliance.py)), and is never saved to the
database. That means fixing a question's rule immediately changes every score
for every past response, with no data migration needed.

As of Phase 4b, the backend turns those response rows into read-only compliance,
out-of-stock, and trend reports ([api/app/analytics.py](api/app/analytics.py)).
All reports are branch-scoped (a manager only sees their own stores) and
computed live, with no new database tables.

As of Phase 4c, the backend runs payroll ([api/app/payroll.py](api/app/payroll.py)),
with pay periods, logged hours, an admin seal/reopen lock, and a permanent
audit log, all gated by a per-company on/off switch. An admin opens a pay
period, reps log their own store/reset/drive hours and miles, managers approve
their branch's entries, and the admin seals the period to lock all numbers.
The one deliberate exception is a "reopen one rep" action that unlocks a single
rep's hours so they can be corrected, then re-sealed, with every reopen written
into the audit log.

As of Phase 4d, the backend can hand the data back out
([api/app/exports.py](api/app/exports.py)). You can export the store survey
answers (responses), the logged hours (payroll), and the headline compliance
summary, either as a spreadsheet file (CSV) you download or as the same data in
plain data form (JSON), chosen with a `?format=` setting. You can narrow what
comes out by date, survey, chain, a spot on the org tree, and product. Like
everything else it is branch-scoped (a manager only ever gets their own branch),
it reuses the same login wristband, the pass/fail is worked out live, and it
adds no new database tables.

As of Phase 5-BE-a (the start of Phase 5, the field phone + offline sync), the
two endpoints a rep submits to (`POST /responses` and `POST /time-entries`) now
accept an optional "claim ticket" (a one-time id the phone makes, like a
coat-check stub). When the phone is offline a submission waits in a queue and is
sent later; if the signal flickers and the phone re-sends, the matching ticket
lets the server return the original row instead of creating a duplicate. Sending
no ticket behaves exactly as before, so nothing already live is affected. This
is the groundwork for the offline queue the field app will use.

As of W1 (the first Admin web screen), the Admin dining room is no longer just a
login plus a near-empty welcome page. It now has the **app shell** (the
persistent left sidebar and a per-page top bar, in `apps/admin/src/shell/`), a
small shared **UI kit** ported from the prototype (`apps/admin/src/ui/`: Icon,
Avatar, Chip, Button, Card, Segmented, Switch, Spark, Bar), and its first real
screen, the **Analytics dashboard** (`apps/admin/src/pages/Dashboard/`): headline
cards with sparklines and deltas, a weekly completion-trend line, a
**compliance-by-node** card that lists your org nodes (the regions when you are at
the company root) and drills region -> district -> store -> the per-product reason
a store failed, an Export-to-CSV button, and an AI gap list badged "preview". To
feed it, the backend has `GET /analytics/dashboard` (the one-call headline summary)
and `GET /analytics/compliance/nodes` (the org-node rollup behind the
compliance-by-node card), both branch-scoped, no new tables, and both windowed to
the same date range so the card and the headline always agree; the login response
also returns the company and pinned-node names for the sidebar. (This W1 merged the
old plan's W1 and W2: the shell ships with the real dashboard as its first screen.)

As of W3 (the second real Admin screen), the Admin app also has the **Catalog**
screen (`apps/admin/src/pages/Catalog/`), reachable at `/catalog`. It shows the
company's product list grouped by product line, in a List view and a Gallery view,
with search, a status filter (All/Active/Discontinued), and three stat tiles
(product lines, total products, active products). Admins can add and edit products
via a pop-up form; managers and reps see it read-only. One company never sees
another's catalog (enforced by the existing backend at `GET/POST/PATCH /skus`;
no backend API or schema change was needed for W3). The UI kit gained four new
shared pieces for the form: Modal, Field, Input, and Select (reusable by every
future screen that needs a pop-up or a form). The backend's demo data (the seed)
was enriched so Lumen now has 33 products across 6 product lines, including one
discontinued product, so the screen has real content to show.

As of W4 (the third real Admin screen), the Admin app also has the **Surveys**
area (`apps/admin/src/pages/Surveys/`), reachable at `/surveys`. It replaces the
old "coming soon" placeholder and lets admins build, publish, and assign checklists.
Three panels: a **Surveys list** (every survey with a status chip Published/Draft/
Archived, a version chip, an Assigned indicator, and three stat tiles); a by-hand
**Builder** (add questions of six types: Yes/No, Number, Single choice, Multiple
choice, Photo, Short text; mark a question required; set a structured pass rule for
scoreable types; ask a question per product by picking product lines, which freeze
to specific product ids on publish; reorder with up/down arrows); and **Publish**
(freeze that version forever, with a confirmation) then **Assign** (point the
published version at one or more org nodes with a deadline and a timezone label).
Only Yes/No, Number, and Single choice questions carry a pass rule (the operators
>=, <=, >, <, ==, !=, in, not_in map directly to the backend's compliance.py); the
other types are logged but not scored. Backend changes were additive only (no
migration, no new endpoint): the survey question model gained three optional fields
(`required`, `unit`, `lines`), and `GET /surveys` now returns `latest_version` and
a scope-aware `assigned` boolean per survey. Everything else used the existing
`/surveys`, `/survey-assignments`, `/skus`, and `/nodes` endpoints. Deliberate
limitations noted: a survey name is read-only in edit mode (no rename endpoint);
the timezone label is stored for display only and does not yet shift the deadline
per store; drag-and-drop reorder, the version-diff panel, the phone preview, the
pre-assign store-count estimate, and survey templates are deferred. 104 frontend
automated checks, all green. Backend: 192 tests (190 prior plus 2 new), all green.

As of W6 (the Payroll screen), the Admin app has a new **Payroll** sidebar item
at `/payroll`. You pick a pay period from a dropdown, and the screen shows a table
of every rep's hours for that period (store time, reset time, drive time, miles,
and approval status). Managers can approve or reject individual entries. Admins
can **seal** the period, which locks every entry; after sealing the screen shows a
padlock icon and a per-rep Reopen button. To reopen one rep's entry an admin must
type a reason, which is written into a permanent **audit log**. A **Download CSV**
button calls the existing export endpoint. Role-gating is strict: reps are
redirected away from this screen entirely (no view at all), managers can approve,
and only admins can seal, reopen, and read the audit log. If a company has payroll
switched off, the screen shows a graceful "payroll not enabled" message instead of
a table. The screen is purely a frontend addition: all the backend endpoints it
calls (`/pay-periods`, `/time-entries` plus approve/reject/seal/reopen, `/audit`,
and `/export/payroll`) already existed from Phase 4c/4d. New files:
`apps/admin/src/pages/Payroll/` (`Payroll.tsx`, `usePayroll.ts`,
`ReopenModal.tsx`, plus tests and CSS). Deliberately deferred: per-rep hour
drill-in and inline editing.

As of W7 (the Hierarchy screen), the Admin "Hierarchy" sidebar item at `/hierarchy`
is now a real screen instead of the old "coming soon" placeholder. It shows the
company's org tree in a read-only, expand/collapse view. Each row has a colour dot
and the level name (Region, District, or Store, from the company's own level
definitions), a chain badge on stores, the store code, and child counts. A search
box filters the tree by name or code. A chain filter narrows by chain. Clicking a
store opens a detail panel showing the store's full management path and its
attributes. The tree itself is powered by the existing `GET /nodes` endpoint. A
small new read-only endpoint was also added: `GET /org-levels`, which returns the
company's level names (like Region, District, Store) scoped to the caller's
tenant. It lives in `api/app/hierarchy.py` and `api/app/scope.py`, with a test.
New files: `apps/admin/src/pages/Hierarchy/` (`Hierarchy.tsx`, `useHierarchy.ts`,
`TreeNode.tsx`, `StoreDetailModal.tsx`, plus tests and CSS). Deliberately deferred
(shown as greyed "soon" labels on screen): coverage mode (managers/reps overlay),
adding/renaming/deleting nodes, bulk import, and export.

As of the Users & Roles screen, the Admin "Users & Roles" sidebar item at `/users`
is a real screen (`apps/admin/src/pages/Users/`) instead of the old "coming soon"
placeholder. It has a **People** tab (three role-count cards for Admin / Manager /
Rep, a plain-language banner that "a role is what a person can do, their pin is where
they can do it", and a team table of name, email, role, and the org-tree spot each
person is pinned to with a sentence explaining what that pin lets them see) and a
**Roles** tab (a read-only capability matrix of Full / Scoped / None per role).
Admins can add a person (name, email, role, which node to pin to, and a starting
password the admin sets), change a person's role in the table, and move or remove a
pin; managers and reps see it read-only (the same pattern as the Catalog). A small
new backend brick powers it, with no database change (the people, pin, and company
tables all already existed): a new `api/app/users.py` router with `GET /users` (the
team list, branch-scoped through the same scope-follows-pin guard, so a pinned person
shows up when pinned at or under your spot, people with no pin show only to a caller
at the company root, and a caller with no pin sees nobody), admin-only `POST /users`
(add a person and pin them in one step, the password stored only as a scrambled
one-way Argon2 hash, a duplicate email refused with a 409, a node outside your branch
refused with a 404), and admin-only `PATCH /users/{id}` (change a role and/or
move-or-remove the pin, with a "you cannot remove the last admin" safety guard). The
pin is one row in the existing `assignments` table. Deliberately deferred and noted
honestly: real emailed invite links (needs an email system; for now the admin sets a
starting password), enable/disable a person (there is no status column yet),
manager-scoped invites (admin-only for now), and custom roles.

As of the Settings screen, the Admin "Settings" sidebar item at `/settings` is a real
screen (`apps/admin/src/pages/Settings/`) instead of the old "coming soon"
placeholder. Two things are real and saved in this first version: the **company name**
(editable) and a **payroll on/off switch** that genuinely controls whether the Payroll
screen and its backend actions are available. Five more panels are shown honestly as
"coming soon" rather than faked: pay-period defaults, work model, store chain logos,
the audit log, and data & security. Managers and reps see the screen read-only. A
small new backend brick powers it, again with no database change (the company table
already had the name, code, and payroll switch): a new `api/app/tenants.py` router with
`GET /tenants` (this company's settings, readable by any signed-in person) and
admin-only `PATCH /tenants` (update the name and/or the payroll switch). The company
code is permanent and cannot be edited. Deferred (the honest "coming soon" panels): the
pay-period defaults, work model, store logos, a unified company audit feed, and the
data & security panel. Both new routers (`users.py` and `tenants.py`) are registered in
`api/app/main.py`, and the shared scope guard in `api/app/scope.py` gained a users
section (list / get / create / update_user) and a tenant section (get / update_tenant)
plus a `LastAdminError`.

With the Users & Roles and Settings screens shipped, **all the Admin web sidebar
screens are complete**: W1 (dashboard + shell), W3 (catalog), W4 (surveys), W5
(responses), W6 (payroll), W7 (hierarchy), plus Users & Roles and Settings.

As of setup-wizard slice 1 (2026-06-26), the **Hierarchy screen is now editable**
for admins (it was read-only). This is the first of two slices toward the setup
wizard: making the org tree editable. The screen at `/hierarchy` gained an
admin-only Edit mode that can add a child node (its level is set automatically from
the parent, so a child of a Region becomes a District, and a Store gets no add-child
because a store is the bottom of the tree), rename a node (and edit a store's chain
and address), and delete a node but only when it is empty (no child nodes, nobody
pinned to it, no surveys assigned, no responses; otherwise it refuses and names the
blocker). Managers and reps still see the screen read-only. Three new backend
endpoints power it, with no database change (the `nodes` table already existed) and
all admin-only and branch-scoped through the existing scope guard: `POST /nodes`
(add a child, the child's level is the parent's plus one, the internal code is
auto-generated and made unique from the name, and adding below the bottom Store
level is refused with a 400), `PATCH /nodes/{id}` (rename and edit store attributes;
the parent, level, and code are not editable), and `DELETE /nodes/{id}` (only when
empty, else a 409 naming the blocker; a 404 if the node is out of scope). These
live in `api/app/hierarchy.py` (the router) and `api/app/scope.py` (the ScopedRepo
gained `get_node`, `create_node`, `update_node`, `delete_node`, and a `_slug_code`
helper). On the frontend, `apps/admin/src/pages/Hierarchy/` gained a new
`NodeFormModal.tsx` (the add/rename pop-up) plus edit-mode wiring in `Hierarchy.tsx`
and `TreeNode.tsx` and new mutation hooks in `useHierarchy.ts`, and
`apps/admin/src/lib/api.ts` gained an `apiDelete` helper. Deferred and noted
honestly: moving a node to a new parent (a later piece), editing the org levels
themselves (that comes with the wizard), and bulk CSV import/export (still greyed
"soon" on the screen).

As of the setup wizard (2026-06-26), the Admin app has a fullscreen, admin-only,
**5-step Setup Wizard** at `/setup` (`apps/admin/src/pages/Setup/`), reached from a
new **Setup** item in the sidebar. This was slice 2 (the UI) on top of the editable
hierarchy and the set-org-levels brick finished earlier the same day, so the whole
setup-wizard feature is now done. The five steps: (1) choose a starting point (pick a
hierarchy template, switched off on a company that is already set up); (2) name your
levels (rename-only once real stores exist, full add/remove/reorder on a fresh
company), saved via `PUT /org-levels`; (3) payroll on/off, saved via `PATCH /tenants`;
(4) build the tree, adding org spots via `POST /nodes`; (5) invite people, adding and
pinning team members via `POST /users` with a starting password. The wizard saves as
you go, and Finish or Exit returns to the dashboard. It is admin-only (the route
redirects non-admins, the Setup nav item is hidden from them, and the backend still
guards every call). No new backend was needed: it reuses the existing `PUT /org-levels`,
`PATCH /tenants`, `POST /nodes`, and `POST /users` endpoints. With the setup wizard
done, the **Admin web app is feature-complete** for this roadmap.

The current green baseline is 249 backend tests + 247 frontend tests, build clean.
What is next per the roadmap: with the Admin web app feature-complete, the next tracks
are the Manager web app (reuses the same backend, scoped to a manager's branch) and
Phase 5 (the Field mobile app + offline sync).

As of W5 (the responses sub-feature inside the Surveys screen), the Surveys list
now shows a response count badge on each survey row, and clicking it opens two
layered pop-ups: a list of all submitted responses for that survey, and a detail
view for one response. The backend's two responses endpoints were enriched to
carry extra fields that the frontend needs:

- `GET /responses` (the list) now returns `survey_id` (which survey the row
  belongs to, as a stable id rather than a display name), `scored` (how many
  questions in that response have a pass rule and were answered), and `passed`
  (how many of those scored questions passed). These three are computed live from
  the same scoring step that already ran for `overall`, so no new database
  queries are added.
- `GET /responses/{id}` (the detail) already returned everything needed; no
  change to its payload.

On the frontend (`apps/admin/src/pages/Surveys/`):

- `useResponses.ts` holds the TypeScript shapes and data helpers for responses.
  `ResponseRow` gained `survey_id`, `scored`, and `passed` fields to match the
  enriched backend. The `responsesForSurvey` helper now filters by `survey_id`
  directly (instead of matching survey names, which was fragile). The
  `countBySurvey` helper takes a list of survey ids and counts each one's rows.
  Checked by `useResponses.test.ts`.
- `ResponsesListModal.tsx` is the pop-up that lists all responses for one
  survey. Each row now shows a real percentage (passed / scored * 100, rounded)
  and a Pass / Partial / Fail / Not scored chip, computed from the `scored` and
  `passed` fields the backend returns. Checked by `ResponsesListModal.test.tsx`.
- `ResponseDetailModal.tsx` is the pop-up that shows one response in full: the
  rep's name, store, submission date, verdict header, and a per-question answer
  block. Per-product (per-SKU) number questions show a grid of shade cells, each
  tinted green (pass) or red (fail). Checked by `ResponseDetailModal.test.tsx`.
- `SurveyList.tsx` uses `survey.id` (not `survey.name`) when calling the helpers,
  so the count and the filtered list are always correct even if two surveys happen
  to share a name.

```
   YOU (browser)              THE WAITER                THE PANTRY
  +--------------+   asks    +--------------+  reads/  +--------------+
  |  FRONTEND    | --------> |   BACKEND    |  writes  |  DATABASE    |
  |  (React)     | <-------- |  (FastAPI)   | <------> | (PostgreSQL) |
  +--------------+  answers  +--------------+          +--------------+
     apps/ +                      api/                       db/
     packages/
```

---

## 2. Which folder is what

| Folder | Part | In plain words |
|--------|------|----------------|
| `api/` | BACKEND | The waiter. Python code that answers requests and is the only thing allowed to touch the database. Full guide: [api/README.md](api/README.md). |
| `db/` | DATABASE | The change-history for the pantry's shelves (which tables exist, what columns). Full guide: [db/README.md](db/README.md). |
| `apps/admin/` | FRONTEND | The Admin dining room: the React screens brand HQ uses. It has the app shell (sidebar + top bar), a shared UI kit, the Analytics dashboard wired to `/analytics/dashboard`, the Catalog screen wired to `/skus`, the Surveys area (build, publish, assign) wired to `/surveys` and `/survey-assignments`, the Payroll screen wired to `/pay-periods`, `/time-entries`, `/audit`, and `/export/payroll`, the Hierarchy screen wired to `/nodes` and `/org-levels` (now with an admin-only Edit mode that adds/renames/deletes nodes via `POST`/`PATCH`/`DELETE /nodes`), the Users & Roles screen wired to `/users`, the Settings screen wired to `/tenants`, and the fullscreen 5-step Setup Wizard at `/setup` (which reuses `PUT /org-levels`, `PATCH /tenants`, `POST /nodes`, and `POST /users`), on top of the login screen. All Admin web sidebar screens are complete, the Hierarchy screen is editable, and with the setup wizard done the Admin web app is feature-complete. Full guide: [apps/admin/README.md](apps/admin/README.md). |
| `apps/manager/` | FRONTEND | The Manager app. Not created yet. |
| `apps/field/` | FRONTEND | The Field mobile app for reps. Not created yet. |
| `packages/` | FRONTEND (shared) | Pieces shared by all the frontend apps, like the brand colors and fonts. Full guide: [packages/tokens/README.md](packages/tokens/README.md). |
| `docs/` | NOTES | Design write-ups and build plans (one file per feature). Not code. |

Everything else at the top level is setup/config, explained in section 4.

---

## 3. How a login actually travels through the three parts

This is the whole app in one example. When you sign in:

1. **Frontend** (the login screen in `apps/admin/`) takes your email and
   password and hands them to the waiter.
2. **Backend** (`api/`) catches them, looks up the matching person in the
   pantry, and checks the password against the safely-scrambled version.
3. **Database** (`db/` defines its shape) hands the backend that one person's
   record.
4. **Backend** decides yes or no. If yes, it makes a "wristband" (a signed
   token that proves who you are) and sends it back.
5. **Frontend** stores the wristband and shows you the welcome page.

Each part has a README that explains its own files in detail.

---

## 4. The setup files at the top level (what each one is for)

These are not "the app" so much as the instructions for assembling and running
it. You rarely edit them by hand.

| File | In plain words |
|------|----------------|
| `docker-compose.yml` | The recipe that starts the backend and the database together with one command. Names the database, opens the right doors (ports), and knows how to run database updates. |
| `package.json` (root) | The project's ID card plus a list of command shortcuts (like `pnpm dev:admin` and `pnpm test:admin`). |
| `pnpm-workspace.yaml` | Tells the tooling that `apps/*` and `packages/*` are all part of one project, so they can share code. |
| `.gitignore` | A list of things git should NOT save (downloaded libraries, build leftovers, secrets). |
| `.env` | Your LOCAL secrets (database password, login secret). Never committed to git. Docker reads it to start things. The backend reads secrets only from the environment (via `api/app/config.py`), never from hardcoded values. |
| `.env.example` | A template showing which secret settings exist, without real values. A new teammate copies it to `.env` and fills in real values. |
| `README.md` | The short technical readme for developers. |
| `START_HERE.md` | Your plain-English "how to run it" guide. |
| `CONTEXT.md` | The short build-status + history for a fresh AI chat or teammate. |
| `CODEBASE_MAP.md` | This file. |

---

## 5. Where to read next

- To understand the part you said you find hardest, the backend, open
  [api/README.md](api/README.md). It explains every backend file from scratch.
- For the database, [db/README.md](db/README.md).
- For the screens you see, [apps/admin/README.md](apps/admin/README.md).
- For the shared colors and fonts, [packages/tokens/README.md](packages/tokens/README.md).
