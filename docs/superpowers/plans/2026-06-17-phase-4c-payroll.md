# Phase 4c: Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company payroll engine: pay periods, reps logging hours, manager approval, an admin seal-at-cutoff lock, an audit-logged per-rep reopen, and an audit log, all behind a per-company payroll switch.

**Architecture:** Three new tables (`pay_periods`, `time_entries`, `audit`) plus a `payroll_enabled` column on `tenants`. A new `api/app/payroll.py` router exposes the endpoints and a `require_payroll` dependency (403 when off). The shared `ScopedRepo` (`api/app/scope.py`) gains a payroll section: periods are company-wide (tenant-filtered), time entries are role-aware-scoped (a rep sees own, a manager/admin sees reps whose pin is in scope). The per-entry `sealed` flag is the lock; seal is re-callable; reopen frees one rep and writes an audit row.

**Tech Stack:** FastAPI, SQLAlchemy Core (`text()` + `engine`), Pydantic v2, plain-SQL dbmate migrations, pytest against a throwaway Postgres.

---

## Conventions (read once)
- **Error codes:** malformed body -> 422 (Pydantic); business-rule (sealed, already-exists, not-sealed) -> 409; out-of-scope / not-found -> 404; wrong role -> 403; payroll disabled for the company -> 403.
- **UUID casting:** `cast(:x as uuid)` for text params vs uuid columns, as everywhere in `scope.py`.
- **Insertion point (scope.py):** new `ScopedRepo` methods go at the END of the class, after `facings_trend` (~line 864) and BEFORE the module-level `def _count_question`. New exception classes go beside the existing ones near the top (after `VersionNotPublishedError`). `json`, `text`, `engine` are already imported.
- **Apply code:** `docker compose restart api`. **Run tests:** `pnpm test:api` (stack up: `docker compose up -d`). Single file: `pnpm test:api -- tests/test_payroll.py`. **Reseed dev DB:** `docker compose exec api python -m app.seed`. **Migrate dev DB:** `bash scripts/db-migrate.sh` (or `docker compose --profile tools run --rm migrate up`).
- The pytest harness rebuilds the test DB from migrations + reseeds each session, so a new migration and seed are picked up automatically.
- Commit directly to `main`.

## File structure
| File | New/Modify | Responsibility |
|------|-----------|----------------|
| `db/migrations/20260617000001_create_payroll.sql` | Create | 3 tables + `tenants.payroll_enabled`. |
| `api/app/seed.py` | Modify | Turn payroll on for Lumen / off for Acme; add a Central rep (Rico); seed an open period + entries. |
| `api/app/payroll.py` | Create | The payroll router, Pydantic models, and `require_payroll`. |
| `api/app/scope.py` | Modify | Payroll section on `ScopedRepo` + lifecycle exceptions + `_audit` helper. |
| `api/app/main.py` | Modify | Mount the payroll router. |
| `api/tests/test_payroll.py` | Create | All payroll tests. |
| Docs | Modify | api/README, db/README, CODEBASE_MAP, CHECKING_THE_WORK, START_HERE, CONTEXT, handoff. |

---

## Task 1: Migration (3 tables + the company switch)

**Files:** Create `db/migrations/20260617000001_create_payroll.sql`; modify (auto) `db/schema.sql`.

- [ ] **Step 1: Write the migration**

Create `db/migrations/20260617000001_create_payroll.sql`:

```sql
-- migrate:up transaction:false
-- transaction:false: dbmate skips its own transaction so this file manages its
-- own (BEGIN/COMMIT). Error-stop is enforced by the runner.
begin;
set local timezone = 'UTC';

-- Payroll is a per-company switch (handoff PART 6). Off by default; the seed
-- turns it on for companies that use Intelli for payroll.
alter table tenants add column payroll_enabled boolean not null default false;

-- A pay period is company-wide: a date range with a cutoff and a sealed/open
-- status. cutoff_at/timezone_basis/grace_hours/lock_behavior are the configured
-- policy; v1 seals manually (no auto-clock). sealed_at is stamped on first seal.
create table pay_periods (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id),
    name            text,
    start_date      date not null,
    end_date        date not null,
    cutoff_at       timestamptz,
    timezone_basis  text,
    grace_hours     int not null default 0,
    lock_behavior   text not null default 'manual',
    status          text not null default 'open' check (status in ('open', 'sealed')),
    sealed_at       timestamptz,
    created_at      timestamptz not null default now()
);
create index pay_periods_tenant_idx on pay_periods (tenant_id);

-- One row per rep per period, holding that rep's totals. The per-entry `sealed`
-- flag is the lock: sealing a period sets every entry true; reopening one rep
-- clears just that rep's flag; a re-seal sets them true again.
create table time_entries (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    period_id   uuid not null references pay_periods(id),
    user_id     uuid not null references users(id),
    store_min   int not null default 0,
    reset_min   int not null default 0,
    drive_min   int not null default 0,
    miles       numeric not null default 0,
    mgr_status  text not null default 'pending'
                check (mgr_status in ('pending', 'approved', 'rejected')),
    sealed      boolean not null default false,
    created_at  timestamptz not null default now(),
    unique (period_id, user_id)
);
create index time_entries_tenant_idx on time_entries (tenant_id);
create index time_entries_period_idx on time_entries (period_id);
create index time_entries_user_idx on time_entries (user_id);

-- The permanent logbook for sensitive actions (pay_period.created / .sealed /
-- .reopened). Append-only in practice; never updated.
create table audit (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id),
    actor_user_id   uuid not null references users(id),
    action          text not null,
    target          text,
    detail          jsonb not null default '{}'::jsonb,
    at              timestamptz not null default now()
);
create index audit_tenant_at_idx on audit (tenant_id, at);

commit;

-- migrate:down transaction:false
begin;
set local timezone = 'UTC';
drop table audit;
drop table time_entries;
drop table pay_periods;
alter table tenants drop column payroll_enabled;
commit;
```

- [ ] **Step 2: Apply and verify the round-trip**

