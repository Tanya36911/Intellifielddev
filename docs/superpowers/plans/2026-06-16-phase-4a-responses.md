# Phase 4a: Responses + read-time pass/fail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store a rep's completed survey for a store as atomic per-product rows, and read it back with pass/fail computed live from the survey version's rules, never stored.

**Architecture:** Two new tables (`responses` envelope + `response_items` atomic rows). A pure evaluator module (`compliance.py`) scores answers against pass rules at read time. The shared `ScopedRepo` gains `create_response` / `list_responses` / `get_response`, all branch-scoped like assignments. A new `responses.py` router exposes `POST /responses`, `GET /responses`, `GET /responses/{id}`. Backend only; no screens (same shape as Phase 3a/3b).

**Tech Stack:** FastAPI, SQLAlchemy Core (`text()` + `engine`), Pydantic v2, plain-SQL dbmate migrations, pytest against a throwaway Postgres.

---

## Conventions used throughout (read once)

- **Error codes** (match the existing surveys/catalog routers):
  - malformed request body (missing field, wrong JSON type) -> **422** (Pydantic, automatic).
  - business-rule violation (unknown question, value does not match the survey, version not published) -> **400** (we raise `HTTPException(400, ...)` from a `ValueError`).
  - out-of-scope / not-found target (store not in your branch, response not yours) -> **404**.
- **UUID casting:** tenant/user ids arrive from the JWT as text, so every SQL comparison against a `uuid` column uses `cast(:param as uuid)`, exactly like `scope.py` already does.
- **Apply code changes:** `docker compose restart api` (code is live-mounted).
- **Apply the migration to your dev DB:** `bash scripts/db-migrate.sh`.
- **Run backend tests** (backend must be up): `pnpm test:api`.
- **Run frontend tests:** `pnpm test:admin`.
- The pytest harness (`api/tests/conftest.py`) rebuilds the test DB from every migration each session, so a new migration is picked up automatically; no test-config change needed.

---

## File structure

| File | New/Modify | Responsibility |
|------|-----------|----------------|
| `db/migrations/20260616000002_create_responses.sql` | Create | The two tables + indexes (with undo). |
| `api/app/compliance.py` | Create | Pure pass/fail evaluator. No DB, no request state. |
| `api/app/responses.py` | Create | The responses router + Pydantic models. |
| `api/app/scope.py` | Modify | Add `create_response` / `list_responses` / `get_response` + answer-shape validation helpers to `ScopedRepo`. |
| `api/app/main.py` | Modify | Mount the responses router. |
| `api/app/seed.py` | Modify | Add demo responses (Lumen + Acme). |
| `api/tests/test_compliance.py` | Create | Pure-evaluator unit tests (the headline gate). |
| `api/tests/test_responses.py` | Create | Submit + read + scope + freeze tests through the API. |
| Docs | Modify | START_HERE, CONTEXT, CODEBASE_MAP, api/README, db/README, CHECKING_THE_WORK, handoff CHANGELOG. |

---

## Task 1: Database migration (two tables + indexes)

**Files:**
- Create: `db/migrations/20260616000002_create_responses.sql`
- Modify (auto-generated): `db/schema.sql`

- [ ] **Step 1: Write the migration**

Create `db/migrations/20260616000002_create_responses.sql` with exactly this content (same self-protecting format as `20260616000001_create_surveys.sql`):

```sql
-- migrate:up transaction:false
-- transaction:false: dbmate skips its own transaction so this file can manage
-- its own (BEGIN/COMMIT), making it safe under dbmate or hand-run psql.
-- Error-stop is enforced by the runner (deploy script: psql -v ON_ERROR_STOP=1).
begin;
set local timezone = 'UTC';

-- One row per completed submission of a survey at a store (the "envelope").
-- store_path is a SNAPSHOT of the store's place in the org tree at submit time
-- (the SCD Type 2 freeze): history stays bucketed where it was collected even
-- if the store is re-parented later. online is always true in Phase 4a; it is
-- here for Phase 5 offline sync to mark records that arrived after the fact.
create table responses (
    id                 uuid primary key default gen_random_uuid(),
    tenant_id          uuid not null references tenants(id),
    survey_version_id  uuid not null references survey_versions(id),
    store_node_id      uuid not null references nodes(id),
    store_path         text not null,
    user_id            uuid not null references users(id),
    online             boolean not null default true,
    submitted_at       timestamptz not null default now(),
    created_at         timestamptz not null default now()
);
create index responses_tenant_idx on responses (tenant_id);
create index responses_store_idx on responses (store_node_id);
create index responses_version_idx on responses (survey_version_id);
create index responses_submitted_idx on responses (submitted_at);

-- The atomic answer rows: one per (response, question, product). A non-per-
-- product question makes one row with sku_id NULL; a per-product question makes
-- one row per product. value holds ONLY the raw answer (number, bool, choice,
-- list, text, or photo url). There is deliberately NO pass/fail column: the
-- verdict is always recomputed at read time from the version's rules.
-- tenant_id/store_node_id/store_path/survey_version_id/submitted_at are
-- denormalized so Phase 4b analytics is one indexed scan, no joins.
create table response_items (
    id                 uuid primary key default gen_random_uuid(),
    response_id        uuid not null references responses(id) on delete cascade,
    tenant_id          uuid not null references tenants(id),
    store_node_id      uuid not null references nodes(id),
    store_path         text not null,
    survey_version_id  uuid not null references survey_versions(id),
    submitted_at       timestamptz not null default now(),
    question_id        text not null,
    sku_id             uuid references skus(id),
    value              jsonb not null
);
create index response_items_response_idx on response_items (response_id);
create index response_items_store_idx on response_items (tenant_id, store_node_id);
create index response_items_sku_time_idx on response_items (tenant_id, sku_id, submitted_at);
create index response_items_question_idx on response_items (tenant_id, question_id);

commit;

-- migrate:down transaction:false
begin;
set local timezone = 'UTC';
drop table response_items;
drop table responses;
commit;
```

