# Compliance-by-node fix: region rollup + a healthy demo world (design)

Date: 2026-06-19. Status: approved by Tanya ("make the changes urself"), pending
adversarial spec review.

## The problem (what Tanya saw)

Side by side with the prototype, our dashboard's "Compliance by node" card looks
worse in two ways:

1. **It groups by survey, not by region.** Our card lists one row per *survey
   assignment* ("Velvet Lip Shelf Check / Central", "Velvet Lip Shelf Check /
   Lumen Beauty"), so the same survey name shows twice and the rows read as
   confusing duplicates. The prototype lists one row per *region* (West, Central,
   Northeast, Southeast), which is the intuitive "how is each part of my org
   doing" view.
2. **The demo data makes it look broken.** The bars are empty and it reads "0%"
   / "—" because the most recent shelf readings in the seed happen to *fail* the
   pass rule (the two original Marcus responses default to `now()`, so they are
   always the latest reading at SF and Oakland, and both fail). That forces the
   "Avg. compliance" headline to 0%, which reads as broken, not as a healthy demo.

## Goals

- "Compliance by node" lists the caller's **org nodes** (regions for an admin at
  the root), each with a rolled-up compliance %, and drills region -> district ->
  store -> the per-product reason it failed. Matches the prototype's structure.
- The seeded demo world shows **healthy, believable, non-broken numbers** with
  every bar filled, a clear drillable failure, and an overall in a sensible range.
- Everything stays **real** (computed live, branch-scoped) and **no new tables**.
- The region card is computed over the **same time window** the headline KPI uses,
  so the two never disagree.
- The existing 183 backend tests + 51 frontend checks stay green (updating the
  handful of frontend dashboard mocks that hard-code the old shape is expected;
  the suite grows by the new node-compliance backend + ComplianceList tests).

Non-goals: growing the org tree (footprint stays 8 nodes / 3 stores / 2 reps, a
hard test contract); changing the catalog, payroll, surveys, or export; touching
the AI preview (stays a labeled preview).

## Part A: backend node-compliance rollup

Add one read-only method + one endpoint. The existing `assignment_compliance`
(`GET /analytics/compliance`) and per-version `compliance_drill`
(`GET /analytics/compliance/drill`) stay unchanged (the export matches against
the former; tests use both). We only ADD a node-oriented view.

### `ScopedRepo.node_compliance(node_id=None, date_from=None, date_to=None)`

Compliance rolled up by org node, cross-survey, **windowed** (latest response per
store *within the window*). Branch-scoped through the same `_base_path_in_scope`.
The window is threaded so the card matches the headline. Returns:

- **Unpinned caller** (`scope_path is None`): `{"is_store": False, "children": []}`
  (a 200 empty payload, matching how `dashboard()` treats the unpinned case).
- **`node_id` out of scope**: `None` -> the endpoint raises 404.
- **Base is NOT a store** (level_order < max): its **immediate child nodes**, each
  with the aggregate over the DISTINCT (store, survey_version) coverage beneath
  it, reusing the dashboard window engine:
  ```
  {"is_store": False, "children": [
     {"node_id", "name", "level_order", "is_store",
      "expected", "responded", "scored", "passed",
      "completion_pct", "pass_pct"}, ...]}
  ```
  Each child's metrics come from `self._dashboard_window(conn, child_path, maxlvl,
  date_from, date_to)`, which de-dupes overlapping coverage by distinct (store,
  version) and scores the latest-in-window response per store. **Because the
  dashboard's headline "Avg. compliance" is also `_dashboard_window` over the
  caller's whole scope with the SAME window, the region rows aggregate to the
  headline** (the headline is the scope-root rollup; the region rows are its
  immediate children). This is the corrected invariant: same function AND same
  window. (`_dashboard_window` with `date_from`/`date_to` None degrades to all-
  time via empty df/dt clauses, but the frontend always sends the active range,
  so the card is always windowed in practice.)
- **Base IS a store** (level_order == max): the per-product why-it-(failed)
  across the survey version(s) that cover the store, using each version's
  **latest-in-window** response so the store detail matches the rollup that
  counted it:
  ```
  {"is_store": True, "name": <store name>, "surveys": [
     {"survey_version_id", "survey_name", "responded": bool,
      "items": [{question_id, sku_id, value, pass}],     # ALWAYS present, [] if no response
      "questions": {question_id: bool|null},              # ALWAYS present, {} if no response
      "overall": bool|null}, ...]}
  ```
  A store covered by N versions returns N blocks (in the current demo, exactly 1).
  Note this is deliberately a richer/more-uniform shape than the legacy
  `compliance_drill` store branch (which returns just `{is_store, responded}` on a
  no-response store): `node_compliance` ALWAYS includes `items`/`questions`/
  `overall` (empty defaults when unresponded) so the frontend reads
  `block.items`/`block.questions` without optional-chaining surprises.

Children are ordered `by level_order, name`. The store-covering-versions query
uses `:store_path like target.path || '%'` (target is an ancestor-or-self of the
store) with `DISTINCT survey_version_id` so two overlapping assignments of the
same version collapse to one block. The store's latest-in-window response query
appends the same df/dt clauses as `_dashboard_window`. All queries are tenant-
scoped; the store/node is already proven in-scope by `_base_path_in_scope`.

Helpers: reuse `_base_path_in_scope`, `_max_level`, `_dashboard_window`,
`_version_questions`, `_score_one`. Add `_store_node_compliance(conn, node,
maxlvl)` for the store branch.

### `GET /analytics/compliance/nodes?node_id=`

```python
@router.get("/compliance/nodes")
def compliance_nodes(node_id: UUID | None = None,
                     date_from: datetime | None = None,
                     date_to: datetime | None = None,
                     repo=Depends(get_scoped_repo)):
    result = repo.node_compliance(node_id, date_from, date_to)
    if result is None:
        raise HTTPException(404, "Node not found in your scope")
    return result
