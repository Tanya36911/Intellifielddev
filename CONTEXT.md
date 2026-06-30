# Intelli — build context (read this first)

If you're an AI assistant or a new teammate opening this repo fresh, read this
file, then `README.md`, then the prototype's `TECH_STACK.txt` and
`Intelli_Complete_Handoff.md` (in the sibling `hi-fi-intelli/` repo). Together
they give you the product, the decisions, the stack, and the build state.

## What this is
The production build of **Intelli**, a multi-tenant CPG retail field-execution
platform (Admin web, Manager web, Field mobile). The finished **prototype** in
`../hi-fi-intelli/project/` is the visual + behavioral spec; this repo
implements it for real. Differentiator: self-serve configurability + flexible
rep autonomy + offline done right. AI (shelf photo -> per-SKU gap list) is a
fast-follow, never the headline.

## Stack (decided, see TECH_STACK.txt for full reasoning)
- Monorepo: pnpm workspaces. TypeScript everywhere.
- Web (Admin/Manager): React 19 + Vite + React Router + TanStack Query +
  Redux Toolkit + react-hook-form/zod + CSS Modules.
- Mobile (Field): Expo (managed) + Expo Router + WatermelonDB + same state libs.
- Backend: FastAPI + Postgres + SQLAlchemy + plain-SQL migrations (dbmate, NOT
  Alembic) + JWT/Argon2. Security spine = "scope follows the pin" (a user sees
  only their subtree of the org tree), enforced in one ScopedRepo + Postgres RLS.

## Build order (gated phases)
- [x] **Phase 0** - monorepo + Docker (API + Postgres) + shared tokens + blank Admin app. Verified.
- [x] **Phase 1** - tenancy + auth. Done: backend login + Admin login screen. Gate met: log in works; only your own tenant's user comes back. (Full cross-tenant data isolation is Phase 2's gate.)
- [x] **Phase 2** - hierarchy + scope guard. Done: org_level_definitions, nodes (materialized path), assignments; one shared ScopedRepo enforces tenant + pinned-subtree on every query; GET /nodes. Gate MET: isolation tests pass (tenant, sibling region, rep, admin reach, no-pin), both at the repo level and through the API.
- [~] **Phase 3** - catalog + surveys + versions + assignments. Split into 3a + 3b.
  - [x] **Phase 3a** - catalog (skus): company-wide list, admin-only add/edit, company isolation. Gate met (tests green).
  - [x] **Phase 3b** - surveys + immutable versions + assignments + structured pass conditions. Gate met (tests green).
- [x] **Phase 4** - responses + analytics + payroll + export. Split into 4a + 4b + 4c + 4d.
  - [x] **Phase 4a** - responses + live pass/fail scoring. Gate met (tests green).
  - [x] **Phase 4b** - analytics (compliance %, OOS by SKU, trends). Gate met (tests green).
  - [x] **Phase 4c** - payroll. Gate met (tests green).
  - [x] **Phase 4d** - export (CSV + read-only JSON feed). Gate met (tests green).
- [~] **Web Screens track (NOW the priority - see ROADMAP.md)** - the Admin web
  screens over the existing backend, built in demo-value order so stakeholders see
  results. Almost all are buildable on today's endpoints; a few need a small
  backend brick first (users, tenant settings, node-edit).
  - [x] **W1** app shell + Analytics dashboard (the old W2 analytics is folded into
    W1: the shell ships with the real dashboard as its first screen, not a stub Home);
    [x] **W3** catalog; [x] **W4** survey builder + assignments; [x] **W5** responses
    + detail; [x] **W6** payroll; [x] **W7** org hierarchy (view);
    [x] **Users & Roles** (the team screen at /users); [x] **Settings** (company
    name + payroll on/off at /settings).
  - ALL ADMIN WEB SIDEBAR SCREENS COMPLETE as of 2026-06-25 (the six demo-order
    screens plus Users & Roles and Settings).
  - [x] **Setup wizard DONE** (2026-06-26, built in two slices). **Slice 1 (editable
    hierarchy)**: the Hierarchy screen at /hierarchy gained an admin-only Edit mode
    (add a child node, rename a node, delete an empty node), backed by new
    POST/PATCH/DELETE /nodes endpoints. **Slice 2 (the wizard UI)**: a fullscreen,
    admin-only, 5-step Setup Wizard at /setup (pick a hierarchy template, name your
    levels, payroll on/off, build the tree, invite people), reached from a new
    admin-only Setup item in the sidebar; it reuses PUT /org-levels, PATCH /tenants,
    POST /nodes, and POST /users (no new backend). With the setup wizard done, the
    **Admin web app is feature-complete** for this roadmap. NEXT: the Manager web app
    and/or Phase 5.
- [~] **Phase 5** - Field app + offline sync. RESEQUENCED (2026-06-18) to AFTER the
  web screens: it is the long, hard, last push, so the visible web screens come
  first. Split into a backend sync-contract track and a mobile track.
  - Backend track: [x] **5-BE-a** idempotency keys (claim tickets on the two rep submit endpoints, the safety primitive the offline queue depends on); [ ] **5-BE-b** batch sync; [ ] **5-BE-c** photo storage.
  - Mobile track: [ ] **5-M-a** Expo skeleton; [ ] **5-M-b**; [ ] **5-M-c**; [ ] **5-M-d** on-device DB + sync engine.
- [ ] **AI** - shelf-scan CV pipeline (separate runway, last).

## How to run (see README for detail)
- Backend + DB: `docker compose up -d` (API at :8000, /docs for API docs)
- Migrations: `docker compose run --rm migrate up`
- Web: `pnpm install` then `pnpm dev:admin` (:5173)

## Working preferences (how the user wants to be helped)
- Explain every change in plain, detailed terms (limited coding background).
- Commit to git after each meaningful change so it can be reverted.
- No em dashes anywhere in UI copy. UI status text is terse; prose is plain
  sentences, not dot-spliced fragments.
- Keep this file's build-order checklist + the prototype handoff CHANGELOG
  updated as work progresses.

## Progress log
- 2026-06-12: Phase 0 committed (monorepo, FastAPI+Postgres, tokens, blank Admin). First commit.
- 2026-06-12: Phase 1 backend - tenants + users tables (dbmate migration), Argon2 password
  hashing + JWT, POST /auth/login, seed (dana@lumenbeauty.com / demo1234). Verified: correct
  password returns a token, wrong password 401, password stored as Argon2 hash. Login SCREEN next.
