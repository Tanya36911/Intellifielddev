# Phase 4c: payroll (periods, hours, seal + logged reopen, audit) design

Approved in design by Tanya on 2026-06-17. Phase 4 is split into 4a responses /
4b analytics / 4c payroll / 4d export. 4a and 4b are done; this is **Phase 4c,
the payroll engine**: pay periods, reps logging hours, manager approval, the
seal-at-cutoff lock, the audit-logged reopen, and the audit log. Backend only,
no screen yet (same shape as 3a/3b/4a/4b). Plain-English throughout.

## The goal, in one paragraph

Let a company run its field payroll: an admin opens a **pay period**, reps **log
their hours** against it (store, reset, drive minutes, miles), managers
**approve** their branch's hours, and at the cutoff the admin **seals** the
period so the numbers can't be quietly changed. The one escape hatch is a
deliberate, **audit-logged reopen of a single rep's hours**. Everything is
company- and branch-scoped through the existing guard, and payroll is a
per-company on/off switch. The gate: a sealed period is immutable except via a
logged reopen, and that reopen unlocks exactly one rep.

## Decisions made with Tanya (2026-06-17)

1. **Whole payroll in one 4c.** Pay periods + time entries + manager approval +
   seal + logged reopen + audit log. The seal/reopen lock is the point of payroll
   and needs entries to act on, so splitting would leave a half-feature.
   (Tanya delegated the sizing; this is the chosen call.)
2. **Roles: admin owns the lock; managers approve; reps log their own.** Admins
   (company HQ) create periods, seal them, and do the reopen-for-one-rep.
   Managers approve/reject their own branch's reps' hours while a period is open.
   Reps log and edit their own hours. (Tanya delegated; chosen because periods
   are company-wide so they are an HQ function, and the money-touching reopen is
   best kept narrow with HQ.)
3. **A pay period is company-wide; hours are per-person.** One set of periods per
   company (like the catalog/surveys, tenant-filtered). One time entry per
   (period, rep), holding that rep's totals for the period.
4. **The per-entry `sealed` flag is the single source of truth for the lock.**
   Sealing a period sets every entry's flag locked; reopening one rep clears just
   that rep's flag; a re-seal locks all again. "Can this entry be edited" =
   "entry not locked." (Chosen over a period-only status so reopen can free one
   rep without unlocking the whole period.)
5. **Reopen is always per-rep and always audit-logged** (PART 7). Admin gives the
   period + the rep + a reason; that rep's entries unlock; an audit row records
   who/when/why. The rest of the period stays locked.
6. **Manual seal in v1; the cutoff clock is deferred.** The cutoff time, grace
   hours, and lock behavior are *stored* as the period's policy, but sealing is a
   deliberate admin action. An automatic "seal itself at the cutoff" background
   job needs a scheduler and is a separate later concern.
7. **Payroll is a per-company switch, enforced.** A `payroll_enabled` flag on the
   company; payroll endpoints refuse with 403 when it is off. Seed turns it on
   for Lumen and off for Acme, so the switch is provable.

## What gets built

### Three new tables + one new column (one migration)

Same self-protecting format as the other migrations (`transaction:false`,
explicit `begin;`/`commit;`, `set local timezone='UTC';`, up and down).

