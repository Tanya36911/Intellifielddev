# Phase 4d: export (CSV + read-only data API) design

Approved in design by Tanya on 2026-06-18. Phase 4 is split into 4a responses /
4b analytics / 4c payroll / 4d export. 4a, 4b, and 4c are done; this is
**Phase 4d, the export layer**: downloadable spreadsheets (CSV) plus a matching
read-only data feed (JSON) over the field data, filterable by date / survey /
chain / node / per-SKU. Backend only, no screen yet (same shape as
3a/3b/4a/4b/4c). It adds no new tables. Plain-English throughout.

## The goal, in one paragraph

Let a company get its data out: a person or a BI tool can pull **responses**
(the store survey answers), **payroll** (logged hours), and a **compliance
summary** (the headline completion/pass numbers) either as a downloadable CSV
file or as the same data in JSON, narrowed by date range, survey, chain, a spot
on the org tree, and product. Everything is read-only, computed live (pass/fail
is still never stored), and runs through the existing scope guard, so a manager
exports only their own branch and one company never sees another. No new tables:
4d only reads what 4a/4b/4c already store. This is "export, not integration"
(handoff PART 6): a one-way way to get the data out, never a two-way ERP sync.

## How 4d fits the Phase 4 split

- **4a - Responses** (done): atomic per-product rows + the read-time pass/fail
  evaluator (`api/app/compliance.py`).
- **4b - Analytics** (done): compliance % per node with drill-down, out-of-stock
  by product, facings trend.
- **4c - Payroll** (done): pay periods, time entries, manager approval, the
  seal/reopen lock, the audit log.
- **4d - Export** (this): CSV + read-only JSON feed over responses, payroll, and
  a compliance summary. Last piece of Phase 4. After it: Phase 5 (Field app +
  offline sync).

## Decisions made with Tanya (2026-06-18)

1. **Three export domains: responses, payroll, and a compliance summary.** Tanya
   chose the fullest useful set. Responses come at two levels of detail (summary
   and per-SKU). Payroll is one row per logged time entry. The compliance summary
   is the flat per-node/per-survey roll-up of completion % + pass %.
2. **One feed, two shapes.** Each export address can return either a CSV download
   or JSON, chosen by a `?format=` query parameter (default `json`;
   `format=csv` streams a download). Same query, same rows, two renderings, so
   the CSV and the "API" are literally the same data. (Considered and rejected:
   separate CSV-only endpoints reusing the existing JSON endpoints, which return
   nested/dashboard shapes, not the flat filterable feed the handoff asks for;
   and a single generic `/export?dataset=` endpoint, which muddies validation and
   reads poorly in the API menu.)
3. **API access reuses the login wristband (Tanya delegated the call).** The read
   feed authenticates with the same 12-hour JWT every other endpoint uses: a
   person or a script logs in, then pulls. This keeps 4d at zero new tables.
   **Long-lived, revocable, per-integration API keys** (for an always-on
   warehouse hookup) are a deliberate later phase, because they need a new table.
4. **The responses export includes the live pass/fail (Tanya delegated the
   call).** Each row carries its computed verdict (pass / fail / blank) next to
   the raw answer, computed fresh at read time through the one `compliance.py`
   evaluator, never stored. It is the most useful column for compliance analysis
   and keeps the export consistent with the rest of the app.