- 2026-06-13: Phase 1 frontend - Admin login screen (approved via browser mockup first). React
  Router v7 route map (/login, /) with auth doorman, react-hook-form + zod validation, Redux
  Toolkit session slice mirrored to localStorage (12h expiry read from the JWT), brand fonts
  loaded, Vitest + Testing Library harness (27 tests, all green). Verified: full build passes,
  live backend returns Dana's token on the demo login and 401 on a wrong password. Spec + plan
  in docs/superpowers/. Phase 1 COMPLETE; Phase 2 (hierarchy + scope guard) next.
- 2026-06-15: Phase 2 - org hierarchy + scope-follows-pin guard. Migration for
  org_level_definitions + nodes (materialized text path, prefix-indexed) + assignments. Shared
  FastAPI ScopedRepo auto-filters every scoped query to tenant + pinned-node subtree;
  current_claims verifies the JWT per request; GET /nodes is the first scoped endpoint. Seed
  builds a 2-tenant world (Lumen 8 nodes, Acme 4) with 5 pinned/unpinned users. Backend test
  harness added (pytest + TestClient vs a throwaway intelli_test Postgres). MANDATORY GATE GREEN:
  18 backend tests incl. cross-tenant, sibling-region, rep, and no-pin isolation, checked on the
  ScopedRepo and through the API. Chain kept as a store label (parallel chain hierarchy deferred,
  per handoff PART 8). Open pre-launch item: replace the dev JWT_SECRET with a strong env secret
  before real client data; RLS (Layer B) still optional/later. Phase 2 COMPLETE; Phase 3 next.
- 2026-06-15: Phase 3a - product catalog. Migration for skus (tenant_id, line, variant, upc,
  color, status, reference_images jsonb; unique per tenant by upc). ScopedRepo gained company-wide
  list_skus/create_sku/update_sku (tenant-only filter, not branch path). New require_admin
  dependency (403 for non-admins). catalog.py: GET /skus (any tenant user), POST/PATCH /skus
  (admin only) with Pydantic validation. Seed adds 4 Lumen + 1 Acme products. Also fixed the test
  harness SQL splitter (strip comments before splitting on ';', a migration comment had a
  semicolon). Tests green (29 backend total): company isolation, admin add/edit, non-admin 403, no
  cross-company edit, auth required. Phase 3a COMPLETE; Phase 3b (surveys) next.
- 2026-06-15: Config hardening (backend-team suggestions). New api/app/config.py centralizes all
  secrets, read from the environment with NO baked-in defaults (missing required secret = app
  refuses to start; test_config covers this). db.py + security.py now import from config. Secrets
  (POSTGRES_PASSWORD, JWT_SECRET) live in a gitignored .env; docker-compose substitutes them and
  pins TZ=UTC on every service. The dev JWT_SECRET is now long enough that the short-key warning is
  gone. 32 backend tests green. Confirmed already-present (per teammate's list): SQL stops on error
  (dbmate + harness) and scripts run in transactions (dbmate, seed, writes via engine.begin); UTC
  was already real via timestamptz + UTC Postgres, now also pinned explicitly. Remaining pre-launch:
  set fresh strong secrets in the production environment.
- 2026-06-16: Phase 3b - surveys + immutable versions + assignments + structured pass conditions.
  Migration for surveys (name, type, status draft/published/archived), survey_versions (questions
  jsonb + published_at = the freeze marker; unique per survey by version_number), and
  survey_assignments (published version -> target node, deadline, created_by). New surveys.py router:
  admins author (POST /surveys creates draft v1; PATCH a draft; POST publish freezes; POST versions
  starts a new draft from the latest; POST archive), any company user views (GET /surveys, GET
  /surveys/{id}); editing a published version is refused (409). Assignments via
  require_manager_or_admin + the scope guard: admins anywhere, managers within their branch (POST/
  DELETE /survey-assignments, 404 out of scope), GET list scoped, GET /survey-assignments/{id}/stores
  computes coverage live from the node path (store added later is included). ScopedRepo gained the
  survey + assignment methods (surveys company-wide like the catalog; assignments branch-scoped like
  nodes) plus 4 lifecycle exceptions. Questions validated by Pydantic (type/operator enums, choice
  options, per-SKU + passScope) and sku_ids checked to belong to the caller's company. Seed adds a
  published survey per company (Lumen "Velvet Lip Shelf Check" assigned to Central, Acme "Glow Serum
  Check"). GATE GREEN: 57 backend tests (incl. isolation, admin-only authoring, immutability,
  assign-scope, computed coverage, assign-only-published, validation) + 27 frontend. Phase 3b
  COMPLETE; Phase 4 (responses + analytics) next.
- 2026-06-16: Phase 4a - responses + live pass/fail. Two new tables: responses (the envelope, one
  row per submission, carrying a snapshot of the store's place in the org tree at submit time so
  history is never re-bucketed if the store moves later) and response_items (the atomic rows, one
  per product per question per submission, indexed for analytics). A new pure module
  api/app/compliance.py evaluates each answer against its question's pass rule (operators: >=, <=,
  >, <, ==, !=, in, not_in; scopes: each, total; blank answers are not counted, not failed) and
  returns pass/fail at read time, never storing the verdict, so changing a rule changes every score.
  New api/app/responses.py endpoints: POST /responses (any signed-in user, only for a store in
  their own branch, survey version must be published, answers are checked against the survey,
  blanks allowed, rejected answer shapes give 400, atomic explode into response_items); GET /responses
  (branch-scoped list with live pass/fail verdicts); GET /responses/{id} (single response with live
  verdicts). ScopedRepo gained create_response / list_responses / get_response. Re-visits are kept,
  never overwritten. Seed adds a Lumen response for the SF store (mix of pass/fail) and an Acme
  response. GATE GREEN: 91 backend tests + 27 frontend. Phase 4a COMPLETE; 4b (analytics) next.
- 2026-06-16: Phase 4b - analytics (read-only reports over the 4a response rows). No new database
  tables. New api/app/analytics.py with four GET endpoints, all branch-scoped through the shared
  ScopedRepo and computed live (pass/fail never stored): GET /analytics/compliance returns per-survey
  completion % (how many of the expected stores responded) and pass % (of scored responses, how many
  passed), with an ancestor rule so a company-wide survey assigned at the company root still shows
  correctly when viewed from a region, measured over that region's own stores only; GET
  /analytics/compliance/drill lets a user step from a region down to its districts and stores, and at
  a single store it shows the per-product reason for failing; GET /analytics/oos returns out-of-stock
  counts by product (a per-product count answer of 0), using each store's latest response; GET
  /analytics/trend returns a product's shelf-count over time (all responses), with a per-UTC-day
  average. Pass/fail stays in the one compliance.py evaluator; out-of-stock and trend are fast
  indexed SQL aggregates. ScopedRepo gained an analytics section. Seed enriched (an out-of-stock
  answer at Oakland and a dated SF trend point). GATE GREEN: 111 backend tests + 27 frontend.
  Phase 4b COMPLETE; 4c (payroll) next.
