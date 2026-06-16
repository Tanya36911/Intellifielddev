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
- [ ] **Phase 4** - responses + analytics + payroll + export.
- [ ] **Phase 5** - Field app + offline sync.
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
- 2026-06-15: DB script hardening (senior-DBA pass). All three migrations rewritten to be
  self-protecting: `-- migrate:up transaction:false` + explicit begin/commit + `set local
  timezone='UTC'` (and same for down), so each file is atomic and UTC-correct under dbmate OR
  hand-run psql. Stop-on-error is enforced by the runner (dbmate aborts; new scripts/db-migrate.sh
  uses set -e; manual psql uses -v ON_ERROR_STOP=1) since psql \set is not valid inside a dbmate
  file. conftest now applies each migration as one whole script (removed the home-grown
  semicolon splitter; Postgres parses statement boundaries). Verified: 32 backend tests green,
  dbmate down+up of the latest migration succeeds with the new format, schema unchanged. Authoring
  rule recorded in db/README: never edit an already-applied migration in production; add a new one.
