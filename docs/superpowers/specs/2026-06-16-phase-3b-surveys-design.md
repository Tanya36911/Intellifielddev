# Phase 3b: surveys, frozen versions, assignments, pass rules (the written-down plan)

Approved in design by Tanya on 2026-06-16. Phase 3 in the master plan (catalog
+ surveys + versions + assignments + pass conditions) was split: Phase 3a built
the catalog; this is **Phase 3b, the surveys engine**. Backend only, no screens
(same shape as 3a). Plain-English throughout; technical names explained where
they appear.

## The goal, in one paragraph

Give each company a way to define **surveys** (the checklists reps fill out in a
store), keep **frozen versions** of them so results can never be silently
rewritten, point a survey at a spot on the org tree (**assign** it), and carry a
structured **pass rule** on each question so later phases can score compliance
from rules instead of guesses. This phase builds the engine and proves it with
the test robot. Actual rep answers, compliance scoring, and screens are Phase 4
and later.

## What a survey is, in plain terms

A survey is a named checklist, for example "Velvet Lip Shelf Check". It holds
questions like "How many facings of Rosewood are on the shelf?". Each question
can carry a pass rule ("passes if 4 or more"). A question can point at specific
products from the catalog (Phase 3a), so the survey asks about real SKUs. Once a
survey version is **published**, it is frozen forever; to change it you make a
new version, and the old one stays exactly as it was.

## Decisions made with Tanya (2026-06-16)

1. **Scope: surveys + frozen versions + assignments + structured pass rules.**
   Backend only. No rep answers, no compliance scoring, no screens (Phase 4+).
2. **Architecture A (two tables).** A `surveys` table for the identity, and a
   `survey_versions` table for the frozen snapshots. A draft version is editable;
   publishing freezes it forever; editing a published survey makes a new draft
   version. (Considered and rejected: stuffing versions inside one JSON column,
   and making every draft edit a new version. A is the clean middle.)
3. **Roles.** Creating, editing, publishing, and archiving a survey is
   **admin-only** (a survey definition is company-wide reference material, like
   the catalog). **Assigning** a published version to an org node can be done by
   an **admin anywhere in the company** or a **manager within their own branch**
   (never a sibling region). Reps can view, not author or assign.
4. **Questions link to the catalog.** A question may reference specific SKU ids;
   the backend checks each one belongs to the caller's company. (Chosen over
   keeping questions generic for now.)
5. **Assignment visibility follows scope.** Any admin or manager whose branch
   covers an assignment's node can see and manage it; there is no "owned by one
   person" concept. (Chosen over creator-only ownership.) We still record who
   created each assignment, for history, but it does not gate permission.
6. **Pass rules are validated structure, not free text.** The backend checks the
   shape of every pass rule when you save, so a malformed rule never reaches the
   database.

## What gets built

### Three new database tables (one new migration)

Same self-protecting format as our other migrations (`transaction:false` with an
explicit `begin;`/`commit;` and `set local timezone='UTC';`, up and down).

**`surveys`** (the identity)
- `id`, `tenant_id` (which company).
- `name` (e.g. "Velvet Lip Shelf Check").
- `type` (a free-text category, e.g. "shelf_check"; nullable).
- `status` (`draft` / `published` / `archived`, defaults to `draft`).
- `created_at`.

**`survey_versions`** (the frozen snapshots)
- `id`, `survey_id` (which survey).
- `version_number` (1, 2, 3, ...).
- `questions` (a JSON list; shape validated on write, see below).
- `published_at` (a timestamp, or empty). **Empty = an editable draft. Set =
  frozen forever.** This single field is what makes immutability real.
- `created_at`.
- Unique on `(survey_id, version_number)`.

**`survey_assignments`** (pointing a version at the tree)
- `id`, `tenant_id`.
- `survey_version_id` (which **published** version is being deployed).
- `target_node_id` (the org node it applies to).
- `deadline` (a timestamp, or empty).
- `timezone_basis` (text, e.g. `store`; nullable; how the deadline is read).
- `created_by` (which user created it; informational, not a permission gate).
- `created_at`.

Indexes: `surveys(tenant_id)`; `survey_versions(survey_id)`;
`survey_assignments(tenant_id)`, `(target_node_id)`, `(survey_version_id)`.
(The existing path index on `nodes` already powers the "which stores" lookup.)

### The status rule (so it can never contradict itself)
- Create a survey -> status `draft`, with a draft version 1.
- Publish a version -> survey status becomes `published`. It **stays**
  `published` even while a new draft version is being worked on (the live
  version is still out there).
- Archive -> status `archived` (retired, history kept). 

