# Phase 4b: analytics (compliance, out-of-stock, trend) design

Approved in design by Tanya on 2026-06-16. Phase 4 is split into 4a responses /
4b analytics / 4c payroll / 4d export. Phase 4a (responses + read-time pass/fail)
is done; this is **Phase 4b, the read-only analytics layer** that reads the
response rows and reports compliance, out-of-stock, and trends. Backend only, no
screen yet (same shape as 3a/3b/4a). Plain-English throughout.

## The goal, in one paragraph

Turn the atomic response rows from 4a into the numbers a manager actually wants:
**how compliant is each part of the org** (and where exactly it failed), **which
products are out of stock and in how many stores**, and **how a product's shelf
count is trending over time**. Every number is computed fresh at read time
(pass/fail still never stored), branch-scoped through the same guard as
everything else, and built on the indexes 4a already added. No new tables.

## How 4b fits the Phase 4 split

- **4a - Responses** (done): atomic per-product rows + the pure read-time
  pass/fail evaluator (`api/app/compliance.py`).
- **4b - Analytics** (this): compliance % per node with drill-down, out-of-stock
  by product, facings trend. Read-only.
- **4c - Payroll**: pay periods, time entries, seal + logged reopen, audit.
- **4d - Export**: CSV + read API.

## Decisions made with Tanya (2026-06-16)

1. **Compliance reports BOTH a completion % and a pass %, side by side.**
   - *completion %* = of the stores a survey was assigned to (expected), how many
     actually submitted a response. A store that should have responded but did not
     counts against completion (this is the honest manager's view; missing work
     shows up, matching the handoff's deadline/overdue focus).
   - *pass %* = of the stores that responded, how many passed overall.
   - Both come with their raw counts (expected / responded / passed).
   - Zero-denominator rule (so percentages are never a divide-by-zero): if
     `expected` is 0, `completion_pct` is `null`; if `responded` is 0,
     `pass_pct` is `null`. The raw counts always tell the true story.
2. **Responses are matched to assignments by computation, not a stored link.** A
   response belongs to an assignment when its `survey_version_id` equals the
   assignment's and its store sits within the assignment's target-node subtree
   (path prefix). So no new column on `responses`; the link is derived, the same
   way 3b computes assignment coverage live. (This is the assignment linkage the
   4a spec deferred to 4b.)
3. **Out-of-stock and trend are run for a caller-named count question.** A report
   is always scoped to a specific survey version + question id; out-of-stock means
   that per-product answer equals 0. No change to the survey schema, no
   mis-reading (the caller points at the right count question). If a future survey
   adds a per-product number that is NOT a count (e.g. a price), an optional
   "this is the shelf count" tag can be added later without breaking this; not
   needed now. (Considered and rejected for now: tagging the metric on the
   question, and assuming every per-product number is a count.)
4. **"Latest is authoritative" for current state (PART 7).** Compliance and
   out-of-stock use each store's **latest** response for the relevant version.
   Trend uses **all** responses over time.
5. **Compute split: rules in one place, numbers in SQL.** Pass/fail is computed
   by the existing `compliance.py` evaluator (never re-expressed as SQL, so the
   rules never fork into two sources of truth). Out-of-stock and trend are pure
   number facts (value == 0; value over time), done as indexed SQL aggregates over
   `response_items`. (Considered and rejected: pushing the pass rules into SQL for
   speed, which would duplicate the rule logic and risk drift.)
6. **No new tables, no schema change.** 4b is read endpoints plus a test gate.

## What gets built

### No migration
4b adds no tables and no columns. It reads `responses` / `response_items` /
`survey_versions` / `survey_assignments` / `nodes` / `skus`, using the indexes
created in the 4a migration (`response_items` on `(tenant_id, sku_id,
submitted_at)`, `(tenant_id, store_node_id)`, etc.).

### The scope guard learns analytics
The shared `ScopedRepo` (`api/app/scope.py`, the single object allowed to touch
scoped tables, so no endpoint can forget the tenant + branch filter) gains a new,
clearly-labelled **analytics** section. Every query keeps the tenant +
`path like scope_path || '%'` filter. New public methods:

- `assignment_compliance(node_id=None)` - for each survey assignment in the
  caller's scope whose target node sits within `node_id` (default: the caller's
  whole branch), return `{assignment_id, survey_id, survey_name,
  survey_version_id, target_node_id, target_node_name, expected, responded,
  passed, completion_pct, pass_pct}`.