Run:
```bash
docker compose up -d
docker compose --profile tools run --rm migrate up
docker compose --profile tools run --rm migrate down
docker compose --profile tools run --rm migrate up
```
Expected: each exits 0; the final `up` recreates everything; `db/schema.sql` now contains `pay_periods`, `time_entries`, `audit`, and `tenants.payroll_enabled`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/20260617000001_create_payroll.sql db/schema.sql
git commit -m "Phase 4c: payroll tables (pay_periods, time_entries, audit) + tenant switch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Seed (switch on/off, a Central rep, an open period + entries)

**Files:** Modify `api/app/seed.py`.

- [ ] **Step 1: Add the payroll seed helpers**

In `api/app/seed.py`, add these helpers after the existing `_response` function:

```python
def _pay_period(conn, tenant_id, name, start_date, end_date):
    """Insert (or fetch) an open pay period. Idempotent by (tenant_id, name)."""
    existing = conn.execute(
        text("select id from pay_periods where tenant_id = :tid and name = :name"),
        {"tid": tenant_id, "name": name},
    ).scalar()
    if existing:
        return existing
    return conn.execute(
        text("insert into pay_periods (tenant_id, name, start_date, end_date) "
             "values (:tid, :name, :sd, :ed) returning id"),
        {"tid": tenant_id, "name": name, "sd": start_date, "ed": end_date},
    ).scalar()


def _time_entry(conn, tenant_id, period_id, user_email, store_min, reset_min,
                drive_min, miles, mgr_status="pending"):
    """Insert (or skip) one rep's entry for a period. Idempotent by (period, user)."""
    user_id = conn.execute(
        text("select id from users where tenant_id = :tid and email = :email"),
        {"tid": tenant_id, "email": user_email},
    ).scalar()
    assert user_id, f"no user with email {user_email!r}"
    existing = conn.execute(
        text("select id from time_entries where period_id = :pid and user_id = :uid"),
        {"pid": period_id, "uid": user_id},
    ).scalar()
    if existing:
        return existing
    return conn.execute(
        text("insert into time_entries (tenant_id, period_id, user_id, store_min, reset_min, "
             "drive_min, miles, mgr_status) values (:tid, :pid, :uid, :sm, :rm, :dm, :mi, :ms) "
             "returning id"),
        {"tid": tenant_id, "pid": period_id, "uid": user_id, "sm": store_min, "rm": reset_min,
         "dm": drive_min, "mi": miles, "ms": mgr_status},
    ).scalar()
```

- [ ] **Step 2: Wire payroll into `run()`**

In `run()`, inside the Lumen block (where `lumen` and `chicago` are defined), after the existing Lumen response seed calls, add:

```python
        # Payroll on for Lumen. A rep pinned under Central (Sarah's branch) so
        # manager-approval scope is testable: Sarah can approve Rico, not Marcus.
        conn.execute(text("update tenants set payroll_enabled = true where id = :id"),
                     {"id": lumen})
        _user(conn, lumen, "rico@lumenbeauty.com", "Rico Vance", "rep", chicago)
        period = _pay_period(conn, lumen, "June 1-15", "2026-06-01", "2026-06-15")
        _time_entry(conn, lumen, period, "marcus@lumenbeauty.com", 480, 60, 90, 42, "pending")
        _time_entry(conn, lumen, period, "rico@lumenbeauty.com", 510, 45, 70, 33, "approved")
```

Acme keeps `payroll_enabled` false (the default), so no Acme payroll seed is needed. Update the final `print(...)` line to mention payroll (e.g. add ", payroll on (1 period, 2 entries)" for Lumen and a 6th Lumen user).

- [ ] **Step 3: Reseed and verify idempotency**

```bash
docker compose exec api python -m app.seed
docker compose exec api python -m app.seed
docker compose exec db psql -U intelli -d intelli -t -c "select payroll_enabled from tenants where code='lumen';"
docker compose exec db psql -U intelli -d intelli -t -c "select count(*) from time_entries;"
```
Expected: `payroll_enabled` is `t` for lumen; entry count is 2 and unchanged on the second run.

- [ ] **Step 4: Commit**

```bash
git add api/app/seed.py
git commit -m "Phase 4c: seed payroll (Lumen on + Central rep Rico + open period + entries)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Pay periods + the payroll switch (`require_payroll`)

**Files:** Modify `api/app/scope.py` (add `_PERIOD_COLS`, `_audit`, `create_pay_period`, `list_pay_periods`, `get_pay_period`); create `api/app/payroll.py`; modify `api/app/main.py`; test `api/tests/test_payroll.py`.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_payroll.py`:

```python
"""Phase 4c: payroll. Pay periods are company-wide and admin-created; the whole
payroll surface is gated by a per-company switch; the seal/reopen lock and audit
log are exercised in later tests."""
from sqlalchemy import text

from app.db import engine


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


def _scalar(sql, **p):
    with engine.connect() as conn:
        return conn.execute(text(sql), p).scalar()


def _make_period(client, admin_token, name="Test Period"):
    return client.post("/pay-periods", headers=_auth(admin_token),
                       json={"name": name, "start_date": "2026-07-01",
                             "end_date": "2026-07-15"})


def test_payroll_requires_auth(client):
    assert client.get("/pay-periods").status_code == 401


def test_switch_blocks_company_with_payroll_off(client, login):
    # Avery (Acme) has payroll off -> 403 on list and create.
    avery = _auth(login("avery@acme.com"))
    assert client.get("/pay-periods", headers=avery).status_code == 403
    assert client.post("/pay-periods", headers=avery,
                       json={"name": "X", "start_date": "2026-07-01",
                             "end_date": "2026-07-15"}).status_code == 403


def test_admin_creates_period(client, login):
    resp = _make_period(client, login("dana@lumenbeauty.com"), "Admin Period")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "open"
    assert body["name"] == "Admin Period"
    # a create audit row was written
    n = _scalar("select count(*) from audit where action = 'pay_period.created' "
                "and target = :pid", pid=str(body["id"]))
    assert n == 1


def test_non_admin_cannot_create_period(client, login):
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        resp = _make_period(client, login(email))
        assert resp.status_code == 403, f"{email} got {resp.status_code}"


def test_list_periods_company_scoped(client, login):
    _make_period(client, login("dana@lumenbeauty.com"), "Listed Period")
    body = client.get("/pay-periods", headers=_auth(login("marcus@lumenbeauty.com"))).json()
    assert any(p["name"] == "Listed Period" for p in body["pay_periods"])
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:api -- tests/test_payroll.py`
Expected: FAIL (`/pay-periods` route missing).