- [ ] **Step 2: Apply it and verify up/down works**

Run:
```bash
docker compose up -d
docker compose run --rm migrate up
docker compose run --rm migrate down
docker compose run --rm migrate up
```
Expected: each command exits 0. The `down` drops both tables, the final `up` recreates them. `db/schema.sql` is regenerated by dbmate and now contains `responses` and `response_items`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/20260616000002_create_responses.sql db/schema.sql
git commit -m "Phase 4a: responses + response_items tables (migration)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The pure pass/fail evaluator (the headline gate)

**Files:**
- Create: `api/app/compliance.py`
- Test: `api/tests/test_compliance.py`

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_compliance.py`:

```python
"""Phase 4a gate: pass/fail is a pure function of (answer, rule), never stored.
The same stored answer must score differently when the rule differs."""
from app.compliance import evaluate_value, evaluate_question, evaluate_response


def test_operators_numeric():
    assert evaluate_value(5, {"operator": ">=", "value": 4}) is True
    assert evaluate_value(3, {"operator": ">=", "value": 4}) is False
    assert evaluate_value(3, {"operator": "<", "value": 4}) is True
    assert evaluate_value(4, {"operator": "==", "value": 4}) is True
    assert evaluate_value(4, {"operator": "!=", "value": 4}) is False


def test_operators_membership():
    assert evaluate_value("clean", {"operator": "in", "value": ["clean", "tidy"]}) is True
    assert evaluate_value("dirty", {"operator": "in", "value": ["clean", "tidy"]}) is False
    assert evaluate_value("dirty", {"operator": "not_in", "value": ["clean"]}) is True


def test_blank_or_no_rule_is_not_counted():
    assert evaluate_value(None, {"operator": ">=", "value": 4}) is None
    assert evaluate_value(5, None) is None


def test_question_each_mode():
    # every answered product must pass
    rule = {"operator": ">=", "value": 4}
    assert evaluate_question([5, 6, 4], rule, per_sku=True, pass_scope="each") is True
    assert evaluate_question([5, 2, 4], rule, per_sku=True, pass_scope="each") is False
    # blanks are ignored, not failed
    assert evaluate_question([5, None], rule, per_sku=True, pass_scope="each") is True
    assert evaluate_question([None, None], rule, per_sku=True, pass_scope="each") is None


def test_question_total_mode():
    rule = {"operator": ">=", "value": 12}
    assert evaluate_question([5, 4, 4], rule, per_sku=True, pass_scope="total") is True
    assert evaluate_question([5, 4, 2], rule, per_sku=True, pass_scope="total") is False


def test_same_answer_different_rule_flips_verdict():
    # THE gate: identical stored answer, different rule -> different verdict.
    answer = 4
    assert evaluate_value(answer, {"operator": ">=", "value": 4}) is True
    assert evaluate_value(answer, {"operator": ">=", "value": 6}) is False


def test_evaluate_response_overall():
    questions = [
        {"id": "q1", "type": "number", "perSku": True, "passScope": "each",
         "pass": {"operator": ">=", "value": 4}},
        {"id": "q2", "type": "boolean", "pass": {"operator": "==", "value": True}},
        {"id": "q3", "type": "text"},  # no rule -> never counted
    ]
    items = [
        {"question_id": "q1", "sku_id": "s1", "value": 5},
        {"question_id": "q1", "sku_id": "s2", "value": 3},  # fails
        {"question_id": "q2", "sku_id": None, "value": True},
        {"question_id": "q3", "sku_id": None, "value": "note"},
    ]
    scored = evaluate_response(questions, items)
    assert scored["questions"]["q1"] is False
    assert scored["questions"]["q2"] is True
    assert scored["questions"]["q3"] is None
    assert scored["overall"] is False  # one countable question failed
    # per-item verdicts present
    verdicts = {(i["question_id"], i["value"]): i["pass"] for i in scored["items"]}
    assert verdicts[("q1", 5)] is True
    assert verdicts[("q1", 3)] is False


def test_evaluate_response_overall_pass_and_none():
    questions = [{"id": "q1", "type": "number",
                  "pass": {"operator": ">=", "value": 4}}]
    assert evaluate_response(questions, [{"question_id": "q1", "sku_id": None, "value": 5}])["overall"] is True
    # nothing countable -> overall None
    assert evaluate_response([{"id": "q1", "type": "text"}],
                             [{"question_id": "q1", "sku_id": None, "value": "x"}])["overall"] is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:api -- tests/test_compliance.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.compliance'`.

- [ ] **Step 3: Write the implementation**

Create `api/app/compliance.py`:

