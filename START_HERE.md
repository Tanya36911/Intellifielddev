# START HERE, Tanya

This is your plain-English guide to the Intelli production app. It assumes you
know nothing about backend code, and it explains every tool and step. When you
open a brand-new chat, read this file first (and tell the assistant to, too).

---

## 1. What we've built so far (in plain points)

**Phase 0 - the skeleton (done):**
- A fresh project folder (`intelli-app`) set up to hold all three real apps.
- A **database** is running (Postgres). Think of it as the app's permanent memory.
- A **backend** is running (FastAPI). Think of it as a waiter: the apps ask it
  for things, and it is the only one allowed to talk to the database.
- A **blank Admin web page** that opens in your browser and shows a green dot
  meaning "the web page successfully talked to the backend."
- Your prototype's colors, fonts, and spacing were copied into one shared place
  so every app looks consistent.

**Phase 1 - login, the backend half (done):**
- Two real database tables: **tenants** (a company, e.g. Lumen Beauty) and
  **users** (people who log in, each tied to one company).
- **Passwords are stored safely** as a scrambled one-way code (called a "hash"),
  never as the real password. Even if someone stole the database, they can't read passwords.
- A **login check**: send an email + password, get back a "token" (a digital
  wristband that proves who you are) if correct, or a rejection if wrong.
- A **demo login** to test with:  email `dana@lumenbeauty.com`  password `demo1234`

**Phase 1 - login, the screen half (done):**
- The Admin app now has a real **login page**: email + password, friendly
  errors ("Invalid email or password", or "Can't reach the backend" when
  Docker is off), and a quiet DEV box showing the demo login while we build.
- After signing in you land on a small **welcome page** (your name, your
  role, the green API dot, and Sign out). The real dashboard replaces it later.
- You **stay signed in up to 12 hours**, even if you close the browser.
- Permanent rails installed for every future screen: a page-switcher (each
  screen gets its own web address, strangers get bounced to login), a
  form-checker (catches typing mistakes before sending), a session pocket
  (one shared place that remembers who is signed in), the brand fonts, and
  a **testing robot** (27 automated checks that re-run on demand).

**Phase 2 - the org chart + the "see only your branch" rule (done):**
- Every company now has an org tree (regions, districts, stores), and each
  person is pinned to one spot. A new safety checkpoint guarantees you can see
  only your spot and everything below it, never another company's data and never
  a sibling branch. This is the security backbone of the whole product.
- Chain (CVS, Walmart) is a label on each store, so you can view and target
  stores by chain across the company.
- Proven by a backend test robot whose isolation checks must pass: one company
  sees zero of another, a regional manager sees zero of a sibling region, a rep
  sees only their stores.
- This phase has no new screen. The org-chart screens come in a later phase.

**Phase 3a - the product catalog (done):**
- Each company now has a product list (its "SKUs", meaning product variants
  like Velvet Lip in Rosewood vs Mauve), with barcode, color, an
  active/discontinued status, and optional reference photo links.
- Everyone in a company can view the catalog; only admins can add or edit
  products. One company never sees another's catalog.
- This is the foundation for surveys (Phase 3b), which ask questions about these
  exact products.

**Phase 3b - surveys, frozen versions, assignments, pass rules (done):**
- Each company can now define surveys (the checklists reps fill out in stores).
  A survey is kept as frozen "versions": once you publish a version it can never
  change, and editing makes a brand-new version, so past results are never
  rewritten under your feet.
- Each question can link to real catalog products and carry a structured pass
  rule ("passes if 4 or more"), which is what later lets the app score
  compliance from rules instead of guesses.
- A survey can be assigned to a spot on the org tree. Which stores it covers is
  worked out live from the tree, so a store added next month is automatically
  included. Admins build surveys; admins (anywhere) and managers (within their
  own branch) assign them; reps can view.
- Backend only, no new screen yet (same as the catalog phase). Proven by the
  test robot: company isolation, admin-only authoring, a published version
  cannot be edited, a manager cannot assign outside their branch, and the
  computed store coverage.

**Phase 4a - responses + live pass/fail (done):** Reps' completed surveys are
now stored, one tiny row per product per question per moment, and read back
with pass/fail worked out fresh from the survey's rules (never saved, so fixing
a rule fixes every score). Backend only, no screen yet. Proven by the test
robot: the same answer scores differently when the rule changes, submissions
are checked against the survey, you can only submit for a store in your branch,
and re-visits are all kept.

