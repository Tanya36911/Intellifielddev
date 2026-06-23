# W4: Survey builder + assignments design

Approved in design by Tanya on 2026-06-23 (after four scope questions, a tiny
backend decision, and a browser mockup of all three screens). This is the fourth
step of the screens-first roadmap (see [ROADMAP.md](../../../ROADMAP.md)) and the
headline differentiator: self-serve survey configurability on screen. It ports
the prototype's Form Builder and Surveys screens
(`../hi-fi-intelli/project/apps/admin/screens/formbuilder.jsx`,
`formbuilder-parts.jsx`, `surveys.jsx`) onto the real backend
([api/app/surveys.py](../../../api/app/surveys.py)), wired to the existing
`/surveys`, `/survey-assignments`, `/skus`, and `/nodes` endpoints. Plain-English
throughout.

## The goal, in one paragraph

Turn the empty "Surveys" nav item into a working area where an admin builds a
field checklist by hand, publishes it (which freezes that version forever), and
assigns it to a spot on the org tree with a deadline. You land on a **Surveys
list** (your surveys with status, version, and where they are assigned), open the
**Builder** to add and edit questions (six types; mark required; ask a question
per product line; set a structured pass rule that drives compliance), then
**Publish & assign** (a clear freeze confirmation, then a panel to pick node(s),
a deadline, and a timezone basis). Every number and rule maps 1:1 to what the
backend already stores and scores; a manager can only assign inside their own
branch (enforced by the backend). The AI "describe it and it drafts the survey"
entry is **deliberately out** (a later fast-follow); this by-hand builder stands
on its own.

## Decisions made with Tanya (2026-06-23)

1. **One Surveys section, not two.** Merge the prototype's separate "Form Builder"
   and "Surveys" nav items into a single **Surveys** destination: a list that
   leads into the builder and the assign flow. The now-AI-less "Form Builder" nav
   item is removed.
2. **The backend's six question types.** Yes/No (`boolean`), Number (`number`),
   Single choice (`single_choice`), Multiple choice (`multi_choice`), Photo
   (`photo`), Short text (`text`). The prototype's Barcode and Date types are
   **dropped** (they need a backend enum change we are not doing in W4).
3. **Per-product selection is by product line.** Pick whole lines as chips
   (Velvet Lip, Silk Foundation, ...); on **publish** each line is expanded into
   its active products' real IDs (`sku_ids`) and frozen onto the question.
4. **Connected-but-honest publish/assign/edit flow.** "Publish" freezes the draft
   (explicit, irreversible, confirmed); the Assign panel opens right after.
   Assign is repeatable (assign an already-published survey again later). Editing
   a published survey starts a **new draft version** with a banner; past responses
   stay pinned to their version.
5. **Add `required`, `unit`, and `lines` to questions** (a tiny additive backend
   change, no migration and no new endpoint, see below). Lets the builder mark
   must-answer questions, label a number's unit ("facings"), and remember which
   product lines the author chose so the per-product picker round-trips without
   re-deriving (and re-deriving could silently change a frozen question).
6. **Mockup confirmations:** the look and the three-screen flow are approved; the
   builder's right rail is **Publish & assign (primary) + Save draft (secondary)**;
   the assign panel **keeps the rep-local / corporate timezone toggle** (the
   backend assignment already stores `timezone_basis`).

## What gets built (the shape)

A new screen folder `apps/admin/src/pages/Surveys/`, reached from the existing
**Surveys** nav item, following the exact pattern W1 and W3 established (a screen
folder + a data hook with pure helpers + sub-components + CSS Modules + tests,
all on the shared UI kit in `apps/admin/src/ui/`). Three views inside it:

- **Surveys list** (route `/surveys`, the landing): three stat tiles (Surveys /
  Published / Draft), then a list of the company's surveys, each with a status
  chip (Published green / Draft amber / Archived grey), a version chip, and an
  "assigned to N places" line, plus per-state actions (Published -> Assign +
  Edit; Draft -> Continue editing; Archived -> read-only).
