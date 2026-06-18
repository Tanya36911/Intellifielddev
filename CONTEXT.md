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
- [~] **Phase 5** - Field app + offline sync. Split into a backend sync-contract track and a mobile track.
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
  api/app/compliance.py evaluates each answer against its question's pass rule (operators: gte, lte,
  eq, min_choices, max_choices; scopes: each, total; blank answers are not counted, not failed) and
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
  COMPLETE. NEXT: 5-BE-b (batch sync), then 5-BE-c (photo storage), then the Expo mobile app (5-M-*).
- 2026-06-15: DB script hardening (senior-DBA pass). All three migrations rewritten to be
  self-protecting: `-- migrate:up transaction:false` + explicit begin/commit + `set local
  timezone='UTC'` (and same for down), so each file is atomic and UTC-correct under dbmate OR
  hand-run psql. Stop-on-error is enforced by the runner (dbmate aborts; new scripts/db-migrate.sh
  uses set -e; manual psql uses -v ON_ERROR_STOP=1) since psql \set is not valid inside a dbmate
  file. conftest now applies each migration as one whole script (removed the home-grown
  semicolon splitter; Postgres parses statement boundaries). Verified: 32 backend tests green,
  dbmate down+up of the latest migration succeeds with the new format, schema unchanged. Authoring
  rule recorded in db/README: never edit an already-applied migration in production; add a new one.