**Phase 4b - analytics (done):** The response rows now power read-only reports:
how compliant each part of the org is (both how many expected stores responded,
and of those how many passed), drill-down from a region all the way to a single
store and the exact product that failed, which products are out of stock and in
how many stores, and how a product's shelf count is trending over time. Backend
only, no screen yet. Proven by the test robot: the numbers add up, compliance
changes when a rule changes, a company-wide survey shows for a region scoped to
its own stores, and a manager only ever sees their own branch.

**Phase 4c - payroll (done):** Each company can switch on payroll. An admin opens a pay period, reps log their own hours (store, reset, drive minutes, miles), managers approve their branch's hours, and at the cutoff the admin seals the period so the numbers lock. The one exception is a deliberate, logged "reopen one rep" (their hours unlock, get fixed, and the action is written into a permanent logbook). Backend only, no screen yet. Proven by the test robot: a sealed period can't be edited or re-approved, a reopen frees exactly one rep and is logged, and a company with payroll off is refused.

**Phase 4d - export (done):** You can now get the field data out of the app. Three new addresses hand back the store survey answers (responses), the logged hours (payroll), and the headline compliance summary, either as a spreadsheet file (CSV) you download or as the same data in plain data form (JSON), chosen with a `?format=` setting. You can narrow what comes out by date, survey, chain, a spot on the org tree, and product. Like everything else it is branch-scoped (a manager only ever gets their own branch), it reuses the same login wristband, and it adds no new database tables. Backend only, no screen yet. Proven by the test robot: the CSV and the JSON always match, both response levels work, the pass/fail is worked out live, every filter narrows correctly, payroll stays role-scoped and is refused for a company with payroll off, and a node outside your branch is refused.

**Phase 5 (Field app + offline sync) STARTED:** This phase (the rep's phone app,
which works even with no signal) is large, so it is being built in small pieces.
- **5-BE-a (idempotency keys, done):** the two screens a rep submits from (saving
  a finished survey, and logging hours) now accept an optional "claim ticket" (a
  one-time id, like a coat-check stub). If the phone is offline and re-sends a
  submission once the signal returns, the ticket lets the server hand back the
  original record instead of making a duplicate. Nothing that was already working
  changes. Backend only, no screen yet.

**W1 (Admin dashboard + shell) DONE:** the Admin app now has its first real
screen, so it finally looks and feels like a product you log into and land
inside. The persistent left sidebar (the Intelli brand, your company card, the
menu, your footprint of Nodes/Stores/Reps, and Sign out) frames every screen,
and the first screen inside it is the **Analytics dashboard**: headline cards
(average compliance, surveys completed, overdue) each with a tiny trend line and
an up/down change, a weekly completion-trend chart, a list of how compliant each
part of the org is that you can click to drill from a region down to a store and
the exact product that failed, an Export button that downloads a spreadsheet, and
an AI gap list clearly marked "preview". The numbers are real, worked out by the
backend. The menu items for screens we have not built yet show a friendly "coming
soon" placeholder. (This merged the old plan's W1 and W2: instead of a stub Home
followed by a separate dashboard, the shell ships with the real dashboard as its
first screen.)

**W3 (Catalog screen) DONE:** the Admin app now has a second real screen, the
**Catalog**, reachable at `/catalog` in the sidebar. It shows the company's
product list (its SKUs, meaning product variants like Velvet Lip in Rosewood)
grouped by product line, in both a List view and a Gallery view. A search box
narrows by name, line, or barcode. A status filter switches between All, Active,
and Discontinued products. Three stat tiles at the top count the product lines,
total products, and active products. Admins can add a new product or edit one
using a pop-up form with five fields (line, variant, barcode, colour, status).
Managers and reps see the same screen but in read-only mode (no Add button,
rows do nothing when clicked). One company never sees another's catalog (enforced
by the backend). The backend demo data (the seed) was enriched to give Lumen 33
products across 6 lines, including one discontinued product, so the filter and
the grouping have real content to show. No backend API or database change was
needed. The UI kit gained four new shared building blocks (Modal, Field, Input,
Select) that every future screen with a form or a pop-up will reuse. 80 frontend
automated checks, all green.

