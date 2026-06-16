# The DATABASE shape (db/)

The database is the app's permanent memory (PostgreSQL). This folder does not
hold the data itself; it holds the **instructions for the data's shape**: which
tables exist and what columns they have. The real data lives inside the running
database.

---

## What "migrations" are (the key idea)

You never change the database by hand. Instead you write a small numbered
change-file called a **migration**, and a tool applies it. Think of migrations
as a stack of dated renovation orders for the pantry: "add a shelf called
tenants", "add a shelf called users". Because they are numbered and saved in
git, anyone can rebuild the exact same pantry from scratch, and you always know
what changed and when.

We use a tool called **dbmate** to run them (chosen by the team; see
TECH_STACK.txt). Each migration has an "up" part (make the change) and a "down"
part (undo it).

### How dbmate runs them (no manual picking)
dbmate keeps a hidden list of which migrations have already been applied (a table
called `schema_migrations`). When you run "up", dbmate looks at the files,
compares them to that list, and applies only the new ones, in number order. So:
- You never choose which files to run; dbmate works it out.
- Running "up" again when nothing is new is a harmless no-op (it will not
  re-apply or double-create anything).
- It is the same one command everywhere: locally, and in a deploy script.

### The script-authoring standard (every migration self-protects)
Each migration file is written to be safe on its own, not just safe because
dbmate runs it:
- It starts with `-- migrate:up transaction:false`. This tells dbmate "do not
  add your own transaction, this file manages its own."
- It then does `begin;` ... `commit;` around the real work, so the whole file is
  all-or-nothing: if any one statement fails, nothing is left half-applied. This
  holds whether dbmate runs it or someone runs it by hand with psql.
- It sets `set local timezone = 'UTC';` at the top, so any time-based values are
  written in UTC. (For pure table-creation this is belt-and-suspenders; it
  matters for any future script that inserts data.)
- **Stop-on-error** is enforced by the runner, not a line in the file: dbmate
  aborts the transaction on the first error, the deploy script uses `set -e`, and
  a by-hand psql run should use `psql -v ON_ERROR_STOP=1`. (The psql `\set`
  command is not SQL and cannot live inside a dbmate file without breaking it.)

**Rule once you are in production:** never edit a migration that has already been
applied; add a new one. Editing an applied migration does not re-run it (dbmate
already recorded it as done), so the change would silently not take effect. We
only edited the existing files now because this is still pre-production and the
resulting tables are identical.

---

## Every file in this folder

### migrations/20260613000001_create_tenants_and_users.sql
The first renovation order. It creates the two tables Phase 1 needs:
- **tenants**: one row per company using Intelli (Lumen Beauty, Revlon, ...).
  Has an id, a name, a short code, and a created date. Everything in the whole
  system belongs to exactly one tenant.
- **users**: one row per person who can log in. Has an id, which tenant they
  belong to, their email, name, role (must be admin, manager, or rep), and
  their scrambled password. Email is unique PER company, not globally, so two
  different brands could each have their own "dana@...".

The long number at the front of the filename is just a timestamp, so the files
apply in the right order.

### migrations/20260615000001_create_hierarchy.sql
The second renovation order. It adds the org chart: **org_level_definitions**
(the level names per company, like Company / Region / District / Store),
**nodes** (the tree itself, each row carrying a "path" that makes "everything
under here" a fast lookup, plus store-only columns including chain), and
**assignments** (the pin: which user sits at which node). These are what the
scope guard reads to decide who can see what.

### migrations/20260615000002_create_skus.sql
The third renovation order. It adds **skus**, the product catalog: one row per
sellable variant (line, variant, UPC barcode, color, active/discontinued status,
and a list of reference photo links). Each product belongs to one company and is
unique per company by barcode. This is company-wide reference data (everyone in
the company sees all of it), unlike the org tree which is branch-scoped.

### migrations/20260616000001_create_surveys.sql
The fourth renovation order. It adds the three survey tables:
- **surveys**: one row per checklist (name, type, and a status of draft /
  published / archived). The identity of a survey; its questions live next door
  in versions.
- **survey_versions**: a frozen snapshot of a survey's questions (stored as
  JSON, including each question's pass rule and any product links). A blank
  `published_at` means it is still an editable draft; once stamped, the row is
  treated as frozen forever, so past results are never rewritten. Editing a
  published survey adds a new version rather than changing an old one.
- **survey_assignments**: points a published version at one org node, with an
  optional deadline. Which stores it covers is NOT stored here; it is computed
  live from the node's path, so a store added later is automatically included.

### schema.sql
An automatically-generated snapshot of what the pantry looks like right now,
after all migrations have been applied. You do not edit this by hand; dbmate
rewrites it whenever a new migration runs. It is handy for seeing the current
shape at a glance and for setting up a fresh database fast.

---

## How to apply changes

From START_HERE.md's cheat sheet:

- Apply pending migrations: `docker compose run --rm migrate up`
  (or the deploy-safe wrapper: `bash scripts/db-migrate.sh`, which adds
  stop-on-the-first-error and is the same command a deploy would use)
- (Re)create the demo company + user afterwards:
  `docker compose exec api python -m app.seed`

---

## What comes later

Phase 2 (hierarchy + scope guard), Phase 3a (the product catalog), and Phase 3b
(surveys, versions, assignments, the fourth migration above) are now built. The
next phase (responses + analytics) will add more tables here, for example one for
the answers reps submit. Each new table arrives as its own numbered migration
file, and this README gets a new entry describing it.