```python
"""Pure pass/fail scoring. No database, no request state: given raw answer
values and a question's pass rule, decide pass / fail / not-counted.

Pass/fail is NEVER stored; it is recomputed here on every read, so changing a
rule changes the verdict immediately. That property is the Phase 4a gate.
"""

_NUMERIC_OPS = {
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}


def _compare(value, operator, target) -> bool:
    if operator in _NUMERIC_OPS:
        return _NUMERIC_OPS[operator](value, target)
    if operator == "in":
        return value in target
    if operator == "not_in":
        return value not in target
    raise ValueError(f"unknown operator: {operator}")


def evaluate_value(value, rule) -> bool | None:
    """One answer value against one pass rule. None = not counted (no rule, or
    a blank answer)."""
    if rule is None or value is None:
        return None
    return _compare(value, rule["operator"], rule["value"])


def evaluate_question(values, rule, per_sku, pass_scope) -> bool | None:
    """All the answer values for one question (a per-product question has
    several) against its pass rule. None = not counted (no rule or all blank).
    'total' sums the values first; 'each' (and non-per-product) requires every
    answered value to pass."""
    if rule is None:
        return None
    present = [v for v in values if v is not None]
    if not present:
        return None
    if per_sku and pass_scope == "total":
        return _compare(sum(present), rule["operator"], rule["value"])
    return all(_compare(v, rule["operator"], rule["value"]) for v in present)


def evaluate_response(questions, items) -> dict:
    """Score a whole response. questions = the version's question dicts;
    items = list of {question_id, sku_id, value}. Returns:
      - items: each item with an added per-item 'pass' (bool/None),
      - questions: {question_id: verdict bool/None},
      - overall: True only if every countable question passes; None if nothing
        countable; False if any countable question fails.
    """
    by_q: dict[str, list] = {}
    for it in items:
        by_q.setdefault(it["question_id"], []).append(it)
    q_index = {q["id"]: q for q in questions}

    question_verdicts = {}
    for q in questions:
        rule = q.get("pass")
        per_sku = q.get("perSku", False)
        pass_scope = q.get("passScope", "each")
        values = [i["value"] for i in by_q.get(q["id"], [])]
        question_verdicts[q["id"]] = evaluate_question(values, rule, per_sku, pass_scope)

    item_verdicts = []
    for it in items:
        q = q_index.get(it["question_id"], {})
        item_verdicts.append({**it, "pass": evaluate_value(it["value"], q.get("pass"))})

    countable = [v for v in question_verdicts.values() if v is not None]
    overall = all(countable) if countable else None
    return {"items": item_verdicts, "questions": question_verdicts, "overall": overall}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:api -- tests/test_compliance.py`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add api/app/compliance.py api/tests/test_compliance.py
git commit -m "Phase 4a: pure pass/fail evaluator (recompute-from-rule gate)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Submit a response (`POST /responses`) + read one (`GET /responses/{id}`)

This task builds the envelope+items insert, scope/version enforcement, the
store-path snapshot, and the single-response read used to verify the result.
Answer-shape validation comes in Task 4.

**Files:**
- Create: `api/app/responses.py`
- Modify: `api/app/scope.py` (add response methods), `api/app/main.py` (mount router)
- Test: `api/tests/test_responses.py`

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_responses.py`:

```python
"""Phase 4a: responses are stored as atomic per-product rows and read back with
pass/fail computed live. Submission is scope-follows-pin and published-version
only."""
from sqlalchemy import text

from app.db import engine


def _scalar(sql, **p):
    with engine.connect() as conn:
        return conn.execute(text(sql), p).scalar()


def _node_id(code):
    return _scalar("select id from nodes where code = :c", c=code)


def _sku_id(upc):
    return _scalar("select id from skus where upc = :u", u=upc)


def _lumen_version_id():
    return _scalar(
        "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
        "where s.name = 'Velvet Lip Shelf Check' and v.published_at is not null "
        "order by v.version_number desc limit 1"
    )


def _submit(client, token, version_id, store_id, answers):
    return client.post(
        "/responses",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": str(version_id), "store_node_id": str(store_id),
              "answers": answers},
    )


def test_submit_requires_auth(client):
    assert client.post("/responses", json={}).status_code in (401, 422)


def test_rep_submits_for_own_store(client, login):
    token = login("marcus@lumenbeauty.com")  # rep pinned at Bay Area
    rose = _sku_id("LUM-VL-ROSE")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
        {"question_id": "q2", "value": True},
    ])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["items"]) == 2          # one per (question, product)
    assert body["overall"] is True          # 5 >= 4 and endcap present
    assert body["questions"]["q1"] is True
    assert body["questions"]["q2"] is True


def test_submit_computes_fail_from_rule(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    resp = _submit(client, token, _lumen_version_id(), _node_id("oakland"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 2},  # 2 < 4 -> fail
        {"question_id": "q2", "value": True},
    ])
    assert resp.status_code == 200, resp.text
    assert resp.json()["overall"] is False


def test_submit_out_of_scope_store_404(client, login):
    token = login("marcus@lumenbeauty.com")  # Bay Area only
    resp = _submit(client, token, _lumen_version_id(), _node_id("chicago-store"), [])
    assert resp.status_code == 404, resp.text
    assert "scope" in resp.json()["detail"].lower()


def test_submit_cross_tenant_store_404(client, login):
    token = login("marcus@lumenbeauty.com")
    resp = _submit(client, token, _lumen_version_id(), _node_id("boston-store"), [])
    assert resp.status_code == 404, resp.text
    assert "scope" in resp.json()["detail"].lower()


def test_submit_target_must_be_a_store_404(client, login):
    token = login("dana@lumenbeauty.com")  # admin, whole company in scope
    resp = _submit(client, token, _lumen_version_id(), _node_id("west"), [])  # a Region, not a store
    assert resp.status_code == 404, resp.text


def test_submit_unpublished_version_400(client, login):
    token = login("dana@lumenbeauty.com")
    # create a draft survey -> its v1 is unpublished
    draft = client.post(
        "/surveys", headers={"Authorization": f"Bearer {token}"},
        json={"name": "Draft For Response", "type": None,
              "questions": [{"id": "q1", "prompt": "x", "type": "boolean"}]},
    ).json()
    draft_vid = draft["versions"][0]["id"]
    resp = _submit(client, token, draft_vid, _node_id("sf"), [])
    assert resp.status_code == 400, resp.text
    assert "published" in resp.json()["detail"].lower()