**W4 (Survey builder + assignments) DONE:** the Admin app now has a third real
screen, the **Surveys** area, reachable at `/surveys` in the sidebar (the old
"Form Builder" nav item is removed; the builder lives inside Surveys). An admin
can create a survey by hand (six question types: Yes/No, Number, Single choice,
Multiple choice, Photo, Short text), mark questions required, set a pass rule for
scoreable types (Yes/No, Number, Single choice) using operators >=, <=, >, <, ==,
!=, in, not_in, ask a question per product by picking product lines (which freeze
to specific product ids on publish), and reorder questions with up/down arrows.
Publishing freezes that version forever with a confirmation. After publishing the
admin assigns the survey to one or more org nodes with a deadline and a timezone
label. The surveys list shows each survey with a status chip (Published / Draft /
Archived), a version chip, and an Assigned indicator, plus three stat tiles. The
backend needed no migration and no new endpoint: two additive-only model changes
(the question shape gained three optional fields; GET /surveys now returns
latest_version and a scope-aware assigned boolean). 104 frontend automated checks,
all green; 192 backend tests (190 prior plus 2 new), all green. Deliberately
deferred (honest limitations): survey rename (no backend rename endpoint, so the
name is read-only in edit mode), timezone deadline shifting per store, drag-and-drop
reorder, version-diff panel, phone preview, pre-assign store-count estimate,
survey templates, and the AI "describe it and draft a survey" feature (a later
fast-follow).

**W5 (Responses, list + detail) DONE:** Responses are NOT a sidebar item
(prototype parity). They open as modals from the Surveys screen: each survey row
has a "N responses" button that opens a per-survey responses list, which opens a
single response's detail with the live verdict and the per-shade facings grid. One
small read-only enrichment to the existing /responses endpoint; no new tables. 196
backend checks + 133 frontend checks, green.

**W6 (Payroll screen) DONE:** a new Admin sidebar item at `/payroll`. Select a pay
period; a table shows each rep's store/reset/drive hours and miles, with approval
status. Managers approve or reject individual entries. Admins seal the period
(locks everything; the screen then shows a padlock and a per-rep Reopen button).
Reopening one rep requires a typed reason, written to the permanent audit log.
A Download CSV button exports the period. Role-gating is strict: reps are
redirected away entirely, managers can approve, admins can seal/reopen/read-audit.
If a company has payroll switched off the screen shows a graceful "payroll not
enabled" message. Frontend only: all backend endpoints already existed (from Phase
4c/4d). New files in apps/admin/src/pages/Payroll/. Deferred: per-rep hour
drill-in, inline editing.

**W7 (Hierarchy screen) DONE:** the Admin "Hierarchy" sidebar item at `/hierarchy`
is now a real screen (was "coming soon"). A read-only org tree: expand/collapse, a
colour dot and level name per row, a chain badge on stores, the store code, and
child counts. A search box and chain filter narrow the view. Clicking a store opens
a detail panel with its management path and attributes. Backed by the existing
`GET /nodes` plus a new small read-only `GET /org-levels` endpoint (the company's
level names, tenant-scoped). New files in apps/admin/src/pages/Hierarchy/.
Deferred (greyed "soon" on screen): coverage mode, add/rename/delete nodes, bulk
import, export.

**The six demo-order Admin screens are DONE** (W1 dashboard, W3 catalog, W4 surveys,
W5 responses, W6 payroll, W7 hierarchy). Current green baseline: 198 backend tests
+ 196 frontend tests, build clean. Still to build in the Admin app: **Users & Roles**
and **Settings** (the two remaining sidebar items, each needs a small backend brick
first, GET/POST /users and GET/PATCH /tenants), then the **setup wizard**. What is
next: build Users & Roles + Settings. The **Manager web app** and **Phase 5** (the
Field mobile app + offline sync) are the larger tracks after that.

---

## 2. The tools you'll use (what each one is for)

| Tool | What it is, in plain terms | When you use it |
|------|----------------------------|-----------------|
| **Terminal** | A text box where you type commands to the computer. | To start/stop the app. |
| **OrbStack** | The program that runs the database + backend "boxes." Must be OPEN. | Leave it running in the background. |
| **Browser** (Chrome/Safari) | Where you see the app and test the backend. | To look at your work. |
| **VS Code / Cursor** | Where you read and edit the code files. | To see the code. |
| **Claude Code** (me) | I write and explain the code with you. | To build features. |

