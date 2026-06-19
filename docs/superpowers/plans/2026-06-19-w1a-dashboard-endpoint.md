# W1 Stage A: Dashboard backend endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the read-only `GET /analytics/dashboard` endpoint (headline KPIs + weekly trend + footprint counts, branch-scoped, no new tables) and two display fields on the login response (`company_name`, `pinned_node_name`), so the W1 Admin dashboard and shell have real data to render.

**Architecture:** A new branch-scoped `ScopedRepo.dashboard(...)` method on the existing analytics section computes everything over the caller's scope, reusing `_overall_for`, `_pct`, `_base_path_in_scope`, `_max_level`. The compliance aggregate is computed over the DISTINCT set of (store, survey_version) coverage obligations (NOT a sum over per-assignment rows, which would double-count). `current`/`previous` are date-bounded; the weekly trend buckets by ISO week (UTC). `auth.py` adds two name lookups to the login response.

**Tech Stack:** Python 3.12, FastAPI + Pydantic, SQLAlchemy Core over Postgres, pytest + `TestClient` against the throwaway `intelli_test` database.

**Spec:** `docs/superpowers/specs/2026-06-18-w1-shell-analytics-dashboard-design.md` (this is Stage A of four; B foundation, C shell, D dashboard screen follow as their own plans).

**Conventions (read before starting):**
- Run backend tests inside the container: `docker compose exec -T api pytest <args>`. The container test path is `tests/test_*.py` (the host `api/` is mounted at `/app`), NOT `api/tests/...`. Backend must be running (`docker compose up -d`).
- Tests go through the API with the `client` + `login` fixtures and isolate to data they create (the shared seeded DB is not rolled back). Reuse the helper idiom from `api/tests/test_analytics.py` (`_auth`, `_scalar`, `_node_id`, `_sku_id`, `_publish_and_assign`, `_submit`).
- Seeded users (password `demo1234`): `dana@lumenbeauty.com` (admin, root), `sarah@lumenbeauty.com` (manager, Central), `marcus@lumenbeauty.com` (rep, Bay Area), `rico@lumenbeauty.com` (rep, Chicago/Central), `newbie@lumenbeauty.com` (rep, NO pin), `avery@acme.com` (admin, Acme). Nodes by code: `lumen-co`, `west`, `bayarea`, `sf`, `oakland`, `central`, `chicago`, `chicago-store`. SKU `LUM-VL-ROSE`.
- Current baseline: 169 backend tests green.
- Commit directly to `main`. No em dashes. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

**Key existing helpers in `api/app/scope.py` (reuse, do not reinvent):**
- `_base_path_in_scope(conn, node_id)` -> the path to analyze over (caller scope, or the node's path if in scope, or `None` if a given node is out of scope).
- `_max_level(conn)` -> the store level_order (`max` of `org_level_definitions`).
- `_store_ids_under(conn, path, maxlvl)` -> store node ids under a path.
- `_overall_for(conn, version_id, response_ids)` -> `{response_id: overall verdict}` scored in bulk (2 queries). Reusable as-is.
- `_pct(num, den)` (staticmethod) -> rounded percentage or `None` when `den` is 0.
- `assignment_compliance(node_id)` shows the assignment-overlap WHERE idiom: `(:base like n.path || '%' or n.path like :base || '%')`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `api/app/auth.py` | Login response gains `company_name` + `pinned_node_name`. | Modify |
| `api/app/scope.py` | New `dashboard(...)` method + private helpers in the analytics section. | Modify |
| `api/app/analytics.py` | New `GET /analytics/dashboard` endpoint. | Modify |
| `api/tests/test_dashboard.py` | The Stage A test gate. | Create |
| `api/README.md`, `CONTEXT.md` | A short note for the new endpoint (full W1 docs at W1 completion). | Modify |

---

## Task 1: Login response gains company_name + pinned_node_name

**Files:**
- Create: `api/tests/test_dashboard.py` (the helpers + this first test)
- Modify: `api/app/auth.py`

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_dashboard.py`:

```python
"""W1 Stage A: the dashboard endpoint + the login display fields. Branch-scoped,
no new tables. Tests go through the API and isolate to data they create."""
import datetime as dt

from sqlalchemy import text

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


def _publish(client, admin_token, name, questions):
    """Create + publish a survey; return the published version id."""
    h = _auth(admin_token)
    survey = client.post("/surveys", headers=h,
                         json={"name": name, "type": None, "questions": questions}).json()
    client.post(f"/surveys/{survey['id']}/publish", headers=h)
    full = client.get(f"/surveys/{survey['id']}", headers=h).json()
    return next(v["id"] for v in full["versions"] if v["published_at"] is not None)


def _assign(client, admin_token, vid, target_code, deadline=None):
    body = {"survey_version_id": str(vid), "target_node_id": str(_node_id(target_code))}
    if deadline is not None:
        body["deadline"] = deadline
    return client.post("/survey-assignments", headers=_auth(admin_token), json=body)


def _submit(client, token, vid, store_code, answers):
    return client.post("/responses", headers=_auth(token),
                       json={"survey_version_id": str(vid),
                             "store_node_id": str(_node_id(store_code)), "answers": answers})


def _rose_q():
    rose = _sku_id("LUM-VL-ROSE")
    return [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
             "sku_ids": [str(rose)], "pass": {"operator": ">=", "value": 4},
             "passScope": "each"}], rose