5. **Access + scope mirror the existing rules.** Responses and compliance exports
   are open to any signed-in user and branch-scoped, exactly like the 4b
   analytics feed (a node outside the caller's scope is 404). Payroll export is
   additionally gated by the per-company payroll switch (`require_payroll`, 403
   when off) and role-scoped like the existing payroll screens: a rep exports
   only their own hours, a manager their branch, an admin everything.
6. **No new tables, no schema change.** 4d is read endpoints plus a test gate over
   the tables 4a/4b/4c already created.
7. **`scope.py` size is acknowledged, not surgically fixed here.** The scope guard
   file is now ~1,200 lines and has twice flagged a by-topic split
   (catalog / surveys / responses / analytics / payroll / export). 4d adds a small,
   clearly-marked **export** section there (so the security rule keeps its one
   home) and **recommends the by-topic split become its own dedicated cleanup
   phase right after 4d**, rather than risky surgery folded into a feature.

## What gets built

### No migration
4d adds no tables and no columns. It reads `responses` / `response_items` /
`survey_versions` / `surveys` / `survey_assignments` / `nodes` / `skus` /
`pay_periods` / `time_entries` / `users` / `assignments`, using the indexes 4a
and 4c already created.

### The scope guard learns export
The shared `ScopedRepo` (`api/app/scope.py`, the single object allowed to touch
scoped tables, so no endpoint can forget the tenant + branch filter) gains a
new, clearly-labelled **export** section. Every query keeps the tenant +
`path like scope_path || '%'` filter. New public methods, each returning a flat
list of plain dict rows ready to render as CSV or JSON:

- `export_responses(grain, date_from=None, date_to=None, survey_id=None,
  chain=None, node_id=None, sku_id=None)` - flat response rows for the caller's
  branch (or `node_id`'s subtree, within scope).
  - `grain="summary"`: one row per completed response: `response_id`,
    `store_node_id`, `store_name`, `chain`, `survey_id`, `survey_name`,
    `survey_version_id`, `version_number`, `user_id`, `submitted_at`, `online`,
    `overall` (the live overall verdict: `true`/`false`/blank), `num_passed`,
    `num_failed` (item counts from the live scoring).
  - `grain="sku"`: one row per atomic answer item: `response_id`,
    `store_node_id`, `store_name`, `chain`, `survey_name`, `version_number`,
    `submitted_at`, `question_id`, `sku_id`, `sku_line`, `sku_variant`, `value`
    (the raw answer), `item_pass` (the live per-item verdict: `true`/`false`/
    blank).
  - Filters: `date_from`/`date_to` on `submitted_at` (UTC, inclusive);
    `survey_id` (all its versions; omit for all surveys); `chain` (store
    attribute); `node_id` (a node in the caller's scope; its store subtree);
    `sku_id` (only meaningful at `grain="sku"`). Pass/fail is computed by the
    existing `evaluate_response`, batched (fetch each version's questions once
    and the relevant items in bulk), never re-expressed as SQL.
  - Returns `None` if `node_id` is given but out of scope (-> 404).
- `export_payroll(caller_user_id, caller_role, period_id=None, date_from=None,
  date_to=None, node_id=None)` - one row per time entry the caller is allowed to
  see: `entry_id`, `period_id`, `period_name`, `start_date`, `end_date`,
  `period_status`, `user_id`, `rep_name`, `rep_email`, `store_min`, `reset_min`,
  `drive_min`, `miles`, `mgr_status`, `sealed`, `rep_node_name`. Role-scoped like
  `list_entries` (rep -> own; manager/admin -> reps pinned within scope).
  Filters: `period_id`; `date_from`/`date_to` (periods overlapping the range);
  `node_id` (branch within scope). Returns `None` if `node_id` is out of scope.
- `export_compliance(node_id=None)` - the flat per-assignment roll-up, reusing
  `assignment_compliance(node_id)` unchanged and returning its rows
  (`assignment_id`, `survey_id`, `survey_name`, `survey_version_id`,
  `target_node_id`, `target_node_name`, `expected`, `responded`, `scored`,
  `passed`, `completion_pct`, `pass_pct`). So the export and the 4b dashboard can
  never disagree. Returns `None` if `node_id` is out of scope.

### The web addresses (a new router, `api/app/exports.py`)
All read-only, branch-scoped (a node outside the caller's scope returns 404).
Each takes `format=csv|json` (default `json`):

- `GET /export/responses?format=&grain=summary|sku&date_from=&date_to=&survey_id=&chain=&node_id=&sku_id=`
  (any signed-in user). Default `grain=summary` (matching the prototype modal).
- `GET /export/payroll?format=&period_id=&date_from=&date_to=&node_id=`
  (any signed-in user; gated by `require_payroll`, 403 if the company has payroll
  off; entries are role-scoped).
- `GET /export/compliance?format=&node_id=` (any signed-in user).

Output mechanics (in `exports.py`, the presentation layer):
- **JSON**: `{"rows": [...], "count": N}`, consistent with the other endpoints.
  A non-scalar answer value (a multi-choice list) is kept as a real JSON list in
  the JSON feed and rendered as its compact JSON text in a CSV cell, so one
  column always holds one value.
- **CSV**: a `StreamingResponse` (`text/csv; charset=utf-8`) written row by row
  with Python's `csv` module from a generator, so a large export is never built
  whole in memory. A `Content-Disposition: attachment; filename="..."` header
  names the file, e.g. `intelli_responses_summary_2026-04-01_2026-06-18.csv`,
  `intelli_payroll_<dates>.csv`, `intelli_compliance_<date>.csv`. Column order is
  defined once per dataset/grain so the header row and the JSON keys stay in
  lockstep.
- Validation: a node not in scope -> 404; `require_payroll` off -> 403 on the
  payroll endpoint; an unknown `grain` or `format` -> 400.

### Demo data
The 4a/4b/4c seed already builds a non-trivial world (responses across Bay Area
stores with passes/fails/out-of-stock and a dated trend point; a Lumen open pay
period with entries; payroll on for Lumen, off for Acme). 4d is expected to need
**no seed change**; extend the seed only if a specific test needs a row that does
not exist yet, keeping it idempotent like the rest.

### The tests (the gate for 4d)
- **Format parity (headline):** for the same filters, `format=csv` and
  `format=json` return the same logical rows (same count, same set); the CSV has
  a header row plus one row per record; the JSON has `rows`/`count`.
- **Responses grains:** `grain=summary` yields one row per response with the
  overall verdict and item counts; `grain=sku` yields one row per atomic item
  with the raw value and its per-item pass/fail.
- **Export pass/fail is rule-derived, not stored:** changing a survey's pass rule
  (a new version with a different threshold, scored over the same values) flips
  the verdict shown in the export. This is the Phase 4 gate ("compliance
  recomputes when a rule changes") seen through the export.
- **Filters:** `date_from`/`date_to`, `survey_id`, `chain`, `node_id`, and
  `sku_id` each narrow the rows correctly; combining them ANDs; a `node_id`
  outside scope -> 404.
- **Payroll export:** role-scoped (a rep gets only their own entries, a manager
  their branch, an admin all); a payroll-off company (Acme) gets 403; the rows
  carry `mgr_status` and `sealed`; the period filter works.
- **Compliance export:** the rows match the numbers `GET /analytics/compliance`
  returns for the same node (same brain, flat shape); branch-scoped.
- **Scope isolation:** a manager's export excludes sibling branches; another
  company's data never appears in any export; cross-company `node_id` -> 404.
- **Streaming smoke test:** a multi-row CSV export returns a well-formed file
  (header + rows, UTF-8) without error.
- The full backend suite plus the existing 27 frontend checks stay green.

## The new and changed files
- `api/app/exports.py` - the export router, its query-parameter handling, the
  CSV streaming + per-dataset column definitions + filename logic. New.
- `api/app/scope.py` - add the **export** section to `ScopedRepo`
  (`export_responses`, `export_payroll`, `export_compliance`). Modify.
- `api/app/main.py` - mount the export router. Modify.
- `api/app/seed.py` - only if a test needs new demo data (not expected). Modify
  if needed.
- `api/tests/test_exports.py` - the tests above. New.
- Docs updated in the same breath: `api/README.md`, `CODEBASE_MAP.md`,
  `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`, and the prototype handoff
  CHANGELOG. (No `db/README.md` change: no schema change.)

## Deliberately NOT in Phase 4d (so nothing is silently missing)
- **Permanent / revocable API keys:** the read feed reuses the login wristband in
  v1; long-lived per-integration keys (always-on warehouse access) need a new
  table and are a later phase.
- **The `scope.py` by-topic split:** acknowledged (decision 7), recommended as
  its own dedicated cleanup phase right after 4d; not folded into this feature.
- **Pagination on the JSON feed:** v1 returns the full scoped, filtered set
  (bounded by scope at demo scale); `limit`/`offset` paging can be added later if
  volume grows, without changing the shape.
- **Any screen / the export modal UI:** a later frontend phase. The prototype
  `export-modal.jsx` is the visual spec for then; 4d is the backend it will call.
- **Excel/XLSX or other formats:** CSV (UTF-8) + JSON only; other formats later
  if asked.
- **Live two-way ERP / inventory / warehouse sync:** export only, per handoff
  PART 6 and PART 8. Shelf data (facings) is never fed into inventory systems or
  vice versa.
- **A new export of the out-of-stock / trend analytics:** the compliance summary
  is the one analytics roll-up exported; out-of-stock and trend stay the 4b JSON
  endpoints (and are derivable from the per-SKU responses export). Can be added
  later in the same shape if wanted.

## How we will know 4d is done
All export tests green (CSV/JSON parity, both response grains, rule-derived
pass/fail in the export, every filter, payroll role-scoping + the company switch,
the compliance export matching the dashboard, scope isolation, the streaming
smoke test), the full backend and the 27 frontend checks still green, a live
walk-through (log in, pull a responses CSV and the same data as JSON, pull a
payroll CSV as a rep then as a manager, pull the compliance summary, try an
out-of-scope node and get 404, try payroll as Acme and get 403) behaves as
described, and all guides updated.
