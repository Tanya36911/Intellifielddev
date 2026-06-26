# The BACKEND, explained for a non-coder (api/)

You said you do not understand the backend at all. This file fixes that. No
coding knowledge assumed. Read it top to bottom once and the folder will make
sense...

---

## What "the backend" even is

When you open a website, two computers are involved:

- **Your computer** runs the screens you see and click. That is the frontend.
- **A server** somewhere runs the behind-the-scenes logic: checking passwords,
  saving records, enforcing rules. That is the backend.

Our backend is written in **Python** (a programming language) using **FastAPI**
(a tool that makes it easy to build a backend that other programs can talk to).

Think of the backend as a **waiter** in a restaurant. The dining room (the
screens) never walks into the kitchen. It asks the waiter. The waiter is the
only one allowed into the pantry (the database). This is on purpose: it keeps
the data safe and puts all the important rules in one trustworthy place.

The backend "listens" at an address on your machine: **http://localhost:8000**.
Other programs send it requests there. `localhost` just means "this computer",
and `8000` is like a specific door number.

---

## How to see it working

With the backend running (`docker compose up -d`, see START_HERE.md), open
these in your browser:

- http://localhost:8000/health -> should say `{"status":"ok"}`. This is the
  waiter saying "I am awake."
- http://localhost:8000/docs -> an automatic, clickable menu of everything the
  backend can do. FastAPI builds this page for free. You can test the login
  right here without any other tool.

---

## Every file in this folder, in plain words

The actual brain of the backend lives in the `app/` subfolder. The other files
are packaging.

### app/main.py  (the front desk)
The starting point. When the backend boots, this file runs first. It:
- creates the application,
- lists the two health-check addresses (`/health` and `/health/db`),
- plugs in each feature router (login from `auth.py`, the org tree from
  `hierarchy.py`, the catalog from `catalog.py`, surveys from `surveys.py`,
  responses from `responses.py`, analytics from `analytics.py`, payroll
  from `payroll.py`, the data exports from `exports.py`, the team list from
  `users.py`, and the company settings from `tenants.py`),
- and sets the "guest list" (called CORS) that says which web addresses are
  allowed to call the backend. Right now that is the local Admin app.

If you want to know everything the backend can do, this file is the table of
contents.

### app/auth.py  (the login desk)
Handles signing in. It defines the `/auth/login` address. When an email and
password arrive, it:
1. looks up the person with that email in the database,
2. asks `security.py` to check the password,
3. if correct, asks `security.py` for a fresh wristband (token) and sends it
   back along with the person's name and role. As of W1 it also looks up and
   returns the company's name (`company_name`) and the name of the node the
   person is pinned to (`pinned_node_name`, or null if they have no pin), so the
   web app's sidebar can show "you are signed in to {company}, pinned to {node}"
   without a second request. These are plain lookups; no new table was added.
4. if wrong, replies "Invalid email or password" without saying which part was
   wrong (telling an attacker "the email exists but the password is wrong"
   would leak a hint, so we never do).

### app/security.py  (the safe and the wristband machine)
Four security jobs live here, kept separate from everything else on purpose. The
third, `current_claims` (added in Phase 2), verifies the caller's wristband on
each incoming request and is what the scope guard relies on. The fourth,
`require_admin` (added in Phase 3a), goes one step further and blocks anyone who
is not an admin with a "not allowed" (403); it guards the catalog and survey
write endpoints. The fifth, `require_manager_or_admin` (added in Phase 3b), lets
admins and managers through but blocks reps; it guards survey assignment writes
(the scope guard still keeps a manager to their own branch). The first two:
- **Password scrambling.** Passwords are never stored as the real text. They
  are run through a one-way scrambler called Argon2. You can check a guess
  against the scramble, but you can never un-scramble it back to the password.
  So even if someone stole the whole database, they could not read anyone's
  password.