- **Builder** (route `/surveys/new` and `/surveys/:id/edit`): the survey name, a
  count line (N questions, N required, N scored), the pass-condition helper note,
  the question cards (type badge + type menu, required, per-product line picker,
  inline pass-condition editor, choice options, number unit), reorder by up/down
  arrows, an "add a question" row of the six types, and a sticky right rail
  (Publish & assign primary, Save draft secondary, plus a "this version" card).
- **Publish & assign** (route `/surveys/:id/assign`, reached after publishing):
  a publish confirmation (freeze warning), then the assign panel (an "all stores"
  root toggle + the region/district node list with switches, a deadline date +
  time, a rep-local / corporate timezone toggle, a reach summary, and Assign).

The nav change: drop the "Form Builder" item; the **Surveys** item is now live
(was a "coming soon" placeholder).

## The backend touches (all additive: no migration, no new endpoint)

Two read-or-validate-only changes to existing files. Surveys/versions/assignments
already exist and are tested; we are not adding tables, endpoints, or a JWT change.

### 1. Three optional fields on the question model

In [api/app/surveys.py](../../../api/app/surveys.py), the `Question` model gains:

```python
required: bool = False
unit: str | None = None
lines: list[str] = []   # the product-line names the author picked (display only)
```

They flow through `_questions_json` (model_dump by_alias) into the existing
`survey_versions.questions` JSONB blob. `compliance.py` ignores them (it reads
only `pass`, `perSku`, `passScope`, `id`), so they are inert metadata and change
no score. Backward compatible: existing seed surveys' questions simply lack the
keys; reading is a raw JSONB passthrough (not re-validated), and writing now has
defaults. `required` is the field-app-facing "must answer" flag; `unit` is the
number's unit label; `lines` records the chosen lines so editing a published
survey can re-show the picker chips without re-deriving from `sku_ids` (the
authoritative frozen product list). Storing these now is correct and cheap.

### 2. Enrich the survey list so the list screen has real content

`GET /surveys` today returns only `{id, name, type, status, created_at}` per
survey, with no version number and no assignment signal. `ScopedRepo.list_surveys`
([scope.py:165](../../../api/app/scope.py)) is widened (read-only SQL, no schema
change) to add, per survey row:

- `latest_version`: `max(version_number)` across the survey's versions.
- `assigned`: a boolean, true when **any** `survey_assignment` **in the caller's
  scope** points at one of this survey's versions. Implemented as a scoped
  `EXISTS` (`survey_assignments` -> `survey_versions` on `survey_id`, joined to
  `nodes` by the same `path LIKE :scope || '%'` rule `list_assignments` uses).
  The repo method **explicitly special-cases `scope_path is None` -> `assigned =
  false` for every row** (matching `list_assignments` returning `[]`), rather than
  relying on `path LIKE NULL` (which is fragile). The list shows "Assigned" vs
  "Not assigned yet".

A boolean, not a count: the reviewers flagged the count as the most over-built
piece (its own scope logic + a three-way test) for no extra demo value, so we ship
the boolean. Surveys stay company-wide (every admin sees the same list); only
`assigned` is scope-aware, which is the correct "assigned somewhere you can see"
semantics and keeps scope-follows-pin intact. The router shape stays
`{ "surveys": [...], "count": n }`; each survey object just carries the two new
fields.

Everything else (`POST /surveys`, `PATCH .../versions/{vid}`, `.../publish`,
`.../versions`, `.../archive`, `GET /surveys/{id}`, `GET /survey-assignments`,
`POST /survey-assignments`, `GET /survey-assignments/{id}/stores`, `GET /nodes`,
`GET /skus`) is used **as-is**.

## The contract translation (the crux)

The prototype and the backend speak slightly different languages. The builder
holds an internal question shape and translates to/from the backend shape.

### Question type mapping

| Builder type | Backend `type` | Scorable? |
|---|---|---|
| Yes / No | `boolean` | yes |
| Number | `number` | yes |
| Single choice | `single_choice` | yes |
| Multiple choice | `multi_choice` | no (logged) |
| Photo | `photo` | no (logged) |
| Short text | `text` | no (logged) |

