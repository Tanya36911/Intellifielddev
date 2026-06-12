# Intelli (production app)

The real build of Intelli, a multi-tenant CPG retail field-execution platform.
The visual and behavioral spec lives in the prototype repo (`hi-fi-intelli`);
this repo is the production implementation. See that repo's `TECH_STACK.txt`
and `Intelli_Complete_Handoff.md` for the full plan and decisions.

## Layout (pnpm monorepo)

```
packages/
  tokens        Design tokens (colors/spacing/type), ported from the prototype.
                Consumed by web (CSS) and mobile (TS). One source of truth.
apps/
  admin         Admin web app   (React + Vite)   [scaffolded]
  manager       Manager web app (React + Vite)   [later]
  field         Field mobile app (React Native + Expo) [later]
api/            FastAPI + Postgres backend (Python, uv)
docker-compose.yml   Runs the API + Postgres locally
```

## Build order (gated phases)

0. **Skeleton** (this) - monorepo, Docker (API + Postgres), shared tokens, blank web app.
1. Tenancy + auth.
2. Hierarchy + scope guard (the security spine; isolation tests are a hard gate).
3. Catalog + surveys + versions + assignments.
4. Responses + analytics + payroll + export.
5. Field app + offline sync.
6. AI shelf-scan (fast-follow, separate runway).

## Run it

Prereqs: Docker (OrbStack/Docker Desktop), Node 20+, pnpm, Python 3.12+.

```bash
# Backend + database
docker compose up --build          # API on http://localhost:8000

# Check it works
curl http://localhost:8000/health        # {"status":"ok",...}
curl http://localhost:8000/health/db     # {"database":"ok"}

# Web (Admin)
pnpm install
pnpm dev:admin                     # http://localhost:5173
```