- [ ] **Step 3: Add the payroll section to `ScopedRepo`**

In `api/app/scope.py`, add at the insertion point (after `facings_trend`, before module-level `_count_question`):

```python
    # ----- payroll (periods company-wide; entries scoped by the rep's pin) -----

    _PERIOD_COLS = ("id, name, start_date, end_date, cutoff_at, timezone_basis, "
                    "grace_hours, lock_behavior, status, sealed_at, created_at")
    _ENTRY_COLS = ("id, period_id, user_id, store_min, reset_min, drive_min, miles, "
                   "mgr_status, sealed, created_at")

    def _audit(self, conn, actor_user_id, action, target, detail) -> None:
        conn.execute(
            text("insert into audit (tenant_id, actor_user_id, action, target, detail) "
                 "values (cast(:tid as uuid), cast(:actor as uuid), :action, :target, "
                 "cast(:detail as jsonb))"),
            {"tid": str(self.tenant_id), "actor": str(actor_user_id), "action": action,
             "target": target, "detail": json.dumps(detail or {})},
        )

    def create_pay_period(self, name, start_date, end_date, cutoff_at, timezone_basis,
                          grace_hours, lock_behavior, actor_user_id) -> dict:
        with engine.begin() as conn:
            row = conn.execute(
                text("insert into pay_periods (tenant_id, name, start_date, end_date, cutoff_at, "
                     "timezone_basis, grace_hours, lock_behavior) values (cast(:tid as uuid), :name, "
                     ":sd, :ed, :cut, :tzb, :grace, :lock) "
                     f"returning {self._PERIOD_COLS}"),
                {"tid": str(self.tenant_id), "name": name, "sd": start_date, "ed": end_date,
                 "cut": cutoff_at, "tzb": timezone_basis, "grace": grace_hours,
                 "lock": lock_behavior},
            ).mappings().first()
            self._audit(conn, actor_user_id, "pay_period.created", str(row["id"]), {"name": name})
        return dict(row)

    def list_pay_periods(self) -> list[dict]:
        with engine.connect() as conn:
            rows = conn.execute(
                text(f"select {self._PERIOD_COLS} from pay_periods "
                     "where tenant_id = cast(:tid as uuid) order by start_date desc"),
                {"tid": str(self.tenant_id)},
            ).mappings().all()
        return [dict(r) for r in rows]

    def get_pay_period(self, period_id) -> dict | None:
        with engine.connect() as conn:
            row = conn.execute(
                text(f"select {self._PERIOD_COLS} from pay_periods "
                     "where id = cast(:pid as uuid) and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            ).mappings().first()
        return dict(row) if row else None
```

- [ ] **Step 4: Create the payroll router**

Create `api/app/payroll.py`:

```python
"""The payroll API. Pay periods are company-wide and admin-created; reps log
their own hours; managers approve their branch; an admin seals at the cutoff and
is the only one who can do the audit-logged reopen-for-one-rep. The whole surface
is gated by a per-company payroll switch (require_payroll).
"""
from datetime import date, datetime
from uuid import UUID

from sqlalchemy import text
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .db import engine
from .scope import ScopedRepo, get_scoped_repo
from .security import current_claims, require_admin

router = APIRouter(tags=["payroll"])


def require_payroll(claims: dict = Depends(current_claims)) -> dict:
    """Allow the request only if the caller's company has payroll switched on,
    else 403. Applied to every payroll endpoint."""
    with engine.connect() as conn:
        enabled = conn.execute(
            text("select payroll_enabled from tenants where id = cast(:tid as uuid)"),
            {"tid": str(claims["tenant_id"])},
        ).scalar()
    if not enabled:
        raise HTTPException(status_code=403, detail="Payroll is not enabled for this company")
    return claims


class PayPeriodCreate(BaseModel):
    name: str | None = None
    start_date: date
    end_date: date
    cutoff_at: datetime | None = None
    timezone_basis: str | None = None
    grace_hours: int = 0
    lock_behavior: str = "manual"


@router.post("/pay-periods")
def create_pay_period(
    body: PayPeriodCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(require_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    return repo.create_pay_period(body.name, body.start_date, body.end_date, body.cutoff_at,
                                  body.timezone_basis, body.grace_hours, body.lock_behavior,
                                  claims["sub"])


@router.get("/pay-periods")
def list_pay_periods(
    repo: ScopedRepo = Depends(get_scoped_repo),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    rows = repo.list_pay_periods()
    return {"pay_periods": rows, "count": len(rows)}
```

- [ ] **Step 5: Mount the router in main.py**

In `api/app/main.py`, add alongside the others:
```python
from .payroll import router as payroll_router
```
```python
app.include_router(payroll_router)
```

- [ ] **Step 6: Apply and run**

```bash
docker compose restart api
pnpm test:api -- tests/test_payroll.py
```
Expected: PASS (all 5 tests).

- [ ] **Step 7: Commit**

```bash
git add api/app/scope.py api/app/payroll.py api/app/main.py api/tests/test_payroll.py
git commit -m "Phase 4c: pay periods + the per-company payroll switch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Time entries (log, edit, list role-scoped)

**Files:** Modify `api/app/scope.py` (exceptions + `create_time_entry`, `update_time_entry`, `list_entries`); modify `api/app/payroll.py` (3 endpoints + models); test `api/tests/test_payroll.py`.

- [ ] **Step 1: Append the failing tests**

Append to `api/tests/test_payroll.py`:

```python
def _node_path(code):
    return _scalar("select path from nodes where code = :c", c=code)


