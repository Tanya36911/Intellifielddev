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

**What's NEXT:** Phase 3b, surveys (with versioning and pass/fail rules).

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
│   │   └── seed.py      Creates the demo companies, tree, users, products
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

> Read START_HERE.md, CONTEXT.md, and CODEBASE_MAP.md in this repo first, then
> TECH_STACK.txt and Intelli_Complete_Handoff.md in the sibling ../hi-fi-intelli
> repo. Phases 0, 1, 2, and 3a are done (monorepo + Docker; login backend + Admin
> login screen; org hierarchy + the scope-follows-pin security guard; the product
> catalog), plus a config-hardening pass and a DB-script-hardening pass. The next
> task is Phase 3b: surveys, with immutable versions, survey assignments to org
> nodes, and structured pass/fail conditions (see handoff PART 6). My name is
> Tanya. Always address me as Tanya, explain everything in plain non-coder terms,
> design and let me approve before building, build test-first, commit to git after
> each change, no em dashes, and keep all the docs updated (START_HERE.md,
> CONTEXT.md, CODEBASE_MAP.md, the per-folder READMEs, and the handoff CHANGELOG).

That paragraph hands the new chat: where the docs are, what's done, what's next,
and how you like to work. With it plus these files, a fresh chat picks up right
where we left off. (Your working preferences are also saved in the assistant's
project memory, so a new chat in this folder already knows them.)

---

## 7. Where we are right now
- Backend login + Admin login screen: DONE and tested.
- Org hierarchy + "see only your branch" scope guard: DONE and tested.
- Product catalog (company-wide to view, admin-only to edit): DONE and tested
  (backend robot green: 29 backend checks, plus 27 frontend checks).
- Phases 1, 2, and 3a complete. NEXT: Phase 3b (surveys + versions + pass rules).
- Secrets are now read from a local `.env` file (never committed) through one
  config file; the code has no weak built-in fallbacks. Remaining pre-launch
  step: in production, set a fresh long random `JWT_SECRET` and database password
  in the real environment (the values in `.env` are dev-only).
- Everything is committed to git, so any step can be undone.