- **Wristbands (tokens).** After a correct login, it creates a signed token
  (a JWT) that says who you are, your tenant (company), and your role, and
  stamps it to expire in 12 hours. The signature means nobody can forge or
  tamper with one. Later requests show this wristband to prove who they are. The
  signing secret is read from `config.py` (the environment), never hardcoded.

### app/config.py  (the one place secrets are read)
Reads every secret and environment-specific setting (the database address and
the login secret) from the environment, in one place. Nothing sensitive is
hardcoded in the rest of the code. If a required secret is missing, the app
refuses to start with a clear message, rather than silently using a weak
default. In development these values come from your `.env` file (which is never
committed); in production they come from the deploy environment.

### app/db.py  (the phone line to the pantry)
Opens and holds the connection to the database, and offers a tiny "is the
database reachable?" check. Every other file that needs data borrows this
connection instead of opening its own. The database address comes from
`config.py` (which reads it from the environment).

### app/scope.py  (the scope guard: you only see your own branch)
The single checkpoint that keeps companies and branches separate. For any
request that reads org data, it reads the caller's wristband, looks up the node
they are pinned to, and hands back a ScopedRepo: the only object allowed to read
the scoped tables. Every query the ScopedRepo runs is automatically limited to
the caller's company and the part of the tree at or below their pin. Because the
filter lives only here, no screen can forget it. A person with no pin sees
nothing (the safe default). As of Phase 3a the ScopedRepo also lists, adds, and
edits catalog products, filtered by company only (the catalog is company-wide
reference data, not branch-scoped). As of Phase 3b it also handles surveys
(company-wide, like the catalog) and survey assignments (branch-scoped, like the
org tree): creating, publishing, and versioning surveys, and assigning a
published version to a node within the caller's branch. As of Phase 4a it also
stores and retrieves responses (create_response, list_responses, get_response),
branch-scoped so a rep can only submit for a store in their own part of the
tree. As of Phase 4b the ScopedRepo gained an analytics section: the four
read-only report queries (compliance, drill, out-of-stock, trend) are also
branch-scoped through it, so a manager can only see analytics for their own part
of the tree. As of Phase 4c the ScopedRepo gained a payroll section: pay periods
are company-wide (any admin in the company can see them), while time entries are
role-scoped (reps see their own; managers see their branch; admins see all). It
also gained an `_audit` helper that writes a permanent, tamper-evident log entry
whenever a sensitive payroll action happens (such as reopening a sealed period). As
of the Users & Roles and Settings screens (2026-06-25) the ScopedRepo gained a users
section (list / get / create / update_user, branch-scoped exactly like the org tree,
so you only ever see and manage people in your own part of the company) and a tenant
section (get / update_tenant, for reading and updating this company's settings), plus
a `LastAdminError` that the users section raises if an update would remove the
company's last remaining admin. As of the editable Hierarchy (2026-06-26) the
ScopedRepo also gained node-write methods (`get_node`, `create_node`, `update_node`,
`delete_node`) plus a `_slug_code` helper that turns a node's name into a unique
internal code; these power the admin-only add/rename/delete-node actions on the
Hierarchy screen, branch-scoped exactly like the rest of the org tree, and
`delete_node` refuses (rather than deletes) a node that still has children, anyone
pinned to it, assigned surveys, or responses.

### app/hierarchy.py  (the org-tree API)
Defines `GET /nodes`, which returns the slice of the org tree the caller is
allowed to see, using the ScopedRepo. This is the live proof the scope guard
works end to end. It also defines `GET /org-levels` (the company's level names
such as Region/District/Store, tenant-scoped, added in W7).

As of the editable Hierarchy (2026-06-26, the first slice toward the setup
wizard), this file also defines three admin-only, branch-scoped write endpoints
that let an admin edit the org tree from the Hierarchy screen, all through the
ScopedRepo and with no database change (the `nodes` table already existed):
- `POST /nodes` adds a child node under a given parent. The new child's level is
  set automatically from the parent (one level deeper, so a child of a Region
  becomes a District), its internal code is auto-generated and made unique from the
  name, and adding a child below the bottom Store level is refused with a 400 (a
  store is a leaf).
- `PATCH /nodes/{id}` renames a node and, for a store, edits its chain and address.
  The node's parent, level, and code are not editable.
- `DELETE /nodes/{id}` deletes a node, but only when it is empty (it has no child
  nodes, nobody is pinned to it, no surveys are assigned to it, and there are no
  responses). If it is not empty, the delete is refused with a 409 that names the
  blocker; a node outside the caller's branch is a 404.

### app/catalog.py  (the product catalog API)
Defines the product endpoints: `GET /skus` (any signed-in person in the company
can view) and `POST /skus` + `PATCH /skus/{id}` (admins only, guarded by
require_admin). All go through the ScopedRepo, so they only ever touch the
caller's own company's products.

### app/surveys.py  (the surveys API)
Defines the survey and assignment endpoints, all through the ScopedRepo. A
**survey** is a checklist a rep fills out in a store; its questions live in
frozen **versions**, and each question can carry a structured **pass rule**
("passes if 4 or more") and link to catalog products. Viewing
(`GET /surveys`, `GET /surveys/{id}`) is open to any signed-in person in the
company; authoring is admins only: `POST /surveys` (creates a draft),
`PATCH /surveys/{id}/versions/{vid}` (edit a draft, refused once published with
a 409), `POST /surveys/{id}/publish` (freeze it forever), `POST /surveys/{id}/versions`
(start a new draft from the latest, the way you "edit" a published survey), and
`POST /surveys/{id}/archive` (retire it, history kept). **Assignments** point a
published version at an org node: `POST /survey-assignments` and
`DELETE /survey-assignments/{id}` are allowed for admins anywhere and managers
within their own branch (guarded by require_manager_or_admin plus the scope
guard); `GET /survey-assignments` lists what is in your branch; and
`GET /survey-assignments/{id}/stores` returns the live list of stores the
assignment covers, computed from the node's tree path, so stores added later are
included automatically. Question and pass-rule shapes are checked on save, and a
question can never link to another company's product.

### app/responses.py  (the responses API)
Defines the endpoints for storing and reading reps' completed surveys. When a
rep finishes a survey in a store, `POST /responses` takes their answers and
saves them as a set of atomic rows, one row per product per question per
submission. Any signed-in user may submit, but only for a store inside their
own branch (the scope guard is enforced); the survey version must be published.
The endpoint checks each answer against the survey's shape (blanks are allowed
as "skipped", but an answer with the wrong shape gives a 400 error), then
writes every answer in one all-or-nothing operation. Each response also saves a
snapshot of the store's place in the org tree at that moment, so the history is
correct even if the store is moved later. Re-visits add a fresh row and never
overwrite the old one. `GET /responses` lists responses in the caller's branch
(with pass/fail worked out live); `GET /responses/{id}` returns one response in
full, same live scoring. All go through the ScopedRepo.