**`pay_periods`** (company-wide)
- `id`, `tenant_id`.
- `name` (optional label, e.g. "June 1-15").
- `start_date`, `end_date` (the period's date range).
- `cutoff_at` (timestamptz; when it is meant to seal), `timezone_basis` (text,
  nullable; how the cutoff is read), `grace_hours` (int, default 0),
  `lock_behavior` (text, default `'manual'`).
- `status` (`open` / `sealed`, default `open`), `sealed_at` (timestamptz, null
  until sealed), `created_at`.
- Index on `tenant_id`.

**`time_entries`** (one row per period per rep)
- `id`, `tenant_id` (denormalized for the tenant filter), `period_id`
  (fk pay_periods), `user_id` (fk users).
- `store_min`, `reset_min`, `drive_min` (ints, default 0), `miles` (numeric,
  default 0).
- `mgr_status` (`pending` / `approved` / `rejected`, default `pending`).
- `sealed` (boolean, default false; **the lock flag**).
- `created_at`.
- `unique (period_id, user_id)` (one entry per rep per period). Indexes on
  `tenant_id`, `period_id`, `user_id`.

**`audit`** (the permanent logbook)
- `id`, `tenant_id`, `actor_user_id` (fk users), `action` (text, e.g.
  `pay_period.created` / `pay_period.sealed` / `pay_period.reopened`), `target`
  (text, the affected ids), `detail` (jsonb: reason, counts), `at` (timestamptz,
  default now). Index on `(tenant_id, at)`.

**`tenants` gains `payroll_enabled boolean not null default false`** (the switch).

### The company switch (a new dependency)
A `require_payroll` FastAPI dependency reads the caller's company
`payroll_enabled` and raises **403** when off. It is applied to every payroll
endpoint. (Defined in `payroll.py`, since it needs a DB read; it composes with
the role dependencies.)

### The lock mechanics (the gate)
- **Open period:** a rep creates/edits their own entry; a manager approves or
  rejects entries in their branch. Editable = the entry's `sealed` flag is false.
- **Seal** (admin): mark the period `status = sealed` (stamping `sealed_at` the
  first time) and set every entry's `sealed = true`. Write one `pay_period.sealed`
  audit row. **Seal is re-callable:** calling it again after a reopen re-locks the
  reopened rep (a re-seal), and each seal writes its own audit row. This is what
  makes the reopen -> fix -> re-seal cycle work; there is deliberately no
  "already sealed" error.
- **After seal:** editing hours or changing approval on a locked entry is refused
  (409). No new entries for a sealed period.
- **Reopen one rep** (admin): the period must be sealed; set that one rep's
  entries in the period `sealed = false`; write one `pay_period.reopened` audit
  row (target = period + user, detail = reason). The period stays sealed; only
  that rep's entries are editable until a re-seal locks them again. A reopen for a
  rep with no entries in the period is a 404.

### The scope guard learns payroll
The shared `ScopedRepo` (`api/app/scope.py`) gains a clearly-marked **payroll**
section. Periods are company-wide (tenant-filtered, like surveys). Time entries
are scoped role-aware:
- a **rep** sees only their own entries (`user_id = caller`);
- a **manager/admin** sees entries for reps whose pinned node is within the
  caller's scope (join entry -> user -> the user's pin -> node path, filter
  `path like scope_path || '%'`), so a manager never sees a sibling branch's
  hours and an admin (root scope) sees all.

Audit writes go through one small `_audit(...)` helper so every logged action is
recorded the same way. New lifecycle exceptions (period sealed / not sealed /
already sealed / entry exists) mirror the survey-version exception pattern.

Internal note: `scope.py` is already large (~900 lines). 4c adds the payroll
section there for consistency with the single-gateway rule, and **flags splitting
the repo by concern (catalog / surveys / responses / analytics / payroll) as the
next cleanup**, rather than expanding the change now.

### The web addresses (a new router, `api/app/payroll.py`)
All require `require_payroll` (403 if the company has payroll off):
- `POST /pay-periods` (admin) - create a period; writes a `pay_period.created`
  audit row. `GET /pay-periods` (any company user) - list the company's periods.
- `POST /pay-periods/{id}/seal` (admin) - seal / re-seal (re-callable; re-locks
  any reopened entries, writes an audit row each time).
- `POST /pay-periods/{id}/reopen` (admin) - body `{user_id, reason}`; 409 if the
  period is not sealed, 404 if that rep has no entries in it.
- `GET /pay-periods/{id}/entries` (scoped: rep -> own, manager -> branch, admin
  -> all).
- `POST /time-entries` (rep) - create the caller's entry for an **open** period
  (409 if the period is sealed or an entry already exists). Body: period_id +
  the minute/miles fields. user comes from the wristband, never the body.
- `PATCH /time-entries/{id}` (the owning rep) - edit the minute/miles fields;
  409 if the entry is locked.
- `POST /time-entries/{id}/approve` and `/reject` (manager or admin, in branch) -
  set `mgr_status`; 409 if the entry is locked; 404 if out of the caller's scope.
