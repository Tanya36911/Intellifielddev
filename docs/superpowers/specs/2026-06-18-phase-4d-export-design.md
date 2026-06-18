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
  branch (or `node_id`'s subtree, within scope). **`grain="summary"` returns
  EVERY stored response in scope (the full audit trail), not the latest per
  store.** This is deliberately different from the compliance roll-up (which is
  latest-per-store), so the summary row count is not meant to match the
  completion numbers; the summary export is the raw record, the compliance export
  is the rolled-up view. (There is no draft/completed state: a `responses` row
  exists only after a successful submission, so "every response" means every row.)
  - `grain="summary"`: one row per response: `response_id`, `store_node_id`,
    `store_name`, `chain`, `survey_id`, `survey_name`, `survey_version_id`,
    `version_number`, `user_id`, `submitted_at`, `online`, `overall` (the live
    overall verdict, `true`/`false`/blank), `num_passed`, `num_failed` (the count
    of this response's countable **question** verdicts that are True and that are
    False respectively; a question with no pass rule or only blank answers is not
    counted, so it lands in neither, exactly like `overall`).
  - `grain="sku"`: one row per **stored** atomic answer item: `response_id`,
    `store_node_id`, `store_name`, `chain`, `survey_name`, `version_number`,
    `submitted_at`, `question_id`, `sku_id`, `sku_line`, `sku_variant`, `value`
    (the raw answer), `item_pass` (the live per-item verdict, `true`/`false`/
    blank). A non-per-product answered question is stored with `sku_id` NULL, so
    its row has blank `sku_id`/`sku_line`/`sku_variant`. Blank/skipped answers are
    never stored (4a drops them), so they produce no row at all; `item_pass` is
    blank only for a stored value whose question has no applicable pass rule.
  - Scoring uses the FULL `evaluate_response` output (its `items` with a per-item
    `pass`, and its `questions` verdict map and `overall`), not the
    `_overall_for` helper (which keeps only `overall`). Because a no-`survey_id`
    export spans many `survey_versions`, the algorithm is: fetch the filtered
    response rows with their `survey_version_id`; group response ids by version;
    per version load its `questions` once (via `_version_questions`) plus that
    version's `response_items` in bulk; run `evaluate_response` per response. The
    pass rules are never re-expressed as SQL.
  - Filters, every one ANDed on top of the unconditional `tenant_id = :tid AND
    n.path like scope_path || '%'` filter (and, when `node_id` is given, the
    node's subtree path), never as a standalone predicate:
    - `date_from`/`date_to`: `datetime` params, inclusive on `submitted_at`
      (`submitted_at >= :df AND submitted_at <= :dt`, the same idiom as
      `facings_trend`). A bare date means midnight UTC (so a whole-day pull passes
      the next day, or a timestamp, as `date_to`); the filename renders the bound
      as `YYYY-MM-DD` in UTC.
    - `survey_id`: matches all versions of that survey, by joining
      `response.survey_version_id -> survey_versions.survey_id` within the tenant
      (responses carry only the version id); omit for all surveys.
    - `chain`: an extra `AND nodes.chain = :chain`. Chain is a free store
      attribute that does not respect the pin (the same chain exists in other
      branches and other tenants), so it MUST stay layered on the scope filter,
      never replace it.
    - `node_id`: a node in the caller's scope; its store subtree.
    - `sku_id`: applies only at `grain="sku"` (filters `response_items.sku_id`).
      At `grain="summary"` it is ignored (summary has no per-SKU dimension), so
      `summary` + `sku_id` returns the same rows as `summary` alone.
  - Returns `None` only if `node_id` is given but out of scope (-> 404). An
    unpinned caller (`scope_path` is None) returns an empty list (200, zero rows),
    never a 404 and never a leak, mirroring `list_responses`.
- `export_payroll(caller_user_id, caller_role, period_id=None, date_from=None,
  date_to=None, node_id=None)` - one row per time entry the caller is allowed to
  see: `entry_id`, `period_id`, `period_name`, `start_date`, `end_date`,
  `period_status`, `user_id`, `rep_name`, `rep_email`, `store_min`, `reset_min`,
  `drive_min`, `miles`, `mgr_status`, `sealed`, `rep_node_name`. This is a **new,
  distinct query**, not a wrapper over `list_entries`: it reuses only that
  method's row-visibility rule, but adds joins `list_entries` does not perform.
  - **Row visibility (reused rule):** a **rep** sees only their own entries
    (`user_id = caller`); a **manager/admin** sees entries for reps whose pinned
    node is within scope (join entry -> the rep's `assignments` -> `nodes`, filter
    `path like scope_path || '%'`, with `a.tenant_id` on the join). The
    `te.tenant_id = :tid` filter is ALWAYS applied (it does not depend on the
    optional period lookup), and a manager/admin with no pin (`scope_path` None)
    gets an empty list, exactly as `list_entries` does today.
  - **New joins for the wider columns:** `pay_periods` (for `period_name`,
    `start_date`, `end_date`, `period_status`), `users` (for `rep_name`,
    `rep_email`; the `users` table carries `name`/`email`), and a **LEFT** join
    rep -> `assignments` -> `nodes` for `rep_node_name`. The LEFT join matters: an
    unpinned rep (e.g. the seeded `Newbie NoPin`) must still export their own rows
    with a blank `rep_node_name`, not be dropped. `miles` keeps the existing
    `miles::float` cast so it serializes as a JSON number, not a string.
  - **Filters:** `period_id` (one period); `date_from`/`date_to` select periods
    overlapping the range, predicate `pp.start_date <= :date_to::date AND
    pp.end_date >= :date_from::date` (inclusive; an omitted bound leaves that side
    open; compared as dates against the DATE columns, since `time_entries` has no
    per-day date); `node_id` (a branch within scope). All are ANDed on top of the
    tenant + role-scope filter.
  - Returns `None` only if `node_id` is given but out of scope (-> 404).
- `export_compliance(node_id=None)` - the flat per-assignment roll-up, reusing
  `assignment_compliance(node_id)` unchanged and returning its rows
  (`assignment_id`, `survey_id`, `survey_name`, `survey_version_id`,
  `target_node_id`, `target_node_name`, `expected`, `responded`, `scored`,
  `passed`, `completion_pct`, `pass_pct`). So the export and the 4b dashboard can
  never disagree, including that `completion_pct`/`pass_pct` are **blank (null),
  never 0**, when their denominator is 0 (the `_pct` zero rule). The CSV must
  render that `None` as an empty cell, not `0`, or the export would disagree with
  the dashboard on exactly the not-scored rows. Returns `None` only if `node_id`
  is out of scope (-> 404); an unpinned caller (`scope_path` None) returns an
  empty list (200), exactly like `GET /analytics/compliance`.

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
- **One ordered `COLUMNS` list per dataset/grain is the single source of truth**
  for BOTH the CSV header + field order AND the JSON row key order. Each JSON row
  is built by projecting the repo's dict through that `COLUMNS` list, and the CSV
  writes the same list, so the two can never silently drift (which is exactly what
  the parity test guards).
- **JSON**: `{"rows": [...], "count": N}`, consistent with the other endpoints.
  A non-scalar answer value (a multi-choice list) is kept as a real JSON list in
  the JSON feed and rendered as its compact JSON text (`json.dumps`) in a CSV
  cell, so one column always holds one value. A `None`/missing value is JSON
  `null` and an empty CSV cell (never the string `false` or `0`); pass/fail
  verdicts and the compliance percentages must follow this so "not scored" stays
  blank, not false.
- **CSV**: a `StreamingResponse` (`text/csv; charset=utf-8`). Because
  `csv.writer` needs a file-like `.write()` target (a bare generator is not one),
  the recipe is: one `io.StringIO` buffer + a `csv.writer` over it; a synchronous
  generator that first `writerow(header)` then, for each data row,
  `writerow(...)`, `yield buf.getvalue()`, `buf.seek(0); buf.truncate(0)`. The
  header is yielded before any data row, so an **empty export still streams a
  valid header line** with zero data rows. The generator is sync (the repo uses
  sync `engine.connect()`), which `StreamingResponse` supports. A
  `Content-Disposition: attachment; filename="..."` header names the file. The
  filename date components come from the supplied `date_from`/`date_to` rendered
  `YYYY-MM-DD` in UTC, with the token `all` for an omitted bound (deterministic
  across the dev box and the Ubuntu deploy host, never local "today"); a payroll
  export filtered by `period_id` names the file from that period. Examples:
  `intelli_responses_summary_2026-04-01_2026-06-18.csv`,
  `intelli_payroll_all_all.csv`, `intelli_compliance_all.csv`.
- **The payroll switch dependency is shared, not re-implemented:** `exports.py`
  reuses the existing `require_payroll` FastAPI dependency by importing it
  (`from .payroll import require_payroll`), so the `tenants.payroll_enabled` check
  lives in exactly one place and cannot drift.
- **Validation order** (deterministic, so parity tests are stable): the payroll
  endpoint's switch is a FastAPI dependency (`require_payroll`), so for that
  endpoint a payroll-off company is refused with 403 first, as an endpoint gate,
  before the body runs. Then in the body: `format` and `grain` are validated
  (unknown -> 400) before any DB work; then the repo is called and a `None` return
  maps to 404. (For the responses and compliance endpoints, which have no payroll
  gate, that is simply 400 then 404.) The `format` query key stays `format` in the
  URL but is bound to a parameter named `fmt` via `Query(alias="format")` so it
  does not shadow the Python builtin.

### Demo data
The 4a/4b/4c seed already builds a non-trivial world (responses across Bay Area
stores with passes/fails/out-of-stock and a dated trend point; a Lumen open pay
period with entries; payroll on for Lumen, off for Acme). 4d is expected to need
**no seed change**; extend the seed only if a specific test needs a row that does
not exist yet, keeping it idempotent like the rest.

### The tests (the gate for 4d)
Same harness as 4a/4b/4c: through-the-API `client` + `login` fixtures over the
throwaway `intelli_test` Postgres, building extra surveys inline (idempotently)
when the seed lacks a needed shape, never mutating the seed.
- **Format parity (headline):** for the same filters, `format=csv` and
  `format=json` return the same logical rows (same count, same set, same column
  order: the CSV header equals the JSON keys); the CSV has a header row plus one
  row per record; the JSON has `rows`/`count`.
- **Responses grains:** `grain=summary` yields one row per stored response with
  `overall` + `num_passed`/`num_failed`; `grain=sku` yields one row per stored
  atomic item with the raw `value` and its `item_pass`.
- **"Not scored" renders blank, not false (the likeliest bug):** a response to a
  rule-less survey (the `test_analytics.py` rule-less setup) exports with
  `overall` (summary) and `item_pass` (sku) as JSON `null` / empty CSV cell, NOT
  `false`. Likewise the compliance export's `pass_pct` is blank, not `0`, for a
  `scored == 0` assignment.
- **multi_choice cell rendering:** a published multi_choice survey + a list-valued
  answer (pattern from `test_responses.py`) exports with the JSON `value` as the
  real list and the CSV cell as the compact JSON string (`["a","b"]`), so one
  column holds one value.
- **Empty export:** an impossible filter (e.g. `date_to` far in the past) returns
  JSON `{"rows": [], "count": 0}` and a CSV that still has the header line and
  zero data rows.
- **Export pass/fail is rule-derived, not stored:** changing a survey's pass rule
  (a new version with a different threshold, scored over the same values) flips
  the verdict shown in the export. This is the Phase 4 gate ("compliance
  recomputes when a rule changes") seen through the export.
- **Filters:** `survey_id`, `chain`, `node_id`, `sku_id` each narrow correctly and
  combine with AND; `date_from`/`date_to` are inclusive at the boundary (with
  `date_from == date_to ==` the seeded 2026-06-10 SF response timestamp that row
  is included; shifting `date_to` one second earlier excludes it); `sku_id` with
  `grain=summary` returns the same rows as `summary` alone (ignored); a `node_id`
  outside scope -> 404.
- **chain does not leak across scope (dedicated):** a manager pinned at Central
  filtering `chain=CVS` returns only the in-scope Chicago CVS store and excludes
  the sibling-branch (Bay Area) CVS store, and never returns Acme's CVS store. (A
  plain "narrows correctly" test would miss this, since CVS stores exist in
  several branches and tenants.)
- **Payroll export:** role-scoped against the concrete seed topology, e.g. as
  Sarah (manager pinned at Central) the export returns Rico's entry only and
  excludes Marcus's Bay Area entry; as Marcus (rep) only his own; an admin sees
  all. A payroll-off company (Acme) gets 403. A returned row carries non-null
  `period_name`, `start_date`, `end_date`, `period_status`, `rep_name`,
  `rep_email`, `mgr_status`, `sealed`, and `rep_node_name` (and a `LEFT`-joined
  unpinned rep exports with a blank `rep_node_name`, not dropped). The
  `period_id` and date-range filters work and stay tenant-scoped even with no
  period filter.
- **Compliance export:** the rows match the numbers `GET /analytics/compliance`
  returns for the same node (same brain, flat shape), including a `scored == 0`
  assignment whose `pass_pct` is blank in both the export and the dashboard, not
  `0`; branch-scoped.
- **Scope + unpinned isolation:** a manager's export excludes sibling branches;
  another company's data never appears in any export; cross-company `node_id` ->
  404; an unpinned caller (`Newbie NoPin`) gets an empty responses/compliance
  export (200, zero rows) and, for payroll, only their own entries by user id.
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