As of Phase 5-BE-a, `POST /responses` also accepts an optional `idempotency_key`
(a client-generated UUID, a "claim ticket" like a coat-check stub). If the same
ticket is sent twice, the second call returns the original response instead of
making a duplicate; sending no ticket behaves exactly as before. This is the
first piece of Phase 5 (the field phone + offline sync): when the phone is
offline a submission waits in a queue and is re-sent later, and the ticket keeps
a flaky re-send from creating a second copy.

### app/compliance.py  (the pure pass/fail evaluator)
Given a rep's answer and a question's pass rule, this module returns whether the
answer passes, fails, or was not counted (because it was blank). It has no
database and no side effects: it is a straightforward function that applies a
rule to a number or a list of choices. Supported operators: at-least (gte),
at-most (lte), exactly-equal (eq), at-least-N-choices (min_choices), and
at-most-N-choices (max_choices). The scope can be "each product" or "total
across all products". Blank answers are skipped rather than failed. Because
nothing is ever stored, changing a question's rule in the survey immediately
changes every score for every past response the next time they are read.

### app/payroll.py  (the payroll API)
Defines the payroll endpoints, gated by a per-company `payroll_enabled` switch
(a `require_payroll` check returns 403 for companies where payroll is off, such
as Acme in the demo). All endpoints also go through the standard wristband check.