- `GET /audit` (admin) - the company's audit log, newest first.

### Demo data (so the endpoints have something real)
Seed (idempotent): set `payroll_enabled` on for Lumen, off for Acme. Add a rep
**pinned under Central** (e.g. `rico@lumenbeauty.com` at the Chicago store) so
that manager-approval scope is testable: Sarah (Central) can approve Rico but not
Marcus (Bay Area/West). Add one **open** Lumen pay period with a time entry or
two (Marcus, and Rico), so logging/approval/seal can be exercised live. No sealed
period is seeded (the seal/reopen flow is covered by the tests and the live
walk-through). Acme gets no period (payroll off).

### The tests (the gate for 4c)
- **Lock is real (headline):** seal a period -> editing an entry's hours is 409,
  approving is 409, creating a new entry is 409.
- **Logged reopen unlocks exactly one rep:** after seal, reopen rep A -> A's entry
  is editable again, rep B's stays locked; a `pay_period.reopened` audit row
  exists with the reason; re-seal locks A again.
- **Audit log:** create + seal + reopen each write an audit row visible via
  `GET /audit`; the log is admin-only and company-scoped.
- **The switch:** an Acme user (payroll off) gets 403 on every payroll endpoint;
  a Lumen user does not.
- **Roles:** a rep cannot create/seal/reopen a period (403); a rep cannot edit
  another rep's entry (404/403); a manager can approve a branch rep's entry but
  not a sibling branch's (404); only the owning rep edits their own hours.
- **Scope isolation:** a manager sees their branch's entries only; another
  company's entries never appear; a rep sees only their own.
- **Manual-seal boundary:** creating a period leaves it `open` (no auto-seal);
  cutoff/grace/lock_behavior are stored but do not auto-act.
- Full backend + the 27 frontend checks stay green.

## The new and changed files
- `db/migrations/<timestamp>_create_payroll.sql`: the three tables + the
  `tenants.payroll_enabled` column (with undo). New.
- `api/app/payroll.py`: the payroll router, its Pydantic models, and the
  `require_payroll` dependency. New.
- `api/app/scope.py`: add the payroll section to `ScopedRepo` (+ the lifecycle
  exceptions + the `_audit` helper). Modify.
- `api/app/main.py`: mount the payroll router. Modify.
- `api/app/seed.py`: set the switch + seed a Lumen open period and entries.
  Modify.
- `api/tests/test_payroll.py`: the tests above. New.
- Docs updated in the same breath: `api/README.md`, `db/README.md`,
  `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`, and
  the prototype handoff CHANGELOG.

## Deliberately NOT in Phase 4c (so nothing is silently missing)
- **Payroll export (CSV / read API):** Phase 4d.
- **The auto-seal cutoff clock:** stored as policy, but no scheduler in v1.
- **Manager editing a rep's hours on their behalf:** reps edit their own; a
  manager-correction flow is a later option (reopen + the rep fixes is the v1
  path, or a future "manager edit" with its own audit entry).
- **Adding brand-new entries into an already-sealed period:** reopen corrects
  existing entries (the real need); a sealed period accepts no new entries.
- **Pay rates / dollar amounts:** v1 records hours and miles only; converting to
  money (rates, overtime rules) is out of scope.
- **Auditing routine approvals:** the audit log captures the sensitive lock
  actions (create / seal / reopen); approve/reject are routine and are not
  audited in v1.
- **Auto-resetting approval when reopened hours are edited:** if an approved
  entry is reopened and its hours change, v1 does NOT auto-flip `mgr_status` back
  to pending; the manager re-approves while it is unlocked. (A future integrity
  rule could invalidate the approval on edit; noted, not built.)
- **Screens:** a later phase.

## How we will know 4c is done
All payroll tests green (the lock is real, the logged reopen unlocks exactly one
rep, the audit log records create/seal/reopen, the company switch blocks a
payroll-off company, role + scope isolation, manual-seal boundary), the full
backend and frontend runs still green, a live walk-through (turn payroll on,
open a period, log + approve hours, seal, try to edit and get refused, reopen one
rep with a reason, edit, re-seal, read the audit log) behaves as described, and
all guides updated.
