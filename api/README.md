# The BACKEND, explained for a non-coder (api/)

You said you do not understand the backend at all. This file fixes that. No
coding knowledge assumed. Read it top to bottom once and the folder will make
sense.

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
- plugs in the login feature (from `auth.py`),
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
   back along with the person's name and role,
4. if wrong, replies "Invalid email or password" without saying which part was
   wrong (telling an attacker "the email exists but the password is wrong"
   would leak a hint, so we never do).

### app/security.py  (the safe and the wristband machine)
Four security jobs live here, kept separate from everything else on purpose. The
third, `current_claims` (added in Phase 2), verifies the caller's wristband on
each incoming request and is what the scope guard relies on. The fourth,
`require_admin` (added in Phase 3a), goes one step further and blocks anyone who
is not an admin with a "not allowed" (403); it guards the catalog write
endpoints. The first two:
- **Password scrambling.** Passwords are never stored as the real text. They
  are run through a one-way scrambler called Argon2. You can check a guess
  against the scramble, but you can never un-scramble it back to the password.
  So even if someone stole the whole database, they could not read anyone's
  password.
- **Wristbands (tokens).** After a correct login, it creates a signed token
  (a JWT) that says who you are, your tenant (company), and your role, and
  stamps it to expire in 12 hours. The signature means nobody can forge or
  tamper with one. Later requests show this wristband to prove who they are.

### app/db.py  (the phone line to the pantry)
Opens and holds the connection to the database, and offers a tiny "is the
database reachable?" check. Every other file that needs data borrows this
connection instead of opening its own. The database address is read from a
secret setting (so it can differ between your laptop and a real server).

### app/scope.py  (the scope guard: you only see your own branch)
The single checkpoint that keeps companies and branches separate. For any
request that reads org data, it reads the caller's wristband, looks up the node
they are pinned to, and hands back a ScopedRepo: the only object allowed to read
the scoped tables. Every query the ScopedRepo runs is automatically limited to
the caller's company and the part of the tree at or below their pin. Because the
filter lives only here, no screen can forget it. A person with no pin sees
nothing (the safe default). As of Phase 3a the ScopedRepo also lists, adds, and
edits catalog products, filtered by company only (the catalog is company-wide
reference data, not branch-scoped).

### app/hierarchy.py  (the org-tree API)
Defines `GET /nodes`, which returns the slice of the org tree the caller is
allowed to see, using the ScopedRepo. This is the live proof the scope guard
works end to end.

### app/catalog.py  (the product catalog API)
Defines the product endpoints: `GET /skus` (any signed-in person in the company
can view) and `POST /skus` + `PATCH /skus/{id}` (admins only, guarded by
require_admin). All go through the ScopedRepo, so they only ever touch the
caller's own company's products.

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
Foundation) and 1 for Acme. Safe to run twice. Run it with the command in
START_HERE.md after the database is set up.

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