- `POST /pay-periods` and `GET /pay-periods` let an admin create and list pay
  periods. Each period has a start date, end date, and a cutoff, and starts as
  "open." Only one open period per company at a time.
- `POST /time-entries` lets a rep log their own hours for a period: store
  minutes, reset minutes, drive minutes, and miles. A rep can only log for stores
  inside their own branch (the scope guard is enforced). As of Phase 5-BE-a it
  also accepts an optional `idempotency_key` (a client-generated UUID, the same
  "claim ticket" idea as on `POST /responses`): re-sending the same ticket
  returns the original entry instead of the usual "you already have an entry"
  409, while a genuinely different second entry still gets that 409, and sending
  no ticket behaves exactly as before. This is part of the first piece of Phase 5
  (the field phone + offline sync).
- `PATCH /time-entries/{id}` lets a rep edit their own entry, as long as the
  entry is not yet locked (sealed periods lock all entries).
- `POST /time-entries/{id}/approve` and `.../reject` let a manager or admin
  change the approval status of an entry within their branch.
- `POST /pay-periods/{id}/seal` locks every entry in the period. After sealing,
  no entry can be edited or re-approved. Seal is re-callable (running it twice is
  harmless), which makes the reopen-fix-re-seal cycle work cleanly.
- `POST /pay-periods/{id}/reopen` (admin only) unlocks one rep's entries in the
  period so they can be corrected. Every reopen is written to the audit log with
  the reason given.
- `GET /audit` lets an admin read the permanent logbook of sensitive payroll
  actions.

### app/analytics.py  (the read-only reports API)
Defines six read-only report endpoints, all branch-scoped through the
ScopedRepo. No new database tables were added; all numbers are computed live
from the existing response rows each time you ask.

- `GET /analytics/dashboard` is the one-call landing-page summary for the Admin
  dashboard (added in W1). It returns, for your part of the org: a footprint
  (how many nodes, stores, and pinned reps you can see); the headline compliance
  figures (completion % and pass % over the distinct set of store-by-survey
  obligations, so a store covered by two assignments of the same survey counts
  once, never twice); how many surveys were completed; how many are overdue (a
  past-deadline assignment whose stores still owe a response; a survey with no
  deadline is never overdue); an optional previous-period block (the same figures
  for the equal-length window just before your date range, so the screen can show
  an up/down delta); and a weekly completion trend (one point per ISO week, Monday
  start, in UTC). Pass an optional `node_id` to narrow to a sub-branch, and
  `date_from`/`date_to` to set the window. A node outside your scope returns 404;
  an unpinned caller gets an all-zero summary, never an error.
- `GET /analytics/compliance` answers "how compliant is each survey in this
  part of the org?" It returns, per survey version, how many stores were
  expected to respond, how many did (completion %), and of those scored, how
  many passed (pass %). An ancestor rule means a company-wide survey assigned
  at the company root still shows correctly when you look from a region: it
  measures only that region's own stores.
- `GET /analytics/compliance/drill` lets you step down the org tree for ONE
  survey version. At a region you see its districts and stores; at a single
  store you see the per-product reason each question failed.
