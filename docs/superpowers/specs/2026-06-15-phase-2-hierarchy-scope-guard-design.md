# Phase 2: the org hierarchy + the scope guard (the written-down plan)

Approved in design by Tanya on 2026-06-15. This is the security-critical phase.
The handoff calls it "the hard one" and sets a hard rule: nothing gets built on
top until the isolation tests pass. Plain-English throughout, because Tanya
reads this; technical names are explained where they appear.

## The goal, in one paragraph

Give every company an org chart (a tree), pin each person to one spot on it,
and guarantee that a person can only ever see their own spot and everything
below it: nothing to the side, nothing above, and nothing belonging to another
company. This rule is called "scope follows the pin." It is enforced in one
shared place in the backend so no future screen can forget it.

## The picture (the example we build and test against)

```
LUMEN BEAUTY (a company / tenant)            ACME COSMETICS (another tenant)
|-- West (region)                            |-- East (region)
|   |-- Bay Area (district)                  |   |-- Boston (district)
|       |-- SF store        [chain: CVS]     |       |-- Boston store [chain: CVS]
|       |-- Oakland store   [chain: Walmart]
|-- Central (region)
    |-- Chicago (district)
        |-- Chicago store   [chain: CVS]
```

People and where they are pinned:
- **Dana** (admin, Lumen), pinned at the top of Lumen. Sees all of Lumen. Sees
  nothing of Acme.
- **Sarah** (manager, Lumen), pinned at **Central**. Sees Central and the
  Chicago store. Sees nothing in West.
- **Marcus** (rep, Lumen), pinned at **Bay Area**. Sees only the SF and Oakland
  stores.
- **An Acme admin**, pinned at the top of Acme. Sees only Acme.

## Decisions made with Tanya (2026-06-15)

1. **Chain is a label on a store, not a second org chart.** Every store has one
   home in the company tree (its location and who manages it) and also carries a
   chain badge (CVS, Walmart, Target, Walgreens). You can view and target stores
   by chain across the whole company by filtering on that badge. Assigning
   PEOPLE by chain (a "CVS account manager" who sees all CVS everywhere) is a
   separate, bigger change deliberately left for a later phase, because a second
   parallel tree complicates the very security rule this phase exists to make
   airtight.
2. **The guard looks up your pin fresh on every request.** So moving someone in
   the org chart takes effect immediately, with no need to log out and back in.
3. **The rule is enforced in the app code now** (the handoff's required Layer
   A). An optional deeper database-level lock (Postgres Row-Level Security,
   "Layer B") is noted for later, before real client data lands.
4. **This phase is invisible.** No new screen. The proof it works is the tests
   going green. Screens for viewing and editing the org chart come later.

## What gets built

### Three new database tables (the org chart's storage)

All three carry `tenant_id` (which company they belong to), because uniqueness
and visibility are always per-company, never global.

**org_level_definitions** (the names of the levels, configurable per company):
- `id`, `tenant_id`, `level_order` (0 at the top and increasing downward),
  `name` (for example Company, Region, District, Store), `locked` (the top and
  bottom levels are locked once nodes exist).
- Unique per company on `(tenant_id, level_order)`.

**nodes** (the tree itself, one row per spot):
- `id`, `tenant_id`, `parent_id` (which node sits above this one; empty for the
  top), `level_order` (which level this node is), `name`, `code`.
- `path`: a "materialized path", a plain text trail of ids from the top down to
  this node, like `/<id-of-lumen>/<id-of-central>/<id-of-chicago>/`. Each path
  starts and ends with a slash. This one column is what makes "everything under
  here" a single fast lookup: the subtree of a node X is every row whose path
  starts with X's path. The slashes stop a short id from accidentally matching a
  longer one.
- Store-only columns (empty on non-store nodes): `chain`, `address`, `lat`,
  `lng`, `tz`.
- Indexes from day one: an index on `path` tuned for "starts-with" lookups
  (text_pattern_ops, so the database actually uses it for `LIKE 'prefix%'`), and
  one on `(tenant_id, parent_id)` for walking the tree.

**assignments** (the pin: who sits where):
- `id`, `tenant_id`, `user_id` (which person), `node_id` (which spot).
- One pin per person in v1 (`unique (tenant_id, user_id)`). The person's role
  (admin / manager / rep) already lives on the users table from Phase 1 and is
  carried in the login wristband, so it is not duplicated here.
- An admin is simply pinned at the top node, so their subtree is the whole
  company. A person with no pin sees nothing (the safe default).