Scorable means it can carry a pass rule. Multiple choice is included as a
"select all that apply" question but is **logged, not auto-scored** in v1: a
multi-choice answer value is itself a **list**, and the compliance engine has no
subset/superset operator, only `in`/`not_in`/comparisons. Feeding a list value to
`in` or `==` would compare the whole list (not its members) and silently
mis-score rather than erroring, so honestly there is no rule we can offer. We
therefore log it without a pass rule. This matches the prototype, whose scorable
set was exactly `{yesno, numeric, dropdown(single)}`.

### Pass-rule mapping (builder UI -> backend `{operator, value}`)

The backend pass rule is `{operator, value}` and is scored verbatim by
[compliance.py](../../../api/app/compliance.py) (operators `>= <= > < == != in
not_in`). Authoring and scoring use the **same** operators (a CONTEXT.md note
that says otherwise, `gte/min_choices`, is stale and is corrected as part of W4's
doc pass).

| Builder type | UI control | Stored rule |
|---|---|---|
| Yes / No | Pass = Yes / Pass = No / No condition | `{operator:"==", value:true}` / `{operator:"==", value:false}` / none |
| Number | Pass when value [>=, <=, >, <, ==] N | `{operator:">=", value:N}` (etc.) |
| Single choice | tap the option(s) that count as a pass | `{operator:"in", value:[...allowed options]}` |
| Multi choice / Photo / Text | (none) | no rule |

`==` is the UI's "exactly". The boolean `==` path is the case the compliance
truthiness guard explicitly supports (bool vs bool).

### Per-product (per-SKU) - expand once, never re-derive

A question's "Ask per product" toggle (`perSku: true`) picks one or more product
**lines** from the catalog (`GET /skus`, grouped by `line`). **The expansion to
product IDs happens once, at the moment the author toggles a line**, not on every
save: when a line is added, the builder captures that line's active products' `id`s
and merges them into the question's `sku_ids`; when a line is removed, its products
are dropped from `sku_ids`. Both the chosen line names (`lines`) and the captured
`sku_ids` are stored on the question. Save and Publish send the **stored `sku_ids`
verbatim** and never re-derive from `lines`. This is what guarantees "frozen
forever" is true: a published question's products are exactly the set the author
saw and approved, even if the catalog changes between editing and publishing.

Only `status === 'active'` products are included; `discontinued` are excluded.
(Production SKU status is strictly `active | discontinued`, enforced by a DB CHECK
constraint, so there is no `new` status to consider, despite the prototype's
sample data.) The backend validates every `sku_id` belongs to the company
(`_check_sku_ids`), which always holds because they come straight from that
company's catalog. A product added to a line after the IDs were captured is **not**
auto-added, which is correct: the author chose a concrete set.

**Empty-set guard:** if a `perSku` question ends up with zero `sku_ids` (every
chosen line is fully discontinued, or no line is selected), the question can never
be answered in the field, so the builder **blocks Save and Publish** with an inline
message until the author either picks a line with active products or turns off "Ask
per product".

### passScope (`each` vs `total`)

For a per-product **Number** question, a segmented toggle sets `passScope`:
- "Each shade on its own" -> `passScope:"each"` (every answered value must pass).
- "One combined total" -> `passScope:"total"` (the engine sums the answered values,
  then compares once).

The toggle is shown **only** for per-product Number questions. Crucially,
`mapToBackendQuestion` **forces `passScope:"each"` whenever the type is not
`number`** (and clears it on a type change away from Number), because
`evaluate_question` only takes the summing path when `passScope == "total"`, and
summing booleans or strings would be wrong (a `TypeError` for strings). So "total"
can never reach a non-number question. Default is `each`.

**Total with blanks:** `evaluate_question` drops `None` (unanswered) values before
summing, so "one combined total" means "the sum of the shades that were answered",
not "the sum across all chosen products". The builder's helper text says exactly
this ("sums the shades that were answered; blanks are ignored") so the rule is not
misread. (The prototype's label "single" becomes the backend's `total`.)