- `GET /analytics/compliance/nodes` is the org-node version of compliance, and
  the one the dashboard's "Compliance by node" card uses (added with the
  region-drill rework). Instead of one row per survey, it returns one row per
  child node (the regions when you look from the company root), each rolled up
  ACROSS all surveys over the distinct store-by-survey obligations beneath it,
  so two overlapping assignments of the same survey never double-count. Pass a
  `node_id` to step down (region -> district -> store); at a store it returns the
  per-product reason each covering survey passed or failed. It takes the same
  `date_from`/`date_to` window as the dashboard, so the card and the headline
  "Avg. compliance" KPI always agree. A node outside your scope returns 404; an
  unpinned caller gets an empty list.
- `GET /analytics/oos` counts out-of-stock by product (a product is out of
  stock when a rep recorded a count of zero for it). It uses each store's most
  recent response, not all responses.
- `GET /analytics/trend` returns a product's shelf count over time (all
  responses, not just the latest), with a per-UTC-day average so you can see
  whether facings are improving or dropping.

### app/exports.py  (the export API)
Defines three read-only export endpoints that let a person, or a reporting tool,
get the field data out of the app, all branch-scoped through the ScopedRepo and
all using the same login wristband every other endpoint uses (so there is no new
sign-in and no new tables).

- `GET /export/responses` hands back the store survey answers, either one row
  per submission (the summary, with the live pass/fail verdict and a count of
  passed and failed questions) or one row per product per question (the per-SKU
  detail, with the raw answer and its own pass/fail), narrowed by date range,
  survey, chain, a spot on the org tree, and product.
- `GET /export/payroll` hands back the logged hours, one row per time entry,
  narrowed by pay period or date range or branch. It is gated by the per-company
  payroll switch (`require_payroll`, a 403 for companies where payroll is off)
  and role-scoped exactly like the payroll screens: a rep gets only their own
  hours, a manager their branch, an admin everything.
- `GET /export/compliance` hands back the same headline completion % and pass %
  numbers as the analytics dashboard, as a flat list of rows, so the export and
  the dashboard can never disagree.

Each address takes a `?format=` choice: `format=csv` streams a spreadsheet file
you can download, and `format=json` (the default) returns the same rows as data.
The CSV and the JSON are built from one shared column list per dataset, so they
always carry the same columns in the same order. Pass/fail is worked out live
through the one `compliance.py` brain, never stored, and "not scored" shows as a
blank cell, never a false. No new database tables: this only reads what Phases
4a, 4b, and 4c already store.

### app/users.py  (the team / users API)
Defines the endpoints behind the Admin "Users & Roles" screen, all through the
ScopedRepo, with no new database table (the people and pin tables already existed).
- `GET /users` returns the team list the caller is allowed to see, branch-scoped by
  the same "see only your branch" rule as everything else: a person who is pinned to
  a spot shows up when that spot is at or below the caller's own spot; a person with
  no pin shows only to a caller standing at the company root; a caller with no pin
  sees nobody (the safe default). Any signed-in person can read it.
- `POST /users` (admins only) adds a person and pins them in one step. The starting
  password the admin types is stored only as a scrambled one-way Argon2 hash, never
  as the real text. A duplicate email is refused with a 409; pinning to a node
  outside the caller's branch is refused with a 404. The pin itself is one row in the
  existing `assignments` table.
- `PATCH /users/{id}` (admins only) changes a person's role and/or moves or removes
  their pin. It has a "you cannot remove the last admin" safety guard so a company can
  never be left with nobody who can administer it (the guard raises a `LastAdminError`,
  turned into a clear refusal).
Deliberately deferred and noted honestly: real emailed invite links (this needs an
email system; for now the admin sets a starting password), enable/disable a person
(there is no status column yet), manager-scoped invites (admin-only for now), and
custom roles.

### app/tenants.py  (the company-settings API)
Defines the two endpoints behind the Admin "Settings" screen, through the ScopedRepo,
again with no new database table (the company table already had the name, the
permanent company code, and the payroll on/off switch).
- `GET /tenants` returns this company's settings (the name, the code, and whether
  payroll is switched on). Any signed-in person can read it.