- 2026-06-17: Phase 4c - payroll engine. Migration adds three tables: pay_periods (a date range with a cutoff and an open/sealed status), time_entries (one row per rep per period: store/reset/drive minutes, miles, a manager-approval status, and a per-entry locked flag), and audit (a permanent logbook of sensitive actions). A new column payroll_enabled on tenants gates the whole feature per company. New api/app/payroll.py with a require_payroll guard: create/list pay periods (admin), log/edit your own hours (rep), approve/reject hours within your branch (manager/admin), seal a period (admin, locks all entries), reopen one rep's hours (admin, always audit-logged), and read the audit log (admin). The per-entry locked flag is the single source of truth for the lock; seal is re-callable so the reopen->fix->re-seal cycle works without special state. Manual seal in v1 (auto-clock deferred). ScopedRepo gained a payroll section (periods company-wide; entries role-scoped by the rep's pin). Seed turns payroll on for Lumen, off for Acme, and adds a rep under Central plus an open period with entries. Gate GREEN: 132 backend tests + 27 frontend. Phase 4c COMPLETE; 4d (export) next.
- 2026-06-18: Phase 4d - export (CSV + a matching read-only JSON feed over responses, payroll, and a
  compliance summary). No new database tables. A new api/app/exports.py router adds three GET
  endpoints, each returning either a downloadable spreadsheet (?format=csv, a streamed CSV) or the
  same rows as data (?format=json, the default), so the file and the data feed are literally the same
  rows; one ordered column list per dataset drives both the CSV header and the JSON keys so they
  cannot drift. GET /export/responses comes at two levels: a summary (one row per stored response,
  with the live overall verdict and counts of passed/failed questions) and a per-SKU detail (one row
  per stored answer item, with the raw value and its live item pass/fail); both filterable by date,
  survey, chain, node, and product, all ANDed on top of the scope filter, with multi-choice answers
  kept as a real list in JSON and as compact JSON text in one CSV cell, and "not scored" rendered as
  a blank cell, never false. GET /export/payroll is role-scoped (rep -> own, manager -> branch,
  admin -> all) and gated by the per-company payroll switch (require_payroll, 403 when off), with a
  LEFT join so an unpinned rep still exports with a blank node name. GET /export/compliance reuses the
  4b assignment_compliance roll-up unchanged, so the export and the dashboard never disagree
  (including pass_pct staying blank, not 0, when nothing is scored). All read-only and branch-scoped
  through the shared ScopedRepo (a new export section: export_responses / export_payroll /
  export_compliance), reusing the same login wristband, so no new tables and no new sign-in; a node
  outside scope is a 404 and an unpinned caller gets an empty export. Seed unchanged (the tests build
  their own surveys/periods where determinism matters). Gate GREEN: 160 backend tests + 27 frontend.
  Phase 4d COMPLETE; Phase 4 done. NEXT: Phase 5 (Field app + offline sync).
- 2026-06-18: Phase 5-BE-a - idempotency keys (the first piece of Phase 5, a backend-only safety
  primitive for offline re-sends). Goal: let the two rep submit endpoints accept an optional
  client-generated "claim ticket" (a UUID) so a re-sent queued submission returns the original row
  instead of duplicating, with zero change for callers that send no ticket. One migration
  (20260618000001_add_idempotency_keys) adds a nullable idempotency_key uuid column to responses and
  time_entries plus a partial unique index on each (responses_tenant_idem_idx / time_entries_tenant_idem_idx,
  unique on (tenant_id, idempotency_key) where idempotency_key is not null), so only real non-null
  tickets are deduped per company and every existing/unkeyed row (all NULL) is untouched; schema.sql
  regenerated. ResponseCreate and TimeEntryCreate gained an optional idempotency_key: UUID | None = None,
  passed straight through. In scope.py, create_response and create_time_entry learned a
  check-then-insert-or-return step: a re-sent ticket returns the original (responses via get_response,
  which re-applies the caller's current scope; hours via the same _ENTRY_COLS row shape, user_id-scoped,
  short-circuiting BEFORE the sealed-period and already-have-an-entry checks so a genuine re-send is a
  200, not the usual 409). Backward-compatible: a NULL ticket is never deduped. The key stays internal
  (never added to _RESPONSE_COLS / _ENTRY_COLS, so it never leaks into a response body). New
  api/tests/test_idempotency.py (9 tests through the API): same ticket twice returns one row and the
  identical body; no ticket creates two; keyed then unkeyed still inserts; the partial index actually
  rejects a direct duplicate; the same ticket across two companies does not collide; a keyed first
  submit still respects scope (404) and validation (400); hours replay returns the original and the row
  carries the sent ticket; a different ticket for the same (period, rep) still 409s; a payroll-off
  company still 403s before any ticket logic. Gate GREEN: 169 backend tests + 27 frontend. Phase 5-BE-a
  COMPLETE.
- 2026-06-18: ROADMAP REVAMP (see ROADMAP.md) - screens first, so stakeholders see results. The
  backend is comprehensive and proven (Phases 1-4d + 5-BE-a, 169 tests) but the only screen is login
  + a near-empty welcome page. So the priority pivots to building the Admin web screens over the
  existing backend, in demo-value order (W1 app shell + Home, W2 analytics/compliance dashboard, W3
  catalog, W4 survey builder + assignments, W5 responses + detail, W6 payroll, W7 hierarchy view).
  Almost all are buildable on today's endpoints; a few need a small backend brick first (users,
  tenant settings, node-edit). Phase 5 (Field mobile app + offline sync) is RESEQUENCED to after the
  web screens (it is the long, hard, last push); nothing built is discarded. NEXT: W1 (app shell +
  Home), then W2 (analytics dashboard), each via the usual mockup-approve-then-build flow.
- 2026-06-19: W1 Stage A - /analytics/dashboard endpoint (footprint, distinct-coverage compliance
  aggregate, overdue, weekly trend, previous-window) + login company/pin names; backend-only, no new
  tables; gate green: 183 backend tests.