### What a question looks like (inside a version's `questions`)
Validated with Pydantic (FastAPI's built-in checker) on every write:
```
{ "id": "q1",                       // stable id, so Phase 4 answers can refer to it
  "prompt": "How many facings of Rosewood are on the shelf?",
  "type": "number",                 // number | boolean | single_choice | multi_choice | photo | text
  "options": [],                    // only for the choice types
  "sku_ids": ["<Velvet Lip Rosewood id>"],  // catalog links; each checked to be your company's
  "perSku": true,                   // ask this once per product variant
  "pass": { "operator": ">=", "value": 4 },  // the pass rule (optional per question)
  "passScope": "each" }             // "each" = every variant must pass; "total" = the sum must
```
Validation rules:
- `id`, `prompt`, `type` required; `type` must be one of the allowed set.
- `options` required and non-empty for the choice types; ignored otherwise.
- `pass.operator` (if a pass rule is present) must be one of
  `>=, <=, >, <, ==, !=, in, not_in`; `value` a number, string, or list.
- `passScope` must be `each` or `total` (only meaningful when `perSku` is true).
- every id in `sku_ids` must be a product in the caller's company, or the save
  is rejected.

### The scope guard learns about surveys and assignments
The shared `ScopedRepo` (the one object allowed to touch scoped tables, so no
endpoint can forget the rules) gains:
- **Surveys (company-wide, tenant-filtered, like the catalog):**
  `list_surveys()`, `get_survey(id)`, `create_survey(...)` (creates draft v1),
  `update_version(survey_id, version_id, questions)` (rejected if that version is
  published), `publish_version(survey_id)` (freezes the current draft),
  `new_version(survey_id)` (starts a new draft from the latest),
  `archive_survey(survey_id)`.
- **Assignments (branch-scoped, like nodes):** `create_assignment(...)` (refuses
  a target node outside the caller's scope or another company),
  `list_assignments()` (only assignments whose node is in the caller's scope),
  `assignment_stores(id)` (the live list of stores under the target node, by
  tree path; this is the gate).

The file grows, so survey and assignment queries go in clearly labelled sections,
the way the catalog section is already separated. Keeping all scoped queries in
one object is deliberate: it is the security guarantee.

### The web addresses (a new router, surveys.py)
- `POST /surveys` (admin) - create a survey with its draft v1. Body: name, type,
  questions. Company comes from the wristband, never the body.
- `GET /surveys` (any signed-in company user) - list the company's surveys with
  their latest version info.
- `GET /surveys/{id}` (any signed-in company user) - one survey and its versions.
- `PATCH /surveys/{id}/versions/{vid}` (admin) - edit a **draft** version's
  questions; editing a published version is refused (409 Conflict).
- `POST /surveys/{id}/publish` (admin) - freeze the current draft version.
- `POST /surveys/{id}/versions` (admin) - start a new draft version from the
  latest (the "edit a published survey" path).
- `POST /surveys/{id}/archive` (admin) - retire the survey, history kept.
- `POST /survey-assignments` (admin anywhere, manager within branch) - point a
  **published** version at a node, with an optional deadline. Targeting a node
  outside the caller's scope is refused (404, same "as if it does not exist" rule
  the scope guard uses everywhere). Assigning a draft version is refused.
- `GET /survey-assignments` (scoped) - assignments visible in the caller's branch.
- `GET /survey-assignments/{id}/stores` (scoped) - the live, computed list of
  store nodes the assignment covers, by tree path.
- `DELETE /survey-assignments/{id}` (admin anywhere, manager within branch) -
  remove an assignment in the caller's scope (one outside scope returns 404).

### Demo data (so tests have something real)
Seed for Lumen a published "Velvet Lip Shelf Check" (v1) whose questions link to
the seeded Velvet Lip SKUs and carry pass rules, assigned to a node so a manager
(Sarah, Central) can see it where appropriate. Seed one survey for Acme too, so
isolation is provable. Idempotent, like the rest of the seed.

### The tests (the gate for 3b)
- **Company isolation:** a Lumen user sees only Lumen surveys/assignments; an
  Acme user sees only Acme's.
- **Auth required:** listing with no wristband returns 401.
- **Admin-only authoring:** a manager or rep creating, editing, publishing, or
  archiving a survey gets 403.
- **Immutability:** editing a published version is refused (409); publishing then
  starting a new version produces v2, and v1's questions are unchanged.
- **Assignment scope:** a manager can assign within their branch; assigning to a
  sibling region is refused (404). An admin can assign anywhere in the company.
- **Computed coverage (headline gate):** assigning to a region returns that
  region's stores by path, not another region's; a store added under the node
  *after* the assignment shows up automatically (computed, not copied).
- **Assign only published:** assigning a draft version is refused.
- **Validation:** a malformed pass rule, a bad question type, or a `sku_ids`
  entry from another company is rejected on save.

## The new and changed files

- `db/migrations/<timestamp>_create_surveys.sql`: the three tables (with undo).
- `api/app/surveys.py`: the survey + assignment router and the Pydantic models
  (new).
- `api/app/scope.py`: add the survey and assignment methods to ScopedRepo
  (modify).
- `api/app/main.py`: plug in the surveys router (modify).
- `api/app/seed.py`: add the demo surveys and an assignment (modify).
- `api/tests/test_surveys.py`: the tests above (new).
- Docs updated in the same breath: `api/README.md`, `db/README.md`,
  `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md` (note the survey checks),
  `START_HERE.md`, `CONTEXT.md`, and the prototype handoff CHANGELOG.

## Deliberately NOT in Phase 3b (so nothing is silently missing)

- **Rep answers / responses:** Phase 4. Surveys define the questions; nobody
  answers them yet.
- **Compliance scoring:** Phase 4. Pass rules are stored and validated now, but
  pass/fail is computed later, at read time, never stored.
- **Screens:** a later phase, like the catalog.
- **AI form builder:** it would *populate* questions; admins authoring/editing by
  hand is the v1 path. The AI piece is a fast-follow.
- **Editing an assignment's deadline in place:** v1 supports create, list, the
  stores lookup, and remove (delete); changing a deadline is remove-and-recreate
  for now, rather than a PATCH.
- **Notifications** on new assignments/deadlines: a separate decision (handoff
  PART 7), not built here.

## How we will know 3b is done

All survey tests green (isolation, auth, admin-only authoring, immutability,
assignment scope, computed coverage, assign-only-published, validation), the full
backend and frontend test runs still green, a live walk-through (create -> edit
draft -> publish -> new version -> assign -> list stores) behaves as described,
and all guides updated.