## The screens and their data flow

**Routing & data conventions (match the existing app exactly).** Every existing
screen is a flat route component rendered in isolation (App.tsx: `/` ->
`<Dashboard/>`, `/catalog` -> `<Catalog/>`), each rendering its own `<Topbar>`
(from `apps/admin/src/shell/`) and `<Page>`, and tested by mounting the bare
component in a `MemoryRouter`. W4 follows this: **four flat sibling routes** in
`App.tsx`, no wrapping container component:
`/surveys` -> `SurveyList`, `/surveys/new` -> `Builder`,
`/surveys/:id/edit` -> `Builder`, `/surveys/:id/assign` -> `AssignPanel`.
All server data goes through **TanStack Query** (the W3 convention): `useSurveys.ts`
wraps the calls in `useQuery`/`useMutation` (v5 object form) and calls
`useQueryClient().invalidateQueries({ queryKey: ['surveys'] })` after any
save/publish/assign so the list refreshes (exactly as `useCatalog.ts` does).
Loading/empty/error UX matches what W1/W3 actually shipped: an inline "Loading..."
line, a friendly empty state (the list's invites "New survey"), and a simple
inline error line on a failed fetch (no richer error UI than the rest of the app).

### Surveys list
- On open: `GET /surveys` (now enriched). The three stat tiles and the rows are
  computed by a pure `surveyStats(surveys)` helper. Status chip from
  `survey.status`; version chip from `latest_version`; "Assigned" vs "Not assigned
  yet" from the `assigned` boolean.
- "New survey" -> route to the Builder in new-survey mode (nothing is created
  until the first Save/Publish).
- "Edit" / "Continue editing" -> `GET /surveys/{id}`, route to the Builder.
- "Assign" (a published survey) -> route to the assign panel for that survey's
  published version.

### Builder
- Loads via `GET /surveys/{id}` (or starts empty for a new survey). The editable
  draft is the version with `published_at == null` (the latest). If the survey has
  only published versions, the screen is in "edit a published survey" mode and the
  amber banner shows; the first edit calls `POST /surveys/{id}/versions` to spin a
  fresh draft (handling the 409 `DraftExistsError` by loading the existing draft
  instead).
- Question edits live in local React state in the **builder's internal shape**
  (`{id, type, prompt, required, unit, options, perSku, lines, pass, passScope}`).
  Reorder is up/down arrows over the array. Add/duplicate/delete are array ops.
- **Save draft**: translate the internal questions to backend questions (types,
  pass rules, the already-captured `sku_ids` + `lines` sent verbatim). If the
  survey does not exist yet (`/surveys/new`), `POST /surveys` with
  `{name, questions}` (creates draft v1), then **immediately
  `navigate('/surveys/{id}/edit', { replace: true })`** so the URL and the
  persisted draft stay in sync (no orphaned draft if the user refreshes or hits
  back). Otherwise `PATCH /surveys/{id}/versions/{vid}` with `{questions}`.
- **Publish & assign**: same translate + save, then `POST /surveys/{id}/publish`
  (freezes the latest draft), then route to the assign panel carrying the now-
  published version id (read from the publish response's `versions`, the one with
  `published_at` set and the highest `version_number`). Save and publish run as one
  guarded action; a publish-race 409 (`PublishedVersionError`/`NoDraftError` from a
  second tab) is shown as "already published, reload" rather than a generic error.
- **Unsaved edits / concurrency (v1):** the builder holds edits in local React
  state; leaving the builder without saving discards those local edits (acceptable
  for v1, no confirm-on-leave, matching the app's current no-toast simplicity). A
  saved draft is server-persisted. Two tabs editing the same draft is last-write-
  wins (`update_version` has no optimistic-concurrency check); this is a documented
  v1 limitation, not handled.

### Publish & assign
- The publish confirmation is shown before `POST .../publish` is called (so
  "Cancel" truly cancels; nothing is frozen until "Publish vN").
- Assign panel: `GET /nodes` gives the in-scope tree (each node has `path` and
  `level_order`). The "all stores" toggle targets the **caller's top node** (the
  shallowest node returned, i.e. the company root for an admin, or the manager's
  pinned node for a manager - so the label reads "all stores you manage" for a
  scoped user). The region/district rows target their own node ids. Selecting "all
  stores" disables the per-region rows (mutually exclusive), mirroring the prototype.
- **No client-side reach estimate.** The earlier "will reach N stores" preview
  was dropped: computing the store level from only the nodes a caller can see is
  wrong for a manager whose subtree is shallower than the org's deepest level (the
  backend's true store level is the org-wide `max(level_order)` from
  `org_level_definitions`, not the visible slice's max). Instead, the panel may show
  a soft "covers everything under <node>" line, and the **authoritative** store
  count comes from `GET /survey-assignments/{id}/stores` **after** assigning, shown
  in the success confirmation. No double-source-of-truth, no manager miscount.
- **Assign**: for each selected node, `POST /survey-assignments` with
  `{survey_version_id, target_node_id, deadline, timezone_basis}`. **Deadline
  serialization:** the date + time the admin picks are combined and sent as an
  **explicit UTC ISO instant** (offset applied from the admin's browser timezone),
  so the stored `timestamptz` is unambiguous; a blank deadline sends `null`.
  `timezone_basis` (`"rep-local"` / `"corporate"`) is, in W4, a **stored label
  only**: the overdue calculation compares the absolute stored instant
  (`deadline < now()`), and per-store-local deadline evaluation is a later concern.
  The toggle is kept (Tanya's call; the backend stores the field) but the screen is
  honest that it does not shift the instant yet.
- **After assign succeeds**, show a brief confirmation (with the authoritative
  store count from `/stores`) and `navigate` back to `/surveys`, where the survey
  now reads "Published, Assigned". The flow never dead-ends on the assign panel.

## Components (each with one clear purpose)

No route-container component (that pattern exists nowhere in the app). The three
top-level screens are flat route components, each rendering its own `<Topbar>`
(from `apps/admin/src/shell/`) + `<Page>`:

- `SurveyList.tsx` (route `/surveys`): stat tiles + rows.
- `Builder.tsx` (routes `/surveys/new` and `/surveys/:id/edit`): the canvas; owns
  the question array state; reads `:id` (or its absence) to decide new vs edit.
- `AssignPanel.tsx` (route `/surveys/:id/assign`): node picker + deadline +
  timezone; shows the authoritative store count after assigning.

Supporting (non-route) components and the hook:
- `useSurveys.ts` (TanStack Query hooks) + pure helpers `surveyStats`,
  `mapToBackendQuestion`, `mapFromBackendQuestion`, `passSummary`,
  `expandLinesToSkuIds(lines, catalog)` (returns the **active** products' ids for
  the given lines; unit-tested in isolation; this is where the translation lives).
- `QuestionCard.tsx` (one question: badges, type menu, text, type-specific config,
  the inline `PassConditionEditor`, per-product line picker, row actions, up/down
  reorder).
- `PassConditionEditor.tsx` (type-adaptive: Yes/No segmented, Number op+value (+
  each/total when per-product Number), Single-choice option toggles).
- `PublishConfirm.tsx` (the freeze confirmation, on the shared `Modal`).

Reuses existing UI kit: `Modal`, `Field`, `Input`, `Select`, `Button`, `Chip`,
`Card`, `Segmented`, `Switch`, `Icon`, plus `Topbar`/`Page` from `shell/`. No new
shared primitives are expected (if a small one is needed it joins
`apps/admin/src/ui/`).

## Validation and error handling

- The builder blocks Save and Publish until: every question has a non-empty prompt;
  every choice question has at least one option (mirroring the backend validators
  `prompt min_length=1` and `_choice_needs_options`); and **every per-product
  question has at least one product id** (the empty-set guard above). Inline
  messages explain each. This avoids round-tripping a guaranteed 400 and avoids
  shipping an unanswerable question.
- A backend 400 (validation) is still surfaced inline if it slips through.
- `PATCH` of a published version -> 409 `PublishedVersionError`; the screen never
  issues this (it only edits drafts), but if it occurs it shows "this version is
  published; start a new version" and offers the new-version action.
- `POST .../publish` with no draft -> 409 `NoDraftError` (handled: reload state).
- `POST .../versions` when a draft already exists -> 409 `DraftExistsError`
  (handled: load the existing draft).
- `POST /survey-assignments` with an unpublished version -> 400; with a node out
  of the caller's scope -> 404 ("not in your scope"); both shown as inline assign
  errors.
- Loading/empty/error states for every fetch (the list empty state invites "New
  survey"; a failed save keeps the user's edits and shows a retry).

## The tests (the gate for W4)

### Backend (`api/tests/test_surveys.py`, extended; new cases)
- A question round-trips `required`, `unit`, and `lines`: create a survey whose
  question sets `required:true`, `unit:"facings"`, `lines:["Velvet Lip"]`, then
  `GET /surveys/{id}` returns them in the stored questions. (Confirms the model
  change persists and reads back, and that `compliance` ignores them.)
- `GET /surveys` returns `latest_version` and a scope-aware `assigned` boolean:
  build a survey, publish it, assign it to a node, and assert `latest_version`
  matches and `assigned == true`; a survey with no assignment shows `false`; a
  manager scoped to a sibling branch sees `assigned == false` for an assignment
  outside their branch, while the admin sees `true`; an unpinned caller sees
  `false` for every row.
- The existing surveys/assignments suite stays green (no behavior change to the
  lifecycle endpoints).

### Frontend (Vitest + Testing Library, the established `vi.mock` + render-helper
style; mocks `./lib/api`)
- The list renders stat tiles and rows from a mocked `GET /surveys`, with the
  right status chips, version chip, and "Assigned"/"Not assigned yet" badge from
  the `assigned` boolean; "New survey" routes to the builder; an archived survey's
  Edit is disabled.
- The builder: adds a question of each type; toggles required; for a Number
  question sets a pass rule (op + value) and asserts the chip reads "Pass = ... ";
  for a per-product Number question picks a line and sees the each/total toggle;
  for a single-choice question picks pass options; Save calls `apiSend` with the
  **translated backend questions** (types mapped, `pass:{operator,value}`, the
  captured `sku_ids` + `lines`), proving `mapToBackendQuestion` is wired.
- **Empty per-product guard:** a per-product question whose chosen line has no
  active products (mocked catalog) blocks Save with the inline message.
- **New-survey navigation:** on `/surveys/new`, the first Save `POST`s and then
  navigates to `/surveys/{id}/edit` (assert the redirect, so no orphaned draft).
- Reorder by up/down arrows changes the order.
- Publish shows the confirm, calls publish, then renders the assign panel; Assign
  calls `POST /survey-assignments` once per selected node with the right body
  (deadline as a UTC instant, `timezone_basis` label), then navigates back to
  `/surveys` and shows the authoritative store count from a mocked `/stores`.
- The pure helpers are unit-tested directly, including: boolean Yes->`==true`;
  single-choice->`in`; each/total; **`mapToBackendQuestion` forces `each` for a
  non-number type**; **multi-choice/photo/text carry no `pass`** (the "logged
  only" guarantee); **`expandLinesToSkuIds` includes only active products and
  excludes discontinued**; **`mapFromBackendQuestion` round-trips** a loaded
  published question (operator/value/lines survive an edit cycle); and the
  total-with-blanks note (a `passSummary`/helper-text assertion that "total" reads
  as "sum of answered shades").

The full backend suite and the updated frontend suite end green; the frontend
check count grows.

## New and changed files
- `api/app/surveys.py` - add `required`, `unit`, `lines` to `Question`. Modify.
- `api/app/scope.py` - enrich `list_surveys` with `latest_version` + a scope-aware
  `assigned` boolean (explicit `scope_path is None -> false`). Modify.
- `api/tests/test_surveys.py` - the new backend cases. Modify.
- `apps/admin/src/pages/Surveys/` - `useSurveys.ts`, `SurveyList.tsx`,
  `Builder.tsx`, `QuestionCard.tsx`, `PassConditionEditor.tsx`, `AssignPanel.tsx`,
  `PublishConfirm.tsx`, their `.module.css`, and tests. New. (No route-container
  component - the three screens are flat routes.)
- `apps/admin/src/App.tsx` - add `/surveys`, `/surveys/new`, `/surveys/:id/edit`,
  `/surveys/:id/assign` routes inside the shell. Modify.
- `apps/admin/src/shell/` (Sidebar) - remove the "Form Builder" nav item; mark
  "Surveys" as a live route (drop its "coming soon"). Modify.
- `apps/admin/src/lib/api.ts` - reuse `apiGet` / `apiSend`; add a `apiDelete`
  helper only if the unassign action lands in W4 (otherwise unchanged). Modify if
  needed.
- Docs updated in the same change: `apps/admin/README.md`, `CODEBASE_MAP.md`,
  `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`, the prototype handoff
  CHANGELOG, tick W4 in `ROADMAP.md`, and **fix the stale operator description in
  CONTEXT.md's Phase 4a log** (`gte/lte/eq/min_choices/max_choices` ->
  the real `>= <= > < == != in not_in`).

## Deliberately NOT in W4 (so nothing is silently missing)
- **AI survey drafting** ("describe it and it drafts the survey"): a later
  fast-follow (Claude API). The by-hand builder is v1.
- **Survey templates** ("start from a proven template"): deferred (needs seeded
  template content). Surveys start blank.
- **Drag-and-drop reorder**: replaced with up/down arrows (testable, simpler).
- **Version-history diff panel**: deferred. The version number, status, and the
  "editing creates a new version" banner stay.
- **AI-assist side rail and the estimated-time card**: cut.
- **Phone preview modal** ("exactly what the rep sees"): deferred as the first
  fast-follow.
- **Recurring deadlines and skip logic**: the backend supports neither; single
  deadline only, no conditional questions.
- **Barcode and Date question types**: dropped (need a backend enum addition).
- **Pre-assign "will reach N stores" estimate**: dropped (the client cannot
  reliably know the org store level for a scoped manager); the authoritative store
  count is shown after assigning, from `GET /survey-assignments/{id}/stores`.
- **Per-store-local deadline evaluation**: `timezone_basis` is stored but is a
  label only in W4; overdue compares the absolute stored instant. The toggle is
  kept for forward-compat, not yet acted on per store.
- **Optimistic-concurrency / multi-tab conflict handling**: v1 is last-write-wins
  on a draft; a documented limitation, not handled.
- **Completion %, responses, the per-store response drill**: that is W5; the list
  shows authoring status, not response progress.
- **Archive / unarchive and delete-survey UI**: the list shows archived surveys
  read-only; the archive action and an unassign control are candidates for a small
  follow-up, not core W4 (kept out unless trivial).

## How we will know W4 is done
The backend gains `required`/`unit`/`lines` (round-tripped by a test) and a
`GET /surveys` that carries `latest_version` + a scope-aware `assigned` boolean
(asserted by a test, including a manager seeing `false` for an out-of-branch
assignment); the full backend suite stays green. The frontend builds; the Surveys list, builder, and
assign panel render on the shared design system and match the approved mockup; a
question of each type can be added, a pass rule set, a per-product line chosen,
and Save sends correctly **translated** backend questions; Publish freezes and the
assign panel creates one assignment per node within scope; the updated frontend
suite ends green; and a live browser walk-through (log in -> Surveys -> New ->
build a few questions with a pass rule and a per-product line -> Publish ->
Assign to a node with a deadline -> see it back on the list as Published, assigned)
behaves as described. All guides are updated in the same change.