- 2026-06-19: W1 COMPLETE - the Admin app's first real screen (the Analytics dashboard inside the app
  shell). Built in 4 staged plans plus a seed enrichment, each adversarially reviewed by a fresh
  checker. Stage A (backend, above): a new read-only GET /analytics/dashboard endpoint, branch-scoped
  with no new tables, returns the headline figures (footprint Nodes/Stores/Reps; compliance computed
  over the distinct set of store-survey obligations so nothing is double-counted; surveys-completed
  count; overdue count; a weekly completion trend; and a previous-period block for the up/down deltas),
  and the login response now also returns company_name and pinned_node_name for the sidebar. Stage B
  (frontend foundation): the full design-token set (layout vars, density, dark mode, fonts), a small UI
  kit ported from the prototype (apps/admin/src/ui/: Icon, Avatar, Chip, Button, Card, Segmented,
  Switch, Spark, Bar), TanStack Query wired in main.tsx for server data, and an authenticated API
  client (apiGet / downloadCsv in lib/api.ts reading the login token via a shared lib/session.ts). Stage
  C (the dashboard screen, apps/admin/src/pages/Dashboard/): KPI cards (avg compliance, surveys
  completed, overdue) with sparklines and deltas, a weekly completion-trend line, a compliance-by-node
  list with click-to-drill (region to store to the per-product reason it failed), an Export-to-CSV
  button, and the AI gap list clearly badged "preview". Numbers are real, computed from the backend;
  out-of-stock by SKU was deferred (it needs a survey/question picker) and avg-completion-time was
  dropped (no duration data exists). Stage D (the shell, apps/admin/src/shell/): the persistent left
  sidebar (Intelli brand, the company card, the nav with the unbuilt screens shown as "coming soon"
  placeholders, the Nodes/Stores/Reps footprint, the user card and sign out) and a per-page top bar.
  Web trims: no tenant switcher, no "Synced" control, and the setup-wizard item and notifications bell
  are "coming soon". The seed was enriched so the dashboard shows fuller real numbers (more responses
  across weeks, a covering assignment, a past-deadline so overdue is non-zero, out-of-stock variety);
  footprint counts unchanged. Home was replaced by the Dashboard at /. Gate GREEN: 183 backend tests +
  48 frontend checks, build compiles. The old W1 (app shell + a stub Home) and W2 (analytics dashboard)
  are merged: the shell ships with the real dashboard as its first screen. W1 COMPLETE; the remaining
  Admin web screens (catalog, survey builder, responses, payroll, org tree) are NEXT, per ROADMAP.
- 2026-06-15: DB script hardening (senior-DBA pass). All three migrations rewritten to be
  self-protecting: `-- migrate:up transaction:false` + explicit begin/commit + `set local
  timezone='UTC'` (and same for down), so each file is atomic and UTC-correct under dbmate OR
  hand-run psql. Stop-on-error is enforced by the runner (dbmate aborts; new scripts/db-migrate.sh
  uses set -e; manual psql uses -v ON_ERROR_STOP=1) since psql \set is not valid inside a dbmate
  file. conftest now applies each migration as one whole script (removed the home-grown
  semicolon splitter; Postgres parses statement boundaries). Verified: 32 backend tests green,
  dbmate down+up of the latest migration succeeds with the new format, schema unchanged. Authoring
  rule recorded in db/README: never edit an already-applied migration in production; add a new one.
- 2026-06-22: W3 COMPLETE - the Admin Catalog screen. The Catalog screen at /catalog replaces
  the "coming soon" placeholder and shows the company's product list (its SKUs, meaning product
  variants such as Velvet Lip in Rosewood) grouped by product line, in a List view and a Gallery
  view, with search (by variant name, line, or UPC barcode), a status filter (All / Active /
  Discontinued), and three stat tiles (product lines, total products, active products). Admins
  can add and edit products via a shared pop-up form with five fields (line, variant, UPC, colour,
  status); the form validates that line, variant, and UPC are filled before enabling Save, handles
  inline errors if the backend refuses, and closes and refreshes the list on success. Managers and
  reps see the screen in read-only mode (no Add button; rows and cards are not clickable). One
  company never sees another's catalog (the existing backend enforces this; no backend API or
  schema change was needed). New files in apps/admin/src/pages/Catalog/: Catalog.tsx, useCatalog.ts
  (with pure helpers groupByLine, catalogStats, filterSkus), LineSection.tsx, SkuThumb.tsx,
  SkuCard.tsx, ProductFormModal.tsx, and tests. New shared UI-kit pieces in apps/admin/src/ui/:
  Modal, Field, Input, Select (plus form.module.css), reusable by every future screen that needs
  a form or a pop-up. lib/api.ts gained apiSend (the authenticated POST/PATCH write helper; before
  W3 the file only had apiGet and downloadCsv). test/render.tsx can now seed a signed-in session
  for tests; test/fixtures.ts gained a company_name for Dana and a rep fixture (Marcus). The sidebar
  nav item for Catalog dropped its "coming soon" flag. Backend: the demo seed was enriched (additive,
  idempotent) so Lumen now has 33 products across 6 lines (Velvet Lip, Silk Foundation, Lash Volume,
  Glow Blush, Cushion Compact, Brow Define), including one discontinued product (Glow Blush Bronze),
  so the status filter and grouping have real content. W3 adds no backend tests (a seed-only change);
  the backend suite is to be re-confirmed with the database running. Frontend: 80 automated checks,
  all green. Deliberately deferred (honest placeholders, not missing): real photo upload (needs object
  storage, 5-BE-c), CSV import, PIM/API sync, "used in N surveys" badge, catalog CSV export, "New" status.
- 2026-06-24: W4 COMPLETE - the Admin Surveys area (survey builder + publish + assign). The Surveys
  screen at /surveys replaces the old "coming soon" placeholder. It has three panels: (1) a Surveys
  list showing each survey with a status chip (Published / Draft / Archived), a version chip, an
  Assigned indicator, and three stat tiles (all surveys, published, drafts); (2) a by-hand Builder
  where an admin adds questions of six types (Yes/No, Number, Single choice, Multiple choice, Photo,
  Short text), marks them required, sets a structured pass rule for scoreable types (Yes/No, Number,
  Single choice) using operators >=, <=, >, <, ==, !=, in, not_in (matching the existing
  api/app/compliance.py), asks a question per product by picking product lines which freeze to
  specific product ids on publish, and reorders questions with up/down arrows; (3) Publish (freezes
  the version forever with a confirmation) then Assign (point the published version at one or more
  org nodes with a deadline and a timezone label). The survey name is read-only in edit mode (no
  backend rename endpoint). The timezone label is stored for display only and does not yet shift the
  deadline per store. The old "Form Builder" nav item was removed; the builder lives inside Surveys.
  The AI "describe it and draft" feature was deliberately not built (a later fast-follow). Backend
  changes were additive only (no migration, no new endpoint): the survey question model gained three
  optional fields (required, unit, lines); GET /surveys now returns latest_version and a scope-aware
  assigned boolean per survey. All other data used the existing /surveys, /survey-assignments, /skus,
  and /nodes endpoints. New files in apps/admin/src/pages/Surveys/: useSurveys.ts, SurveyList.tsx,
  Builder.tsx, QuestionCard.tsx, PassConditionEditor.tsx, PublishConfirm.tsx, AssignPanel.tsx, plus
  their .module.css files and tests. Deliberately deferred (with honest notes): drag-and-drop reorder,
  version-diff panel, phone preview, pre-assign store-count estimate, survey templates. Gate GREEN:
  192 backend tests (190 prior + 2 new) + 104 frontend checks, admin app builds clean. W4 COMPLETE;
  W5 (Responses + response detail) next.
