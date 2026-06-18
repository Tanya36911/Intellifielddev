# Phase 5-BE-a: idempotency keys for safe re-submission design

Approved in design by Tanya on 2026-06-18. Phase 5 (Field mobile app + offline
sync) is large, so it is split into a backend sync-contract track (5-BE-a
idempotency keys, 5-BE-b batch sync, 5-BE-c photo storage) and a mobile-app track
(5-M-a Expo skeleton through 5-M-d the offline DB + sync engine). This is the
first piece, **5-BE-a: idempotency keys**, a small backend-only step in the same
pattern as 3a/3b/4a..4d. Plain-English throughout.

## The goal, in one paragraph

Make re-sending a queued submission safe. When the Field phone is offline a rep's
survey submission or hours entry waits in a queue and is sent later; if the signal
flickers mid-send the phone cannot be sure the server received it, so it re-sends.
Without protection that re-send creates a **duplicate** (a second identical survey,
double-counted hours). 5-BE-a gives each submission a one-time **claim ticket** (a
client-generated UUID, like a coat-check stub): the server records the ticket on
the first write, and a later write carrying the same ticket returns the original
result instead of filing a second copy. The gate: the same submission sent twice
with one ticket creates exactly one row and returns the same result both times,
while a submission with no ticket behaves exactly as today.

## How 5-BE-a fits Phase 5

- **5-BE-a (this):** idempotency keys on the two rep submit endpoints. The safety
  primitive the offline queue depends on.
- **5-BE-b:** batch pull/push sync endpoints (carry these keys per item).
- **5-BE-c:** object storage (MinIO) + resumable photo upload.
- **5-M-a..d:** the Expo mobile app, ending with the on-device DB + sync engine.

## Decisions made with Tanya (2026-06-18, Tanya delegated the calls)

1. **Tickets only on the two rep submit endpoints** that get queued offline:
   `POST /responses` (survey submissions) and `POST /time-entries` (hours).
   Admin/manager actions (survey authoring, assignments, pay-period create/seal)
   are done online from the web and are out of scope for offline replay, so they
   get no ticket in v1.
2. **The ticket is optional (nullable), so the change is backward-compatible.**
   The phone always sends one; the existing Admin web app and the current tests
   send nothing and keep working unchanged (no ticket means "no dedup, insert as
   today"). This is what makes 5-BE-a zero-risk to everything already live.
3. **A repeated ticket returns the ORIGINAL result, never a duplicate**, with a
   200. No strict "did the re-send carry different data" (payload-hash) check in
   v1: tickets are unique UUIDs the phone pairs with one fixed submission, so a
   key-with-different-data collision is effectively impossible; noted as a later
   refinement, not built now.
4. **For hours, the ticket short-circuits BEFORE the existing "you already have an
   entry" error.** A re-sent create (same ticket) returns the original entry
   (200); a genuinely different second entry for the same (period, rep) with no
   matching ticket still gets the existing 409. Edits go through `PATCH`, which is
   out of scope here (the sync engine handles update idempotency by entry id).
5. **The ticket is unique per company** (`(tenant_id, idempotency_key)`), matching
   the repo convention that uniqueness is always per tenant. A client-generated
   UUID is globally unique anyway; the tenant scoping also means one company's
   ticket can never resolve to another company's row.
6. **The ticket lives on the parent rows only** (`responses`, `time_entries`), not
   on `response_items`. A response and its atomic items are written together in
   one transaction, so the response is the unit of idempotency; its items ride
   along.

## What gets built

### One migration
A new migration `db/migrations/20260618000001_add_idempotency_keys.sql` in the
same self-protecting format as the others (`-- migrate:up transaction:false`,
explicit `begin;`/`commit;`, `set local timezone='UTC';`, and a matching
`-- migrate:down`):
- `alter table responses add column idempotency_key uuid;`
- `alter table time_entries add column idempotency_key uuid;`
- A **partial unique index** on each so only real (non-null) tickets are deduped
  and the many existing/unkeyed rows (all NULL) are unaffected:
  `create unique index responses_tenant_idem_key on responses (tenant_id,
  idempotency_key) where idempotency_key is not null;` and the equivalent
  `time_entries_tenant_idem_key`.
- Adding a nullable column to existing tables leaves current rows as NULL (no
  backfill needed). The `down` drops the two indexes and the two columns.
- Regenerate the `db/schema.sql` snapshot after applying the migration (the
  snapshot is the auto-generated picture of the current shape).

### The submit endpoints learn an optional ticket
- `api/app/responses.py`: `ResponseCreate` gains `idempotency_key: UUID | None =
  None`; `POST /responses` passes it through to the repo. Nothing else about the
  endpoint changes (same validation, same scope, same 400/404).
- `api/app/payroll.py`: `TimeEntryCreate` gains `idempotency_key: UUID | None =
  None`; `POST /time-entries` passes it through. The `require_payroll` 403 gate
  and the rest are unchanged.

### The scope guard learns the check-then-insert-or-return step
`api/app/scope.py` (the single object allowed to touch scoped tables):
- `create_response(survey_version_id, store_node_id, answers, user_id,
  idempotency_key=None)`: if `idempotency_key` is given, first look up an existing
  response in this tenant with that key; if found, return `get_response(existing
  id)` (the original, re-scored live, same shape as a fresh create). Otherwise
  insert as today, writing the key into the new column. The partial unique index
  is the hard backstop against a duplicate.
- `create_time_entry(period_id, user_id, fields, idempotency_key=None)`: if
  `idempotency_key` is given and matches an existing entry in this tenant, return
  that entry (200), short-circuiting before the sealed-period and
  already-have-an-entry checks. Otherwise run today's logic (sealed -> 409, an
  existing (period, rep) entry without a matching ticket -> 409) and write the key
  on insert.
