# Phase 4a: responses + read-time pass/fail (the written-down plan)

Approved in design by Tanya on 2026-06-16. Phase 4 in the master plan (responses
+ analytics + payroll + export) is large, so it is split the way Phase 3 was
split into 3a/3b. This is **Phase 4a, the responses engine**: storing what reps
answer in stores as atomic per-product rows, and reading them back with pass/fail
computed live from the survey's rules. Backend only, no screens (same shape as
3a/3b). Plain-English throughout; technical names explained where they appear.

## The goal, in one paragraph

Let a rep's completed survey for a store be **stored** as atomic per-product rows
(one tiny row per product per question per moment), and **read back** with
pass/fail worked out fresh each time from the survey version's pass rules,
**never stored**. This is the foundation the later pieces read from: analytics
(4b), payroll (4c), and export (4d). This phase builds the engine and proves it
with the test robot. Real screens and offline syncing come later (Field app,
Phase 5).

## How Phase 4 is split (decided with Tanya, 2026-06-16)

- **4a - Responses** (this doc): the atomic response rows, the submit endpoint,
  read-time pass/fail. The foundation.
- **4b - Analytics**: compliance % per node drilling to per-SKU, OOS by SKU,
  facings trend. Reads 4a.
- **4c - Payroll**: pay periods, time entries, seal + logged reopen, audit log.
  Mostly independent.
- **4d - Export**: CSV + read API. Reads 4a/4b.

Each piece gets its own spec, plan, and test gate. We build 4a, prove it, then
return for 4b.

## Decisions made with Tanya (2026-06-16)

1. **Scope: completed submissions only.** A response is stored whole, in one go.
   No half-finished drafts and no offline syncing in 4a; those belong to Phase 5
   (the Field app), which needs draft/queue state anyway. (Considered and
   rejected: adding draft-response state now, before any client exists to use it.)
2. **Storage shape: two tables (envelope + atomic rows).** A `responses` row per
   submission, and a `response_items` row per (response, question, product). The
   atomic rows are the "per-SKU-per-store-per-timestamp" rows PART 6 insists on,
   and they carry no pass/fail column, which keeps "pass/fail is never stored"
   physically true. (Considered and rejected: a single `answers` jsonb blob, which
   analytics in 4b would have to dig inside and could not index per product
   cleanly; and a hybrid blob-plus-index-table, which keeps two copies of the
   truth in sync for no real gain.)
3. **Who can submit: any signed-in user, for an in-scope store only.** Same
   scope-follows-pin guard as everything else; the store must be inside the
   caller's branch and must actually be a store. In real life this is the rep;
   managers and admins technically can too, matching the rule that a manager can
   act anywhere in their branch. The test robot submits as a rep.
4. **Re-visits are kept, never overwritten.** Every submit is a new response row
   with its own timestamp (PART 7: retain all submissions, latest is
   authoritative). No "one response per store/survey" limit.
5. **Submit checks: strict shape, skips allowed.** Reject an answer that does not
   fit the survey version (unknown question, wrong value type, a per-product
   answer naming a product the question does not cover, the same question/product
   answered twice). Allow questions to be left blank; a blank simply does not
   count toward compliance. (Considered and rejected: requiring every question be
   answered, which the survey model has no "required" marker for and which blocks
   legitimate field skips; and loose storage, which lets malformed data through.)
6. **Pass/fail is computed live by a pure function, never stored.** A small
   module takes one answer value and one pass rule and returns pass / fail / not
   counted. Because answers are stored raw and scored fresh, the same stored
   answer scores differently the moment the rule differs. This is the **gate**.
7. **Tree-snapshot freeze (PART 7, SCD Type 2).** Each response records a
   snapshot of the store's place in the org tree at submit time, so history stays
   bucketed where it was collected even if the store is later re-parented. The
   snapshot is for analytics bucketing only; the security/visibility filter uses
   the store's *current* tree position (same as assignments).
8. **No assignment link in 4a (deliberate boundary).** A response requires a
   published survey version and an in-scope store; it is not yet tied to a
   specific assignment + deadline. That link is folded into 4b analytics, where it
   is actually used. Recorded here so it is on the record, not silently missing.

