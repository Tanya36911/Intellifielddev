#!/usr/bin/env bash
# Apply pending database migrations safely. Use this for deploys and manual runs.
#
# Why this is safe:
#  - set -euo pipefail: the script stops on the first error (nothing half-runs).
#  - dbmate applies each pending migration and records which ones already ran in
#    a schema_migrations table, so it never re-applies or double-applies. Running
#    it again when nothing is pending is a harmless no-op.
#  - Each migration file also carries its own BEGIN/COMMIT and SET timezone='UTC',
#    so a single file is still all-or-nothing and UTC-correct even if someone
#    ever runs it by hand with psql.
#
# Local use (Docker):                 bash scripts/db-migrate.sh
# Production (dbmate binary on host):  DATABASE_URL=... dbmate up
# Run ONE file by hand with stop-on-error:
#   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/<file>.sql
set -euo pipefail

echo "Applying pending database migrations (atomic, stop-on-error)..."
docker compose run --rm migrate up
echo "Done. Applied migrations are recorded in the schema_migrations table."