- `PATCH /tenants` (admins only) updates the company name and/or the payroll on/off
  switch. The payroll switch genuinely controls whether the Payroll screen and its
  backend actions are available. The company code is permanent and cannot be edited.

### app/seed.py  (puts the demo data in)
Creates two demo companies and their org trees so you can log in and so the
isolation tests have a known world to check: "Lumen Beauty" (8 spots: regions,
districts, stores with CVS/Walmart labels) and "Acme Cosmetics" (4 spots, used
to prove one company cannot see another). It also creates the demo people and
pins each to a spot: `dana@lumenbeauty.com` (admin, sees all of Lumen),
`sarah@lumenbeauty.com` (manager at Central), `marcus@lumenbeauty.com` (rep at
Bay Area), `newbie@lumenbeauty.com` (no pin, sees nothing), and
`avery@acme.com` (admin of Acme). All use password `demo1234`. As of Phase 3a it
also seeds demo products: 4 for Lumen (Velvet Lip in three shades plus a Silk
Foundation) and 1 for Acme. As of Phase 3b it also seeds one demo survey per
company (Lumen's "Velvet Lip Shelf Check", published, with pass rules and a
product link, assigned to the Central region; Acme's "Glow Serum Check"), so the
survey tests have a known world. As of Phase 4a it also seeds one demo response
per company (a Lumen response for the SF store with a mix of passing and failing
answers, and an Acme response) so the response tests have a known baseline. As
of Phase 4b the seed was enriched with an out-of-stock answer at the Oakland
store and a dated SF response to give the trend report something to plot. As of
Phase 4c it also turns payroll on for Lumen (off for Acme), adds a rep pinned
to the Central region, and creates an open pay period with sample time entries,
so the payroll tests have a known world to check against. Safe to run twice. Run it with the command in START_HERE.md after the database is set
up.

### app/__init__.py  (a Python formality)
An empty file whose mere presence tells Python "treat this folder as one
bundle of code called `app`." You will basically never touch it.

### pyproject.toml  (the backend's shopping list)
Lists the outside libraries the backend needs (FastAPI, the database driver,
the password scrambler, and so on), with version numbers. A separate "dev"
list holds tools only used for testing. When the backend is built, these get
installed.

### Dockerfile  (the recipe to build the backend's box)
Docker runs the backend inside a clean, sealed "box" (a container) so it works
the same on every computer. This recipe says: start from Python 3.12, install
the shopping list, copy the `app/` code in, and start the waiter on door 8000.

### .dockerignore  (what to leave out of the box)
A short list of files Docker should not copy into the box (caches, junk),
keeping the box small and clean.

---

## How these files work together (the login, end to end)

1. `main.py` has the backend running and listening, with `auth.py`'s login
   desk plugged in.
2. A login request hits `auth.py`.
3. `auth.py` uses `db.py`'s connection to find the user, and `security.py` to
   check the password.
4. If good, `security.py` mints the wristband and `auth.py` sends it back.

That is the entire backend as it stands today. Future phases add more desks
(hierarchy, surveys, responses) following the same shape: a file per feature,
with `db.py` and `security.py` shared underneath.

---

## The backend's test robot (tests/)

The `tests/` folder holds the backend's automated checks (using pytest, the
standard Python test tool). They run against a throwaway copy of the database
so they never touch your real data. The most important ones are the isolation
checks in `test_scope_isolation.py` and `test_nodes_api.py`: they prove one
company sees zero of another, a manager sees zero of a sibling region, and a rep
sees only their own stores, both directly and through the real API. Run them
with `pnpm test:api` (the backend must be running). These are the mandatory gate
for Phase 2: nothing builds on top until they pass.

## A note on the database

This folder (the backend) does not define the SHAPE of the stored data. That
lives next door in `db/`. The backend reads and writes; `db/` decides what
tables and columns exist. See [../db/README.md](../db/README.md).