def test_rep_logs_and_edits_own_hours(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Log Period").json()["id"]
    created = client.post("/time-entries", headers=_auth(marcus),
                          json={"period_id": pid, "store_min": 100, "reset_min": 10,
                                "drive_min": 20, "miles": 5})
    assert created.status_code == 200, created.text
    eid = created.json()["id"]
    edited = client.patch(f"/time-entries/{eid}", headers=_auth(marcus),
                          json={"store_min": 200, "reset_min": 10, "drive_min": 20, "miles": 5})
    assert edited.status_code == 200, edited.text
    assert edited.json()["store_min"] == 200


def test_duplicate_entry_rejected(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Dup Period").json()["id"]
    first = {"period_id": pid, "store_min": 10, "reset_min": 0, "drive_min": 0, "miles": 0}
    assert client.post("/time-entries", headers=_auth(marcus), json=first).status_code == 200
    assert client.post("/time-entries", headers=_auth(marcus), json=first).status_code == 409


def test_rep_cannot_edit_another_reps_entry(client, login):
    dana, marcus, rico = (login("dana@lumenbeauty.com"),
                          login("marcus@lumenbeauty.com"), login("rico@lumenbeauty.com"))
    pid = _make_period(client, dana, "Two Rep Period").json()["id"]
    marcus_eid = client.post("/time-entries", headers=_auth(marcus),
                             json={"period_id": pid, "store_min": 10, "reset_min": 0,
                                   "drive_min": 0, "miles": 0}).json()["id"]
    resp = client.patch(f"/time-entries/{marcus_eid}", headers=_auth(rico),
                        json={"store_min": 999, "reset_min": 0, "drive_min": 0, "miles": 0})
    assert resp.status_code == 404, resp.text  # not yours -> as if not found


def test_entries_list_is_role_scoped(client, login):
    dana, marcus, rico = (login("dana@lumenbeauty.com"),
                          login("marcus@lumenbeauty.com"), login("rico@lumenbeauty.com"))
    pid = _make_period(client, dana, "Scope Period").json()["id"]
    client.post("/time-entries", headers=_auth(marcus),
                json={"period_id": pid, "store_min": 10, "reset_min": 0, "drive_min": 0, "miles": 0})
    client.post("/time-entries", headers=_auth(rico),
                json={"period_id": pid, "store_min": 20, "reset_min": 0, "drive_min": 0, "miles": 0})
    # Marcus (rep) sees only his own
    mine = client.get(f"/pay-periods/{pid}/entries", headers=_auth(marcus)).json()
    assert mine["count"] == 1
    # Sarah (Central) sees Rico (her branch) but not Marcus (West)
    sarah = client.get(f"/pay-periods/{pid}/entries",
                       headers=_auth(login("sarah@lumenbeauty.com"))).json()
    sarah_users = {e["user_id"] for e in sarah["entries"]}
    rico_id = str(_scalar("select id from users where email='rico@lumenbeauty.com'"))
    marcus_id = str(_scalar("select id from users where email='marcus@lumenbeauty.com'"))
    assert rico_id in sarah_users
    assert marcus_id not in sarah_users
    # Dana (admin) sees both
    alld = client.get(f"/pay-periods/{pid}/entries", headers=_auth(dana)).json()
    assert {rico_id, marcus_id} <= {e["user_id"] for e in alld["entries"]}
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:api -- tests/test_payroll.py`
Expected: the 4 new tests FAIL (time-entry routes missing).

- [ ] **Step 3: Add the lifecycle exceptions to `scope.py`**

In `api/app/scope.py`, after the `VersionNotPublishedError` class (near the top), add:

```python
class PeriodSealedError(Exception):
    """Tried to add an entry to a sealed pay period."""


class EntryExistsError(Exception):
    """Tried to create a second time entry for the same rep + period."""


class EntrySealedError(Exception):
    """Tried to edit or re-approve a locked (sealed) time entry."""


class PeriodNotSealedError(Exception):
    """Tried to reopen a pay period that is not sealed."""
```

- [ ] **Step 4: Add the time-entry methods to the payroll section of `ScopedRepo`**

In `api/app/scope.py`, in the payroll section after `get_pay_period`, add:

```python
    def create_time_entry(self, period_id, user_id, fields) -> dict | None:
        """The caller's own entry for an OPEN period. None if the period is not
        the company's (-> 404); PeriodSealedError if sealed; EntryExistsError if
        the rep already has one."""
        with engine.begin() as conn:
            period = conn.execute(
                text("select status from pay_periods where id = cast(:pid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if period is None:
                return None
            if period["status"] != "open":
                raise PeriodSealedError()
            exists = conn.execute(
                text("select id from time_entries where period_id = cast(:pid as uuid) "
                     "and user_id = cast(:uid as uuid)"),
                {"pid": str(period_id), "uid": str(user_id)},
            ).first()
            if exists is not None:
                raise EntryExistsError()
            row = conn.execute(
                text("insert into time_entries (tenant_id, period_id, user_id, store_min, "
                     "reset_min, drive_min, miles) values (cast(:tid as uuid), cast(:pid as uuid), "
                     "cast(:uid as uuid), :sm, :rm, :dm, :mi) "
                     f"returning {self._ENTRY_COLS}"),
                {"tid": str(self.tenant_id), "pid": str(period_id), "uid": str(user_id),
                 "sm": fields["store_min"], "rm": fields["reset_min"],
                 "dm": fields["drive_min"], "mi": fields["miles"]},
            ).mappings().first()
        return dict(row)

    def update_time_entry(self, entry_id, user_id, fields) -> dict | None:
        """Edit the caller's OWN entry's hours. None if not found or not the
        caller's (-> 404); EntrySealedError if the entry is locked."""
        with engine.begin() as conn:
            entry = conn.execute(
                text("select sealed, user_id from time_entries where id = cast(:eid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"eid": str(entry_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if entry is None or str(entry["user_id"]) != str(user_id):
                return None
            if entry["sealed"]:
                raise EntrySealedError()
            row = conn.execute(
                text("update time_entries set store_min = :sm, reset_min = :rm, "
                     "drive_min = :dm, miles = :mi where id = cast(:eid as uuid) "
                     f"returning {self._ENTRY_COLS}"),
                {"sm": fields["store_min"], "rm": fields["reset_min"],
                 "dm": fields["drive_min"], "mi": fields["miles"], "eid": str(entry_id)},
            ).mappings().first()
        return dict(row)

    def list_entries(self, period_id, caller_user_id, caller_role) -> list[dict] | None:
        """Entries for a period. A rep sees only their own; a manager/admin sees
        entries for reps whose pin is within the caller's scope. None if the
        period is not the company's (-> 404)."""
        with engine.connect() as conn:
            period = conn.execute(
                text("select id from pay_periods where id = cast(:pid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            ).first()
            if period is None:
                return None
            if caller_role == "rep":
                rows = conn.execute(
                    text(f"select {self._ENTRY_COLS} from time_entries "
                         "where period_id = cast(:pid as uuid) and tenant_id = cast(:tid as uuid) "
                         "and user_id = cast(:uid as uuid) order by created_at"),
                    {"pid": str(period_id), "tid": str(self.tenant_id),
                     "uid": str(caller_user_id)},
                ).mappings().all()
            elif self.scope_path is None:
                rows = []
            else:
                rows = conn.execute(
                    text("select te.id, te.period_id, te.user_id, te.store_min, te.reset_min, "
                         "te.drive_min, te.miles, te.mgr_status, te.sealed, te.created_at "
                         "from time_entries te "
                         "join assignments a on a.user_id = te.user_id "
                         "join nodes n on n.id = a.node_id "
                         "where te.period_id = cast(:pid as uuid) "
                         "and te.tenant_id = cast(:tid as uuid) "
                         "and n.path like :scope || '%' order by te.created_at"),
                    {"pid": str(period_id), "tid": str(self.tenant_id), "scope": self.scope_path},
                ).mappings().all()
        return [dict(r) for r in rows]
```

- [ ] **Step 5: Add the time-entry endpoints to `payroll.py`**

In `api/app/payroll.py`, add the import of the exceptions and `require_manager_or_admin` (you will need the latter in Task 5; add it now to avoid a second import edit), and the endpoints. Update the imports:

```python
from .scope import (
    EntryExistsError,
    EntrySealedError,
    PeriodNotSealedError,
    PeriodSealedError,
    ScopedRepo,
    get_scoped_repo,
)
from .security import current_claims, require_admin, require_manager_or_admin
```

Add the models + endpoints (after the pay-period endpoints):

```python
class TimeEntryFields(BaseModel):
    store_min: int = 0
    reset_min: int = 0
    drive_min: int = 0
    miles: float = 0


class TimeEntryCreate(TimeEntryFields):
    period_id: UUID


def _fields(body: TimeEntryFields) -> dict:
    return {"store_min": body.store_min, "reset_min": body.reset_min,
            "drive_min": body.drive_min, "miles": body.miles}


@router.post("/time-entries")
def create_time_entry(
    body: TimeEntryCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(current_claims),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    try:
        result = repo.create_time_entry(body.period_id, claims["sub"], _fields(body))
    except PeriodSealedError:
        raise HTTPException(status_code=409, detail="This pay period is sealed")
    except EntryExistsError:
        raise HTTPException(status_code=409, detail="You already have an entry for this period")
    if result is None:
        raise HTTPException(status_code=404, detail="Pay period not found")
    return result


@router.patch("/time-entries/{entry_id}")
def update_time_entry(
    entry_id: UUID,
    body: TimeEntryFields,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(current_claims),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    try:
        result = repo.update_time_entry(entry_id, claims["sub"], _fields(body))
    except EntrySealedError:
        raise HTTPException(status_code=409, detail="This entry is sealed")
    if result is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result


@router.get("/pay-periods/{period_id}/entries")
def list_entries(
    period_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(current_claims),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    rows = repo.list_entries(period_id, claims["sub"], claims["role"])
    if rows is None:
        raise HTTPException(status_code=404, detail="Pay period not found")
    return {"entries": rows, "count": len(rows)}
```

- [ ] **Step 6: Apply and run**

```bash
docker compose restart api
pnpm test:api -- tests/test_payroll.py
```
Expected: PASS (all tests in the file).

- [ ] **Step 7: Commit**

```bash
git add api/app/scope.py api/app/payroll.py api/tests/test_payroll.py
git commit -m "Phase 4c: time entries (rep logs/edits own; role-scoped listing)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Manager approval (approve / reject)

**Files:** Modify `api/app/scope.py` (`set_entry_status`); modify `api/app/payroll.py` (2 endpoints); test `api/tests/test_payroll.py`.

- [ ] **Step 1: Append the failing tests**

Append to `api/tests/test_payroll.py`:

```python
def test_manager_approves_branch_rep(client, login):
    dana, rico = login("dana@lumenbeauty.com"), login("rico@lumenbeauty.com")
    pid = _make_period(client, dana, "Approve Period").json()["id"]
    eid = client.post("/time-entries", headers=_auth(rico),
                      json={"period_id": pid, "store_min": 10, "reset_min": 0,
                            "drive_min": 0, "miles": 0}).json()["id"]
    # Sarah (Central) manages Rico (Chicago, under Central)
    resp = client.post(f"/time-entries/{eid}/approve",
                       headers=_auth(login("sarah@lumenbeauty.com")))
    assert resp.status_code == 200, resp.text
    assert resp.json()["mgr_status"] == "approved"


def test_manager_cannot_approve_sibling_branch(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Sibling Approve").json()["id"]
    eid = client.post("/time-entries", headers=_auth(marcus),
                      json={"period_id": pid, "store_min": 10, "reset_min": 0,
                            "drive_min": 0, "miles": 0}).json()["id"]
    # Sarah (Central) cannot touch Marcus (Bay Area / West)
    resp = client.post(f"/time-entries/{eid}/reject",
                       headers=_auth(login("sarah@lumenbeauty.com")))
    assert resp.status_code == 404, resp.text


def test_rep_cannot_approve(client, login):
    dana, marcus, rico = (login("dana@lumenbeauty.com"),
                          login("marcus@lumenbeauty.com"), login("rico@lumenbeauty.com"))
    pid = _make_period(client, dana, "Rep Approve").json()["id"]
    eid = client.post("/time-entries", headers=_auth(rico),
                      json={"period_id": pid, "store_min": 10, "reset_min": 0,
                            "drive_min": 0, "miles": 0}).json()["id"]
    resp = client.post(f"/time-entries/{eid}/approve", headers=_auth(marcus))
    assert resp.status_code == 403, resp.text
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:api -- tests/test_payroll.py`
Expected: the 3 new tests FAIL (approve/reject routes missing).

- [ ] **Step 3: Add `set_entry_status` to the payroll section of `ScopedRepo`**

In `api/app/scope.py`, after `list_entries`, add:

```python
    def set_entry_status(self, entry_id, status) -> dict | None:
        """Approve/reject an entry. The entry's rep must be pinned within the
        caller's scope (the role is already gated by the endpoint dependency).
        None if not found / out of scope / the rep is unpinned (-> 404);
        EntrySealedError if the entry is locked."""
        if self.scope_path is None:
            return None
        with engine.begin() as conn:
            entry = conn.execute(
                text("select te.sealed, n.path as user_path from time_entries te "
                     "left join assignments a on a.user_id = te.user_id "
                     "left join nodes n on n.id = a.node_id "
                     "where te.id = cast(:eid as uuid) and te.tenant_id = cast(:tid as uuid)"),
                {"eid": str(entry_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if entry is None:
                return None
            if entry["user_path"] is None or not entry["user_path"].startswith(self.scope_path):
                return None
            if entry["sealed"]:
                raise EntrySealedError()
            row = conn.execute(
                text("update time_entries set mgr_status = :st where id = cast(:eid as uuid) "
                     f"returning {self._ENTRY_COLS}"),
                {"st": status, "eid": str(entry_id)},
            ).mappings().first()
        return dict(row)
```

- [ ] **Step 4: Add the approve/reject endpoints to `payroll.py`**

In `api/app/payroll.py`, after the time-entry endpoints, add:

```python
def _set_status(repo, entry_id, status):
    try:
        result = repo.set_entry_status(entry_id, status)
    except EntrySealedError:
        raise HTTPException(status_code=409, detail="This entry is sealed")
    if result is None:
        raise HTTPException(status_code=404, detail="Entry not found in your scope")
    return result


@router.post("/time-entries/{entry_id}/approve")
def approve_entry(
    entry_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _claims: dict = Depends(require_manager_or_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    return _set_status(repo, entry_id, "approved")


@router.post("/time-entries/{entry_id}/reject")
def reject_entry(
    entry_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _claims: dict = Depends(require_manager_or_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    return _set_status(repo, entry_id, "rejected")
```

Note: `set_entry_status` does not take the role: the role is gated by the `require_manager_or_admin` dependency on the endpoint, and the branch check is the path-prefix filter inside the method.

- [ ] **Step 5: Apply and run**

```bash
docker compose restart api
pnpm test:api -- tests/test_payroll.py
```
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add api/app/scope.py api/app/payroll.py api/tests/test_payroll.py
git commit -m "Phase 4c: manager approve/reject (branch-scoped, not on sealed entries)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Seal + logged reopen + the audit log (the gate)

**Files:** Modify `api/app/scope.py` (`seal_period`, `reopen_period`, `list_audit`); modify `api/app/payroll.py` (3 endpoints + model); test `api/tests/test_payroll.py`.

- [ ] **Step 1: Append the failing tests**

Append to `api/tests/test_payroll.py`:

```python
def _seal(client, admin_token, pid):
    return client.post(f"/pay-periods/{pid}/seal", headers=_auth(admin_token))


def test_seal_locks_entries(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Seal Lock").json()["id"]
    eid = client.post("/time-entries", headers=_auth(marcus),
                      json={"period_id": pid, "store_min": 10, "reset_min": 0,
                            "drive_min": 0, "miles": 0}).json()["id"]
    assert _seal(client, dana, pid).status_code == 200
    # edit, approve, and new-entry are all refused once sealed
    edit = client.patch(f"/time-entries/{eid}", headers=_auth(marcus),
                        json={"store_min": 99, "reset_min": 0, "drive_min": 0, "miles": 0})
    assert edit.status_code == 409, edit.text
    appr = client.post(f"/time-entries/{eid}/approve", headers=_auth(dana))
    assert appr.status_code == 409, appr.text
    new = client.post("/time-entries", headers=_auth(login("rico@lumenbeauty.com")),
                      json={"period_id": pid, "store_min": 5, "reset_min": 0, "drive_min": 0, "miles": 0})
    assert new.status_code == 409, new.text


def test_logged_reopen_unlocks_one_rep(client, login):
    dana, marcus, rico = (login("dana@lumenbeauty.com"),
                          login("marcus@lumenbeauty.com"), login("rico@lumenbeauty.com"))
    pid = _make_period(client, dana, "Reopen One").json()["id"]
    marcus_eid = client.post("/time-entries", headers=_auth(marcus),
                             json={"period_id": pid, "store_min": 10, "reset_min": 0,
                                   "drive_min": 0, "miles": 0}).json()["id"]
    rico_eid = client.post("/time-entries", headers=_auth(rico),
                           json={"period_id": pid, "store_min": 20, "reset_min": 0,
                                 "drive_min": 0, "miles": 0}).json()["id"]
    _seal(client, dana, pid)
    marcus_id = _scalar("select id from users where email='marcus@lumenbeauty.com'")
    reopen = client.post(f"/pay-periods/{pid}/reopen", headers=_auth(dana),
                         json={"user_id": str(marcus_id), "reason": "missed a visit"})
    assert reopen.status_code == 200, reopen.text
    # Marcus is editable again; Rico is still locked
    assert client.patch(f"/time-entries/{marcus_eid}", headers=_auth(marcus),
                        json={"store_min": 30, "reset_min": 0, "drive_min": 0,
                              "miles": 0}).status_code == 200
    assert client.patch(f"/time-entries/{rico_eid}", headers=_auth(rico),
                        json={"store_min": 30, "reset_min": 0, "drive_min": 0,
                              "miles": 0}).status_code == 409
    # a reopen audit row exists with the reason
    n = _scalar("select count(*) from audit where action = 'pay_period.reopened' "
                "and detail->>'reason' = 'missed a visit'")
    assert n >= 1
    # re-seal re-locks Marcus
    assert _seal(client, dana, pid).status_code == 200
    assert client.patch(f"/time-entries/{marcus_eid}", headers=_auth(marcus),
                        json={"store_min": 40, "reset_min": 0, "drive_min": 0,
                              "miles": 0}).status_code == 409


def test_reopen_requires_sealed_period(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Reopen Open").json()["id"]
    client.post("/time-entries", headers=_auth(marcus),
                json={"period_id": pid, "store_min": 10, "reset_min": 0, "drive_min": 0, "miles": 0})
    marcus_id = _scalar("select id from users where email='marcus@lumenbeauty.com'")
    resp = client.post(f"/pay-periods/{pid}/reopen", headers=_auth(dana),
                       json={"user_id": str(marcus_id), "reason": "x"})
    assert resp.status_code == 409, resp.text  # not sealed -> nothing to reopen


def test_reopen_unknown_rep_404(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Reopen Unknown").json()["id"]
    client.post("/time-entries", headers=_auth(marcus),
                json={"period_id": pid, "store_min": 10, "reset_min": 0, "drive_min": 0, "miles": 0})
    _seal(client, dana, pid)
    rico_id = _scalar("select id from users where email='rico@lumenbeauty.com'")  # no entry here
    resp = client.post(f"/pay-periods/{pid}/reopen", headers=_auth(dana),
                       json={"user_id": str(rico_id), "reason": "x"})
    assert resp.status_code == 404, resp.text


def test_audit_log_admin_only_and_records_actions(client, login):
    dana = login("dana@lumenbeauty.com")
    pid = _make_period(client, dana, "Audit Period").json()["id"]
    _seal(client, dana, pid)
    log = client.get("/audit", headers=_auth(dana))
    assert log.status_code == 200, log.text
    actions = {r["action"] for r in log.json()["audit"]}
    assert {"pay_period.created", "pay_period.sealed"} <= actions
    # a rep cannot read the audit log
    assert client.get("/audit", headers=_auth(login("marcus@lumenbeauty.com"))).status_code == 403
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:api -- tests/test_payroll.py`
Expected: the new tests FAIL (seal/reopen/audit routes missing).

- [ ] **Step 3: Add `seal_period`, `reopen_period`, `list_audit` to the payroll section**

In `api/app/scope.py`, after `set_entry_status`, add:

```python
    def seal_period(self, period_id, actor_user_id) -> dict | None:
        """Lock every entry in the period and mark it sealed (stamping sealed_at
        the first time). Re-callable: a re-seal re-locks reopened entries. Writes
        a pay_period.sealed audit row. None if the period is not the company's."""
        with engine.begin() as conn:
            period = conn.execute(
                text("select id from pay_periods where id = cast(:pid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            ).first()
            if period is None:
                return None
            conn.execute(
                text("update pay_periods set status = 'sealed', "
                     "sealed_at = coalesce(sealed_at, now()) where id = cast(:pid as uuid)"),
                {"pid": str(period_id)},
            )
            conn.execute(
                text("update time_entries set sealed = true where period_id = cast(:pid as uuid)"),
                {"pid": str(period_id)},
            )
            self._audit(conn, actor_user_id, "pay_period.sealed", str(period_id), {})
        return self.get_pay_period(period_id)

    def reopen_period(self, period_id, target_user_id, reason, actor_user_id):
        """Unlock one rep's entries in a sealed period and log it. Returns the
        period dict on success, None if the period is not the company's (-> 404),
        the string 'no_entries' if that rep has none (-> 404); PeriodNotSealedError
        if the period is not sealed (-> 409)."""
        with engine.begin() as conn:
            period = conn.execute(
                text("select status from pay_periods where id = cast(:pid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if period is None:
                return None
            if period["status"] != "sealed":
                raise PeriodNotSealedError()
            unlocked = conn.execute(
                text("update time_entries set sealed = false "
                     "where period_id = cast(:pid as uuid) and user_id = cast(:uid as uuid) "
                     "returning id"),
                {"pid": str(period_id), "uid": str(target_user_id)},
            ).all()
            if not unlocked:
                return "no_entries"
            self._audit(conn, actor_user_id, "pay_period.reopened",
                        f"period:{period_id} user:{target_user_id}", {"reason": reason})
        return self.get_pay_period(period_id)

    def list_audit(self) -> list[dict]:
        with engine.connect() as conn:
            rows = conn.execute(
                text("select id, actor_user_id, action, target, detail, at from audit "
                     "where tenant_id = cast(:tid as uuid) order by at desc"),
                {"tid": str(self.tenant_id)},
            ).mappings().all()
        return [dict(r) for r in rows]
```

- [ ] **Step 4: Add the seal / reopen / audit endpoints to `payroll.py`**

In `api/app/payroll.py`, add the reopen body model (near the other models) and the endpoints (after the approve/reject endpoints):

```python
class ReopenBody(BaseModel):
    user_id: UUID
    reason: str = Field(min_length=1)


@router.post("/pay-periods/{period_id}/seal")
def seal_period(
    period_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(require_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    result = repo.seal_period(period_id, claims["sub"])
    if result is None:
        raise HTTPException(status_code=404, detail="Pay period not found")
    return result


@router.post("/pay-periods/{period_id}/reopen")
def reopen_period(
    period_id: UUID,
    body: ReopenBody,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(require_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    try:
        result = repo.reopen_period(period_id, body.user_id, body.reason, claims["sub"])
    except PeriodNotSealedError:
        raise HTTPException(status_code=409, detail="This pay period is not sealed")
    if result is None or result == "no_entries":
        raise HTTPException(status_code=404, detail="Pay period or rep entries not found")
    return result


@router.get("/audit")
def get_audit(
    repo: ScopedRepo = Depends(get_scoped_repo),
    _claims: dict = Depends(require_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    rows = repo.list_audit()
    return {"audit": rows, "count": len(rows)}
```

- [ ] **Step 5: Apply and run**

```bash
docker compose restart api
pnpm test:api -- tests/test_payroll.py
```
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add api/app/scope.py api/app/payroll.py api/tests/test_payroll.py
git commit -m "Phase 4c: seal + audit-logged per-rep reopen + audit log (the lock gate)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Docs + full green run

**Files:** Modify `START_HERE.md`, `CONTEXT.md`, `CODEBASE_MAP.md`, `api/README.md`, `db/README.md`, `CHECKING_THE_WORK.md`, `../hi-fi-intelli/Intelli_Complete_Handoff.md`.

STYLE: plain non-coder English, NO em dashes, match each file's voice, surgical edits.

- [ ] **Step 1: Run the full suites and capture real counts**

```bash
docker compose restart api
pnpm test:api
pnpm test:admin
```
Use the real "N passed" numbers in the docs. If anything is not green, STOP and report BLOCKED.

- [ ] **Step 2: Update `START_HERE.md`**
- Add a "Phase 4c" bullet after the Phase 4b block:
  > **Phase 4c - payroll (done):** Each company can switch on payroll. An admin opens a pay period, reps log their own hours (store, reset, drive minutes, miles), managers approve their branch's hours, and at the cutoff the admin seals the period so the numbers lock. The one exception is a deliberate, logged "reopen one rep" (their hours unlock, get fixed, and the action is written into a permanent logbook). Backend only, no screen yet. Proven by the test robot: a sealed period can't be edited or re-approved, a reopen frees exactly one rep and is logged, and a company with payroll off is refused.
- Update "What's NEXT" to Phase 4d (export).
- In the file-structure block under `api/app/`, add `payroll.py  Pay periods, hours, the seal/reopen lock, audit log`.
- Update section 7 with 4c done, 4d next, and the real test counts.

- [ ] **Step 3: Update `CONTEXT.md`**
- Mark 4c done ([x]) in the build-order checklist; 4d pending.
- Add a 2026-06-17 progress-log entry: migration for pay_periods + time_entries + audit + tenants.payroll_enabled; new payroll.py with require_payroll switch; ScopedRepo gained a payroll section (periods company-wide, entries role-scoped by the rep's pin); per-entry sealed flag is the lock, seal re-callable, reopen per-rep + audit-logged; manual seal (auto-clock deferred); seed turns Lumen on / Acme off and adds a Central rep. State the real backend + frontend counts. End "Phase 4c COMPLETE; 4d (export) next."

- [ ] **Step 4: Update `CODEBASE_MAP.md`**
- Add an "As of Phase 4c" paragraph after the 4b one: the backend now runs payroll ([api/app/payroll.py](api/app/payroll.py)), with pay periods, logged hours, an admin seal/reopen lock, and a permanent audit log, gated by a per-company switch.

- [ ] **Step 5: Update `api/README.md`**
- Add a `payroll.py` entry (the endpoints + the require_payroll switch) and note the ScopedRepo gained a payroll section and an `_audit` helper.

- [ ] **Step 6: Update `db/README.md`**
- Add the `pay_periods`, `time_entries`, `audit` tables and the `tenants.payroll_enabled` column to the schema walk-through, in plain style: the per-entry sealed flag as the lock, the audit log as the permanent record.

- [ ] **Step 7: Update `CHECKING_THE_WORK.md`**
- Add a "Phase 4c checks (payroll)" section: in http://localhost:8000/docs, log in as Dana, POST /pay-periods, have Marcus log hours, POST .../seal, try to PATCH the entry (refused), POST .../reopen with a reason, edit, re-seal, then GET /audit to see the logbook. Note that an Acme user is refused (payroll off), and `pnpm test:api` runs the gate.

- [ ] **Step 8: Update the handoff CHANGELOG**
- In `../hi-fi-intelli/Intelli_Complete_Handoff.md`, add a newest-first 2026-06-17 Phase 4c entry in the production voice: the three tables + the switch, the admin-owned seal/reopen lock with the per-entry flag, manager approval, the audit log, manual seal (auto-clock deferred), branch-scoped hours, the real test counts, and "Next: Phase 4d (export)."

- [ ] **Step 9: Commit both repos**

```bash
git add START_HERE.md CONTEXT.md CODEBASE_MAP.md api/README.md db/README.md CHECKING_THE_WORK.md
git commit -m "Phase 4c: docs (guides + handoff) for payroll

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
cd ../hi-fi-intelli && git add Intelli_Complete_Handoff.md && git commit -m "Handoff: Phase 4c complete (production repo) - payroll

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" && cd ../intelli-app
```

---

## Self-review notes (done while writing)
- **Spec coverage:** migration + switch (Task 1); seed on/off + Central rep + period/entries (Task 2); periods + require_payroll switch (Task 3); time entries log/edit/list role-scoped (Task 4); manager approve/reject branch-scoped (Task 5); seal + logged per-rep reopen + audit log, the gate, incl. re-seal (Task 6); docs + full green (Task 7). The spec's "deliberately NOT" items (export, auto-clock, manager-edits-rep, new-entry-into-sealed, dollars, routine-approval-audit, screens) are all absent.
- **Placeholder scan:** none; every step has complete code/commands.
- **Type/name consistency:** exceptions `PeriodSealedError` / `EntryExistsError` / `EntrySealedError` / `PeriodNotSealedError` defined in Task 4 Step 3 and imported in Task 4 Step 5, used in Tasks 4-6. Methods `create_pay_period` / `list_pay_periods` / `get_pay_period` / `create_time_entry` / `update_time_entry` / `list_entries` / `set_entry_status` / `seal_period` / `reopen_period` / `list_audit` and `_audit` / `_PERIOD_COLS` / `_ENTRY_COLS` are spelled identically across tasks and the router. `require_payroll` defined in Task 3, reused everywhere. Router uses None->404, business-rule->409, role->403, switch->403, missing-body->422 consistently.
- **Scope safety:** periods are tenant-filtered; entry listing/approval scope by the rep's pin path (`n.path like scope_path || '%'` for managers/admins, `user_id = caller` for reps); the manager-join queries qualify columns with `te.` to avoid ambiguity with `nodes`/`assignments`. reopen/seal act only within the company (period fetched tenant-scoped first).
- **The re-seal fix from the spec review** is implemented in `seal_period` (re-callable, `coalesce(sealed_at, now())`), and `test_logged_reopen_unlocks_one_rep` proves the reopen -> edit -> re-seal cycle.
```