```

### Backend tests (api/tests/test_analytics.py, isolated own-data like the rest)

1. `test_node_compliance_lists_children_rollup`: admin at root -> children include
   a node whose rollup over a freshly assigned+answered version is correct
   (expected/responded/passed), proving cross-node rollup.
2. `test_node_compliance_no_double_count`: two overlapping assignments of the same
   version under one child add the child's expected ONCE (distinct coverage),
   mirroring the dashboard no-double-count contract.
3. `test_node_compliance_store_shows_why_failed`: drilling to a store returns
   `is_store True`, a surveys block with `overall False` and `questions[qid]
   False` for a failing answer.
4. `test_node_compliance_store_no_response`: a covered store with no response
   returns a block with `responded False`, `items []`, `overall None`.
5. `test_node_compliance_node_out_of_scope_404`: a manager asking for a sibling
   branch node gets 404.
6. `test_node_compliance_unpinned_empty`: newbie (no pin) gets
   `{"is_store": False, "children": []}`.
7. `test_node_compliance_respects_window`: with a past-deadline-free assignment +
   a response, a window that EXCLUDES the response yields responded 0 for that
   child (proves the date window is threaded, matching the headline KPI).

## Part B: the frontend reshape (apps/admin)

### useDashboard.ts

Add types `NodeComplianceRow`, `StoreSurveyBlock`, `NodeCompliance` (a discriminated
union on `is_store`), reusing the existing `DrillItem`. The hook takes the active
range and sends the SAME `date_from`/`date_to` the dashboard uses (via the existing
`rangeToDates`), so the card is windowed to match the headline:
```ts
export function useNodeCompliance(nodeId: string | undefined, range: Range) {
  const { date_from, date_to } = rangeToDates(range)
  const q = new URLSearchParams({ date_from, date_to })
  if (nodeId) q.set('node_id', nodeId)
  return useQuery({
    queryKey: ['node-compliance', range, nodeId ?? 'root'],
    queryFn: () => apiGet<NodeCompliance>('/analytics/compliance/nodes?' + q.toString()),
  })
}
```
Remove the now-unused `useCompliance` and `useComplianceDrill` (and the
assignment-only `ComplianceRow` / `DrillResult` / `DrillChild` types). Keep
`DrillItem`. Note: removing dead exports does NOT break `tsc --noEmit` (the admin
tsconfig has `strict` but not `noUnusedLocals`); the only hard constraint is that
no surviving file imports a removed symbol. Verified the only importers are
`ComplianceList.tsx` and `Dashboard.tsx` (both rewritten here); `useDashboard.test.ts`
imports only `rangeToDates`.

### ComplianceList.tsx (recursive node drill)

- Default export takes `{ range }` and calls `useNodeCompliance(undefined, range)`
  (scope root), rendering the root's children as `NodeRow`s.
- `NodeRow({ node, range })`: one clickable row (chevron when not a store,
  store/branch icon, name, pass-% Bar with the existing `tone()`, pct label,
  responded/expected count). When open, renders `NodeDrill`.
- `NodeDrill({ nodeId, range })`: calls `useNodeCompliance(nodeId, range)` and
  **narrows on the fetched `data.is_store`** (the discriminant), NOT on any prop:
  `if (data.is_store) { /* data.surveys */ } else { const children = data.children ?? [] }`.
  TypeScript only narrows the union on `data.is_store`; branching on a prop and
  then reading `data.children`/`data.surveys` would fail tsc. For a non-store
  result, map `children` to nested `NodeRow`s inside the existing `.drill` box (so
  depth nests visually). For a store result, render each survey block: a small
  survey-name header with the overall verdict mark, then the per-product item lines
  (verdict icon, question id, `sku · value`) and the per-question verdicts, using
  the existing `verdictIcon` / `valueText` helpers.
- Null-safe throughout: missing `children` -> empty note; never `.map` on a
  non-array (the latent-crash class we fixed in Stage D). `block.items`/
  `block.questions` are always arrays/objects by the backend contract above.

### Dashboard.tsx

Replace `const comp = useCompliance()` + `<ComplianceList rows={...} />` with
`<ComplianceList range={range} />` (it fetches its own root rollup, windowed to the
same range as the KPIs). Title stays "Compliance by node". Everything else (KPIs,
trend, export, AI preview) is unchanged.

### Frontend test updates

- `Dashboard.test.tsx`: the root list and the drill BOTH hit
  `/analytics/compliance/nodes`, differing only by `?node_id=`. The mock MUST
  branch on the query string FIRST, e.g.
  `if (path.startsWith('/analytics/compliance/nodes') && path.includes('node_id=')) return STORE_BLOCK`
  BEFORE the bare `/analytics/compliance/nodes` -> region payload rule (otherwise
  the bare prefix shadows the drill and the store-detail assertion fails). Drop the
  now-dead `/analytics/compliance/drill` branch. Assert the region name renders and
  drilling shows the per-product detail without throwing.
- `App.test.tsx`: `dashboardRoute` returns `{ is_store: false, children: [] }`
  for `/analytics/compliance` paths (keeps the journey/redirect tests quiet).
- New `ComplianceList` unit test: a region row renders its pass-% and count; a
  null pass_pct renders the no-data dash.

## Part C: the seed retune (api/app/seed.py)

Footprint, the Acme world, payroll, the catalog, and the survey definition are
all UNCHANGED. The protected instant (`2026-06-10T09:00:00Z`, Dana's SF q1=6
response) is preserved and remains the only response at that instant. We only
change response VALUES/timestamps and add ONE store response:

- **Marcus @ SF** (the original `now()`-dated response): q1 `3 -> 6` (pass), q2
  stays True. SF's latest reading now PASSES.
- **Marcus @ Oakland** (the original `now()`-dated response): q1 `0 -> 2` (still a
  fail, but "short of 4" rather than out of stock), q2 `False -> True`. Oakland's
  latest reading FAILS on q1, giving a clean drill-to-the-reason story.
- **Add Chicago store** a response (author rico, `2026-06-16T10:00:00Z`): q1 5
  (pass), q2 True. Chicago is no longer unanswered, so Central shows a real number
  and is not overdue.

Resulting demo picture (admin at root, 12-week window):
- **West** (Bay Area: SF pass, Oakland fail) -> completion 100%, pass 50% (amber
  half-bar). Drill West -> Bay Area -> {SF pass, Oakland fail: Rosewood 2}.
- **Central** (Chicago store pass) -> completion 100%, pass 100% (green full bar).
- **Headline**: Avg. compliance 67% (2 of 3 stores pass), completion 100%,
  overdue 0, surveys completed 11, a rising weekly trend that now ends near 100%
  (Chicago's recent response lifts the last point).

No empty/zero bars, no duplicate survey rows, a believable overall, and a real
drillable failure. Update the seed comments and the closing `print(...)` summary
(responses 10 -> 11).

Why overdue becomes 0: with only three stores and Central holding a single store,
we cannot show both "Central has a real filled number" AND "Central is overdue".
Tanya's complaint was specifically the empty/0% look, so we favor a filled Central
(overdue 0, a positive "nothing overdue" state) over a non-zero overdue with an
empty Central. No test asserts the seed's overdue value (the overdue tests build
their own past-deadline assignments), so this is safe.

## Risks and how they are handled

- **Seed is load-bearing for ~183 tests.** Verified: every analytics/dashboard/
  export test creates its own isolated survey/responses or uses deltas; none
  assert the seed's compliance/OOS/overdue values. The only seed contracts are
  footprint (unchanged), the protected instant (preserved), payroll pins
  (untouched), and Acme isolation (Velvet stays Lumen). `_response` is idempotent
  by (version, store, user), so the tamper-restore test's `run()` re-call stays a
  safe no-op.
- **Recursive hook calls in the frontend.** Each drill level is its own component
  instance (`NodeDrill`) that calls `useNodeCompliance` once; React allows one
  hook call per instance, and org depth is shallow (Company -> Region -> District
  -> Store).
- **Perf (N+1).** `node_compliance` runs `_dashboard_window` per child; the same
  bounded-N caveat as the existing `assignment_compliance`. Acceptable at demo
  scale; documented inline.

## Test/quality gate

- Backend: `docker compose exec -T api pytest` (rebuild + reseed `intelli_test`),
  all green including the 6 new node-compliance tests.
- Frontend: `pnpm test:admin` and `pnpm build:admin`, all green.
- Commit each logical unit straight to main, UNPUSHED (push auto-deploys).
- Update CODEBASE_MAP.md, api/app/README.md, apps/admin README, CONTEXT.md, and
  the handoff/CHANGELOG in the same change.