- 2026-06-19: Compliance-by-node region drill + healthy demo seed (a W1 dashboard refinement). The
  "Compliance by node" card was reshaped from a per-survey-assignment list (which showed duplicate
  survey rows and empty 0%/dash bars, and did not match the prototype) into a recursive ORG-NODE
  drill: it lists your nodes (the regions at the company root) and steps region -> district -> store
  -> the per-product reason a store failed. New read-only GET /analytics/compliance/nodes
  (ScopedRepo.node_compliance, cross-survey, no new tables) rolls each child node up over the distinct
  (store, version) coverage beneath it via the same _dashboard_window the headline uses, windowed by
  date_from/date_to so the card and the "Avg. compliance" KPI always agree. Frontend: useNodeCompliance
  (sends the dashboard's range) + a rewritten ComplianceList (recursive NodeRow/NodeDrill, narrows on
  data.is_store); the now-unused useCompliance/useComplianceDrill hooks were removed. Seed retuned
  (response values only; footprint 8/3/2, the protected 2026-06-10 export instant, payroll, and Acme
  isolation all unchanged): SF latest passes, Oakland latest fails (Rosewood 2, a drillable "two
  facings short"), Chicago answers and passes - so the demo reads West 50%, Central 100%, avg
  compliance 67%, completion 100%, overdue 0, with filled bars and a real drillable failure (no more
  0%/empty look). Reviewed by two 3-reviewer adversarial passes (spec, then code). Gate GREEN: 190
  backend tests + 54 frontend checks, tsc + vite build clean. Numbers appear on screen only after a
  fresh seed (the dev DB must be reseeded; the seed is idempotent so it will not overwrite old rows).
- 2026-06-25: W7 COMPLETE - the Hierarchy screen. The Admin "Hierarchy" sidebar
  item at /hierarchy is now a real screen (was a "coming soon" placeholder). It
  shows the company's org tree in a read-only expand/collapse view. Each row has a
  colour dot, the level name (Region/District/Store), a chain badge on stores, the
  store code, and child counts. A search box and a chain filter narrow the tree.
  Clicking a store opens a detail panel with the store's full management path and
  attributes. Backed by the existing GET /nodes plus a new small read-only endpoint
  GET /org-levels (returns the company's level names, tenant-scoped; added to
  api/app/hierarchy.py and api/app/scope.py with a test). New files in
  apps/admin/src/pages/Hierarchy/: Hierarchy.tsx, useHierarchy.ts, TreeNode.tsx,
  StoreDetailModal.tsx, plus tests and CSS. Deferred (greyed "soon"): coverage mode
  (managers/reps overlay), add/rename/delete nodes, bulk import, export. Gate GREEN:
  198 backend tests + 196 frontend tests, build clean. ALL ADMIN WEB SCREENS NOW
  COMPLETE (W1, W3, W4, W5, W6, W7). Next tracks: Manager web app and/or Phase 5
  (Field mobile app + offline sync).
- 2026-06-25: W6 COMPLETE - the Payroll screen. A new Admin sidebar item at
  /payroll. Select a pay period; an hours table shows each rep's store/reset/drive
  minutes, miles, and approval status. Managers can approve or reject individual
  entries. Admins can SEAL the period (locks all entries; the screen then shows a
  padlock and a per-rep Reopen button). To reopen one rep an admin must type a
  reason, which is written to the permanent audit log. A Download CSV button exports
  the period. Role-gating is strict: reps are redirected away entirely (no view),
  managers approve, admins seal/reopen/read-audit. If a company has payroll switched
  off the screen shows a graceful "payroll not enabled" state. Frontend-only addition:
  all backend endpoints already existed (/pay-periods, /time-entries +
  approve/reject/seal/reopen, /audit, /export/payroll from Phase 4c/4d). New files
  in apps/admin/src/pages/Payroll/: Payroll.tsx, usePayroll.ts, ReopenModal.tsx,
  plus tests and CSS. Deferred: per-rep hour drill-in, inline editing.
- 2026-06-25: W5 COMPLETE - the Responses feature (list + detail). Responses are NOT a sidebar item
  (prototype parity): they open as modals from the Surveys screen (each survey row has a "N responses"
  button -> a per-survey responses list -> a single response's detail with the live verdict and the
  per-shade facings grid). Backend: a small read-only enrichment to GET /responses and /responses/{id}
  (added store_name, survey_name, survey_version_number, rep_name, survey_id, and per-response
  scored/passed counts via additive joins; branch-scoping unchanged; no new tables). Frontend in
  apps/admin/src/pages/Surveys/: useResponses hook + pure helpers, ResponsesListModal,
  ResponseDetailModal (renders the backend's per-item and per-question verdicts, never re-scores;
  reuses useSurveys + useCatalog for question/SKU display), wired into SurveyList. Shelf photos
  deferred (5-BE-c, placeholders). Built test-first on a w5-responses branch (the new per-screen git
  workflow); review caught and fixed a re-scoring bug, a name-collision response-bucketing bug, and
  the partial/% list display, then merged to main. Gate GREEN: 196 backend + 133 frontend, build
  clean. W6 (payroll) next.
- 2026-06-25: USERS & ROLES + SETTINGS COMPLETE - the two remaining Admin sidebar screens are now
  real (were "coming soon" placeholders). With these, ALL Admin web sidebar screens are done.
  Users & Roles (/users): a People tab with three role-count cards (Admin / Manager / Rep), a
  plain-language banner ("a role is what a person can do, their pin is where they can do it"), and a
  team table (name, email, role, pinned node with an inheritance sentence); a Roles tab with a
  read-only capability matrix (Full / Scoped / None per role). Admins can add a user (name, email,
  role, which org node to pin to, and a starting password the admin sets), change a role inline, and
  move or remove a pin; non-admins see it read-only (same pattern as Catalog). Settings (/settings):
  real and saved in v1 are the company name (editable) and a payroll on/off switch (it genuinely
  controls whether the Payroll screen and its backend actions are available); shown honestly as
  "coming soon" (not faked) are pay-period defaults, work model, store chain logos, audit log, and
  data & security; non-admins see it read-only. Backend bricks (no migration; the users +
  assignments + tenants tables already existed): new api/app/users.py with GET /users (team list,
  branch-scoped through the existing scope-follows-pin guard: a pinned user is visible when pinned
  at/under the caller's node; unpinned users are visible only to a caller at the company root; an
  unpinned caller sees none), admin-only POST /users (add + pin, password stored only as an Argon2
  hash, duplicate email 409, node out of scope 404), and admin-only PATCH /users/{id} (change role
  and/or move-or-remove the pin, with a "cannot remove the last admin" guard); the pin is one row in
  the existing assignments table. New api/app/tenants.py with GET /tenants (this company's config,
  any signed-in user) and admin-only PATCH /tenants (update name and/or payroll_enabled; the company
  code is permanent and not editable). Both routers registered in api/app/main.py. scope.py gained a
  users section (list/get/create/update_user) and a tenant section (get/update_tenant) plus a
  LastAdminError. Tests: api/tests/test_users.py, api/tests/test_tenants.py. Frontend: new
  apps/admin/src/pages/Users/ (useUsers.ts, pinOptions.ts, RolesReference.tsx, AddUserModal.tsx,
  MovePinModal.tsx, UserTable.tsx, RoleSelect.tsx, Users.tsx, plus CSS modules and tests) and
  apps/admin/src/pages/Settings/ (useSettings.ts, CompanyPanel.tsx, PayrollPanel.tsx,
  ComingSoonPanel.tsx, Settings.tsx, plus CSS and tests); App.tsx now routes /users and /settings to
  the real screens; shell/nav.ts dropped the comingSoon flags on those two items. Deferred, recorded
  honestly: real emailed invite links (needs an email system; v1 has the admin set a starting
  password), enable/disable a user (no status column yet), manager-scoped user invites (admin-only in
  v1), custom roles; and for Settings the pay-period defaults, work model, store logos, a unified
  company audit feed, and the data & security panel. Built brainstorm -> spec -> plan -> parallel
  worktree build (one per screen) -> adversarial review pass; specs in
  docs/superpowers/specs/2026-06-25-users-roles-design.md and 2026-06-25-settings-design.md, plans in
  docs/superpowers/plans/2026-06-25-users-roles.md and 2026-06-25-settings.md, mockups in
  docs/superpowers/mockups/. Gate GREEN: 230 backend tests + 213 frontend tests, admin build clean
  (previous baseline 198 backend + 196 frontend). Committed locally but NOT pushed yet (pushing
  auto-deploys). ALL ADMIN WEB SIDEBAR SCREENS NOW COMPLETE. NEXT: the setup wizard (needs the Users
  brick plus on-screen hierarchy editing, meaning node add/rename/delete endpoints), then the Manager
  web app and Phase 5 (the Field mobile app + offline sync).
- 2026-06-26: SETUP WIZARD SLICE 1 (editable hierarchy) COMPLETE - the Hierarchy screen at /hierarchy
  (previously read-only, W7) now has an admin-only Edit mode. This is slice 1 of 2 toward the setup
  wizard: making the org hierarchy editable. In edit mode an admin can: add a child node under any node
  (its level is set automatically from the parent, so a child of a Region becomes a District; Store
  rows get no add-child because a store is a leaf); rename a node (and edit a store's chain and
  address); and delete a node, but only when it is empty (no child nodes, nobody pinned to it, no
  surveys assigned, no responses), otherwise it refuses and names the blocker. Managers and reps still
  see the screen exactly as before (read-only). Backend brick (no database migration; the nodes table
  already existed), admin-only and branch-scoped through the existing scope guard: POST /nodes (add a
  child; the child's level is parent + 1; the internal code is auto-generated and made unique from the
  name; adding below the locked bottom/Store level is refused with 400), PATCH /nodes/{id} (rename plus
  edit store attributes; parent, level, and code are not editable), and DELETE /nodes/{id} (allowed
  only when empty, else 409 naming the blocker; 404 if out of scope). These live in api/app/hierarchy.py
  (the router) and api/app/scope.py (ScopedRepo gained get_node, create_node, update_node, delete_node,
  and a _slug_code helper). Frontend, in apps/admin/src/pages/Hierarchy/: a new NodeFormModal.tsx (the
  add/rename modal), edit-mode wiring in Hierarchy.tsx and TreeNode.tsx, and new mutation hooks plus an
  isBottomLevel helper and a levelChildName helper in useHierarchy.ts; apps/admin/src/lib/api.ts gained
  an apiDelete helper. An adversarial review caught and fixed a real bug: the code had detected the
  Store level by the "locked" flag, but the Company root is also locked, which had hidden the add-child
  action on the root; it now detects the Store level by the deepest level, which also fixed a latent W7
  root-rendering glitch. Deferred and recorded honestly: moving/re-parenting a node (a later piece),
  editing the org LEVELS themselves (the wizard slice), and bulk CSV import/export (still shown as
  greyed "soon" on the screen). Built brainstorm -> spec -> test-first backend brick (in the main folder)
  -> worktree-built frontend -> adversarial review; spec in
  docs/superpowers/specs/2026-06-26-editable-hierarchy-design.md. Gate GREEN: 243 backend tests + 221
  frontend tests, admin build clean (previous baseline 230 backend + 213 frontend). Committed locally
  but NOT pushed yet. NEXT: slice 2, the 5-step setup wizard UI (pick a hierarchy template, name your
  levels, payroll, build the tree, invite people), which adds org-level editing on top of this. After
  the wizard: the Manager web app and Phase 5 (the Field mobile app + offline sync).
- 2026-06-26: SETUP WIZARD SLICE 1b (set-org-levels brick) COMPLETE - the last backend prerequisite for
  the wizard's step 2 ("name your levels"). Admin-only PUT /org-levels (in api/app/hierarchy.py +
  ScopedRepo.set_org_levels) replaces the company's level definitions with an ordered top-to-bottom list
  (level_order by position, top and bottom locked). Re-map safety: once real nodes exist the NUMBER of
  levels cannot change (renaming and reordering labels is allowed, since those keep every node's
  level_order valid; adding or removing a level is refused with 409), while a fresh or root-only company
  can set any 2 to 7 level structure (the path the wizard uses on a new company). No migration; tenant
  table unchanged. Backend-only (no UI yet; the wizard slice is the consumer). Self-reviewed plus six new
  tests (the guard both ways, validation, role-gating, company isolation, and the fresh-company path).
  Spec in docs/superpowers/specs/2026-06-26-org-levels-brick-design.md. Gate GREEN: 249 backend tests +
  221 frontend, build clean. Committed locally but NOT pushed. With this, every backend piece the wizard
  needs exists (nodes, org-levels, users, tenant/payroll config); the only thing left is the wizard UI
  itself (slice 2), which is a fullscreen 5-step flow that assembles these.
