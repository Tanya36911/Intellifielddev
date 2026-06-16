# Phase 4b: Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only analytics over the 4a response rows: compliance per node (completion % + pass %) with drill-down to per-product "why it failed," out-of-stock by a named count question, and a facings trend over time.

**Architecture:** No new tables. A new `api/app/analytics.py` router exposes four GET endpoints, all branch-scoped through the existing `ScopedRepo` (`api/app/scope.py`), which gains an "analytics" section. Pass/fail is computed by the existing pure `compliance.py` evaluator (never re-expressed in SQL); out-of-stock and trend are indexed SQL aggregates over `response_items`.

**Tech Stack:** FastAPI, SQLAlchemy Core (`text()` + `engine`), Pydantic v2, pytest against a throwaway Postgres.

---

## Conventions used throughout (read once)

- **Error codes:** node/version not in the caller's company or scope -> **404**; a malformed analytics parameter (a question that is not a per-product number question, a sku not on that question) -> **400** (raised as `ValueError` in the repo, mapped in the router); missing required query param -> **422** (FastAPI automatic).
- **Scope:** every query keeps `tenant_id = cast(:tid as uuid)` and a `path like :base || '%'` filter, where `base` is either a validated in-scope node path or the caller's own `scope_path`. A `scope_path` of `None` (no pin) means empty results.
- **UUID casting:** text params compared to `uuid` columns use `cast(:x as uuid)`, matching the rest of `scope.py`.
- **jsonb values:** a stored answer `value` is jsonb. To compare a number in SQL, cast via text: `(ri.value::text)::numeric`.
- **Apply code:** `docker compose restart api`. **Run tests:** `pnpm test:api` (stack up; `docker compose up -d` first). Single file: `pnpm test:api -- tests/test_analytics.py`.
- **Insertion point:** all new `ScopedRepo` methods go at the END of the class, after `get_response` (around line 565 of `scope.py`) and BEFORE the module-level `def _check_value`. Module-level helpers added by this plan go beside the other module-level helpers (`_check_value`, `scope_path_for`).
- Commit directly to `main`.

---

## File structure

| File | New/Modify | Responsibility |
|------|-----------|----------------|
| `api/app/scope.py` | Modify | Add the analytics section to `ScopedRepo` (4 public methods + private helpers) and the module-level pure helper `_count_question`. |
| `api/app/analytics.py` | Create | The analytics router: the four GET endpoints + error mapping. |
| `api/app/main.py` | Modify | Mount the analytics router. |
| `api/app/seed.py` | Modify | A few more demo responses + optional `submitted_at` on `_response`. |
| `api/tests/test_analytics.py` | Create | All analytics tests. |
| Docs | Modify | api/README, CODEBASE_MAP, CHECKING_THE_WORK, START_HERE, CONTEXT, handoff CHANGELOG. |

---

## Task 1: Compliance summary (`GET /analytics/compliance`)