- `compliance_drill(node_id, survey_version_id)` -
  - if `node_id` is NOT a store: for each immediate child node, the completion %
    and pass % for that version over the child's coverage (`{node_id, name,
    level_order, is_store, expected, responded, passed, completion_pct,
    pass_pct}`), so a manager can navigate region -> districts -> stores;
  - if `node_id` IS a store (deepest level): the store's latest response for that
    version, fully scored (`items` with per-item `pass`, per-question verdicts,
    `overall`), i.e. the per-product "why it failed"; or `{responded: false}` if
    the store never responded.
- `oos_by_sku(survey_version_id, question_id, node_id=None)` - for the named
  per-product count question, using each store's latest response under `node_id`,
  return per product `{sku_id, line, variant, oos_store_count,
  reporting_store_count}` (out of stock = answer 0).
- `facings_trend(survey_version_id, question_id, sku_id, node_id=None,
  date_from=None, date_to=None)` - for that product + count question across the
  node's stores, return the data points `{submitted_at, store_node_id,
  store_name, value}` over time (all responses, not just latest) plus a per-day
  average series; honors an optional date range.

Internal helpers (private, in the same analytics section):
- `_coverage_store_paths(conn, target_path)` - the deepest-level (store) nodes
  under a path, reusing the 3b coverage logic.
- `_latest_response_ids(conn, version_id, scope_or_node_path)` - the latest
  response per store for a version (`distinct on (store_node_id) ... order by
  store_node_id, submitted_at desc`).
- `_overall_by_store(conn, version_id, response_ids)` - batch-score: fetch the
  version's questions once and all items for the given response ids in one query,
  group by response, run `evaluate_response` per group, return `{store_node_id:
  overall verdict}`. (Efficient: 2 queries + in-memory evaluation, no per-store
  round trip.)

### The web addresses (a new router, `api/app/analytics.py`)
All read-only, any signed-in user, branch-scoped (a node outside the caller's
scope returns 404):
- `GET /analytics/compliance?node_id=<optional>` - the per-assignment
  completion % + pass % summary for the node (default: whole branch).
- `GET /analytics/compliance/drill?node_id=<required>&survey_version_id=<required>`
  - the children rollup, or the per-product why-it-failed at a store.
- `GET /analytics/oos?survey_version_id=<required>&question_id=<required>&node_id=<optional>`
  - out-of-stock by product.
- `GET /analytics/trend?survey_version_id=<required>&question_id=<required>&sku_id=<required>&node_id=<optional>&date_from=<optional>&date_to=<optional>`
  - facings trend.
Validation: a node not in scope -> 404; a version not in the caller's company ->
404; a `question_id` that is not a per-product number question in that version ->
400; a `sku_id` not on that question -> 400.

### Demo data (so the endpoints show real numbers)
Extend the seed so analytics is non-trivial: a small spread of responses across
the Bay Area stores (`sf`, `oakland`) for the Velvet Lip survey, including at
least one product at 0 (out of stock) and at least two responses for one
store/product on different dates (so the trend has more than one point and
"latest is authoritative" is visible). The `_response` seed helper gains an
optional `submitted_at` so dated points can be seeded. Idempotent, like the rest.

### The tests (the gate for 4b)
- **Compliance counts (headline):** assign a survey to a node with a known set of
  stores; have some respond (some pass, some fail) and some not respond; assert
  `expected`, `responded`, `passed`, and that `completion_pct` and `pass_pct`
  match by hand. Confirm a store that never responded lowers completion % but not
  pass %.
- **Compliance is rule-derived, not stored:** two versions whose only difference
  is the pass threshold, scored over the same answer values, yield different
  pass % (compliance recomputes from the rule; the verdict is never stored). This
  is the Phase 4 gate ("compliance recomputes when a rule changes").
- **Drill-down:** a region returns its child districts each with their %; a store
  returns the per-question / per-product why-it-failed (the failing question + its
  value vs threshold); a store that never responded returns `responded: false`.
- **Out-of-stock:** a store whose latest response records a SKU at 0 shows in the
  out-of-stock count; a re-visit recording a non-zero value removes it (latest is
  authoritative); a SKU never at 0 is not counted.
- **Trend:** returns the data points for a SKU over time, in order, with the
  per-day average; respects the date range; uses all responses, not just latest.
- **Scope isolation:** a manager gets analytics only for their branch; a node
  outside scope -> 404; another company's data never appears; cross-company
  version -> 404.
- **Live coverage:** a store added under the target node after the assignment
  raises the `expected` count (coverage is computed, not copied).
- The full backend suite plus the existing 27 frontend checks stay green.

## The new and changed files
- `api/app/analytics.py` - the analytics router + its query-parameter models. New.
- `api/app/scope.py` - add the analytics section to `ScopedRepo` (the four public
  methods + the three private helpers). Modify. (Note: `scope.py` is the single
  scoped-data gateway by design; keeping analytics here preserves the
  one-place-for-the-guard guarantee. The file is growing; if it becomes unwieldy
  a future refactor could split the repo by concern, but the security invariant
  takes priority over file size for now.)
- `api/app/main.py` - mount the analytics router. Modify.
- `api/app/seed.py` - the extra demo responses + optional `submitted_at` on
  `_response`. Modify.
- `api/tests/test_analytics.py` - the tests above. New.
- Docs updated in the same breath: `api/README.md`, `CODEBASE_MAP.md`,
  `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`, and the prototype handoff
  CHANGELOG. (No `db/README.md` change: no schema change.)

## Deliberately NOT in Phase 4b (so nothing is silently missing)
- **Payroll** (pay periods, time entries, seal/reopen, audit): Phase 4c.
- **Export** (CSV + read API): Phase 4d. 4b returns JSON for screens/tests; bulk
  export is its own piece.
- **Screens / charts:** a later phase. 4b is the read endpoints the charts will
  call. (The handoff's chart-type rules, horizontal bars and lines never pie, are
  a frontend concern for then.)
- **A stored metric tag on questions** (to auto-find the count question): deferred
  per decision 3; the caller names the question for now.
- **Overdue / deadline escalation logic:** completion % already exposes "expected
  but not responded"; turning that into overdue flags + escalation is a separate
  behavior (handoff PART 7), not built here.
- **"Below planogram" (0 < facings < target) analytics:** out-of-stock (== 0) is
  in; the in-between band can be added later, it is the same shape of query.

## How we will know 4b is done
All analytics tests green (compliance counts + rule-derived pass %, drill-down to
per-product why, out-of-stock with latest-authoritative, trend over time, scope
isolation, computed coverage), the full backend and frontend runs still green, a
live walk-through (assign -> some stores respond -> read compliance, drill to a
failing store, read out-of-stock and a trend) behaves as described, and all
guides updated.