- 2026-06-26: SETUP WIZARD COMPLETE (slice 2, the UI) - with it the whole setup wizard feature is done,
  and the Admin web app is feature-complete for this roadmap. A fullscreen, admin-only, 5-step Setup
  Wizard lives at /setup, reached from a new "Setup" item in the sidebar (organization group). It walks
  an admin through configuring the company by assembling the bricks built earlier the same day: (1) Choose
  a starting point (pick a hierarchy template, a starting level structure; on a company that is already set
  up, templates are disabled with a note that they apply to new companies only); (2) Name your levels
  (rename, and on a fresh company add/remove/reorder, the org levels, saved via PUT /org-levels; on a
  company that already has stores it shows the company's REAL current level names in rename-only mode,
  since changing the number of levels would strand existing stores, with a clear note); (3) Payroll (turn
  the payroll module on or off, saved via PATCH /tenants; the detailed pay-period settings are shown as
  "coming soon", same as the Settings screen); (4) Build the tree (add org nodes, regions/districts/stores,
  via POST /nodes; CSV import and system sync are "coming soon"); (5) Invite people (add users and pin them
  to a node via POST /users, the admin setting a starting password; real emailed invites are "coming
  soon"). The wizard saves as you go, and Finish or Exit returns to the dashboard. It is admin-only: the
  route redirects non-admins, the Setup nav item is hidden from them, and the backend still guards every
  call. No new backend was needed (it reuses PUT /org-levels, PATCH /tenants, POST /nodes, POST /users).
  Frontend: a new folder apps/admin/src/pages/Setup/ (SetupWizard.tsx, useSetup.ts, StepTemplate/StepLevels/
  StepPayroll/StepTree/StepInvite, CSS, tests); apps/admin/src/lib/api.ts apiSend now also allows PUT;
  apps/admin/src/App.tsx has a /setup route outside the app shell (fullscreen, like login);
  apps/admin/src/shell/nav.ts has the admin-only Setup item; apps/admin/src/shell/Sidebar.tsx hides
  admin-only items from non-admins. An adversarial review caught and fixed three things before this was
  finalized: step 2 now seeds from the company's real saved levels (it had been showing template
  placeholder names on an already-populated company), the payroll on/off switch can no longer fire
  overlapping saves, and store-level nodes are no longer offered as parents when adding to the tree. Built
  brainstorm -> per-slice specs -> test-first bricks (in the main folder) -> a worktree/main UI build -> an
  adversarial review; specs in docs/superpowers/specs/2026-06-26-editable-hierarchy-design.md,
  2026-06-26-org-levels-brick-design.md, and 2026-06-26-setup-wizard-design.md. Gate GREEN: 249 backend
  tests + 247 frontend tests, admin build clean (previous baseline 249 backend + 221 frontend). Committed
  locally but NOT pushed yet. NEXT: the Admin app is feature-complete, so the next tracks are the Manager
  web app (reuses the same backend, scoped to a manager's branch) and Phase 5 (the Field mobile app +
  offline sync).