def test_get_one_response_returns_computed_verdicts(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    created = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
        {"question_id": "q2", "value": True},
    ]).json()
    got = client.get(f"/responses/{created['id']}",
                     headers={"Authorization": f"Bearer {token}"})
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["overall"] is True
    assert any(i["question_id"] == "q1" and i["pass"] is True for i in body["items"])
    assert body["store_path"]  # the tree snapshot was stored
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:api -- tests/test_responses.py`
Expected: FAIL. The happy-path POST returns 404 ("Not Found", route missing), so the assertions fail.

- [ ] **Step 3: Add the response methods to `ScopedRepo`**

In `api/app/scope.py`, add this import near the top (with the other imports):

```python
from .compliance import evaluate_response
```

Then add this section to the `ScopedRepo` class, after the assignment methods
(just before the closing of the class, after `delete_assignment`):

```python
    # ----- responses (branch-scoped, like assignments; atomic per-SKU rows) -----

    _RESPONSE_COLS = ("id, survey_version_id, store_node_id, store_path, user_id, "
                      "online, submitted_at, created_at")

    def create_response(self, survey_version_id, store_node_id, answers, user_id) -> dict | None:
        """Store one completed response. Returns None if the store is not a store
        in the caller's scope. Raises VersionNotPublishedError if the version is
        missing/unpublished, ValueError if an answer does not fit the version."""
        if self.scope_path is None:
            return None
        with engine.begin() as conn:
            version = conn.execute(
                text(
                    "select v.id, v.questions from survey_versions v "
                    "join surveys s on s.id = v.survey_id "
                    "where v.id = cast(:vid as uuid) and s.tenant_id = cast(:tid as uuid) "
                    "and v.published_at is not null"
                ),
                {"vid": str(survey_version_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if version is None:
                raise VersionNotPublishedError()
            store = conn.execute(
                text(
                    "select id, path from nodes where id = cast(:nid as uuid) "
                    "and tenant_id = cast(:tid as uuid) and path like :scope || '%' "
                    "and level_order = (select max(level_order) from org_level_definitions "
                    "where tenant_id = cast(:tid as uuid))"
                ),
                {"nid": str(store_node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            if store is None:
                return None
            rows = self._explode_answers(version["questions"], answers)
            resp = conn.execute(
                text(
                    "insert into responses (tenant_id, survey_version_id, store_node_id, "
                    "store_path, user_id) values (cast(:tid as uuid), cast(:vid as uuid), "
                    "cast(:nid as uuid), :spath, cast(:uid as uuid)) "
                    f"returning {self._RESPONSE_COLS}"
                ),
                {"tid": str(self.tenant_id), "vid": str(survey_version_id),
                 "nid": str(store_node_id), "spath": store["path"], "uid": str(user_id)},
            ).mappings().first()
            for r in rows:
                conn.execute(
                    text(
                        "insert into response_items (response_id, tenant_id, store_node_id, "
                        "store_path, survey_version_id, submitted_at, question_id, sku_id, value) "
                        "values (cast(:rid as uuid), cast(:tid as uuid), cast(:nid as uuid), "
                        ":spath, cast(:vid as uuid), :sub, :qid, cast(:sku as uuid), cast(:val as jsonb))"
                    ),
                    {"rid": str(resp["id"]), "tid": str(self.tenant_id),
                     "nid": str(store_node_id), "spath": store["path"],
                     "vid": str(survey_version_id), "sub": resp["submitted_at"],
                     "qid": r["question_id"],
                     "sku": str(r["sku_id"]) if r["sku_id"] else None,
                     "val": json.dumps(r["value"])},
                )
        return self.get_response(resp["id"])

    def _explode_answers(self, questions: list[dict], answers: list[dict]) -> list[dict]:
        """Turn the submitted answers into atomic rows. Phase 4a Task 3: pass
        through, dropping only blanks. Task 4 adds shape validation here."""
        rows = []
        for a in answers:
            if a.get("value") is None:
                continue
            rows.append({"question_id": a["question_id"], "sku_id": a.get("sku_id"),
                         "value": a["value"]})
        return rows

    def _score(self, conn, response_row) -> dict:
        """Load a response's items + its version questions and compute verdicts."""
        version = conn.execute(
            text("select questions from survey_versions where id = cast(:vid as uuid)"),
            {"vid": str(response_row["survey_version_id"])},
        ).mappings().first()
        items = conn.execute(
            text(
                "select question_id, sku_id, value from response_items "
                "where response_id = cast(:rid as uuid) order by question_id, sku_id"
            ),
            {"rid": str(response_row["id"])},
        ).mappings().all()
        return evaluate_response(version["questions"], [dict(i) for i in items])

    # Same columns as _RESPONSE_COLS but r.-qualified, because the list/get
    # queries join nodes (which also has an `id` column) for the path filter.
    _RESPONSE_COLS_R = ("r.id, r.survey_version_id, r.store_node_id, r.store_path, "
                        "r.user_id, r.online, r.submitted_at, r.created_at")

    def list_responses(self) -> list[dict]:
        if self.scope_path is None:
            return []
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"select {self._RESPONSE_COLS_R} from responses r "
                    "join nodes n on n.id = r.store_node_id "
                    "where r.tenant_id = cast(:tid as uuid) and n.path like :scope || '%' "
                    "order by r.submitted_at desc"
                ),
                {"tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().all()
            result = []
            for r in rows:
                result.append({**dict(r), "overall": self._score(conn, r)["overall"]})
        return result

    def get_response(self, response_id) -> dict | None:
        if self.scope_path is None:
            return None
        with engine.connect() as conn:
            r = conn.execute(
                text(
                    f"select {self._RESPONSE_COLS_R} from responses r "
                    "join nodes n on n.id = r.store_node_id "
                    "where r.id = cast(:rid as uuid) and r.tenant_id = cast(:tid as uuid) "
                    "and n.path like :scope || '%'"
                ),
                {"rid": str(response_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            if r is None:
                return None
            scored = self._score(conn, r)
        result = dict(r)
        result["items"] = scored["items"]
        result["questions"] = scored["questions"]
        result["overall"] = scored["overall"]
        return result
```

Note: `_RESPONSE_COLS` (bare) is used only in the Task 3 `insert ... returning`
clause, which has no join and is unambiguous. `_RESPONSE_COLS_R` (r.-qualified)
is used in the list/get queries, which join `nodes` (also has an `id` column).

- [ ] **Step 4: Create the router**

Create `api/app/responses.py`:

```python
"""The responses API. A response is one completed survey filled in at a store.
It is stored as atomic per-product rows (see ScopedRepo) and read back with
pass/fail computed live by compliance.py, never stored. Submission is
scope-follows-pin (the store must be in the caller's branch) and published-
version only. Any signed-in user may submit for an in-scope store.
"""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .scope import ScopedRepo, VersionNotPublishedError, get_scoped_repo
from .security import current_claims

router = APIRouter(tags=["responses"])


class Answer(BaseModel):
    question_id: str = Field(min_length=1)
    sku_id: UUID | None = None
    value: Any = None  # number / bool / str / list / None (blank)


class ResponseCreate(BaseModel):
    survey_version_id: UUID
    store_node_id: UUID
    answers: list[Answer] = []


@router.post("/responses")
def submit_response(
    body: ResponseCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(current_claims),
) -> dict:
    try:
        result = repo.create_response(
            body.survey_version_id,
            body.store_node_id,
            [a.model_dump(mode="json") for a in body.answers],
            claims["sub"],
        )
    except VersionNotPublishedError:
        raise HTTPException(status_code=400, detail="Survey version not found or not published")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="Store not found in your scope")
    return result


@router.get("/responses")
def list_responses(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    rows = repo.list_responses()
    return {"responses": rows, "count": len(rows)}


@router.get("/responses/{response_id}")
def get_response(
    response_id: UUID, repo: ScopedRepo = Depends(get_scoped_repo)
) -> dict:
    result = repo.get_response(response_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Response not found in your scope")
    return result
```

- [ ] **Step 5: Mount the router in `main.py`**

In `api/app/main.py`, add the import alongside the others:

```python
from .responses import router as responses_router
```

and add the include alongside the others:

```python
app.include_router(responses_router)
```

- [ ] **Step 6: Apply code and run the tests**

Run:
```bash
docker compose restart api
pnpm test:api -- tests/test_responses.py
```
Expected: PASS (all 8 tests in the file). If a per-item ordering assertion is
flaky, note `order by question_id, sku_id` in `_score` keeps it stable.

- [ ] **Step 7: Commit**

```bash
git add api/app/responses.py api/app/scope.py api/app/main.py api/tests/test_responses.py
git commit -m "Phase 4a: submit + read one response (scope + published-version + live scoring)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Strict answer-shape validation (allow skips)

**Files:**
- Modify: `api/app/scope.py` (replace `_explode_answers`, add `_check_value`)
- Test: `api/tests/test_responses.py` (add validation tests)

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_responses.py`:

```python
def test_unknown_question_rejected(client, login):
    token = login("marcus@lumenbeauty.com")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "nope", "value": 5},
    ])
    assert resp.status_code == 400, resp.text
    assert "unknown question" in resp.json()["detail"].lower()


def test_wrong_value_type_rejected(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": "five"},  # q1 is a number
    ])
    assert resp.status_code == 400, resp.text
    assert "number" in resp.json()["detail"].lower()


def test_sku_not_covered_rejected(client, login):
    token = login("marcus@lumenbeauty.com")
    other = _sku_id("LUM-SF-IVORY")  # a real Lumen sku, but not on q1
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(other), "value": 5},
    ])
    assert resp.status_code == 400, resp.text
    assert "not covered" in resp.json()["detail"].lower()


def test_sku_on_non_per_product_rejected(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q2", "sku_id": str(rose), "value": True},  # q2 is not per-product
    ])
    assert resp.status_code == 400, resp.text
    assert "not per-product" in resp.json()["detail"].lower()


def test_per_product_requires_sku(client, login):
    token = login("marcus@lumenbeauty.com")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "value": 5},  # q1 is per-product, sku missing
    ])
    assert resp.status_code == 400, resp.text
    assert "sku_id required" in resp.json()["detail"].lower()


