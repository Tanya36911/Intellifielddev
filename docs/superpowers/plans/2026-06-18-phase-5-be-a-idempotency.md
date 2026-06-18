# Phase 5-BE-a: Idempotency Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the two rep-submit endpoints (`POST /responses`, `POST /time-entries`) accept an optional client-generated idempotency key (a UUID) so a re-sent queued submission returns the original row instead of creating a duplicate, with zero change for callers that send no key.

**Architecture:** One migration adds a nullable `idempotency_key uuid` column plus a partial unique index (`where idempotency_key is not null`) to `responses` and `time_entries`. The two Pydantic create-models gain an optional `idempotency_key`; the endpoints pass it to the existing `ScopedRepo.create_response` / `create_time_entry`, which do a key lookup first and return the original on a hit, else insert as today (writing the key). Optional + partial index = fully backward compatible.

**Tech Stack:** Python 3.12, FastAPI + Pydantic, SQLAlchemy Core over Postgres, dbmate plain-SQL migrations, pytest + `TestClient` against the throwaway `intelli_test` database.

**Spec:** `docs/superpowers/specs/2026-06-18-phase-5-be-a-idempotency-design.md`

**Conventions (read before starting):**
- Run backend tests inside the container: `docker compose exec -T api pytest <args>`. The container's test path is `tests/test_*.py` (the host `api/` is mounted at `/app`), NOT `api/tests/...`. Backend must be running (`docker compose up -d`).
- The test harness (`api/tests/conftest.py`) rebuilds `intelli_test` by applying every migration's up-section as one whole `execute`, then seeds, once per session. So a new migration is picked up automatically on the next `pytest` run, and a syntax error in it reds the whole suite.
- Tests go through the API with the `client` + `login` fixtures and isolate to data they create. Seeded users (password `demo1234`): `dana@lumenbeauty.com` (admin), `marcus@lumenbeauty.com` (rep, Bay Area), `rico@lumenbeauty.com` (rep, Chicago/Central), `sarah@lumenbeauty.com` (manager, Central), `avery@acme.com` (admin, Acme, payroll OFF). Nodes by code: `bayarea`, `sf`, `central`, `chicago-store`, `boston-store`. SKU `LUM-VL-ROSE`. Acme has a published `Glow Serum Check` survey.
- Current baseline: 160 backend tests green, 27 frontend.
- Commit directly to `main` (Tanya's workflow). No em dashes anywhere. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `db/migrations/20260618000001_add_idempotency_keys.sql` | Add the nullable column + partial unique index to both tables (with down). | Create |
| `db/schema.sql` | Regenerated snapshot. | Modify |
| `api/app/scope.py` | `create_response` / `create_time_entry` learn the optional key (lookup-then-return-or-insert). | Modify |
| `api/app/responses.py` | `ResponseCreate` gains `idempotency_key`; pass it through. | Modify |
| `api/app/payroll.py` | `TimeEntryCreate` gains `idempotency_key`; pass it through. | Modify |
| `api/tests/test_idempotency.py` | The 5-BE-a test gate. | Create |
| `api/README.md`, `db/README.md`, `CODEBASE_MAP.md`, `START_HERE.md`, `CONTEXT.md` | Docs. | Modify |
| `../hi-fi-intelli/Intelli_Complete_Handoff.md` | Handoff CHANGELOG. | Modify |

No seed change.

---

## Task 1: The migration + schema snapshot

**Files:**
- Create: `db/migrations/20260618000001_add_idempotency_keys.sql`
- Modify: `db/schema.sql`

- [ ] **Step 1: Write the migration**

Create `db/migrations/20260618000001_add_idempotency_keys.sql`:

```sql
-- migrate:up transaction:false
-- transaction:false: dbmate skips its own transaction so this file can manage
-- its own (BEGIN/COMMIT), making it safe under dbmate or hand-run psql.
-- Error-stop is enforced by the runner (deploy script: psql -v ON_ERROR_STOP=1).
begin;
set local timezone = 'UTC';

-- Phase 5-BE-a: a client-generated idempotency key (a claim ticket) so a re-sent
-- offline submission returns the original row instead of duplicating. Optional:
-- existing/web callers send none (NULL), which the partial unique index ignores,
-- so behavior is unchanged for them. Only the two rep-submit tables get it.
alter table responses add column idempotency_key uuid;
alter table time_entries add column idempotency_key uuid;

-- Dedup only real (non-null) keys, per company; unlimited NULL (unkeyed) rows.
create unique index responses_tenant_idem_idx
    on responses (tenant_id, idempotency_key) where idempotency_key is not null;
create unique index time_entries_tenant_idem_idx
    on time_entries (tenant_id, idempotency_key) where idempotency_key is not null;

commit;

-- migrate:down transaction:false
begin;
set local timezone = 'UTC';
drop index time_entries_tenant_idem_idx;
drop index responses_tenant_idem_idx;
alter table time_entries drop column idempotency_key;
alter table responses drop column idempotency_key;
commit;
```

- [ ] **Step 2: Apply the migration and regenerate the schema snapshot**

Run: `docker compose run --rm migrate up`
Expected: dbmate applies `20260618000001_add_idempotency_keys` and rewrites `db/schema.sql`. Confirm `db/schema.sql` now shows the two `idempotency_key` columns and the two `*_idem_idx` indexes (e.g. `grep -n idempotency_key db/schema.sql`).

- [ ] **Step 3: Verify the existing suite still passes against the new schema**

Run: `docker compose exec -T api pytest -q`
Expected: PASS, still 160 (conftest rebuilt `intelli_test` with the new migration; the nullable column + partial index changes no existing behavior because all rows have a NULL key).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/20260618000001_add_idempotency_keys.sql db/schema.sql
git commit -m "Phase 5-BE-a: migration for idempotency_key columns + partial unique indexes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Responses idempotency

**Files:**
- Create: `api/tests/test_idempotency.py`
- Modify: `api/app/scope.py` (`create_response`)
- Modify: `api/app/responses.py` (`ResponseCreate` + passthrough)

- [ ] **Step 1: Write the failing responses tests**

Create `api/tests/test_idempotency.py`:

```python
"""Phase 5-BE-a: idempotency keys. A client-generated UUID (a claim ticket) on
POST /responses and POST /time-entries makes a re-sent submission return the
original row instead of duplicating. Optional: callers that send no key behave
exactly as before. Tests go through the API and isolate to data they create."""
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import engine


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


def _scalar(sql, **p):
    with engine.connect() as conn:
        return conn.execute(text(sql), p).scalar()


def _node_id(code):
    return _scalar("select id from nodes where code = :c", c=code)


def _sku_id(upc):
    return _scalar("select id from skus where upc = :u", u=upc)


def _publish_and_assign(client, admin_token, name, questions, target_code):
    h = _auth(admin_token)
    survey = client.post("/surveys", headers=h,
                         json={"name": name, "type": None, "questions": questions}).json()
    client.post(f"/surveys/{survey['id']}/publish", headers=h)
    full = client.get(f"/surveys/{survey['id']}", headers=h).json()
    vid = next(v["id"] for v in full["versions"] if v["published_at"] is not None)
    client.post("/survey-assignments", headers=h,
                json={"survey_version_id": vid, "target_node_id": str(_node_id(target_code))})
    return vid


def _submit(client, token, vid, store_code, answers, idem=None):
    body = {"survey_version_id": str(vid),
            "store_node_id": str(_node_id(store_code)), "answers": answers}
    if idem is not None:
        body["idempotency_key"] = idem
    return client.post("/responses", headers=_auth(token), json=body)


def _bay_survey(client, dana):
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
          "sku_ids": [str(rose)], "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    return _publish_and_assign(client, dana, "Idem Responses", q, "bayarea"), rose


def test_responses_same_ticket_returns_original(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    vid, rose = _bay_survey(client, dana)
    tk = str(uuid.uuid4())
    a = [{"question_id": "q1", "sku_id": str(rose), "value": 5}]
    r1 = _submit(client, marcus, vid, "sf", a, idem=tk)
    r2 = _submit(client, marcus, vid, "sf", a, idem=tk)
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    assert r1.json()["id"] == r2.json()["id"]          # same row
    assert r1.json() == r2.json()                      # identical body
    assert "idempotency_key" not in r1.json()          # key stays internal
    n = _scalar("select count(*) from responses where idempotency_key = cast(:k as uuid)", k=tk)
    assert n == 1                                       # exactly one row for the ticket


def test_responses_no_ticket_creates_two(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    vid, rose = _bay_survey(client, dana)
    a = [{"question_id": "q1", "sku_id": str(rose), "value": 5}]
    r1 = _submit(client, marcus, vid, "sf", a)
    r2 = _submit(client, marcus, vid, "sf", a)
    assert r1.json()["id"] != r2.json()["id"]          # re-visits retained


def test_responses_keyed_then_unkeyed_inserts(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    vid, rose = _bay_survey(client, dana)
    a = [{"question_id": "q1", "sku_id": str(rose), "value": 5}]
    r1 = _submit(client, marcus, vid, "sf", a, idem=str(uuid.uuid4()))
    r2 = _submit(client, marcus, vid, "sf", a)         # no ticket -> never deduped
    assert r1.json()["id"] != r2.json()["id"]


def test_responses_duplicate_key_rejected_by_index(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    vid, rose = _bay_survey(client, dana)
    tk = str(uuid.uuid4())
    _submit(client, marcus, vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}], idem=tk)
    # A direct second row with the same (tenant_id, idempotency_key) must be rejected
    # by the partial unique index (the endpoint short-circuits, so this is the only
    # way to prove the index bites).
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(text(
                "insert into responses (tenant_id, survey_version_id, store_node_id, "
                "store_path, user_id, idempotency_key) "
                "select tenant_id, survey_version_id, store_node_id, store_path, user_id, "
                "cast(:k as uuid) from responses where idempotency_key = cast(:k as uuid)"),
                {"k": tk})


def test_responses_cross_company_ticket_no_collision(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    avery = login("avery@acme.com")
    tk = str(uuid.uuid4())
    vid_l, rose = _bay_survey(client, dana)
    rl = _submit(client, marcus, vid_l, "sf",
                 [{"question_id": "q1", "sku_id": str(rose), "value": 5}], idem=tk)
    acme_vid = _scalar(
        "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
        "where s.name = 'Glow Serum Check' and v.published_at is not null limit 1")
    ra = client.post("/responses", headers=_auth(avery),
                     json={"survey_version_id": str(acme_vid),
                           "store_node_id": str(_node_id("boston-store")),
                           "answers": [{"question_id": "q1", "value": True}],
                           "idempotency_key": tk})
    assert rl.status_code == 200 and ra.status_code == 200, (rl.text, ra.text)
    assert rl.json()["id"] != ra.json()["id"]          # same ticket, two companies, two rows
    n = _scalar("select count(*) from responses where idempotency_key = cast(:k as uuid)", k=tk)
    assert n == 2


def test_responses_keyed_first_submit_still_scoped_and_validated(client, login):
    dana = login("dana@lumenbeauty.com")
    sarah = login("sarah@lumenbeauty.com")     # Central, cannot reach Bay Area
    marcus = login("marcus@lumenbeauty.com")
    vid, rose = _bay_survey(client, dana)
    out = _submit(client, sarah, vid, "sf",
                  [{"question_id": "q1", "sku_id": str(rose), "value": 5}], idem=str(uuid.uuid4()))
    assert out.status_code == 404, out.text          # ticket does not bypass scope
    bad = _submit(client, marcus, vid, "sf",
                  [{"question_id": "q1", "sku_id": str(rose), "value": "notnum"}],
                  idem=str(uuid.uuid4()))
    assert bad.status_code == 400, bad.text          # ticket does not bypass validation
```

- [ ] **Step 2: Run the responses tests to verify they fail**

Run: `docker compose exec -T api pytest tests/test_idempotency.py -q`
Expected: FAIL (the `idempotency_key` field is silently ignored today, so the same-ticket test creates two rows / count is 2, etc.; the duplicate-index test may pass already since the migration exists, but the dedup tests fail).

- [ ] **Step 3: Teach `create_response` the optional key**

In `api/app/scope.py`, change the `create_response` signature (add the trailing param):

```python
    def create_response(self, survey_version_id, store_node_id, answers, user_id,
                        idempotency_key=None) -> dict | None:
```

Immediately after `with engine.begin() as conn:` (the first line of the method body's `with`), insert the key lookup as the first thing in the block:

```python
        with engine.begin() as conn:
            # Idempotency: a re-sent submission carrying a ticket we have already
            # seen returns the original (re-scored), never a duplicate. Tenant-only
            # lookup (no path filter); get_response re-applies the caller's scope.
            if idempotency_key is not None:
                existing = conn.execute(
                    text("select id from responses where tenant_id = cast(:tid as uuid) "
                         "and idempotency_key = cast(:idem as uuid)"),
                    {"tid": str(self.tenant_id), "idem": str(idempotency_key)},
                ).mappings().first()
                if existing is not None:
                    return self.get_response(existing["id"])
            version = conn.execute(
```

Then add the key to the `responses` INSERT (column list + values + param):

```python
            resp = conn.execute(
                text(
                    "insert into responses (tenant_id, survey_version_id, store_node_id, "
                    "store_path, user_id, idempotency_key) values (cast(:tid as uuid), "
                    "cast(:vid as uuid), cast(:nid as uuid), :spath, cast(:uid as uuid), "
                    "cast(:idem as uuid)) "
                    f"returning {self._RESPONSE_COLS}"
                ),
                {"tid": str(self.tenant_id), "vid": str(survey_version_id),
                 "nid": str(store_node_id), "spath": store["path"], "uid": str(user_id),
                 "idem": str(idempotency_key) if idempotency_key is not None else None},
            ).mappings().first()
```

(The `response_items` INSERT and the closing `return self.get_response(resp["id"])` are unchanged.)

- [ ] **Step 4: Pass the key through `POST /responses`**

In `api/app/responses.py`, add the field to `ResponseCreate`:

```python
class ResponseCreate(BaseModel):
    survey_version_id: UUID
    store_node_id: UUID
    answers: list[Answer] = []
    idempotency_key: UUID | None = None
```

And pass it to the repo in `submit_response`:

```python
        result = repo.create_response(
            body.survey_version_id,
            body.store_node_id,
            [a.model_dump(mode="json") for a in body.answers],
            claims["sub"],
            body.idempotency_key,
        )
```

- [ ] **Step 5: Run the responses tests to verify they pass**

Run: `docker compose exec -T api pytest tests/test_idempotency.py -q`
Expected: PASS (6 responses tests). Then run the full suite to confirm no regression: `docker compose exec -T api pytest -q` (expect 166 = 160 + 6).

- [ ] **Step 6: Commit**

```bash
git add api/app/scope.py api/app/responses.py api/tests/test_idempotency.py
git commit -m "Phase 5-BE-a: idempotency key on POST /responses

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Time-entry idempotency

**Files:**
- Modify: `api/tests/test_idempotency.py` (append the hours tests)
- Modify: `api/app/scope.py` (`create_time_entry`)
- Modify: `api/app/payroll.py` (`TimeEntryCreate` + passthrough)

- [ ] **Step 1: Write the failing hours tests**

Append to `api/tests/test_idempotency.py`:

```python
def _open_period(client, dana):
    return client.post("/pay-periods", headers=_auth(dana),
                       json={"start_date": "2026-12-01", "end_date": "2026-12-15",
                             "name": "Idem Hours"}).json()["id"]


def _post_entry(client, token, pid, idem=None, store_min=120):
    body = {"period_id": pid, "store_min": store_min, "reset_min": 0,
            "drive_min": 0, "miles": 0}
    if idem is not None:
        body["idempotency_key"] = idem
    return client.post("/time-entries", headers=_auth(token), json=body)


def test_hours_same_ticket_returns_original(client, login):
    dana = login("dana@lumenbeauty.com")
    rico = login("rico@lumenbeauty.com")
    pid = _open_period(client, dana)
    tk = str(uuid.uuid4())
    e1 = _post_entry(client, rico, pid, idem=tk)
    e2 = _post_entry(client, rico, pid, idem=tk)
    assert e1.status_code == 200 and e2.status_code == 200, (e1.text, e2.text)
    assert e1.json()["id"] == e2.json()["id"]
    assert e1.json() == e2.json()                      # identical body (miles a number)
    assert isinstance(e1.json()["miles"], (int, float))
    assert "idempotency_key" not in e1.json()
    rico_id = _scalar("select id from users where email = 'rico@lumenbeauty.com'")
    n = _scalar("select count(*) from time_entries where period_id = cast(:p as uuid) "
                "and user_id = cast(:u as uuid)", p=str(pid), u=str(rico_id))
    assert n == 1
    k = _scalar("select idempotency_key from time_entries where period_id = cast(:p as uuid) "
                "and user_id = cast(:u as uuid)", p=str(pid), u=str(rico_id))
    assert str(k) == tk                                # the row carries the sent ticket


def test_hours_different_ticket_same_period_409(client, login):
    dana = login("dana@lumenbeauty.com")
    rico = login("rico@lumenbeauty.com")
    pid = _open_period(client, dana)
    e1 = _post_entry(client, rico, pid, idem=str(uuid.uuid4()))
    assert e1.status_code == 200, e1.text
    e2 = _post_entry(client, rico, pid, idem=str(uuid.uuid4()))   # different ticket, same (period, rep)
    assert e2.status_code == 409, e2.text              # genuine second entry still blocked


def test_hours_payroll_off_company_403(client, login):
    avery = login("avery@acme.com")                    # Acme: payroll off
    r = client.post("/time-entries", headers=_auth(avery),
                    json={"period_id": str(uuid.uuid4()), "store_min": 10,
                          "idempotency_key": str(uuid.uuid4())})
    assert r.status_code == 403, r.text                # gate runs before ticket logic
```

- [ ] **Step 2: Run the hours tests to verify they fail**

Run: `docker compose exec -T api pytest tests/test_idempotency.py -k hours -q`
Expected: FAIL (`test_hours_same_ticket_returns_original` fails: the second POST currently raises `EntryExistsError` -> 409 instead of returning the original 200, and the key column is not populated).

- [ ] **Step 3: Teach `create_time_entry` the optional key**

In `api/app/scope.py`, change the `create_time_entry` signature:

```python
    def create_time_entry(self, period_id, user_id, fields, idempotency_key=None) -> dict | None:
```

Immediately after `with engine.begin() as conn:`, insert the key lookup as the first thing in the block (it must select the full `_ENTRY_COLS`, with `miles::float`, and is scoped to the caller's `user_id` as defense-in-depth, with no nodes/assignments join):

```python
        with engine.begin() as conn:
            # Idempotency: a re-sent create carrying a ticket we have already seen
            # returns the original entry (200), before the sealed/exists checks, so
            # a genuine re-send is not mistaken for a duplicate. Same un-scoped
            # _ENTRY_COLS shape as a fresh insert.
            if idempotency_key is not None:
                prior = conn.execute(
                    text(f"select {self._ENTRY_COLS} from time_entries "
                         "where tenant_id = cast(:tid as uuid) "
                         "and idempotency_key = cast(:idem as uuid) "
                         "and user_id = cast(:uid as uuid)"),
                    {"tid": str(self.tenant_id), "idem": str(idempotency_key),
                     "uid": str(user_id)},
                ).mappings().first()
                if prior is not None:
                    return dict(prior)
            period = conn.execute(
```

Then add the key to the `time_entries` INSERT (column list + values + param):

```python
            row = conn.execute(
                text("insert into time_entries (tenant_id, period_id, user_id, store_min, "
                     "reset_min, drive_min, miles, idempotency_key) values (cast(:tid as uuid), "
                     "cast(:pid as uuid), cast(:uid as uuid), :sm, :rm, :dm, :mi, "
                     "cast(:idem as uuid)) "
                     f"returning {self._ENTRY_COLS}"),
                {"tid": str(self.tenant_id), "pid": str(period_id), "uid": str(user_id),
                 "sm": fields["store_min"], "rm": fields["reset_min"],
                 "dm": fields["drive_min"], "mi": fields["miles"],
                 "idem": str(idempotency_key) if idempotency_key is not None else None},
            ).mappings().first()
        return dict(row)
```

- [ ] **Step 4: Pass the key through `POST /time-entries`**

In `api/app/payroll.py`, add the field to `TimeEntryCreate`:

```python
class TimeEntryCreate(TimeEntryFields):
    period_id: UUID
    idempotency_key: UUID | None = None
```

And pass it to the repo in `create_time_entry` (the endpoint function):

```python
        result = repo.create_time_entry(body.period_id, claims["sub"], _fields(body),
                                        body.idempotency_key)
```

(`_fields(body)` returns only the minute/miles fields, so the key is passed separately as the 4th argument and never leaks into the stored `fields`.)

- [ ] **Step 5: Run the hours tests, then the full suite**

Run: `docker compose exec -T api pytest tests/test_idempotency.py -q`
Expected: PASS (all 9 idempotency tests: 6 responses + 3 hours).
Run: `docker compose exec -T api pytest -q`
Expected: PASS, 169 (160 + 9).

- [ ] **Step 6: Commit**

```bash
git add api/app/scope.py api/app/payroll.py api/tests/test_idempotency.py
git commit -m "Phase 5-BE-a: idempotency key on POST /time-entries

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Docs + verification

**Files:**
- Modify: `api/README.md`, `db/README.md`, `CODEBASE_MAP.md`, `START_HERE.md`, `CONTEXT.md`
- Modify: `../hi-fi-intelli/Intelli_Complete_Handoff.md`

- [ ] **Step 1: Final verification (get the real numbers)**

Run: `docker compose exec -T api pytest -q` (confirm the total, expected 169).
Run: `pnpm test:admin` (confirm 27 frontend checks pass).
If either is not green, STOP and report BLOCKED with the output.

- [ ] **Step 2: Update `db/README.md`**

Add the new migration to the migrations list/section in the same plain style, noting it adds an optional `idempotency_key` to `responses` and `time_entries` with a partial unique index that only dedups non-null keys (so existing/unkeyed rows are unaffected).

- [ ] **Step 3: Update `api/README.md`**

Note that `POST /responses` and `POST /time-entries` now accept an optional `idempotency_key` (a client-generated UUID): re-sending the same key returns the original row instead of a duplicate, and omitting it behaves exactly as before. Mention this is the first piece of Phase 5 (offline sync).

- [ ] **Step 4: Update `CODEBASE_MAP.md`**

Add a short "As of Phase 5-BE-a" note after the Phase 4 material: the two rep-submit endpoints accept a claim-ticket so an offline phone can safely re-send without duplicating, the groundwork for the offline queue.

- [ ] **Step 5: Update `START_HERE.md`**

In section 1, add a "Phase 5 (Field app + offline sync) STARTED" note with a one-line "5-BE-a (idempotency keys, done)" bullet. In section 7, update the status: Phase 4 complete; Phase 5 underway, first piece (idempotency keys) done; update the backend check count to the number from Step 1 (frontend stays 27).

- [ ] **Step 6: Update `CONTEXT.md`**

Change the Phase 5 line to show it is split and underway (e.g. `- [~] **Phase 5** - Field app + offline sync. Backend sync-contract track: [x] 5-BE-a idempotency keys; [ ] 5-BE-b batch sync; [ ] 5-BE-c photo storage. Mobile track: [ ] 5-M-a..d.`), and add a progress-log entry dated 2026-06-18 summarizing 5-BE-a (optional client-generated idempotency key on POST /responses and POST /time-entries, nullable column + partial unique index, replay returns the original, backward-compatible, the test count from Step 1, frontend still 27).

- [ ] **Step 7: Update the prototype handoff CHANGELOG**

In `../hi-fi-intelli/Intelli_Complete_Handoff.md`, add a newest-first entry dated **2026-06-18 (production: Phase 5-BE-a complete)** in the same voice as the prior entries, describing the idempotency keys and noting the next pieces (5-BE-b batch sync, then the Expo mobile app). (This repo is on branch `step3-ui-polish`, where the recent handoff entries live; commit there.)

- [ ] **Step 8: Commit the docs**

```bash
git add api/README.md db/README.md CODEBASE_MAP.md START_HERE.md CONTEXT.md
git commit -m "Docs: Phase 5-BE-a idempotency keys (guides + status + progress log)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git -C ../hi-fi-intelli add Intelli_Complete_Handoff.md
git -C ../hi-fi-intelli commit -m "Docs: Phase 5-BE-a idempotency keys complete (production handoff CHANGELOG)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Optional key on the two rep submit endpoints: Tasks 2-3 (`ResponseCreate`/`TimeEntryCreate` + passthrough). ✓
- Nullable column + partial unique index, per company, backward-compatible: Task 1 migration. ✓
- Replay returns the original (responses via `get_response`; hours via `_ENTRY_COLS` row, no scope join, user_id-scoped lookup): Tasks 2-3 Step 3. ✓
- Hours short-circuit before the sealed/exists checks; different ticket still 409: `create_time_entry` order + `test_hours_different_ticket_same_period_409`. ✓
- UUID binding (`cast(:idem as uuid)`, str-or-None): both INSERTs and lookups. ✓
- Tests: same-ticket one-row + full-body + key-not-leaked; no-ticket two rows; keyed-then-unkeyed; direct duplicate index rejection; cross-company (responses); keyed-first still scoped+validated; hours replay + key==ticket + 409 control + payroll-off 403. ✓
- Migration is a self-contained script matching the payroll envelope; schema.sql regenerated. Task 1. ✓
- Docs updated. Task 4. ✓

**Placeholder scan:** none; every code step shows complete code, every test shows full asserts.

**Type/name consistency:** the `idempotency_key=None` trailing param matches between `scope.py`, `responses.py`, and `payroll.py` call sites; the index names `responses_tenant_idem_idx` / `time_entries_tenant_idem_idx` match between the migration up and down; `_ENTRY_COLS` / `_RESPONSE_COLS` are reused unchanged; helper names (`_submit`, `_open_period`, `_post_entry`) are defined once in `test_idempotency.py`. ✓