- 2026-06-29: MANAGER WEB APP STARTED (Lane 0 + Lane 1), and the push rule changed (Tanya: push completed
  green work autonomously, do not ask first; design/mockup gates still stand). Chose the Manager web app
  over Phase 5 as the next track (lighter, higher-visibility, mostly screen work since the backend already
  enforces branch scope). v1 = 4 real screens (Dashboard, Compliance Review review-only, Survey Assignment,
  Payroll Approval) on existing branch-scoped endpoints; Route Planning + Announcements stay "coming soon"
  (no backend). Spec: docs/superpowers/specs/2026-06-29-manager-web-app-design.md.
  - **Lane 0 (shared packages), DONE + PUSHED:** extracted the Admin UI kit into `@intelli/ui` and the API
    client into `@intelli/api-client` (in `packages/`, source-only like `@intelli/tokens`), re-pointed the
    Admin imports, and made the session-storage key per-app (the shared client is told its key once at
    startup via `configureSession`), so the Admin and Manager apps never share a login. Behavior-preserving:
    Admin build clean, 247 frontend tests green. Plan: docs/superpowers/plans/2026-06-29-manager-lane0-shared-packages.md.
  - **Lane 1 (Manager app shell), DONE:** a new `apps/manager` Vite app (port 5174), sibling to Admin,
    reusing the shared packages. The shell: a scope-forward Sidebar (loud "Your scope" chip from the pinned
    node, locked company card, branch-scoped footprint, 6-item nav with Route Planning + Announcements
    greyed "soon"), Topbar, a Manager-branded Login (own session key `intelli-manager-session`), and a
    fail-closed doorman (manager/admin -> shell; field rep -> a friendly NoAccess wall; unauthenticated ->
    login). The four real screens are ComingSoon placeholders, built one per lane next. No backend change.
    Manager: 15 frontend tests, build clean; Admin unchanged (247). New demo login: sarah@lumenbeauty.com /
    demo1234, scoped to "Central". A 4-lens adversarial review (correctness, scope-security, mockup
    fidelity, lane-readiness) passed; its fixes are folded in (honest scope label "No branch assigned" for
    an unpinned caller instead of a misleading "Whole company"; test fixtures match the real seed node names
    "Central"/"Lumen Beauty"; the role guard is an explicit fail-closed allowlist; the dead nav `badge`
    field removed; a deep-link rep test added).
  - **Lane 2 (Manager Dashboard), DONE:** the Dashboard at `/`, reusing the Admin dashboard (headline
    KPIs with trends, weekly completion trend, the compliance-by-node drill, CSV export, the preview AI
    gap list) over the same branch-scoped `/analytics/dashboard`, `/analytics/compliance/nodes`, and
    `/export/compliance`, so a manager sees only their branch. Copied-and-adapted from Admin (only the
    top-bar copy changed: "Dashboard" / "Your branch, period to date"); Admin untouched. It skipped a
    fresh mockup (it mirrors the already-approved Admin dashboard). Manager: 26 frontend tests, build
    clean; Admin: 247. Decision recorded: Manager screens are copied-and-adapted from Admin, not shared
    as whole pages (the foundation primitives + API client are already shared, the screens diverge per
    app, and copying keeps the green Admin app untouched).
  - **Lane 3 (Compliance Review, the hero screen), DONE:** at `/compliance`. A breadcrumb drill from the
    manager's branch root through districts to a store, then a store-detail review of each submitted
    survey scored live, with failing products surfaced by shade name and colour. Reuses the dashboard's
    branch-scoped `/analytics/compliance/nodes` drill (useNodeCompliance) plus a small `/skus` lookup for
    shade names; no backend change. Review-only for v1: failures shown in full, but "Assign follow-up to
    rep" and shelf photos are greyed "coming soon" (need the field app + photo storage, Phase 5). Mockup
    approved first (docs/superpowers/mockups/manager-compliance-mockup.html). New files in
    apps/manager/src/pages/Compliance/. Reviewed by a read-only adversarial pass. Deferred (noted):
    per-question text labels + pass-rule chips (need the survey-version question join) and the
    rep/last-visit metadata (needs /responses). Manager: 33 frontend tests, build clean; Admin: 247.
    NEXT: Lane 4, Survey Assignment (mockup -> build -> review), then Payroll Approval.