def test_duplicate_answer_rejected(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
        {"question_id": "q1", "sku_id": str(rose), "value": 6},
    ])
    assert resp.status_code == 400, resp.text
    assert "duplicate" in resp.json()["detail"].lower()


def test_blank_answer_is_skipped_not_stored(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    created = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
        {"question_id": "q2", "value": None},  # blank -> dropped
    ]).json()
    assert len(created["items"]) == 1  # only q1 stored
    assert created["questions"]["q2"] is None  # not counted
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:api -- tests/test_responses.py`
Expected: the new tests FAIL (the current pass-through `_explode_answers` stores bad data and returns 200 instead of 400; the blank test already passes).

- [ ] **Step 3: Replace `_explode_answers` and add `_check_value` in `scope.py`**

Replace the Task 3 `_explode_answers` method with this validating version:

```python
    def _explode_answers(self, questions: list[dict], answers: list[dict]) -> list[dict]:
        """Strict shape, skips allowed. Returns atomic rows (blanks dropped).
        Raises ValueError on anything that does not fit the version."""
        q_index = {q["id"]: q for q in questions}
        seen = set()
        rows = []
        for a in answers:
            qid = a["question_id"]
            q = q_index.get(qid)
            if q is None:
                raise ValueError(f"unknown question: {qid}")
            sku_id = a.get("sku_id")
            if q.get("perSku", False):
                if sku_id is None:
                    raise ValueError(f"question {qid} is per-product; sku_id required")
                allowed = {str(s) for s in (q.get("sku_ids") or [])}
                if str(sku_id) not in allowed:
                    raise ValueError(f"sku {sku_id} is not covered by question {qid}")
            elif sku_id is not None:
                raise ValueError(f"question {qid} is not per-product; sku_id not allowed")
            key = (qid, str(sku_id) if sku_id else None)
            if key in seen:
                raise ValueError(f"duplicate answer for question {qid}")
            seen.add(key)
            value = a.get("value")
            if value is None:
                continue  # blank: allowed, simply not stored
            _check_value(value, q)
            rows.append({"question_id": qid, "sku_id": sku_id, "value": value})
        return rows