- Both follow the existing pre-check pattern (as `create_time_entry` already does
  for `EntryExistsError`); the partial unique index guarantees no duplicate row
  even if two identical sends ever raced. A concurrent double-send from one rep is
  out of scope for v1 (a single phone sends its queue sequentially).

### Demo data
No seed change needed. The seed's existing responses and time entries simply have
a NULL ticket (the pre-idempotency, web-style path), which is exactly the
backward-compatible behavior. Tests create their own keyed submissions.

### The tests (the gate for 5-BE-a)
A new `api/tests/test_idempotency.py` (through the API, same harness as the rest):
- **Responses, headline:** submit the same survey twice with one ticket -> the
  same `response_id` and identical body both times, and exactly one row exists in
  the database for that ticket.
- **No ticket is unchanged:** submitting the same survey twice with no ticket
  creates two different responses (today's behavior, re-visits retained).
- **Cross-company isolation of the ticket:** the same ticket value used by two
  different companies does not collide; each company gets its own row, and one
  company never receives the other's row.
- **A keyed first submit still scopes and validates:** an out-of-scope store still
  returns 404 and a bad answer shape still returns 400 on the first call (the
  ticket does not bypass any existing rule).
- **Hours, replay returns the original (not 409):** `POST /time-entries` twice
  with one ticket returns the same entry both times; a second, different create
  for the same (period, rep) with no matching ticket still returns 409; a
  payroll-off company still returns 403.
- **The unique index holds:** two responses (or entries) cannot carry the same
  (tenant, ticket) (covered through the endpoint replay behavior; the index is the
  backstop).
- The full backend suite plus the existing 27 frontend checks stay green.

## The new and changed files
- `db/migrations/20260618000001_add_idempotency_keys.sql` - the two columns + two
  partial unique indexes (with undo). New.
- `db/schema.sql` - regenerated snapshot. Modify.
- `api/app/responses.py` - `idempotency_key` on `ResponseCreate` + passthrough.
  Modify.
- `api/app/payroll.py` - `idempotency_key` on `TimeEntryCreate` + passthrough.
  Modify.
- `api/app/scope.py` - `create_response` and `create_time_entry` learn the
  optional ticket (check-then-insert-or-return). Modify.
- `api/tests/test_idempotency.py` - the tests above. New.
- Docs updated in the same breath: `api/README.md`, `db/README.md`,
  `CODEBASE_MAP.md`, `START_HERE.md`, `CONTEXT.md` (record Phase 5 underway and the
  sub-phase breakdown), and the prototype handoff CHANGELOG.

## Deliberately NOT in Phase 5-BE-a (so nothing is silently missing)
- **Batch pull/push sync endpoints:** 5-BE-b. This step only adds the ticket to
  the existing one-at-a-time submit endpoints.
- **Object storage + resumable photo upload:** 5-BE-c.
- **Idempotency on edits/updates (`PATCH /time-entries`, future response edits):**
  the sync engine (5-M-d) keys updates by the row id; this step covers the two
  creates.
- **Strict payload-hash conflict detection** (same ticket, different data -> 409):
  deferred per decision 3; effectively impossible with client UUIDs.
- **Any mobile / Expo code and any screen:** the mobile track (5-M-*).
- **A sync cursor / per-device last-modified tracking:** that belongs with the
  batch pull endpoint (5-BE-b).

## How we will know 5-BE-a is done
The idempotency tests are green (same ticket twice -> one row, same result; no
ticket -> two rows; cross-company tickets do not collide; a keyed first submit
still respects scope and validation; a re-sent hours entry returns the original
not a 409), the full backend suite and the 27 frontend checks stay green, a live
check (submit a response twice with the same ticket through `/docs` and see one
row) behaves as described, and all guides are updated.
