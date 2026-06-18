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
| `apps/admin/` | FRONTEND | The Admin dining room: the React screens brand HQ uses (login is built). Full guide: [apps/admin/README.md](apps/admin/README.md). |
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