```

Add this module-level function to `scope.py` (place it near the bottom, beside
`scope_path_for`):

```python
def _check_value(value, q) -> None:
    """Raise ValueError if a non-blank answer value does not match its question
    type (and, for choice questions, its options)."""
    qtype = q["type"]
    if qtype == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"question {q['id']} expects a number")
    elif qtype == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"question {q['id']} expects true/false")
    elif qtype == "single_choice":
        if not isinstance(value, str) or value not in (q.get("options") or []):
            raise ValueError(f"question {q['id']} expects one of its options")
    elif qtype == "multi_choice":
        opts = q.get("options") or []
        if not isinstance(value, list) or not all(v in opts for v in value):
            raise ValueError(f"question {q['id']} expects a subset of its options")
    elif qtype in ("text", "photo"):
        if not isinstance(value, str):
            raise ValueError(f"question {q['id']} expects text")
    else:
        raise ValueError(f"question {q['id']} has unknown type {qtype}")
```

- [ ] **Step 4: Apply code and run the tests**

Run:
```bash
docker compose restart api
pnpm test:api -- tests/test_responses.py
```
Expected: PASS (all tests in the file, including the new validation tests).

- [ ] **Step 5: Commit**

```bash
git add api/app/scope.py api/tests/test_responses.py
git commit -m "Phase 4a: strict answer-shape validation on submit (allow skips)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: List + read scope isolation

**Files:**
- Test: `api/tests/test_responses.py` (add list/isolation tests)

The code already exists (Task 3). These tests lock in the scope guarantees; they
assert on specific detail strings so they fail meaningfully if the guard regresses.

- [ ] **Step 1: Write the tests**

Append to `api/tests/test_responses.py`:

```python
def _seeded_lumen_response_id():
    return _scalar(
        "select r.id from responses r join survey_versions v on v.id = r.survey_version_id "
        "join surveys s on s.id = v.survey_id where s.name = 'Velvet Lip Shelf Check' "
        "order by r.submitted_at limit 1"
    )


def test_list_is_scoped_to_branch(client, login):
    # Marcus (Bay Area) submits, then sees his own response in the list.
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    _submit(client, token, _lumen_version_id(), _node_id("sf"),
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    listed = client.get("/responses", headers={"Authorization": f"Bearer {token}"})
    assert listed.status_code == 200, listed.text
    assert listed.json()["count"] >= 1
    assert all("overall" in r for r in listed.json()["responses"])


def test_company_isolation(client, login):
    # Avery (Acme) never sees a Lumen response, by list or by direct id.
    lumen_id = _seeded_lumen_response_id()
    avery = login("avery@acme.com")
    listed = client.get("/responses", headers={"Authorization": f"Bearer {avery}"}).json()
    assert all(str(r["id"]) != str(lumen_id) for r in listed["responses"])
    direct = client.get(f"/responses/{lumen_id}", headers={"Authorization": f"Bearer {avery}"})
    assert direct.status_code == 404, direct.text


def test_sibling_region_manager_sees_zero(client, login):
    # Marcus (Bay Area, West) submits; Sarah (Central) must not see it.
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    created = _submit(client, marcus, _lumen_version_id(), _node_id("sf"),
                      [{"question_id": "q1", "sku_id": str(rose), "value": 5}]).json()
    sarah = login("sarah@lumenbeauty.com")
    direct = client.get(f"/responses/{created['id']}",
                        headers={"Authorization": f"Bearer {sarah}"})
    assert direct.status_code == 404, direct.text


def test_no_pin_user_sees_nothing(client, login):
    token = login("newbie@lumenbeauty.com")  # rep with no pin
    listed = client.get("/responses", headers={"Authorization": f"Bearer {token}"})
    assert listed.status_code == 200
    assert listed.json()["count"] == 0
```

- [ ] **Step 2: Apply (no code change) and run**

Run: `pnpm test:api -- tests/test_responses.py`
Expected: PASS (all tests, including the four new isolation tests). If
`test_company_isolation` cannot find a seeded Lumen response, Task 7 (seed) has
not run yet; run it after Task 7 or rely on the submitted rows. To be safe, this
test reads `_seeded_lumen_response_id()` which Task 7 guarantees; until then it
will be covered once the seed exists. (Order: this passes after Task 7 reseeds.)

- [ ] **Step 3: Commit**