Builds the shared helpers and the per-assignment completion %/pass % summary, including the ancestor rule (a company-wide survey shows for a node, measured over that node's own stores).

**Files:**
- Modify: `api/app/scope.py` (add analytics helpers + `assignment_compliance`)
- Create: `api/app/analytics.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_analytics.py`

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_analytics.py`:

```python
"""Phase 4b: read-only analytics over the 4a response rows. Compliance reports
completion % (of expected stores, how many responded) and pass % (of scored
responses, how many passed); both are computed live, branch-scoped, never stored."""
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


def _publish_and_assign(client, admin_token, name, questions, target_code):
    """Create a survey, publish v1, assign it to the node with target_code.
    Returns the published survey_version_id."""
    h = _auth(admin_token)
    survey = client.post("/surveys", headers=h,
                         json={"name": name, "type": None, "questions": questions}).json()
    client.post(f"/surveys/{survey['id']}/publish", headers=h)
    full = client.get(f"/surveys/{survey['id']}", headers=h).json()
    vid = next(v["id"] for v in full["versions"] if v["published_at"] is not None)
    client.post("/survey-assignments", headers=h,
                json={"survey_version_id": vid, "target_node_id": str(_node_id(target_code))})
    return vid


def _submit(client, token, vid, store_code, answers):
    return client.post("/responses", headers=_auth(token),
                       json={"survey_version_id": str(vid),
                             "store_node_id": str(_node_id(store_code)), "answers": answers})


def _row_for(rows, vid):
    return next(r for r in rows if r["survey_version_id"] == vid)


NUM_Q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
          "sku_ids": [], "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]


def test_compliance_requires_auth(client):
    assert client.get("/analytics/compliance").status_code == 401


def test_compliance_counts(client, login):
    # Assign a survey to Bay Area (stores: sf, oakland). sf responds and passes;
    # oakland never responds. expected=2, responded=1, scored=1, passed=1.
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
          "sku_ids": [str(rose)], "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Bay Compliance", q, "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    rows = client.get("/analytics/compliance", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()["rows"]
    r = _row_for(rows, vid)
    assert r["expected"] == 2
    assert r["responded"] == 1
    assert r["scored"] == 1
    assert r["passed"] == 1
    assert r["completion_pct"] == 50.0
    assert r["pass_pct"] == 100.0


def test_company_wide_survey_shows_per_node(client, login):
    # A survey assigned at the company ROOT must show for Bay Area, measured over
    # Bay Area's stores only (not Central's).
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
          "sku_ids": [str(rose)], "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Company Wide", q, "lumen-co")
    rows = client.get("/analytics/compliance", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()["rows"]
    r = _row_for(rows, vid)
    assert r["expected"] == 2  # only Bay Area's two stores, not the whole company


def test_pass_pct_recomputes_from_rule(client, login):
    # Same answer value (5), two surveys with different thresholds -> different pass %.
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    lenient = _publish_and_assign(client, dana, "Lenient",
        [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}], "bayarea")
    strict = _publish_and_assign(client, dana, "Strict",
        [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 6}, "passScope": "each"}], "bayarea")
    _submit(client, marcus, lenient, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    _submit(client, marcus, strict, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    rows = client.get("/analytics/compliance", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()["rows"]
    assert _row_for(rows, lenient)["pass_pct"] == 100.0  # 5 >= 4
    assert _row_for(rows, strict)["pass_pct"] == 0.0      # 5 < 6


def test_not_scored_excluded_from_pass_pct(client, login):
    # A survey with no pass rule -> a response is "responded" but not "scored".
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "No Rule Survey",
        [{"id": "q1", "prompt": "note", "type": "text"}], "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "value": "looks fine"}])
    rows = client.get("/analytics/compliance", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()["rows"]
    r = _row_for(rows, vid)
    assert r["responded"] == 1
    assert r["scored"] == 0
    assert r["pass_pct"] is None  # nothing to score


def test_compliance_node_out_of_scope_404(client, login):
    # Sarah (Central) asks for Bay Area (West) -> 404.
    resp = client.get("/analytics/compliance", headers=_auth(login("sarah@lumenbeauty.com")),
                      params={"node_id": str(_node_id("bayarea"))})
    assert resp.status_code == 404, resp.text


def test_compliance_company_isolation(client, login):
    # Avery (Acme) sees none of Lumen's assignments.
    rows = client.get("/analytics/compliance", headers=_auth(login("avery@acme.com"))).json()["rows"]
    assert all("Velvet" not in r["survey_name"] for r in rows)
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:api -- tests/test_analytics.py`
Expected: FAIL (the `/analytics/compliance` route does not exist yet -> 404/401 mismatches).

- [ ] **Step 3: Add the analytics helpers + `assignment_compliance` to `ScopedRepo`**

In `api/app/scope.py`, add this section at the END of the `ScopedRepo` class (after `get_response`, before the module-level `def _check_value`):

```python
    # ----- analytics (read-only; branch-scoped like responses) -----

    def _max_level(self, conn) -> int:
        return conn.execute(
            text("select max(level_order) from org_level_definitions "
                 "where tenant_id = cast(:tid as uuid)"),
            {"tid": str(self.tenant_id)},
        ).scalar()

    def _base_path_in_scope(self, conn, node_id):
        """The path to analyze over: the given node's path (if it is in the
        caller's scope) or the caller's whole scope when node_id is None. Returns
        None if node_id is given but out of scope (-> 404)."""
        if node_id is None:
            return self.scope_path
        row = conn.execute(
            text("select path from nodes where id = cast(:nid as uuid) "
                 "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
            {"nid": str(node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
        ).mappings().first()
        return row["path"] if row else None

    def _store_ids_under(self, conn, path, maxlvl) -> list:
        return list(conn.execute(
            text("select id from nodes where tenant_id = cast(:tid as uuid) "
                 "and level_order = :ml and path like :p || '%'"),
            {"tid": str(self.tenant_id), "ml": maxlvl, "p": path},
        ).scalars().all())

    def _overall_for(self, conn, version_id, response_ids) -> dict:
        """{response_id: overall verdict} for the given responses, scored against
        the version's questions. Two queries + in-memory evaluation (no per-store
        round trip)."""
        if not response_ids:
            return {}
        questions = conn.execute(
            text("select questions from survey_versions where id = cast(:vid as uuid)"),
            {"vid": str(version_id)},
        ).mappings().first()["questions"]
        rows = conn.execute(
            text("select response_id, question_id, sku_id, value from response_items "
                 "where response_id = any(cast(:ids as uuid[]))"),
            {"ids": [str(r) for r in response_ids]},
        ).mappings().all()
        by_resp: dict = {}
        for r in rows:
            by_resp.setdefault(r["response_id"], []).append(dict(r))
        return {rid: evaluate_response(questions, by_resp.get(rid, []))["overall"]
                for rid in response_ids}

    def _metrics_for_stores(self, conn, version_id, store_ids):
        """(expected, responded, scored, passed) for a version over a set of
        store node ids, using each store's latest response."""
        expected = len(store_ids)
        if not store_ids:
            return 0, 0, 0, 0
        latest = conn.execute(
            text("select distinct on (store_node_id) id, store_node_id from responses "
                 "where survey_version_id = cast(:vid as uuid) "
                 "and tenant_id = cast(:tid as uuid) "
                 "and store_node_id = any(cast(:sids as uuid[])) "
                 "order by store_node_id, submitted_at desc"),
            {"vid": str(version_id), "tid": str(self.tenant_id),
             "sids": [str(s) for s in store_ids]},
        ).mappings().all()
        responded = len(latest)
        overalls = self._overall_for(conn, version_id, [r["id"] for r in latest])
        scored = sum(1 for v in overalls.values() if v is not None)
        passed = sum(1 for v in overalls.values() if v is True)
        return expected, responded, scored, passed

    @staticmethod
    def _pct(numerator, denominator):
        return round(100 * numerator / denominator, 1) if denominator else None

    def assignment_compliance(self, node_id=None):
        """Per assignment whose coverage overlaps node_id (default: whole branch),
        completion % + pass % measured over (coverage ∩ node subtree ∩ scope).
        Returns None if node_id is given but out of scope (-> 404)."""
        if self.scope_path is None:
            return []
        with engine.connect() as conn:
            base = self._base_path_in_scope(conn, node_id)
            if base is None:
                return None
            maxlvl = self._max_level(conn)
            assigns = conn.execute(
                text("select a.id as assignment_id, a.survey_version_id, n.path as target_path, "
                     "n.id as target_node_id, n.name as target_node_name, "
                     "s.id as survey_id, s.name as survey_name "
                     "from survey_assignments a join nodes n on n.id = a.target_node_id "
                     "join survey_versions v on v.id = a.survey_version_id "
                     "join surveys s on s.id = v.survey_id "
                     "where a.tenant_id = cast(:tid as uuid) "
                     "and (:base like n.path || '%' or n.path like :base || '%')"),
                {"tid": str(self.tenant_id), "base": base},
            ).mappings().all()
            out = []
            for a in assigns:
                # intersection of two nested subtrees = the deeper (longer) path
                measured = a["target_path"] if len(a["target_path"]) >= len(base) else base
                store_ids = self._store_ids_under(conn, measured, maxlvl)
                expected, responded, scored, passed = self._metrics_for_stores(
                    conn, a["survey_version_id"], store_ids)
                out.append({
                    "assignment_id": a["assignment_id"],
                    "survey_id": a["survey_id"], "survey_name": a["survey_name"],
                    "survey_version_id": a["survey_version_id"],
                    "target_node_id": a["target_node_id"],
                    "target_node_name": a["target_node_name"],
                    "expected": expected, "responded": responded,
                    "scored": scored, "passed": passed,
                    "completion_pct": self._pct(responded, expected),
                    "pass_pct": self._pct(passed, scored),
                })
        return out
```

- [ ] **Step 4: Create the analytics router**

Create `api/app/analytics.py`:

```python
"""The analytics API: read-only views over the response rows. Compliance per node
(completion % + pass %), drill-down to per-product why-it-failed, out-of-stock by
a named count question, and a facings trend. Everything is branch-scoped through
the ScopedRepo and computed live (pass/fail is never stored).
"""
from datetime import datetime  # used by the trend endpoint (Task 4)
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from .scope import ScopedRepo, get_scoped_repo

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/compliance")
def compliance(
    node_id: UUID | None = None,
    repo: ScopedRepo = Depends(get_scoped_repo),
) -> dict:
    rows = repo.assignment_compliance(node_id)
    if rows is None:
        raise HTTPException(status_code=404, detail="Node not found in your scope")
    return {"rows": rows, "count": len(rows)}
```

- [ ] **Step 5: Mount the router in main.py**

In `api/app/main.py`, add alongside the others:
```python
from .analytics import router as analytics_router
```
```python
app.include_router(analytics_router)
```

- [ ] **Step 6: Apply and run**

Run:
```bash
docker compose restart api
pnpm test:api -- tests/test_analytics.py
```
Expected: PASS (all 7 tests).

- [ ] **Step 7: Commit**

```bash
git add api/app/scope.py api/app/analytics.py api/app/main.py api/tests/test_analytics.py
git commit -m "Phase 4b: compliance summary endpoint (completion % + pass %, ancestor rule)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Compliance drill-down (`GET /analytics/compliance/drill`)

Children rollup for a non-store node; per-product "why it failed" at a store.

**Files:**
- Modify: `api/app/scope.py` (add `_version_questions`, `_score_one`, `compliance_drill`)
- Modify: `api/app/analytics.py` (add the drill endpoint)
- Test: `api/tests/test_analytics.py`

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_analytics.py`:

```python
def test_drill_children_rollup(client, login):
    # Assign to West (region). Drill West for the version -> rows per child
    # district (Bay Area). Bay Area's expected = its 2 stores.
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "West Drill", q, "west")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    body = client.get("/analytics/compliance/drill", headers=_auth(dana),
                      params={"node_id": str(_node_id("west")), "survey_version_id": vid}).json()
    assert body["is_store"] is False
    bay = next(c for c in body["children"] if c["name"] == "Bay Area")
    assert bay["expected"] == 2
    assert bay["responded"] == 1
    assert bay["passed"] == 1


def test_drill_store_shows_why_failed(client, login):
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Why Failed", q, "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 2}])  # 2 < 4 -> fail
    body = client.get("/analytics/compliance/drill", headers=_auth(dana),
                      params={"node_id": str(_node_id("sf")), "survey_version_id": vid}).json()
    assert body["is_store"] is True
    assert body["responded"] is True
    assert body["overall"] is False
    assert body["questions"]["q1"] is False  # the failing question is identified


def test_drill_store_no_response(client, login):
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Drill No Resp", q, "bayarea")
    body = client.get("/analytics/compliance/drill", headers=_auth(dana),
                      params={"node_id": str(_node_id("oakland")), "survey_version_id": vid}).json()
    assert body["is_store"] is True
    assert body["responded"] is False


def test_drill_node_out_of_scope_404(client, login):
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    vid = _publish_and_assign(client, dana, "Drill Scope",
        [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}], "bayarea")
    resp = client.get("/analytics/compliance/drill",
                      headers=_auth(login("sarah@lumenbeauty.com")),  # Central
                      params={"node_id": str(_node_id("bayarea")), "survey_version_id": vid})
    assert resp.status_code == 404, resp.text
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:api -- tests/test_analytics.py`
Expected: the four new tests FAIL (drill route missing).

- [ ] **Step 3: Add `_version_questions`, `_score_one`, `compliance_drill` to `ScopedRepo`**

In `api/app/scope.py`, add these methods inside the analytics section (after `assignment_compliance`):

```python
    def _version_questions(self, conn, version_id):
        """The version's questions if it belongs to the caller's company, else
        None (-> 404)."""
        row = conn.execute(
            text("select v.questions from survey_versions v "
                 "join surveys s on s.id = v.survey_id "
                 "where v.id = cast(:vid as uuid) and s.tenant_id = cast(:tid as uuid)"),
            {"vid": str(version_id), "tid": str(self.tenant_id)},
        ).mappings().first()
        return row["questions"] if row else None

    def _score_one(self, conn, version_id, response_id) -> dict:
        questions = conn.execute(
            text("select questions from survey_versions where id = cast(:vid as uuid)"),
            {"vid": str(version_id)},
        ).mappings().first()["questions"]
        items = conn.execute(
            text("select question_id, sku_id, value from response_items "
                 "where response_id = cast(:rid as uuid) order by question_id, sku_id"),
            {"rid": str(response_id)},
        ).mappings().all()
        return evaluate_response(questions, [dict(i) for i in items])

    def compliance_drill(self, node_id, survey_version_id):
        """Children rollup for a non-store node, or the per-product why-it-failed
        at a store. None if the node is out of scope or the version is not the
        caller's company (-> 404)."""
        if self.scope_path is None:
            return None
        with engine.connect() as conn:
            node = conn.execute(
                text("select id, path, level_order from nodes where id = cast(:nid as uuid) "
                     "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
                {"nid": str(node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            if node is None or self._version_questions(conn, survey_version_id) is None:
                return None
            maxlvl = self._max_level(conn)
            if node["level_order"] == maxlvl:
                latest = conn.execute(
                    text("select id from responses where survey_version_id = cast(:vid as uuid) "
                         "and store_node_id = cast(:nid as uuid) and tenant_id = cast(:tid as uuid) "
                         "order by submitted_at desc limit 1"),
                    {"vid": str(survey_version_id), "nid": str(node_id), "tid": str(self.tenant_id)},
                ).mappings().first()
                if latest is None:
                    return {"is_store": True, "responded": False}
                scored = self._score_one(conn, survey_version_id, latest["id"])
                return {"is_store": True, "responded": True, **scored}
            # not a store: covered stores under this node for the version, by child
            covered = conn.execute(
                text("select n.id, n.path from nodes n where n.tenant_id = cast(:tid as uuid) "
                     "and n.level_order = :ml and n.path like :np || '%' and exists ("
                     "  select 1 from survey_assignments a join nodes tn on tn.id = a.target_node_id "
                     "  where a.survey_version_id = cast(:vid as uuid) "
                     "  and a.tenant_id = cast(:tid as uuid) and n.path like tn.path || '%')"),
                {"tid": str(self.tenant_id), "ml": maxlvl, "np": node["path"],
                 "vid": str(survey_version_id)},
            ).mappings().all()
            covered = [dict(c) for c in covered]
            children = conn.execute(
                text("select id, name, level_order, path from nodes "
                     "where parent_id = cast(:nid as uuid) and tenant_id = cast(:tid as uuid) "
                     "order by name"),
                {"nid": str(node_id), "tid": str(self.tenant_id)},
            ).mappings().all()
            rows = []
            for c in children:
                child_store_ids = [s["id"] for s in covered if s["path"].startswith(c["path"])]
                expected, responded, scored_n, passed = self._metrics_for_stores(
                    conn, survey_version_id, child_store_ids)
                rows.append({
                    "node_id": c["id"], "name": c["name"], "level_order": c["level_order"],
                    "is_store": c["level_order"] == maxlvl,
                    "expected": expected, "responded": responded,
                    "scored": scored_n, "passed": passed,
                    "completion_pct": self._pct(responded, expected),
                    "pass_pct": self._pct(passed, scored_n),
                })
        return {"is_store": False, "children": rows}
```

- [ ] **Step 4: Add the drill endpoint to analytics.py**

In `api/app/analytics.py`, add after the `compliance` endpoint:

```python
@router.get("/compliance/drill")
def compliance_drill(
    node_id: UUID,
    survey_version_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
) -> dict:
    result = repo.compliance_drill(node_id, survey_version_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Node or version not found in your scope")
    return result
```

- [ ] **Step 5: Apply and run**

Run:
```bash
docker compose restart api
pnpm test:api -- tests/test_analytics.py
```
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add api/app/scope.py api/app/analytics.py api/tests/test_analytics.py
git commit -m "Phase 4b: compliance drill-down (children rollup + per-product why-it-failed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Out-of-stock by product (`GET /analytics/oos`)

**Files:**
- Modify: `api/app/scope.py` (add module-level `_count_question`, method `oos_by_sku`)
- Modify: `api/app/analytics.py` (add the oos endpoint)
- Test: `api/tests/test_analytics.py`

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_analytics.py`:

```python
def test_oos_counts_zero_answers(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "OOS Survey", q, "bayarea")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 0}])     # OOS
    _submit(client, marcus, vid, "oakland", [{"question_id": "q1", "sku_id": str(rose), "value": 7}]) # ok
    body = client.get("/analytics/oos", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1"}).json()
    row = next(r for r in body["rows"] if r["sku_id"] == str(rose))
    assert row["oos_store_count"] == 1
    assert row["reporting_store_count"] == 2


def test_oos_uses_latest_response(client, login):
    # A re-visit recording a non-zero value clears the OOS.
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "OOS Latest", q, "bayarea")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 0}])
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])  # later
    body = client.get("/analytics/oos", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1"}).json()
    row = next(r for r in body["rows"] if r["sku_id"] == str(rose))
    assert row["oos_store_count"] == 0  # latest is 5, not out of stock


def test_oos_bad_question_400(client, login):
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "OOS Bad Q",
        [{"id": "q1", "prompt": "present?", "type": "boolean"}], "bayarea")  # not a per-product number
    resp = client.get("/analytics/oos", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1"})
    assert resp.status_code == 400, resp.text


def test_oos_version_out_of_company_404(client, login):
    acme_vid = _scalar(
        "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
        "where s.name = 'Glow Serum Check' and v.published_at is not null limit 1")
    resp = client.get("/analytics/oos", headers=_auth(login("dana@lumenbeauty.com")),
                      params={"survey_version_id": str(acme_vid), "question_id": "q1"})
    assert resp.status_code == 404, resp.text
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:api -- tests/test_analytics.py`
Expected: the four new tests FAIL (oos route missing).

- [ ] **Step 3: Add `_count_question` (module-level) and `oos_by_sku` to scope.py**

Add this module-level pure helper to `api/app/scope.py`, next to `_check_value`:

```python
def _count_question(questions, question_id):
    """Return the question if it is a per-product number question, else raise
    ValueError (-> 400). Used by the out-of-stock and trend analytics."""
    q = next((x for x in questions if x.get("id") == question_id), None)
    if q is None or q.get("type") != "number" or not q.get("perSku", False):
        raise ValueError(f"{question_id} is not a per-product number question")
    return q
```

Add this method inside the analytics section of `ScopedRepo` (after `compliance_drill`):

```python
    def oos_by_sku(self, survey_version_id, question_id, node_id=None):
        """Out-of-stock by product for a per-product count question, using each
        store's latest response under the node. Out of stock = answer 0. Returns
        None if node/version not in scope (-> 404); raises ValueError for a bad
        question (-> 400)."""
        if self.scope_path is None:
            return None
        with engine.connect() as conn:
            base = self._base_path_in_scope(conn, node_id)
            if base is None:
                return None
            questions = self._version_questions(conn, survey_version_id)
            if questions is None:
                return None
            _count_question(questions, question_id)  # raises ValueError if invalid
            maxlvl = self._max_level(conn)
            rows = conn.execute(
                text("with latest as ("
                     " select distinct on (r.store_node_id) r.id from responses r "
                     " join nodes n on n.id = r.store_node_id "
                     " where r.survey_version_id = cast(:vid as uuid) "
                     " and r.tenant_id = cast(:tid as uuid) "
                     " and n.path like :base || '%' and n.level_order = :ml "
                     " order by r.store_node_id, r.submitted_at desc) "
                     "select ri.sku_id, sk.line, sk.variant, "
                     " count(*) filter (where (ri.value::text)::numeric = 0) as oos_store_count, "
                     " count(*) as reporting_store_count "
                     "from response_items ri join latest l on l.id = ri.response_id "
                     "join skus sk on sk.id = ri.sku_id "
                     "where ri.question_id = :qid and ri.sku_id is not null "
                     "group by ri.sku_id, sk.line, sk.variant order by sk.line, sk.variant"),
                {"vid": str(survey_version_id), "tid": str(self.tenant_id),
                 "base": base, "ml": maxlvl, "qid": question_id},
            ).mappings().all()
        return [{"sku_id": str(r["sku_id"]), "line": r["line"], "variant": r["variant"],
                 "oos_store_count": r["oos_store_count"],
                 "reporting_store_count": r["reporting_store_count"]} for r in rows]
```

- [ ] **Step 4: Add the oos endpoint to analytics.py**

In `api/app/analytics.py`, add:

```python
@router.get("/oos")
def oos(
    survey_version_id: UUID,
    question_id: str,
    node_id: UUID | None = None,
    repo: ScopedRepo = Depends(get_scoped_repo),
) -> dict:
    try:
        rows = repo.oos_by_sku(survey_version_id, question_id, node_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if rows is None:
        raise HTTPException(status_code=404, detail="Node or version not found in your scope")
    return {"rows": rows, "count": len(rows)}
```

- [ ] **Step 5: Apply and run**

Run:
```bash
docker compose restart api
pnpm test:api -- tests/test_analytics.py
```
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add api/app/scope.py api/app/analytics.py api/tests/test_analytics.py
git commit -m "Phase 4b: out-of-stock by product (latest response, answer == 0)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Facings trend (`GET /analytics/trend`)

**Files:**
- Modify: `api/app/scope.py` (add `facings_trend`)
- Modify: `api/app/analytics.py` (add the trend endpoint)
- Test: `api/tests/test_analytics.py`

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_analytics.py`:

```python
def test_trend_returns_points_and_daily_avg(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Trend Survey", q, "bayarea")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 4}])
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 8}])
    body = client.get("/analytics/trend", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1",
                              "sku_id": str(rose)}).json()
    assert len(body["points"]) == 2          # uses ALL responses, not just latest
    assert [p["value"] for p in body["points"]] == [4, 8]  # ordered by time
    # both on the same UTC day -> one bucket, average (4+8)/2 = 6
    assert len(body["daily_avg"]) == 1
    assert body["daily_avg"][0]["avg"] == 6.0


def test_trend_respects_date_range(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Trend Range", q, "bayarea")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    # a window entirely in the past excludes everything
    body = client.get("/analytics/trend", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1", "sku_id": str(rose),
                              "date_from": "2000-01-01T00:00:00Z",
                              "date_to": "2000-01-02T00:00:00Z"}).json()
    assert body["points"] == []


def test_trend_sku_not_on_question_400(client, login):
    dana = login("dana@lumenbeauty.com")
    rose, ivory = _sku_id("LUM-VL-ROSE"), _sku_id("LUM-SF-IVORY")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Trend Bad Sku", q, "bayarea")
    resp = client.get("/analytics/trend", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1", "sku_id": str(ivory)})
    assert resp.status_code == 400, resp.text
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:api -- tests/test_analytics.py`
Expected: the three new tests FAIL (trend route missing).

- [ ] **Step 3: Add `facings_trend` to scope.py**

Add this method inside the analytics section of `ScopedRepo` (after `oos_by_sku`):

```python
    def facings_trend(self, survey_version_id, question_id, sku_id,
                      node_id=None, date_from=None, date_to=None):
        """Time-series of a per-product count answer across a node's stores (all
        responses, not just latest), plus a per-UTC-day average. None if
        node/version not in scope (-> 404); raises ValueError for a bad question
        or a sku not on the question (-> 400)."""
        if self.scope_path is None:
            return None
        with engine.connect() as conn:
            base = self._base_path_in_scope(conn, node_id)
            if base is None:
                return None
            questions = self._version_questions(conn, survey_version_id)
            if questions is None:
                return None
            q = _count_question(questions, question_id)  # raises ValueError if invalid
            if str(sku_id) not in {str(s) for s in (q.get("sku_ids") or [])}:
                raise ValueError(f"sku {sku_id} is not on question {question_id}")
            rows = conn.execute(
                text("select ri.submitted_at, ri.store_node_id, n.name as store_name, ri.value "
                     "from response_items ri join nodes n on n.id = ri.store_node_id "
                     "where ri.survey_version_id = cast(:vid as uuid) "
                     "and ri.tenant_id = cast(:tid as uuid) "
                     "and ri.question_id = :qid and ri.sku_id = cast(:sku as uuid) "
                     "and n.path like :base || '%' "
                     "and (:df is null or ri.submitted_at >= cast(:df as timestamptz)) "
                     "and (:dt is null or ri.submitted_at <= cast(:dt as timestamptz)) "
                     "order by ri.submitted_at"),
                {"vid": str(survey_version_id), "tid": str(self.tenant_id), "qid": question_id,
                 "sku": str(sku_id), "base": base, "df": date_from, "dt": date_to},
            ).mappings().all()
        points = [{"submitted_at": r["submitted_at"], "store_node_id": str(r["store_node_id"]),
                   "store_name": r["store_name"], "value": r["value"]} for r in rows]
        by_day: dict = {}
        for r in rows:
            day = r["submitted_at"].date().isoformat()
            by_day.setdefault(day, []).append(float(r["value"]))
        daily_avg = [{"date": d, "avg": round(sum(v) / len(v), 1)}
                     for d, v in sorted(by_day.items())]
        return {"points": points, "daily_avg": daily_avg}
```

- [ ] **Step 4: Add the trend endpoint to analytics.py**

In `api/app/analytics.py`, add (and ensure `from datetime import datetime` is imported at the top, which Task 1 already added):

```python
@router.get("/trend")
def trend(
    survey_version_id: UUID,
    question_id: str,
    sku_id: UUID,
    node_id: UUID | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    repo: ScopedRepo = Depends(get_scoped_repo),
) -> dict:
    try:
        result = repo.facings_trend(survey_version_id, question_id, sku_id,
                                    node_id, date_from, date_to)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="Node or version not found in your scope")
    return result
```

- [ ] **Step 5: Apply and run**

Run:
```bash
docker compose restart api
pnpm test:api -- tests/test_analytics.py
```
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add api/app/scope.py api/app/analytics.py api/tests/test_analytics.py
git commit -m "Phase 4b: facings trend (time-series points + per-UTC-day average)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Seed richer demo data

Make the analytics endpoints show non-trivial numbers in the demo.

**Files:**
- Modify: `api/app/seed.py`

- [ ] **Step 1: Add an optional `submitted_at` to `_response`**

In `api/app/seed.py`, change the `_response` signature and the two inserts to accept an optional `submitted_at` (so dated trend points can be seeded). Replace the `def _response(...)` line:

```python
def _response(conn, tenant_id, survey_name, store_code, user_email, answers, submitted_at=None):
```

In the `responses` insert inside `_response`, change it to set `submitted_at` when provided:

```python
    resp_id = conn.execute(
        text(
            "insert into responses (tenant_id, survey_version_id, store_node_id, store_path, "
            "user_id, submitted_at) values (:tid, :vid, :nid, :spath, :uid, "
            "coalesce(cast(:sub as timestamptz), now())) returning id"
        ),
        {"tid": tenant_id, "vid": version_id, "nid": store["id"], "spath": store["path"],
         "uid": user_id, "sub": submitted_at},
    ).scalar()
```

And in the `response_items` insert inside `_response`, set the item's `submitted_at` to match the envelope (add the column + value):

```python
    for a in answers:
        conn.execute(
            text(
                "insert into response_items (response_id, tenant_id, store_node_id, store_path, "
                "survey_version_id, submitted_at, question_id, sku_id, value) values (:rid, :tid, "
                ":nid, :spath, :vid, coalesce(cast(:sub as timestamptz), now()), :qid, :sku, "
                "cast(:val as jsonb))"
            ),
            {"rid": resp_id, "tid": tenant_id, "nid": store["id"], "spath": store["path"],
             "vid": version_id, "sub": submitted_at, "qid": a["question_id"],
             "sku": a.get("sku_id"), "val": json.dumps(a["value"])},
        )
```

- [ ] **Step 2: Add a couple more Lumen responses in `run()`**

In `run()`, after the existing Lumen `_response(...)` call (the SF one), add an out-of-stock response at Oakland and a second dated SF response so the trend has two points:

```python
        # Oakland: Rosewood out of stock (0) -> shows in the OOS report.
        _response(
            conn, lumen, "Velvet Lip Shelf Check", "oakland", "marcus@lumenbeauty.com",
            [{"question_id": "q1", "sku_id": str(rose), "value": 0},
             {"question_id": "q2", "value": False}],
        )
        # An earlier SF reading so the facings trend has more than one point.
        _response(
            conn, lumen, "Velvet Lip Shelf Check", "sf", "dana@lumenbeauty.com",
            [{"question_id": "q1", "sku_id": str(rose), "value": 6}],
            submitted_at="2026-06-10T09:00:00Z",
        )
```

Note: the existing SF response is by Marcus; this second SF reading is attributed to Dana with an explicit earlier date, so the `(version, store, user)` idempotency key differs and both are kept.

Update the final `print(...)` to reflect the extra responses (e.g. "3 responses" for Lumen).

- [ ] **Step 3: Reseed and verify**

Run:
```bash
docker compose exec api python -m app.seed
docker compose exec api python -m app.seed
docker compose exec db psql -U intelli -d intelli -t -c "select count(*) from responses;"
```
Expected: both runs succeed; response count is stable across the two runs (idempotent).

- [ ] **Step 4: Confirm the suite is still green**

Run: `pnpm test:api -- tests/test_analytics.py tests/test_responses.py`
Expected: PASS (the conftest reseeds; analytics + responses tests still green).

- [ ] **Step 5: Commit**

```bash
git add api/app/seed.py
git commit -m "Phase 4b: richer demo responses (OOS at Oakland + a dated SF trend point)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Docs + full green run

**Files:**
- Modify: `START_HERE.md`, `CONTEXT.md`, `CODEBASE_MAP.md`, `api/README.md`, `CHECKING_THE_WORK.md`, `../hi-fi-intelli/Intelli_Complete_Handoff.md`

STYLE: plain non-coder English, NO em dashes, match each file's existing voice, surgical edits.

- [ ] **Step 1: Run the full suites and capture real counts**

```bash
docker compose restart api
pnpm test:api
pnpm test:admin
```
Use the real "N passed" numbers in the docs. If anything is not green, STOP and report BLOCKED.

- [ ] **Step 2: Update `START_HERE.md`**
- Add a "Phase 4b" bullet block after the Phase 4a block:
  > **Phase 4b - analytics (done):** The response rows now power read-only reports: how compliant each part of the org is (both how many expected stores responded and, of those, how many passed), drill-down from a region all the way to a single store and the exact product that failed, which products are out of stock and in how many stores, and how a product's shelf count is trending over time. Backend only, no screen yet. Proven by the test robot: the numbers add up, compliance changes when a rule changes, a company-wide survey shows for a region scoped to its own stores, and a manager only ever sees their own branch.
- Update "What's NEXT" to Phase 4c (payroll).
- In the file-structure block, add under `api/app/`: `analytics.py  Read-only reports (compliance, out-of-stock, trend)`.
- Update section 7 with 4b done, 4c next, and the real test counts.

- [ ] **Step 3: Update `CONTEXT.md`**
- In the build-order checklist, mark 4b done ([x]), 4c/4d pending.
- Add a 2026-06-16 progress-log entry: no new tables; new `analytics.py` with four read endpoints (compliance completion %/pass % with the ancestor rule, drill-down to per-product why, out-of-stock by a named count question, facings trend); pass/fail still via the one evaluator, out-of-stock/trend as indexed SQL aggregates; ScopedRepo gained the analytics section; seed enriched. State the real backend test count + 27 frontend. End "Phase 4b COMPLETE; 4c (payroll) next."

- [ ] **Step 4: Update `CODEBASE_MAP.md`**
- Add an "As of Phase 4b" paragraph after the 4a one: the backend now turns the response rows into compliance, out-of-stock, and trend reports ([api/app/analytics.py](api/app/analytics.py)), all branch-scoped and computed live, with no new tables.

- [ ] **Step 5: Update `api/README.md`**
- Add an entry for `analytics.py` (the four read-only report endpoints) and note that the ScopedRepo gained an analytics section.

- [ ] **Step 6: Update `CHECKING_THE_WORK.md`**
- Add a "Phase 4b checks (analytics)" section: in `http://localhost:8000/docs`, log in as Dana, call `GET /analytics/compliance` and read the completion %/pass % rows; call `GET /analytics/oos` for the Velvet Lip version + `q1` and see Oakland's Rosewood out of stock; call `GET /analytics/compliance/drill` on a region then a store to see the per-product why-it-failed. Note `pnpm test:api` runs the automated gate.

- [ ] **Step 7: Update the handoff CHANGELOG**
- In `../hi-fi-intelli/Intelli_Complete_Handoff.md`, add a newest-first 2026-06-16 entry summarizing Phase 4b (no new tables; the four analytics endpoints; completion %/pass % with the ancestor rule; pass/fail via the one evaluator; out-of-stock/trend as indexed SQL; branch-scoped; the real test counts) and "Next: Phase 4c (payroll)."

- [ ] **Step 8: Commit both repos**

```bash
git add START_HERE.md CONTEXT.md CODEBASE_MAP.md api/README.md CHECKING_THE_WORK.md
git commit -m "Phase 4b: docs (guides + handoff) for analytics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
cd ../hi-fi-intelli && git add Intelli_Complete_Handoff.md && git commit -m "Handoff: Phase 4b complete (production repo) - analytics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" && cd ../intelli-app
```

---

## Self-review notes (done while writing)

- **Spec coverage:** compliance summary with completion %/pass % + ancestor rule + zero-denominator (Task 1); drill children + per-product why + not-responded (Task 2); out-of-stock latest-authoritative + bad-question 400 (Task 3); trend points + daily UTC avg + date range + sku-not-on-question 400 (Task 4); richer seed (Task 5); docs + full green (Task 6). Scope isolation is tested in each endpoint task (out-of-scope 404, company isolation, version-out-of-company 404). The "not scored excluded from pass %" and "rule-recompute" gates are in Task 1.
- **Placeholder scan:** none; every step has complete code/commands.
- **Type/name consistency:** helpers `_max_level`, `_base_path_in_scope`, `_store_ids_under`, `_overall_for`, `_metrics_for_stores`, `_pct`, `_version_questions`, `_score_one`, module-level `_count_question`; public `assignment_compliance`, `compliance_drill`, `oos_by_sku`, `facings_trend` are spelled identically across tasks and the router. `evaluate_response` (from `compliance.py`) is already imported in `scope.py` (Task 3 of Phase 4a). The router uses None->404 and ValueError->400 consistently.
- **Coverage math:** assignment_compliance measures over the deeper of (target, base) subtree (= their intersection, since they overlap); drill partitions the version's covered store set by child, so children's `expected` sums to the parent's. Both keep `base` in scope, so all measured stores are in scope.
```