def test_login_returns_company_and_pin_names(client):
    resp = client.post("/auth/login",
                       json={"email": "marcus@lumenbeauty.com", "password": "demo1234"})
    assert resp.status_code == 200, resp.text
    user = resp.json()["user"]
    assert user["company_name"] == "Lumen Beauty"     # the tenant's name
    assert user["pinned_node_name"] == "Bay Area"     # marcus is pinned at bayarea


def test_login_unpinned_user_pin_name_null(client):
    user = client.post("/auth/login",
                       json={"email": "newbie@lumenbeauty.com", "password": "demo1234"}).json()["user"]
    assert user["company_name"] == "Lumen Beauty"
    assert user["pinned_node_name"] is None           # newbie has no pin
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose exec -T api pytest tests/test_dashboard.py -k login -q`
Expected: FAIL (`company_name` not in the user object).

- [ ] **Step 3: Add the lookups to `auth.py`**

Replace the body of `login` in `api/app/auth.py` so it looks up the tenant name and the pinned node name (the pin via the same `assignments -> nodes` join `scope_path_for` uses):

```python
@router.post("/login")
def login(body: LoginIn) -> dict:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "select id, tenant_id, name, role, password_hash "
                "from users where email = :email"
            ),
            {"email": body.email},
        ).mappings().first()

        if row is None or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")

        company_name = conn.execute(
            text("select name from tenants where id = :tid"),
            {"tid": row["tenant_id"]},
        ).scalar()
        pinned_node_name = conn.execute(
            text("select n.name from assignments a join nodes n on n.id = a.node_id "
                 "where a.tenant_id = :tid and a.user_id = :uid"),
            {"tid": row["tenant_id"], "uid": row["id"]},
        ).scalar()

    token = make_token(row["id"], row["tenant_id"], row["role"])
    return {"token": token, "user": {
        "name": row["name"], "role": row["role"],
        "company_name": company_name, "pinned_node_name": pinned_node_name,
    }}
```

(Note: the `verify_password` check moves inside the `with` block so the lookups share the connection; behavior on a wrong password is unchanged, still 401.)

- [ ] **Step 4: Run to verify it passes**

Run: `docker compose exec -T api pytest tests/test_dashboard.py -k login -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/app/auth.py api/tests/test_dashboard.py
git commit -m "W1a: login response carries company_name + pinned_node_name

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The endpoint + footprint + surveys_completed + scope semantics

This stands up `GET /analytics/dashboard` returning the footprint counts and the
surveys-completed count, with the scope rules (404 out-of-scope node, zero payload
for an unpinned caller). The compliance/overdue/trend fields are added in later
tasks; for now they return zero/empty so the shape is stable.

**Files:**
- Modify: `api/app/scope.py` (new `dashboard` method + footprint helpers, analytics section)
- Modify: `api/app/analytics.py` (the endpoint)
- Modify: `api/tests/test_dashboard.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_dashboard.py`:

```python
def test_dashboard_footprint_counts(client, login):
    dana = login("dana@lumenbeauty.com")  # pinned at the company root
    body = client.get("/analytics/dashboard", headers=_auth(dana)).json()
    fp = body["footprint"]
    # Lumen seed: 8 nodes; stores = the max-level store nodes (sf, oakland,
    # chicago-store); reps = pinned rep users (marcus, rico), NOT unpinned newbie.
    assert fp["nodes"] == 8
    assert fp["stores"] == 3
    assert fp["reps"] == 2


def test_dashboard_node_id_narrows_footprint(client, login):
    dana = login("dana@lumenbeauty.com")
    body = client.get("/analytics/dashboard", headers=_auth(dana),
                      params={"node_id": str(_node_id("west"))}).json()
    # West contains Bay Area + its two stores (sf, oakland); marcus is pinned in it.
    assert body["footprint"]["stores"] == 2
    assert body["footprint"]["reps"] == 1   # marcus only (rico is under Central)


def test_dashboard_surveys_completed_counts_responses(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rose_q()
    vid = _publish(client, dana, "W1a Surveys Completed", q)
    _assign(client, dana, vid, "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    # Count over just this survey by reading the per-version count is awkward via
    # the aggregate; instead assert the company-wide count is at least the 3 seed
    # responses + this one, and that a fresh submit increments it.
    before = client.get("/analytics/dashboard", headers=_auth(dana)).json()["current"]["surveys_completed"]
    _submit(client, login("marcus@lumenbeauty.com"), vid, "oakland",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    after = client.get("/analytics/dashboard", headers=_auth(dana)).json()["current"]["surveys_completed"]
    assert after == before + 1


def test_dashboard_node_out_of_scope_404(client, login):
    # Sarah is pinned at Central and cannot reach Bay Area.
    resp = client.get("/analytics/dashboard", headers=_auth(login("sarah@lumenbeauty.com")),
                      params={"node_id": str(_node_id("bayarea"))})
    assert resp.status_code == 404, resp.text


def test_dashboard_unpinned_caller_zero_payload(client, login):
    body = client.get("/analytics/dashboard", headers=_auth(login("newbie@lumenbeauty.com"))).json()
    assert body["footprint"] == {"nodes": 0, "stores": 0, "reps": 0}
    assert body["current"]["expected"] == 0
    assert body["current"]["completion_pct"] is None
    assert body["previous"] is None
    assert body["trend"] == []
```

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose exec -T api pytest tests/test_dashboard.py -k "footprint or surveys_completed or out_of_scope or unpinned" -q`
Expected: FAIL (no `/analytics/dashboard` route yet -> 404 / KeyError).

- [ ] **Step 3: Add the `dashboard` method (footprint + surveys_completed + scope) to `ScopedRepo`**

In `api/app/scope.py`, in the analytics section (near `assignment_compliance`), add a zero-payload helper and the method. Date params are `datetime | None`.

```python
    @staticmethod
    def _zero_dashboard():
        return {
            "footprint": {"nodes": 0, "stores": 0, "reps": 0},
            "current": {"completion_pct": None, "pass_pct": None, "expected": 0,
                        "responded": 0, "scored": 0, "passed": 0,
                        "surveys_completed": 0, "overdue": 0},
            "previous": None,
            "trend": [],
        }

    def dashboard(self, node_id=None, date_from=None, date_to=None):
        """Headline figures for the Admin dashboard, branch-scoped. Returns None
        only if node_id is given but out of scope (-> 404); an unpinned caller
        (scope_path None) returns the zero payload (200)."""
        if self.scope_path is None:
            return self._zero_dashboard()
        with engine.connect() as conn:
            base = self._base_path_in_scope(conn, node_id)
            if base is None:
                return None  # node_id out of scope -> 404
            maxlvl = self._max_level(conn)
            footprint = {
                "nodes": conn.execute(
                    text("select count(*) from nodes where tenant_id = cast(:tid as uuid) "
                         "and path like :base || '%'"),
                    {"tid": str(self.tenant_id), "base": base}).scalar(),
                "stores": conn.execute(
                    text("select count(*) from nodes where tenant_id = cast(:tid as uuid) "
                         "and level_order = :ml and path like :base || '%'"),
                    {"tid": str(self.tenant_id), "ml": maxlvl, "base": base}).scalar(),
                "reps": conn.execute(
                    text("select count(*) from users u "
                         "join assignments a on a.user_id = u.id and a.tenant_id = cast(:tid as uuid) "
                         "join nodes n on n.id = a.node_id "
                         "where u.tenant_id = cast(:tid as uuid) and u.role = 'rep' "
                         "and n.path like :base || '%'"),
                    {"tid": str(self.tenant_id), "base": base}).scalar(),
            }
            current = self._dashboard_window(conn, base, maxlvl, date_from, date_to)
            current["surveys_completed"] = self._surveys_completed(conn, base, maxlvl, date_from, date_to)
            current["overdue"] = 0  # filled in Task 4
            previous = None         # filled in Task 3
            trend = []              # filled in Task 5
        return {"footprint": footprint, "current": current, "previous": previous, "trend": trend}

    def _surveys_completed(self, conn, base, maxlvl, date_from, date_to):
        clauses = ["r.tenant_id = cast(:tid as uuid)", "n.path like :base || '%'",
                   "n.level_order = :ml"]
        params = {"tid": str(self.tenant_id), "base": base, "ml": maxlvl}
        if date_from is not None:
            clauses.append("r.submitted_at >= cast(:df as timestamptz)"); params["df"] = date_from.isoformat()
        if date_to is not None:
            clauses.append("r.submitted_at <= cast(:dt as timestamptz)"); params["dt"] = date_to.isoformat()
        return conn.execute(
            text("select count(*) from responses r join nodes n on n.id = r.store_node_id "
                 "where " + " and ".join(clauses)), params).scalar()