```bash
git add api/tests/test_responses.py
git commit -m "Phase 4a: response list + read scope-isolation tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Re-visit retained + tree-snapshot freeze

**Files:**
- Test: `api/tests/test_responses.py` (add behavior tests)

- [ ] **Step 1: Write the tests**

Append to `api/tests/test_responses.py`:

```python
def test_revisit_keeps_both_submissions(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    before = client.get("/responses", headers={"Authorization": f"Bearer {token}"}).json()["count"]
    _submit(client, token, _lumen_version_id(), _node_id("oakland"),
            [{"question_id": "q1", "sku_id": str(rose), "value": 4}])
    _submit(client, token, _lumen_version_id(), _node_id("oakland"),
            [{"question_id": "q1", "sku_id": str(rose), "value": 6}])
    after = client.get("/responses", headers={"Authorization": f"Bearer {token}"}).json()["count"]
    assert after == before + 2  # nothing overwritten


def test_store_path_snapshot_is_frozen(client, login):
    # The stored snapshot equals the store's path at submit time and does NOT
    # change when the node is later re-parented. Checked at the storage level:
    # re-parenting changes the live nodes.path, which would drop the row out of
    # every scope, so the freeze can only be observed on the stored column.
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    created = _submit(client, token, _lumen_version_id(), _node_id("sf"),
                      [{"question_id": "q1", "sku_id": str(rose), "value": 5}]).json()
    snapshot = created["store_path"]
    assert snapshot  # a snapshot was stored
    live = _scalar("select path from nodes where code = 'sf'")
    assert snapshot == live  # snapshot == the store's path at submit time
    # re-parent the node; the stored snapshot must NOT move with it
    with engine.begin() as conn:
        conn.execute(text("update nodes set path = '/tampered/' where code = 'sf'"))
    try:
        frozen = _scalar("select store_path from responses where id = cast(:rid as uuid)",
                         rid=created["id"])
        assert frozen == snapshot  # unchanged despite the re-parent
    finally:
        from app.seed import run
        run()  # idempotently restores sf's real path so later tests are unaffected
```

Note: this asserts on the stored `responses.store_path` column directly (via
`_scalar`), not through the scoped endpoint, because tampering the live path
would 404 the row for everyone. That is exactly the freeze property: storage is
frozen even though the live tree moved.

- [ ] **Step 2: Run the tests**

Run: `pnpm test:api -- tests/test_responses.py`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add api/tests/test_responses.py
git commit -m "Phase 4a: re-visit retained + store-path snapshot freeze tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Seed demo responses

**Files:**
- Modify: `api/app/seed.py`

- [ ] **Step 1: Add the `_response` helper**

In `api/app/seed.py`, add this helper after the `_survey` function:

```python
def _response(conn, tenant_id, survey_name, store_code, user_email, answers):
    """Insert one demo response with its atomic answer rows. Idempotent: if this
    user already has a response for this store+version, do nothing."""
    version_id = conn.execute(
        text(
            "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
            "where s.tenant_id = :tid and s.name = :name and v.published_at is not null "
            "order by v.version_number desc limit 1"
        ),
        {"tid": tenant_id, "name": survey_name},
    ).scalar()
    store = conn.execute(
        text("select id, path from nodes where tenant_id = :tid and code = :code"),
        {"tid": tenant_id, "code": store_code},
    ).mappings().first()
    user_id = conn.execute(
        text("select id from users where tenant_id = :tid and email = :email"),
        {"tid": tenant_id, "email": user_email},
    ).scalar()
    existing = conn.execute(
        text(
            "select id from responses where survey_version_id = :vid "
            "and store_node_id = :nid and user_id = :uid"
        ),
        {"vid": version_id, "nid": store["id"], "uid": user_id},
    ).scalar()
    if existing:
        return existing
    resp_id = conn.execute(
        text(
            "insert into responses (tenant_id, survey_version_id, store_node_id, store_path, user_id) "
            "values (:tid, :vid, :nid, :spath, :uid) returning id"
        ),
        {"tid": tenant_id, "vid": version_id, "nid": store["id"],
         "spath": store["path"], "uid": user_id},
    ).scalar()
    for a in answers:
        conn.execute(
            text(
                "insert into response_items (response_id, tenant_id, store_node_id, store_path, "
                "survey_version_id, question_id, sku_id, value) values (:rid, :tid, :nid, :spath, "
                ":vid, :qid, :sku, cast(:val as jsonb))"
            ),
            {"rid": resp_id, "tid": tenant_id, "nid": store["id"], "spath": store["path"],
             "vid": version_id, "qid": a["question_id"], "sku": a.get("sku_id"),
             "val": json.dumps(a["value"])},
        )
    return resp_id
```

- [ ] **Step 2: Call it for Lumen and Acme**

In the `run()` function, after the Lumen `_survey(...)` call (and after `rose` is
defined), add:

```python
        # A real response at SF (Bay Area, Marcus's scope): Rosewood below the
        # bar (3 < 4) so q1 fails, endcap present so q2 passes -> overall fail.
        _response(
            conn, lumen, "Velvet Lip Shelf Check", "sf", "marcus@lumenbeauty.com",
            [{"question_id": "q1", "sku_id": str(rose), "value": 3},
             {"question_id": "q2", "value": True}],
        )
```

After the Acme `_survey(...)` call, add:

```python
        # Acme demo response (q1 has no pass rule -> overall not counted).
        _response(
            conn, acme, "Glow Serum Check", "boston-store", "avery@acme.com",
            [{"question_id": "q1", "value": True}],
        )
```

Update the final `print(...)` line to mention the responses:

```python
    print("Seeded Lumen (8 nodes, 4 products, 1 survey, 1 response) + Acme (4 nodes, 1 product, 1 survey, 1 response) + 5 users with pins.")
```

- [ ] **Step 3: Reseed and verify idempotency**

Run:
```bash
docker compose exec api python -m app.seed
docker compose exec api python -m app.seed
```
Expected: both runs succeed; the second creates no duplicate (the `existing`
check returns the same id). Verify in the API docs or with:
```bash
docker compose exec db psql -U intelli -d intelli -c "select count(*) from responses;"
```
Expected: 2 rows (one Lumen, one Acme), unchanged after the second seed.

- [ ] **Step 4: Commit**

```bash
git add api/app/seed.py
git commit -m "Phase 4a: seed demo responses (Lumen fail-mix + Acme)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Update the docs + full green test run

**Files:**
- Modify: `START_HERE.md`, `CONTEXT.md`, `CODEBASE_MAP.md`, `api/README.md`, `db/README.md`, `CHECKING_THE_WORK.md`, and `../hi-fi-intelli/Intelli_Complete_Handoff.md`

- [ ] **Step 1: Run the FULL backend + frontend suites**

Run:
```bash
docker compose restart api
pnpm test:api
pnpm test:admin
```
Expected: backend all green (the prior 57 + the new compliance and responses
tests), frontend 27 green (unchanged). Record the new backend total from the
pytest summary line for the docs.

- [ ] **Step 2: Update `START_HERE.md`**

- In section 1, add a "Phase 4a" bullet block after the Phase 3b block:
  > **Phase 4a - responses + live pass/fail (done):** Reps' completed surveys are
  > now stored, one tiny row per product per question per moment, and read back
  > with pass/fail worked out fresh from the survey's rules (never saved, so
  > fixing a rule fixes every score). Backend only, no screen yet. Proven by the
  > test robot: the same answer scores differently when the rule changes,
  > submissions are checked against the survey, you can only submit for a store
  > in your branch, and re-visits are all kept.