- 2026-06-30: ADMIN sidebar fidelity + Hierarchy tree fix (Tanya spotted the Admin sidebar diverging from
  the prototype and an empty Hierarchy tree). Admin nav now matches the prototype: re-added the **Form
  Builder** item (sparkles icon + AI badge, linking to the real builder at /surveys/new; the AI "draft it"
  assist is still a fast-follow), Catalog icon back to `box`, reordered to Analytics, Form Builder, Surveys,
  Catalog. Kept **Payroll** and the admin-only **Setup** item (real built screens the prototype's sidebar
  predates). Fixed a real bug in `apps/admin/src/pages/Hierarchy/useHierarchy.ts` buildTreeIndex: it rooted
  the tree only on parent_id===null (the company root), so a manager whose scoped /nodes starts mid-tree
  (at Central) saw "No nodes found" despite the stat tiles showing 11 nodes; roots now also include nodes
  whose parent is outside the scoped set, so the tree renders for any scope. Updated the Admin App.test
  (Form Builder nav item now expected) and added a useHierarchy test for the manager-scoped tree. Gate
  GREEN: 248 admin tests (was 247, +1 tree test), build clean; Manager + backend unaffected.
  - **Central demo enrichment, DONE:** the seed now adds (behind a `demo_extras` flag) two more districts
    under Central (Detroit, Indianapolis), six more stores, two reps (Tasha, Omar), a mix of passing/failing
    Velvet Lip readings, and hours, so the Manager screens demo full (Sarah's branch went from 3 nodes to
    11). The flag is dev/demo-only: backend TESTS call `run()` (demo_extras=False) and keep the small,
    asserted world, so the suite stays green (249) with no test churn; only `python -m app.seed` (the
    dev/demo DB) includes the extras. Also fixed a pre-existing date-rotted dashboard trend test
    (test_dashboard_weekly_trend hardcoded date_to=2026-06-29, which the real calendar reached today, making
    it window-out the now()-dated submissions; now relative to now()). The LOCAL dev DB is re-seeded; the
    DEPLOYED dev server's DB must be re-seeded after deploy (`docker compose exec api python -m app.seed`)
    for the extras to show there.
  - **Compliance Review district cards matched to the prototype:** the cards were thinner than the approved
    prototype, so `GET /analytics/compliance/nodes` gained additive per-child fields (stores, reps,
    failing_stores = scored - passed, and a period-over-period delta over the prior same-length window) and
    the card now renders the prototype layout: "N stores, N reps" subtitle, big % + up/down delta, progress
    bar, and an "N stores with failures" chip (green when none). Territories are intentionally omitted
    (Lumen's levels are Region/District/Store, no Territory level). delta shows only when there is a prior
    window to compare (none for the just-seeded stores, so it is honestly absent for now). Additive backend
    change, no migration; 249 backend tests still green (the new fields did not change existing assertions).
    NEXT: Lane 4, Survey Assignment.
- 2026-06-30: PROTOTYPE FIDELITY PASS started (Tanya: every built Admin + Manager screen must match the
  hi-fi prototype in layout, components, copy, badges, spacing; max parity, Admin app first, then Manager
  fidelity, then the two unbuilt Manager screens). Each screen goes mockup -> approve -> test-first build
  -> read-only adversarial review. Specs in docs/superpowers/specs/.
  - **Screen 1, Admin Hierarchy (/hierarchy): DONE.** Brought to prototype fidelity: a coloured retailer
    dot on each chain badge (CVS/Walmart/Target/Walgreens, in TreeNode + the store detail panel); a lock
    icon on locked rows (Company root + Store) and in the level legend; the prototype's TWO info banners
    (locked-levels, and chain-is-an-attribute); a Structure/Coverage segmented toggle whose Coverage view
    shows who manages/staffs each node (manager chip on the pinned node, rep-count chip on regions/
    districts, a green/amber "every district has a rep / N have no rep yet" summary), adapted to Lumen's
    Region/District/Store levels (no "Territory" level, so rep coverage is per district) and reusing the
    existing GET /users (fetched lazily, only when Coverage is opened); and a real, end-to-end **Bulk
    import** pop-up (CSV tab parses the file in the browser into {level,name,parent} rows, shows a review,
    imports; API-import tab is a styled "coming soon"). New backend brick (no migration): admin-only,
    branch-scoped **POST /nodes/bulk** (api/app/hierarchy.py + ScopedRepo.bulk_create_nodes in
    api/app/scope.py) creates many nodes in one transaction, resolving each row's parent BY NAME to a
    single in-scope node one level up (existing or created earlier in the same batch), refusing the
    company-root level and unknown levels, reporting per-row errors; 8 new tests in
    api/tests/test_nodes_bulk.py (happy path, in-batch parent, unknown level, parent not found, ambiguous
    parent, company-root refused, non-admin 403, cross-tenant refused). Frontend: new helpers in
    useHierarchy.ts (chainColor, computeCoverage, parseCsv, useBulkImportNodes) and a new BulkImportModal.tsx,
    plus edits to TreeNode.tsx, Hierarchy.tsx, StoreDetailModal.tsx, and CSS. An adversarial review caught
    that the company ROOT was still offering Rename/Delete in edit mode (it should not: the company name
    lives in Settings and the root can never be removed); fixed so only the root hides those actions while a
    store stays editable by design (its name/chain/address). Gate GREEN: 257 backend tests (249 + 8) + 268
    admin frontend tests, admin build clean. Spec:
    docs/superpowers/specs/2026-06-30-admin-hierarchy-fidelity-design.md. NOTE: re-seed the deployed dev DB
    after deploy for the demo data; the bulk endpoint needs no migration.
