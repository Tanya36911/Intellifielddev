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

### schema.sql
An automatically-generated snapshot of what the pantry looks like right now,
after all migrations have been applied. You do not edit this by hand; dbmate
rewrites it whenever a new migration runs. It is handy for seeing the current
shape at a glance and for setting up a fresh database fast.

---

## How to apply changes

From START_HERE.md's cheat sheet:

- Apply pending migrations: `docker compose run --rm migrate up`
- (Re)create the demo company + user afterwards:
  `docker compose exec api python -m app.seed`

---

## What comes later

Phase 2 (hierarchy + scope guard) and Phase 3a (the product catalog, the third
migration above) are now built. Phase 3b adds surveys, which means new migrations
here (surveys, survey_versions, survey_assignments) and new rules in the backend.
Each new table arrives as its own numbered migration file, and this README gets a
new entry describing it.