- Update the "What's NEXT" line to: `Phase 4b, analytics (compliance %, OOS by SKU, trends).`
- In the file-structure block (section 5), add under `api/app/`:
  `│   │   ├── responses.py  Rep answers stored as atomic rows + live pass/fail`
  `│   │   ├── compliance.py The pass/fail brain (pure, computes from rules)`
- In section 7, update the "where we are" bullets to add 4a done and 4b next.

- [ ] **Step 3: Update `CONTEXT.md`**

- In the build-order checklist, change Phase 4 to a split with `[x] 4a` done and
  `[ ] 4b/4c/4d` pending, mirroring the 3a/3b style.
- Add a progress-log entry dated 2026-06-16:
  > 2026-06-16: Phase 4a - responses + read-time pass/fail. Migration for
  > `responses` (envelope + store_path snapshot) + `response_items` (atomic
  > per-(response,question,product) rows, indexed on sku+time and store). New pure
  > `compliance.py` evaluator (operators, each/total, blank=not-counted) computes
  > pass/fail at read time, never stored. New `responses.py`: POST /responses
  > (any in-scope user, published version only, strict-shape-allow-skips
  > validation, atomic explode), GET /responses + GET /responses/{id} (live
  > verdicts, branch-scoped). ScopedRepo gained create/list/get_response. Seed
  > adds a Lumen (mixed pass/fail) + Acme response. GATE GREEN: <N> backend tests
  > (recompute-from-rule, submit happy + every rejection, scope isolation,
  > published-only, re-visit retained, snapshot freeze) + 27 frontend. Phase 4a
  > COMPLETE; 4b (analytics) next.

  Replace `<N>` with the number from Step 1.

- [ ] **Step 4: Update `CODEBASE_MAP.md`**

- Add an "As of Phase 4a" paragraph after the Phase 3b one:
  > As of Phase 4a, the backend also stores reps' completed surveys as atomic
  > per-product rows ([api/app/responses.py](api/app/responses.py)) and computes
  > pass/fail live from the survey's rules ([api/app/compliance.py](api/app/compliance.py)),
  > never storing the verdict, so changing a rule changes every score.

- [ ] **Step 5: Update `api/README.md`**

Add plain-English entries for the two new files (`responses.py` = the responses
API; `compliance.py` = the pure pass/fail evaluator) and note the `responses` /
`response_items` tables, following the existing per-file style in that README.

- [ ] **Step 6: Update `db/README.md`**

Add the `responses` and `response_items` tables to the schema walk-through, in
the same plain style as the surveys tables: envelope vs atomic rows, the
store_path snapshot (freeze), and the "no pass/fail column on purpose" note.

- [ ] **Step 7: Update `CHECKING_THE_WORK.md`**

Add a "Phase 4a checks (responses)" section telling Tanya, with no coding, how to
see it: in `/docs`, log in as Marcus, `POST /responses` for the SF store against
the Velvet Lip version, then `GET /responses/{id}` and read the `overall` and
per-item `pass` fields; and how to confirm isolation (Avery cannot read the
Lumen response). Mention `pnpm test:api` runs the automated gate.

- [ ] **Step 8: Update the prototype handoff CHANGELOG**

In `../hi-fi-intelli/Intelli_Complete_Handoff.md`, add a newest-first entry dated
2026-06-16 summarizing Phase 4a (the two tables, the pure evaluator + recompute
gate, the submit endpoint with strict-shape-allow-skips, scope isolation, the
snapshot freeze, the test count), and note "Next: Phase 4b (analytics)."

- [ ] **Step 9: Commit the docs (both repos)**

```bash
git add START_HERE.md CONTEXT.md CODEBASE_MAP.md api/README.md db/README.md CHECKING_THE_WORK.md
git commit -m "Phase 4a: docs (guides + handoff) for responses + live pass/fail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
cd ../hi-fi-intelli && git add Intelli_Complete_Handoff.md && git commit -m "Handoff: Phase 4a complete (production repo) - responses + live pass/fail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" && cd ../intelli-app
```

---

## Self-review notes (done while writing)

- **Spec coverage:** two tables + indexes (Task 1); pure evaluator + recompute
  gate (Task 2); submit with scope + published-version + atomic explode (Task 3);
  strict-shape-allow-skips validation (Task 4); scoped list/read + isolation
  (Task 5); re-visit retained + snapshot freeze (Task 6); seed (Task 7); docs +
  full green run (Task 8). The spec's "deliberately NOT in 4a" items (analytics,
  payroll, export, drafts/offline, assignment link, screens) are absent by design.
- **Type/name consistency:** `evaluate_value`/`evaluate_question`/`evaluate_response`
  are defined in Task 2 and used identically in Task 3's `_score`. `_explode_answers`
  is introduced in Task 3 and replaced in Task 4 (same name, same signature).
  `_RESPONSE_COLS`, `create_response`, `list_responses`, `get_response`,
  `_check_value`, `VersionNotPublishedError` (reused from `scope.py`) are spelled
  the same everywhere.
- **Error codes:** 422 for malformed body, 400 for business-rule/validation, 404
  for out-of-scope, consistent with the surveys router.
- **Test ordering caveat:** `test_company_isolation` in Task 5 depends on the
  seeded Lumen response from Task 7; the note in Task 5 Step 2 flags this, and the
  full-suite run in Task 8 confirms green after the seed exists.
```
