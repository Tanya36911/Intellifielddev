# Compliance-by-node fix Implementation Plan

> **For agentic workers:** implement task-by-task, test-first. Steps use checkbox
> (`- [ ]`) syntax. Backend tests run in docker (`docker compose exec -T api
> pytest`); frontend on the host (`pnpm test:admin`, `pnpm build:admin`). Commit
> each task straight to main, UNPUSHED.

**Goal:** Make the dashboard's "Compliance by node" list org nodes (region ->
district -> store -> per-product reason), windowed to the headline range, and
retune the seed so the demo shows healthy, filled, believable numbers.

**Architecture:** Add a read-only `node_compliance` rollup to ScopedRepo reusing
`_dashboard_window`; add `GET /analytics/compliance/nodes`; rewrite the frontend
ComplianceList into a recursive node drill fed by a windowed `useNodeCompliance`;
retune response values in seed.py (no new tables, footprint unchanged).

**Tech Stack:** FastAPI + SQLAlchemy Core + Postgres; React 19 + Vite + TS +
TanStack Query + CSS Modules + Vitest.

Spec: docs/superpowers/specs/2026-06-19-compliance-by-node-fix-design.md

---

## Task 1: Backend `node_compliance` method + endpoint + tests

**Files:**
- Modify: `api/app/scope.py` (add `node_compliance`, `_store_node_compliance`)
- Modify: `api/app/analytics.py` (add `GET /analytics/compliance/nodes`)
- Test: `api/tests/test_analytics.py` (7 new tests, isolated own-data)

- [ ] **Step 1: Write failing tests** for the 7 cases in the spec
  (children rollup, no-double-count, store why-failed, store no-response,
  out-of-scope 404, unpinned empty, respects-window). Each builds its own
  survey/assignment/responses like the existing analytics tests; the window test
  submits a response then queries with a window that excludes it.
- [ ] **Step 2: Run, verify they fail** (`docker compose exec -T api pytest
  tests/test_analytics.py -k node_compliance -v`) — 404/AttributeError.
- [ ] **Step 3: Implement** `node_compliance(self, node_id=None, date_from=None,
  date_to=None)`:
  - `if self.scope_path is None: return {"is_store": False, "children": []}`
  - open conn; `base = self._base_path_in_scope(conn, node_id)`; `if base is None:
    return None`; `maxlvl = self._max_level(conn)`.
  - look up the base node by exact path (`where path = :base and tenant_id=...`).
  - if `node["level_order"] == maxlvl`: `return self._store_node_compliance(conn,
    node, date_from, date_to)`.
  - else: children = immediate children (`parent_id = base node id`, order by
    `level_order, name`); for each, `m = self._dashboard_window(conn, c["path"],
    maxlvl, date_from, date_to)`; append `{node_id, name, level_order,
    is_store: level_order==maxlvl, **m}`. Return `{"is_store": False, "children":
    rows}`.
  - `_store_node_compliance(conn, node, date_from, date_to)`: find DISTINCT
    `survey_version_id` + survey name where `:store_path like target.path || '%'`
    (tenant-scoped); for each, `questions = self._version_questions(...)`, fetch
    the store's latest-in-window response (append df/dt clauses), `_score_one` it;
    build a block ALWAYS containing `items`/`questions`/`overall` (empty defaults
    when no response). Return `{"is_store": True, "name": node["name"],
    "surveys": blocks}`.
- [ ] **Step 4: Add the endpoint** in analytics.py (node_id + date_from + date_to,
  404 on None).
- [ ] **Step 5: Run all backend tests** (`docker compose exec -T api pytest -q`) —
  all green (183 + 7).
- [ ] **Step 6: Commit** ("feat(analytics): node-compliance rollup endpoint
  (region -> store drill, windowed)").

## Task 2: Seed retune

**Files:** Modify `api/app/seed.py`

- [ ] **Step 1:** Marcus SF response q1 `3 -> 6`, q2 stays True (comment update).
- [ ] **Step 2:** Marcus Oakland response q1 `0 -> 2`, q2 `False -> True`.
- [ ] **Step 3:** Add a Chicago-store response (author rico, `2026-06-16T10:00:00Z`,
  q1 5, q2 True) AFTER rico is created; update the surrounding comments.
- [ ] **Step 4:** Update the closing `print(...)` (responses 10 -> 11).
- [ ] **Step 5: Reseed + run the full suite** (`docker compose exec -T api pytest
  -q`) — all green (the seed is rebuilt by conftest; footprint/protected-instant
  contracts hold).
- [ ] **Step 6: Commit** ("chore(seed): healthy demo readings for compliance-by-node").

## Task 3: Frontend hook + types

**Files:** Modify `apps/admin/src/pages/Dashboard/useDashboard.ts`

- [ ] **Step 1:** Add `NodeComplianceRow`, `StoreSurveyBlock`, `NodeCompliance`
  (union on `is_store`), keep `DrillItem`. Add `useNodeCompliance(nodeId, range)`
  sending `date_from`/`date_to` from `rangeToDates(range)` + optional `node_id`,
  queryKey `['node-compliance', range, nodeId ?? 'root']`.
- [ ] **Step 2:** Remove `useCompliance`, `useComplianceDrill`, `ComplianceRow`,
  `DrillResult`, `DrillChild`.
- [ ] **Step 3:** `pnpm build:admin` (tsc) — expect errors only from the not-yet-
  rewritten ComplianceList/Dashboard (fixed in Task 4); do not commit yet.

## Task 4: ComplianceList rewrite + Dashboard wiring + frontend tests

**Files:**
- Rewrite: `apps/admin/src/pages/Dashboard/ComplianceList.tsx`
- Modify: `apps/admin/src/pages/Dashboard/Dashboard.tsx`
- Modify: `apps/admin/src/pages/Dashboard/Dashboard.test.tsx`, `apps/admin/src/App.test.tsx`
- Create: `apps/admin/src/pages/Dashboard/ComplianceList.test.tsx`
- Maybe extend: `ComplianceList.module.css` (reuse existing classes; add a
  survey-header class if needed)

- [ ] **Step 1:** Write `ComplianceList.test.tsx` (region row renders pct + count;
  null pass_pct -> dash) — failing.
- [ ] **Step 2:** Rewrite ComplianceList: `{ range }` prop; `useNodeCompliance(
  undefined, range)`; `NodeRow` + recursive `NodeDrill` narrowing on
  `data.is_store`; store block renders survey header + items + question verdicts;
  null-safe.
- [ ] **Step 3:** Wire Dashboard.tsx: `<ComplianceList range={range} />`, drop
  `useCompliance`.
- [ ] **Step 4:** Update Dashboard.test.tsx mocks (branch on `node_id=` first; drop
  `/drill` branch) and App.test.tsx (`{is_store:false, children:[]}`).
- [ ] **Step 5:** `pnpm test:admin` + `pnpm build:admin` — all green.
- [ ] **Step 6: Commit** ("feat(admin): compliance-by-node region drill, windowed
  to the dashboard range").

## Task 5: Docs

**Files:** `CODEBASE_MAP.md`, `api/app/README.md`, `apps/admin/src/pages/Dashboard/README.md`
(if present) or the admin README, `CONTEXT.md`, the handoff/CHANGELOG.

- [ ] Document the new endpoint + the node-drill screen behavior + the seed demo
  picture, in plain English; commit ("docs: compliance-by-node region drill").