## What gets built

### Two new database tables (one new migration)

Same self-protecting format as our other migrations (`transaction:false` with an
explicit `begin;`/`commit;` and `set local timezone='UTC';`, up and down).

**`responses`** (the submission envelope) - one row per submission
- `id`, `tenant_id` (which company).
- `survey_version_id` (which **published** version was filled in).
- `store_node_id` (which store it was filled at).
- `store_path` (a **snapshot** of the store's tree path at submit time; the
  freeze rule). Set from the node's current path at insert; never updated.
- `user_id` (who submitted).
- `online` (boolean, defaults true; always true in 4a, there for Phase 5 offline
  sync to mark records that arrived after the fact).
- `submitted_at` (timestamp, defaults now), `created_at`.

**`response_items`** (the atomic answer rows) - one row per (response, question,
product)
- `id`, `response_id` (parent, `on delete cascade`).
- Denormalized for fast indexed analytics in 4b (so a per-product query is one
  index scan, no joins): `tenant_id`, `store_node_id`, `store_path`,
  `survey_version_id`, `submitted_at`.
- `question_id` (the question's stable id within the version).
- `sku_id` (the product, for per-product questions; **null** otherwise).
- `value` (jsonb; the raw answer: a number, yes/no, a choice string, a list, a
  text string, or a photo url). **No pass/fail column anywhere.**

Indexes (added now, as PART 6 instructs):
- `responses`: `(tenant_id)`, `(store_node_id)`, `(survey_version_id)`,
  `(submitted_at)`.
- `response_items`: `(response_id)`, `(tenant_id, store_node_id)`,
  `(tenant_id, sku_id, submitted_at)` (powers OOS-by-SKU and facings-trend in
  4b), `(tenant_id, question_id)`.

### The pass/fail brain (new file, `api/app/compliance.py`)

A **pure** function (no database, no request state) so it can be unit-tested in
isolation. Given one answer value, one pass rule, and the question type, it
returns `True` (pass), `False` (fail), or `None` (not counted).

- Returns `None` when there is no pass rule, or the answer is blank/skipped.
- Operators (already defined on the survey question's `pass` rule):
  `>=, <=, >, <, ==, !=, in, not_in`.
- Per-product modes (from the question's `perSku` + `passScope`):
  - `each`: every answered product is scored individually; the question passes
    only if all answered products pass (skipped products ignored).
  - `total`: the answered products are aggregated (summed, for number questions)
    and the total is compared against the rule, for example "total facings across
    shades >= 12".
- A whole-response **overall** verdict: passes only if every countable question
  passes; questions with no rule or fully skipped are not counted.

Because the verdict is always recomputed from the current rule, **the same stored
answer scores differently when the rule differs.** That property is the gate, and
it is unit-tested directly.

### The scope guard learns about responses

The shared `ScopedRepo` (the one object allowed to touch scoped tables, so no
endpoint can forget the rules) gains, in a clearly labelled new section:

- `create_response(survey_version_id, store_node_id, answers, user_id)`:
  validates scope + version + answer shape, then inserts the envelope and explodes
  the answers into atomic rows, in one transaction. Returns the saved response.
- `list_responses()`: responses whose store is in the caller's **current** branch
  (join `nodes`, path-prefix on the caller's scope), newest first.
- `get_response(id)`: one response with its atomic rows, in the caller's scope, or
  None.

Validation lives next to the insert so a bad submission never reaches the
database: store must be in scope and be a store (max level_order); version must be
the company's and published; each answer's `question_id` must exist in the
version; `value` must match the question `type`; a per-product answer must name a
`sku_id` the question covers; a `sku_id` on a non-per-product question is
rejected; the same `(question_id, sku_id)` twice is rejected. Blank answers are
allowed (simply omitted from the rows).

### The web addresses (a new router, `api/app/responses.py`)

- `POST /responses` (any signed-in user, in-scope store) - submit a completed
  response. Body: `survey_version_id`, `store_node_id`, `answers` (a list of
  `{question_id, sku_id?, value}`). Company comes from the wristband, never the
  body. Out-of-scope or non-store target -> 404; unpublished/foreign version ->
  400; malformed answers -> 400. Returns the saved response with per-item and
  overall pass/fail computed live.
- `GET /responses` (scoped) - the company's responses visible in the caller's
  branch, each with its overall pass/fail computed.
- `GET /responses/{id}` (scoped) - one response: envelope + each answer with its
  computed pass/fail + the overall verdict. Out of scope -> 404.

### Demo data (so 4b and tests have something real)

Seed for Lumen a couple of responses against the published "Velvet Lip Shelf
Check" at a store under Central, submitted by the rep (Marcus), with per-product
facings answers where some products pass and some fail, so pass/fail is visibly
mixed. Seed one response for Acme too, so isolation is provable. Idempotent, like
the rest of the seed.

### The tests (the gate for 4a)

- **Evaluator unit tests (headline gate):** every operator; `each` vs `total`
  per-product modes; a blank answer scores `None`; and **the same stored answer
  yields a different verdict when the pass rule changes** (proves compliance
  recomputes from the rule and is never stored).
- **Submit happy path:** a rep submits; the envelope plus the right number of
  atomic rows are created (a per-product question over N products -> N rows; a
  plain question -> 1 row).
- **Submit rejections:** unknown `question_id` -> 400; wrong value type -> 400; a
  `sku_id` the question does not cover -> 400; a `sku_id` on a non-per-product
  question -> 400; a duplicate `(question_id, sku_id)` -> 400.
- **Scope isolation:** a rep submits for their own store; submitting for a store
  outside their branch -> 404; for another company's store -> 404. Reading: a
  Lumen user never sees Acme's responses; a sibling-region manager sees zero of
  another region's responses.
- **Version rule:** submitting against an unpublished or another company's version
  -> 400.
- **Read computes pass/fail:** `GET /responses/{id}` returns per-item and overall
  verdicts derived from the version's rules.
- **Re-visit:** two submissions for the same store/survey are both retained, with
  distinct timestamps.
- **Tree-snapshot freeze:** the response stores the store's path at submit; a
  later re-parent of the node does not change the stored snapshot.
- The full backend run plus the existing 27 frontend checks stay green.

## The new and changed files

- `db/migrations/<timestamp>_create_responses.sql`: the two tables + indexes (with
  undo). New.
- `api/app/compliance.py`: the pure pass/fail evaluator. New.
- `api/app/responses.py`: the responses router and its Pydantic models. New.
- `api/app/scope.py`: add the response methods to `ScopedRepo`. Modify.
- `api/app/main.py`: plug in the responses router. Modify.
- `api/app/seed.py`: add the demo responses. Modify.
- `api/tests/test_responses.py` and `api/tests/test_compliance.py`: the tests
  above. New.
- Docs updated in the same breath: `api/README.md`, `db/README.md`,
  `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md` (note the response checks),
  `START_HERE.md`, `CONTEXT.md`, and the prototype handoff CHANGELOG.

## Deliberately NOT in Phase 4a (so nothing is silently missing)

- **Analytics queries** (compliance % per node, OOS by SKU, facings trend,
  drill-down): Phase 4b. 4a stores the rows and proves single-response scoring;
  the aggregate queries read them next.
- **Payroll** (pay periods, time entries, seal/reopen, audit): Phase 4c.
- **Export** (CSV + read API): Phase 4d.
- **Draft / half-finished responses and offline sync:** Phase 5 (Field app +
  offline). 4a is whole submissions only.
- **Assignment + deadline link on a response:** folded into 4b, where it is used.
- **Screens:** a later phase, like the catalog and surveys.
- **Mid-flight version pinning beyond "the version you submitted against":** a
  response already records its `survey_version_id`, which satisfies PART 7's rule
  that a submission is scored by the version it was filled under; in-flight draft
  pinning is a Phase 5 concern.

## How we will know 4a is done

All response and evaluator tests green (the same-answer-different-rule recompute,
submit happy path and every rejection, scope isolation, version-must-be-published,
read-time pass/fail, re-visit retained, tree-snapshot freeze), the full backend
and frontend test runs still green, a live walk-through (submit a response ->
read it back with mixed pass/fail -> re-submit -> confirm both kept) behaves as
described, and all guides updated.