You don't need to memorize commands - section 4 is your copy-paste cheat sheet.

---

## 3. How to turn everything on (do this each time you start working)

1. **Open OrbStack** (from Applications or Spotlight). Wait until it's running.
   This powers the database + backend.
2. **Open Terminal** and go to the project folder:
   ```
   cd ~/Documents/intelli-app
   ```
3. **Start the backend + database:**
   ```
   docker compose up -d
   ```
   (The `-d` means "run in the background.")
4. **Check it's alive** - open these in your browser:
   - http://localhost:8000/health  -> should say `{"status":"ok"}`
   - http://localhost:8000/docs    -> the backend's interactive menu (you can
     test login right here: open `POST /auth/login`, click "Try it out", enter
     the demo email/password, and hit Execute).
5. **Start the web app** (only when you want to see the Admin screens):
   ```
   pnpm dev:admin
   ```
   Then open http://localhost:5173

**To stop for the day:** `docker compose down` (the database remembers its data
for next time).

---

## 4. Command cheat sheet (copy-paste, run from `~/Documents/intelli-app`)

| I want to... | Type this |
|--------------|-----------|
| Start backend + database | `docker compose up -d` |
| Stop backend + database | `docker compose down` |
| See the Admin web app | `pnpm dev:admin` (then open http://localhost:5173) |
| Apply new database changes | `bash scripts/db-migrate.sh` (or `docker compose run --rm migrate up`) |
| Re-create the demo data (companies, tree, users) | `docker compose exec api python -m app.seed` |
| Apply backend code changes | `docker compose restart api` (code is now live-mounted) |
| Rebuild backend (only when libraries change) | `docker compose up -d --build api` |
| Run the testing robot (frontend checks) | `pnpm test:admin` |
| Run the testing robot (backend checks) | `pnpm test:api` (backend must be running) |
| See what changed in git | `git status` |

---

## 5. File structure (kept up to date)

```
intelli-app/
├── START_HERE.md        <- THIS FILE (your plain-English guide)
├── CONTEXT.md           Short context + progress log (for a new AI chat)
├── README.md            Quick technical readme
├── CODEBASE_MAP.md      PLAIN-ENGLISH MAP OF THE CODE (backend vs frontend)
├── CHECKING_THE_WORK.md HOW TO CHECK/TEST THE WORK YOURSELF (no coding needed)
├── DEMO.md              MEETING GUIDE: what to tell + show supervisors
├── DEPLOY.md            HOW TO PUT IT ON A DEV SERVER (so others can verify it)
├── scripts/demo.sh      One-command live demo of the security boundary
├── docs/
│   └── superpowers/        Design write-ups (specs/) + build plans (plans/)
├── docker-compose.yml   Recipe that runs the backend + database together
├── package.json         Project ID card + command shortcuts
│
├── api/                 THE BACKEND (Python). The "waiter" that talks to the DB.
│   ├── README.md        Plain-English guide to every backend file
│   ├── Dockerfile       Recipe to build the backend's box
│   ├── pyproject.toml   List of backend libraries it needs
│   ├── app/
│   │   ├── main.py      Starts the backend; lists its web addresses
│   │   ├── config.py    Reads all secrets from the environment (one place)
│   │   ├── db.py        Connects to the database
│   │   ├── security.py  Password scrambling + wristbands + "who is calling"
│   │   ├── auth.py      The /auth/login check
│   │   ├── scope.py     The "see only your branch" guard (scope follows pin)
│   │   ├── hierarchy.py GET /nodes (the scoped org-tree API)
│   │   ├── catalog.py   GET/POST/PATCH /skus (the product catalog API)
│   │   ├── surveys.py   Surveys + versions + assignments API (Phase 3b)
│   │   ├── responses.py Rep answers stored as atomic rows + live pass/fail (Phase 4a)
│   │   ├── compliance.py Pass/fail brain: given an answer + a rule, returns pass/fail (Phase 4a)
│   │   ├── analytics.py  Read-only reports (compliance, out-of-stock, trend)
│   │   ├── payroll.py   Pay periods, hours, the seal/reopen lock, audit log
│   │   ├── exports.py   Data exports (responses, payroll, compliance) as CSV or JSON (Phase 4d)
│   │   └── seed.py      Creates the demo companies, tree, users, products, surveys, responses
│   └── tests/           Backend test robot (pytest), incl. the isolation gate
│
├── db/                  THE DATABASE shape (not the data itself)
│   ├── README.md        Plain-English guide to migrations + schema
│   ├── migrations/      Database change files (each adds/changes tables)
│   └── schema.sql       Auto-generated snapshot of the current DB shape
│
├── packages/
│   └── tokens/          Shared colors/fonts/spacing (one source for all apps)
│       └── README.md    Plain-English guide to the design tokens
│
└── apps/                THE FRONTEND apps (the screens you see)
    ├── admin/           ADMIN web app (React). Has a real login now.
    │   ├── README.md    Plain-English guide to every frontend file
    │   └── src/
    │       ├── lib/api.ts        The one file that talks to the backend
    │       ├── store/            The session pocket (who is signed in)
    │       ├── pages/            Login + welcome Home screens
    │       ├── test/             Shared test helpers
    │       ├── App.tsx           The route map (which address shows what)
    │       └── main.tsx          The app's front door (wiring)
    ├── manager/         MANAGER web app  (not created yet)
    └── field/           FIELD mobile app (not created yet)
```

**Want to understand the code, not just run it?** Open
[CODEBASE_MAP.md](CODEBASE_MAP.md) first. It explains, in plain English, which
folders are the backend and which are the frontend, then each folder has its
own README that walks through every file. The backend one
([api/README.md](api/README.md)) assumes you know nothing about backends.

**Want to check that the work is correct (test me)?** Open
[CHECKING_THE_WORK.md](CHECKING_THE_WORK.md). It shows you, with no coding, how
to run the checks, what "good" and "bad" look like, and how to undo anything.

---

## 6. How to resume in a NEW chat (the important part)

When you start a new session, **open Claude Code with the `intelli-app` folder**
(not the prototype folder), and paste this as your first message:

> Read START_HERE.md, CONTEXT.md, CODEBASE_MAP.md, and ROADMAP.md in this repo
> first, then TECH_STACK.txt and Intelli_Complete_Handoff.md in the sibling
> ../hi-fi-intelli repo.
>
> Where we are: the whole backend is done (Phases 0-4d: login, org hierarchy +
> the scope-follows-pin guard, catalog, surveys with frozen versions, responses
> with live pass/fail, analytics, payroll, export), plus Phase 5-BE-a (idempotency
> keys). We then pivoted to screens-first (see ROADMAP.md). ALL ADMIN WEB SCREENS
> ARE NOW COMPLETE: W1 (app shell + Analytics dashboard), W3 (Catalog at /catalog),
> W4 (Surveys area at /surveys), W5 (Responses modals from Surveys), W6 (Payroll
> screen at /payroll: pay-period selector, hours table, approve/reject, seal/reopen
> with audit log, CSV download; frontend only, all backend endpoints existed),
> W7 (Hierarchy screen at /hierarchy: read-only org tree, expand/collapse, search,
> chain filter, store detail panel; plus the new small GET /org-levels endpoint,
> tenant-scoped). Baseline is green: 198 backend tests + 196 frontend tests, build
> clean. Everything is committed to main but NOT pushed yet (pushing auto-deploys to
> the dev server, so ask me before pushing).
>
> What's next: the two remaining Admin sidebar screens, Users & Roles and Settings
> (both currently coming-soon), unless I say otherwise. Each needs a small backend
> brick first (Users: GET/POST /users; Settings: GET/PATCH /tenants), then the
> screen. After those, the setup wizard (needs the Users brick + on-screen hierarchy
> editing), then the Manager web app and Phase 5 (the Field mobile app + offline sync).
>
> My name is Tanya. Always address me as Tanya, explain everything in plain
> non-coder terms, design and let me approve before building (show me a browser
> mockup for any screen), build test-first, commit to git (straight to main) after
> each change, no em dashes, and run an adversarial multi-reviewer pass on each
> spec before building. Use the brainstorm -> spec -> plan ->
> subagent-driven-development flow; specs and plans live in docs/superpowers/.
> Keep all the docs updated (START_HERE.md, CONTEXT.md, CODEBASE_MAP.md,
> ROADMAP.md, the per-folder READMEs, CHECKING_THE_WORK.md, and the prototype
> handoff CHANGELOG).

That paragraph hands the new chat: where the docs are, what's done, what's next,
and how you like to work. With it plus these files, a fresh chat picks up right
where we left off. (Your working preferences are also saved in the assistant's
project memory, so a new chat in this folder already knows them.)

---

## 7. Where we are right now
- Backend login + Admin login screen: DONE and tested.
- Org hierarchy + "see only your branch" scope guard: DONE and tested.
- Product catalog (company-wide to view, admin-only to edit): DONE and tested.
- Surveys + frozen versions + assignments + pass rules: DONE and tested.
- Responses + live pass/fail scoring: DONE and tested.
- Analytics (compliance %, out-of-stock by product, trends): DONE and tested.
- Payroll (pay periods, logged hours, manager approval, seal/reopen lock, audit log): DONE and tested.
- Export (responses, payroll, compliance as CSV or JSON, branch-scoped): DONE and tested.
- Idempotency keys (the "claim ticket" so an offline phone can safely re-send a
  survey or hours without duplicating): DONE and tested. This is Phase 5's first
  piece.
- W1 (the Admin app shell + the Analytics dashboard): DONE and tested. The Admin
  app now has a real dashboard inside the app shell (the sidebar/top-bar frame),
  not the old near-empty welcome page. Headline numbers, a weekly trend, a
  compliance-by-org list you can click to drill into, an Export-to-CSV button, and
  the not-yet-built menu items shown as "coming soon".
- W3 (the Admin Catalog screen): DONE. The product list is live at /catalog:
  33 products across 6 lines (Velvet Lip, Silk Foundation, Lash Volume, Glow
  Blush, Cushion Compact, Brow Define), List and Gallery views, search, status
  filter, stat tiles, and admin-only add/edit via a pop-up form. Managers and
  reps see it read-only. No backend API change (seed-only). 80 frontend checks,
  green.
- W4 (the Admin Surveys area): DONE. The survey builder is live at /surveys: a
  by-hand builder for six question types (Yes/No, Number, Single choice, Multiple
  choice, Photo, Short text), pass rules for scoreable types (operators >=, <=,
  >, <, ==, !=, in, not_in), per-product questions with product-line picking,
  publish (freezes the version forever), and assign to org nodes with a deadline.
  The list shows status chip, version chip, and Assigned indicator with three stat
  tiles. Two additive backend changes only (no migration, no new endpoint). 104
  frontend checks, green; 192 backend checks, green.
- W5 (the Admin Responses feature): DONE. Responses open as modals from the
  Surveys screen (each survey row has a "N responses" button). One small read-only
  enrichment to the existing /responses endpoint; no new tables. 196 backend
  checks + 133 frontend checks, green.
- W6 (the Admin Payroll screen): DONE. A new sidebar item at /payroll. Select a
  pay period; see each rep's hours, approve or reject, seal the period, reopen one
  rep with a typed reason (written to the audit log), and download CSV. Reps are
  redirected away entirely; managers approve; admins seal/reopen/read-audit.
  Frontend only: all backend endpoints already existed. New files in
  apps/admin/src/pages/Payroll/.
- W7 (the Admin Hierarchy screen): DONE. A real org-tree screen at /hierarchy
  (was "coming soon"). Read-only expand/collapse tree: colour dot, level name,
  chain badge, store code, child counts; search and chain filter; store detail
  panel. Backed by GET /nodes plus the new GET /org-levels endpoint
  (tenant-scoped level names, added to api/app/hierarchy.py + api/app/scope.py
  with a test). New files in apps/admin/src/pages/Hierarchy/.
- **The six demo-order Admin screens are DONE** (W1, W3, W4, W5, W6, W7). Current
  green baseline: 198 backend tests + 196 frontend tests, build clean. Still to build
  in the Admin app: Users & Roles and Settings (the two remaining sidebar items),
  then the setup wizard.
- **NEXT (see [ROADMAP.md](ROADMAP.md)): Users & Roles and Settings.** Each needs a
  small backend brick first (Users: GET/POST /users; Settings: GET/PATCH /tenants),
  then the screen. After those: the setup wizard (needs the Users brick + on-screen
  hierarchy editing, i.e. node-write endpoints), then the Manager web app and Phase 5
  (the Field mobile app + offline sync).
- Secrets are now read from a local `.env` file (never committed) through one
  config file; the code has no weak built-in fallbacks. Remaining pre-launch
  step: in production, set a fresh long random `JWT_SECRET` and database password
  in the real environment (the values in `.env` are dev-only).
- Everything is committed to git, so any step can be undone.