### The scope guard (the heart of this phase)

A single shared checkpoint that every data request passes through. In FastAPI
this is a "dependency" (a piece of code that runs before the actual handler).
It lives in a new file `api/app/scope.py` and does three things:
1. Reads and verifies the login wristband (the JWT) from the request, getting
   the `user_id` and `tenant_id`. (This needs a small "who is calling" helper,
   added alongside the existing token code in `security.py`.)
2. Looks up that user's pin to get their `scope_path` (the path of their pinned
   node). No pin means an empty scope, which means zero rows.
3. Hands back a **ScopedRepo**: the one and only object allowed to query the
   scoped tables. Every query it runs automatically gets
   `WHERE tenant_id = :me AND path LIKE :scope_path || '%'` glued on. Endpoints
   never write that filter themselves, so they cannot forget it.

### A first scoped address (to prove the guard works through the real API)

`GET /nodes`: returns the slice of the tree the caller is allowed to see, using
the ScopedRepo. This is the live proof that the guard holds end to end, not just
in isolated code. A new router file `api/app/hierarchy.py` owns it.

### Demo data (so the tests have something real to check)

Extend the seed to build the two-company example above: both tenants, their
level definitions, the full node trees with chain badges on the stores, the four
people (Dana, Sarah, Marcus, an Acme admin), and their pins. Safe to run twice.

### The mandatory tests (THE GATE)

The backend has no automated tests yet (only the frontend does), so this phase
also sets up the backend's own test robot: **pytest** (the standard Python test
tool) with **httpx** (to call the API in tests), running against a **throwaway
test database** in Docker, never against your real data and never against a fake
database (the handoff requires a real Postgres so the path lookups behave
exactly as in production). You run it with one command and see green or red,
just like the frontend robot.

The gate, the checks that must pass before anything builds on Phase 2:
- (a) **Company isolation:** the Acme admin sees zero Lumen rows, and Dana sees
  zero Acme rows.
- (b) **Sibling isolation:** Sarah (pinned at Central) sees zero West rows. She
  sees Central and the Chicago store, and nothing from West / Bay Area / the SF
  or Oakland stores.
- (c) **Rep isolation:** Marcus (pinned at Bay Area) sees only the SF and
  Oakland stores, nothing in Central.
- (d) **Admin reach:** Dana (pinned at the Lumen top) sees every Lumen node.
- (e) **No pin, no rows:** a user with no assignment sees nothing.
- Each of (a) to (e) is checked twice: once directly on the ScopedRepo, and once
  through the real `GET /nodes` API with that user's wristband.

Following test-first discipline, these are written and made to FAIL first
(proving they really test something), then the code is written to make them
pass.

## The new and changed files

- `db/migrations/<timestamp>_create_hierarchy.sql`: creates the three tables and
  their indexes (with an undo section).
- `api/app/scope.py`: the scope guard dependency + the ScopedRepo (new).
- `api/app/hierarchy.py`: the `GET /nodes` router (new).
- `api/app/security.py`: add a small "who is calling" helper that verifies the
  wristband on an incoming request (modify).
- `api/app/main.py`: plug in the hierarchy router (modify).
- `api/app/seed.py`: extend with the two-company demo tree, people, and pins
  (modify).
- `api/tests/` : the pytest harness and the isolation tests (new), plus a
  `conftest.py` that prepares the throwaway test database.
- `api/pyproject.toml`: already lists pytest + httpx under dev; wire them so they
  are available when testing (modify if needed).
- Docs updated in the same breath: `api/README.md`, `db/README.md`,
  `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md` (add the backend test command),
  `START_HERE.md`, `CONTEXT.md`, and the prototype handoff CHANGELOG.

## Deliberately NOT in this phase (so nothing is silently missing)

- **Chain-based assignment** (a parallel chain org chart / matrix reporting):
  documented future phase, per the decision above and handoff PART 8.
- **Screens** to view or edit the org chart: a later frontend phase. This phase
  is backend only.
- **Re-parenting** (moving a node and rewriting its subtree's paths): the model
  supports it; the admin action and its audit log come with the hierarchy UI.
- **Postgres Row-Level Security (Layer B):** optional deeper lock, noted for
  before real client data lands; the app-layer guard is the v1 requirement.
- **Catalog, surveys, responses:** Phases 3 and 4.

## How we will know it is done

All five isolation checks green (both directly and through the API), the full
backend and frontend test runs green, the live `GET /nodes` returns correctly
scoped results for each demo user, and all the guides updated.