```

Add a STUB `_dashboard_window` that returns the zero compliance block for now (Task 3 fills it in):

```python
    def _dashboard_window(self, conn, base, maxlvl, date_from, date_to):
        # Filled in Task 3 (distinct-coverage date-bounded compliance aggregate).
        return {"completion_pct": None, "pass_pct": None, "expected": 0,
                "responded": 0, "scored": 0, "passed": 0}
```

- [ ] **Step 4: Add the endpoint to `api/app/analytics.py`**

```python
@router.get("/dashboard")
def dashboard(
    node_id: UUID | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    repo: ScopedRepo = Depends(get_scoped_repo),
) -> dict:
    result = repo.dashboard(node_id, date_from, date_to)
    if result is None:
        raise HTTPException(status_code=404, detail="Node not found in your scope")
    return result
```

- [ ] **Step 5: Run to verify they pass**

Run: `docker compose exec -T api pytest tests/test_dashboard.py -k "footprint or surveys_completed or out_of_scope or unpinned" -q`
Expected: PASS. Then full suite: `docker compose exec -T api pytest -q` (no regressions).

- [ ] **Step 6: Commit**

```bash
git add api/app/scope.py api/app/analytics.py api/tests/test_dashboard.py
git commit -m "W1a: /analytics/dashboard endpoint (footprint + surveys count + scope)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The compliance aggregate (distinct coverage, date-bounded, with previous)

Fills in `current` compliance and the `previous` window over the DISTINCT set of
(store, survey_version) coverage obligations, so a store covered by two
assignments is counted once per version (no double-count).

**Files:**
- Modify: `api/app/scope.py` (`_dashboard_window` + wire `previous` in `dashboard`)
- Modify: `api/tests/test_dashboard.py` (append)

- [ ] **Step 1: Write the failing tests**

Append:

```python
def test_dashboard_compliance_no_double_count(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rose_q()
    vid = _publish(client, dana, "W1a No Double Count", q)
    # Two overlapping assignments of the SAME version: one at West, one at Bay Area.
    _assign(client, dana, vid, "west")
    _assign(client, dana, vid, "bayarea")
    # sf and oakland are the covered stores; the store must count ONCE per version.
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])  # pass
    body = client.get("/analytics/dashboard", headers=_auth(dana),
                      params={"node_id": str(_node_id("west"))}).json()["current"]
    # West coverage for this version = {sf, oakland} = 2 distinct obligations,
    # not 4 (which a per-assignment sum would give).
    assert body["expected"] == 2
    assert body["responded"] == 1
    assert body["scored"] == 1
    assert body["passed"] == 1
    assert body["pass_pct"] == 100.0
    assert body["completion_pct"] == 50.0


def test_dashboard_previous_window(client, login):
    dana = login("dana@lumenbeauty.com")
    # With a date range, previous is the equal-length window before date_from.
    body = client.get("/analytics/dashboard", headers=_auth(dana),
                      params={"date_from": "2026-06-15T00:00:00Z",
                              "date_to": "2026-06-22T00:00:00Z"}).json()
    assert body["previous"] is not None
    assert "completion_pct" in body["previous"]


def test_dashboard_previous_null_without_range(client, login):
    dana = login("dana@lumenbeauty.com")
    body = client.get("/analytics/dashboard", headers=_auth(dana)).json()
    assert body["previous"] is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose exec -T api pytest tests/test_dashboard.py -k "double_count or previous" -q`
Expected: FAIL (`expected` is 0; `previous` is null even with a range).

- [ ] **Step 3: Implement `_dashboard_window` (distinct coverage + date-bounded scoring) and wire `previous`**

Replace the stub `_dashboard_window` with the real aggregate. Algorithm:
1. Find every in-scope assignment whose coverage overlaps `base` (the
   `assignment_compliance` overlap idiom), getting each assignment's
   `survey_version_id` and its measured path (the deeper of the assignment target
   path vs `base`).
2. For each, collect its covered store ids via `_store_ids_under(conn, measured,
   maxlvl)`; build the DISTINCT set of `(store_node_id, survey_version_id)` pairs.
   `expected` = len of that set.
3. For each distinct (store, version), find that store's LATEST response for that
   version with `submitted_at` within `[date_from, date_to]` (if given); collect
   those response ids per version.
4. Score them in bulk per version via `_overall_for(conn, version_id,
   response_ids)`; `responded` = count of (store,version) pairs with a response,
   `scored` = verdict not None, `passed` = verdict True.
5. `completion_pct = _pct(responded, expected)`, `pass_pct = _pct(passed, scored)`.

```python
    def _dashboard_window(self, conn, base, maxlvl, date_from, date_to):
        assigns = conn.execute(
            text("select a.survey_version_id, n.path as target_path "
                 "from survey_assignments a join nodes n on n.id = a.target_node_id "
                 "where a.tenant_id = cast(:tid as uuid) "
                 "and (:base like n.path || '%' or n.path like :base || '%')"),
            {"tid": str(self.tenant_id), "base": base},
        ).mappings().all()
        # distinct (store_id, version_id) obligations
        pairs = set()
        for a in assigns:
            measured = a["target_path"] if len(a["target_path"]) >= len(base) else base
            for sid in self._store_ids_under(conn, measured, maxlvl):
                pairs.add((str(sid), str(a["survey_version_id"])))
        expected = len(pairs)
        if expected == 0:
            return {"completion_pct": None, "pass_pct": None, "expected": 0,
                    "responded": 0, "scored": 0, "passed": 0}
        # group obligations by version; per version find each store's latest
        # in-window response, then score in bulk.
        by_version = {}
        for sid, vid in pairs:
            by_version.setdefault(vid, set()).add(sid)
        df = date_from.isoformat() if date_from is not None else None
        dt = date_to.isoformat() if date_to is not None else None
        df_clause = "and submitted_at >= cast(:df as timestamptz) " if df else ""
        dt_clause = "and submitted_at <= cast(:dt as timestamptz) " if dt else ""
        responded = scored = passed = 0
        for vid, store_ids in by_version.items():
            latest = conn.execute(
                text("select distinct on (store_node_id) id, store_node_id from responses "
                     "where survey_version_id = cast(:vid as uuid) "
                     "and tenant_id = cast(:tid as uuid) "
                     "and store_node_id = any(cast(:sids as uuid[])) "
                     + df_clause + dt_clause +
                     "order by store_node_id, submitted_at desc"),
                {"vid": vid, "tid": str(self.tenant_id), "sids": list(store_ids),
                 "df": df, "dt": dt},
            ).mappings().all()
            responded += len(latest)
            overalls = self._overall_for(conn, vid, [r["id"] for r in latest])
            scored += sum(1 for v in overalls.values() if v is not None)
            passed += sum(1 for v in overalls.values() if v is True)
        return {"completion_pct": self._pct(responded, expected),
                "pass_pct": self._pct(passed, scored), "expected": expected,
                "responded": responded, "scored": scored, "passed": passed}
```

In `dashboard`, replace `previous = None` with the equal-length prior window when a
range is given:

```python
            previous = None
            if date_from is not None and date_to is not None:
                window = date_to - date_from
                prev_from, prev_to = date_from - window, date_from
                previous = self._dashboard_window(conn, base, maxlvl, prev_from, prev_to)
                previous["surveys_completed"] = self._surveys_completed(conn, base, maxlvl, prev_from, prev_to)
                previous["overdue"] = 0  # overdue is as-of-now only (see Task 4); not windowed
```

- [ ] **Step 4: Run to verify they pass**

Run: `docker compose exec -T api pytest tests/test_dashboard.py -k "double_count or previous" -q`
Expected: PASS. Then `docker compose exec -T api pytest tests/test_dashboard.py -q` (all Stage A so far green).

- [ ] **Step 5: Commit**

```bash
git add api/app/scope.py api/tests/test_dashboard.py
git commit -m "W1a: dashboard compliance aggregate (distinct coverage, date-bounded, previous)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The overdue count

**Files:**
- Modify: `api/app/scope.py` (`_overdue` + wire into `dashboard`)
- Modify: `api/tests/test_dashboard.py` (append)

- [ ] **Step 1: Write the failing tests**

Append:

```python
def test_dashboard_overdue_zero_without_deadline(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rose_q()
    vid = _publish(client, dana, "W1a No Deadline", q)
    _assign(client, dana, vid, "bayarea")  # no deadline
    # No deadline => never overdue, regardless of responses.
    body = client.get("/analytics/dashboard", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()
    assert body["current"]["overdue"] == 0


def test_dashboard_overdue_counts_past_deadline_unanswered(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rose_q()
    vid = _publish(client, dana, "W1a Overdue", q)
    past = "2020-01-01T00:00:00Z"
    _assign(client, dana, vid, "bayarea", deadline=past)  # past deadline, 2 stores
    # sf responds; oakland does not. Overdue = 1 (oakland still owes it).
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    body = client.get("/analytics/dashboard", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()
    assert body["current"]["overdue"] == 1
```

- [ ] **Step 2: Run to verify they fail**

Run: `docker compose exec -T api pytest tests/test_dashboard.py -k overdue -q`
Expected: FAIL (overdue is hardcoded 0).

- [ ] **Step 3: Implement `_overdue` and wire it in**

```python
    def _overdue(self, conn, base, maxlvl):
        """As-of-now overdue: covered stores under a past-deadline assignment that
        have no response for that version. NULL deadline = never overdue."""
        assigns = conn.execute(
            text("select a.survey_version_id, n.path as target_path "
                 "from survey_assignments a join nodes n on n.id = a.target_node_id "
                 "where a.tenant_id = cast(:tid as uuid) "
                 "and a.deadline is not null and a.deadline < now() "
                 "and (:base like n.path || '%' or n.path like :base || '%')"),
            {"tid": str(self.tenant_id), "base": base},
        ).mappings().all()
        overdue = 0
        for a in assigns:
            measured = a["target_path"] if len(a["target_path"]) >= len(base) else base
            store_ids = self._store_ids_under(conn, measured, maxlvl)
            if not store_ids:
                continue
            responded = conn.execute(
                text("select count(distinct store_node_id) from responses "
                     "where survey_version_id = cast(:vid as uuid) "
                     "and tenant_id = cast(:tid as uuid) "
                     "and store_node_id = any(cast(:sids as uuid[]))"),
                {"vid": str(a["survey_version_id"]), "tid": str(self.tenant_id),
                 "sids": [str(s) for s in store_ids]},
            ).scalar()
            overdue += len(store_ids) - responded
        return overdue
```

In `dashboard`, replace `current["overdue"] = 0` with `current["overdue"] = self._overdue(conn, base, maxlvl)`. (Leave `previous["overdue"] = 0`: overdue is as-of-now, not windowed.)

- [ ] **Step 4: Run to verify they pass**

Run: `docker compose exec -T api pytest tests/test_dashboard.py -k overdue -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/app/scope.py api/tests/test_dashboard.py
git commit -m "W1a: dashboard overdue count (past-deadline, unanswered, as-of-now)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: The weekly completion trend

**Files:**
- Modify: `api/app/scope.py` (`_trend` + wire into `dashboard`)
- Modify: `api/tests/test_dashboard.py` (append)

- [ ] **Step 1: Write the failing test**

Append:

```python
def test_dashboard_weekly_trend(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rose_q()
    vid = _publish(client, dana, "W1a Trend", q)
    _assign(client, dana, vid, "bayarea")  # expected = 2 stores (sf, oakland)
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    body = client.get("/analytics/dashboard", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea")),
                              "date_from": "2026-06-15T00:00:00Z",
                              "date_to": "2026-06-29T00:00:00Z"}).json()
    trend = body["trend"]
    assert len(trend) >= 1                       # weekly buckets across the range
    assert all(set(p) == {"week_start", "completion_pct", "responded", "expected"} for p in trend)
    assert all(p["expected"] == 2 for p in trend)  # expected is the constant covered-store count
    # the week marcus responded shows 1 responded store, completion 50%
    hit = [p for p in trend if p["responded"] == 1]
    assert hit and hit[0]["completion_pct"] == 50.0
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose exec -T api pytest tests/test_dashboard.py -k weekly_trend -q`
Expected: FAIL (trend is []).

- [ ] **Step 3: Implement `_trend` and wire it in**

Only build the trend when a date range is given (no range => the dashboard's
default "period to date" shows the KPIs without a weekly series; the frontend
range control always supplies one). Algorithm: `expected` = the constant distinct
covered-store count in scope (the same coverage set as `_dashboard_window`, but
count of distinct stores across all in-scope assignments); for each ISO week from
`date_from` to `date_to`, `responded` = distinct stores with a response in that
week; `completion_pct = _pct(responded, expected)`.

```python
    def _covered_store_ids(self, conn, base, maxlvl):
        assigns = conn.execute(
            text("select n.path as target_path from survey_assignments a "
                 "join nodes n on n.id = a.target_node_id "
                 "where a.tenant_id = cast(:tid as uuid) "
                 "and (:base like n.path || '%' or n.path like :base || '%')"),
            {"tid": str(self.tenant_id), "base": base},
        ).mappings().all()
        ids = set()
        for a in assigns:
            measured = a["target_path"] if len(a["target_path"]) >= len(base) else base
            for sid in self._store_ids_under(conn, measured, maxlvl):
                ids.add(str(sid))
        return ids

    def _trend(self, conn, base, maxlvl, date_from, date_to):
        if date_from is None or date_to is None:
            return []
        store_ids = self._covered_store_ids(conn, base, maxlvl)
        expected = len(store_ids)
        rows = []
        # ISO weeks: bucket start = Monday 00:00 UTC. date_trunc('week', ...) in
        # Postgres is Monday-based. Group distinct responders per week.
        if expected and store_ids:
            counts = {r["wk"].date().isoformat(): r["n"] for r in conn.execute(
                text("select date_trunc('week', submitted_at at time zone 'UTC') as wk, "
                     "count(distinct store_node_id) as n from responses "
                     "where tenant_id = cast(:tid as uuid) "
                     "and store_node_id = any(cast(:sids as uuid[])) "
                     "and submitted_at >= cast(:df as timestamptz) "
                     "and submitted_at <= cast(:dt as timestamptz) "
                     "group by wk"),
                {"tid": str(self.tenant_id), "sids": list(store_ids),
                 "df": date_from.isoformat(), "dt": date_to.isoformat()},
            ).mappings().all()}
        else:
            counts = {}
        # walk Monday-aligned weeks across the range
        import datetime as _dt
        start = (date_from - _dt.timedelta(days=date_from.weekday())).date()
        end = date_to.date()
        wk = start
        while wk <= end:
            key = wk.isoformat()
            responded = counts.get(key, 0)
            rows.append({"week_start": key, "responded": responded,
                         "expected": expected, "completion_pct": self._pct(responded, expected)})
            wk = wk + _dt.timedelta(days=7)
        return rows
```

In `dashboard`, replace `trend = []` with `trend = self._trend(conn, base, maxlvl, date_from, date_to)`.

- [ ] **Step 4: Run to verify it passes**

Run: `docker compose exec -T api pytest tests/test_dashboard.py -k weekly_trend -q`
Expected: PASS. Then the full Stage A file + full suite:
`docker compose exec -T api pytest tests/test_dashboard.py -q` and `docker compose exec -T api pytest -q`.

- [ ] **Step 5: Commit**

```bash
git add api/app/scope.py api/tests/test_dashboard.py
git commit -m "W1a: dashboard weekly completion trend (ISO-week UTC buckets)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: A manager-scope test + docs note

**Files:**
- Modify: `api/tests/test_dashboard.py` (append)
- Modify: `api/README.md`, `CONTEXT.md`

- [ ] **Step 1: Write the failing test**

Append:

```python
def test_dashboard_manager_scoped_to_branch(client, login):
    # Sarah (manager at Central) sees only Central's footprint, never West's.
    body = client.get("/analytics/dashboard",
                      headers=_auth(login("sarah@lumenbeauty.com"))).json()
    fp = body["footprint"]
    # Central subtree: central, chicago, chicago-store => 1 store; rico is the
    # only pinned rep under Central. West's sf/oakland and marcus never appear.
    assert fp["stores"] == 1
    assert fp["reps"] == 1
```

- [ ] **Step 2: Run to verify it passes** (it should already pass given the scope filter; this is a guard)

Run: `docker compose exec -T api pytest tests/test_dashboard.py -k manager_scoped -q`
Expected: PASS. If it fails, the scope filter has a hole; fix before committing.

- [ ] **Step 3: Docs note**

In `api/README.md`, add `GET /analytics/dashboard` to the `analytics.py` entry (headline KPIs + weekly trend + footprint, branch-scoped, no new tables) and note the login response now carries `company_name`/`pinned_node_name`. In `CONTEXT.md`, add a 2026-06-19 progress-log line: "W1 Stage A: /analytics/dashboard endpoint (footprint, distinct-coverage compliance aggregate, overdue, weekly trend, previous-window) + login company/pin names; backend-only, no new tables; gate green: <N> backend tests." (Full W1 docs land when the screen ships.)

- [ ] **Step 4: Run the full suite for the count**

Run: `docker compose exec -T api pytest -q`
Expected: PASS; note the new total for the CONTEXT line.

- [ ] **Step 5: Commit**

```bash
git add api/tests/test_dashboard.py api/README.md CONTEXT.md
git commit -m "W1a: dashboard manager-scope test + docs note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Stage A scope only):**
- `/analytics/dashboard` shape (footprint/current/previous/trend): Tasks 2-5. ✓
- Compliance over DISTINCT (store, version), no double-count: Task 3 + `test_dashboard_compliance_no_double_count`. ✓
- Date-bounded current + equal-length previous (null without range): Task 3. ✓
- Overdue: NULL deadline excluded, as-of-now, unanswered covered stores: Task 4. ✓
- Weekly trend: constant expected, ISO-week UTC buckets, _pct: Task 5. ✓
- Footprint nodes/stores/reps (reps = pinned rep users in scope): Task 2. ✓
- Scope: out-of-scope node 404, unpinned zero payload, manager branch-scoped: Tasks 2 + 6. ✓
- Login company_name + pinned_node_name: Task 1. ✓
- Reuses `_overall_for`/`_pct`/`_base_path_in_scope`/`_max_level`/`_store_ids_under`, not `_metrics_for_stores`: Task 3/5. ✓

**Placeholder scan:** none; tests are complete; implementation code is complete (the intricate aggregates show full code; the test contract gates correctness, so the implementer iterates the SQL to green if a detail needs adjusting).

**Type/name consistency:** `dashboard`, `_dashboard_window`, `_surveys_completed`, `_overdue`, `_trend`, `_covered_store_ids`, `_zero_dashboard` are consistent between the method that calls them and their definitions; the payload keys match between `_zero_dashboard`, `_dashboard_window`, and the tests. The endpoint maps `None -> 404` and otherwise returns the dict.

(Frontend Stages B/C/D get their own plans after Stage A is green, since the screen's exact shape depends on this endpoint.)
