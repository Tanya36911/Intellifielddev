# Phase 2: Hierarchy + Scope Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the org hierarchy (3 tables) and the scope-follows-pin security guard for the Intelli backend, proven by a mandatory pytest isolation gate that must pass before anything builds on top.

**Architecture:** A new migration creates `org_level_definitions`, `nodes` (materialized text `path`, indexed for prefix lookups), and `assignments` (the pin). A single shared FastAPI dependency (`get_scoped_repo` in `scope.py`) reads the caller's JWT, looks up their pinned node's path, and returns a `ScopedRepo`, the one object allowed to query scoped tables, which auto-adds `WHERE tenant_id = :me AND path LIKE :scope || '%'`. A `GET /nodes` route proves it end to end. Tests run with pytest + Starlette TestClient against a throwaway `intelli_test` Postgres database inside the existing db container.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 + psycopg 3, Postgres 18, dbmate migrations, pytest + httpx (via FastAPI's TestClient). Spec: `docs/superpowers/specs/2026-06-15-phase-2-hierarchy-scope-guard-design.md`.

**House rules (every commit):** run from repo root `/Users/tanyajustin/Documents/intelli-app`. No em dashes anywhere (code, comments, commit messages). Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**Demo data this plan seeds (memorize, the tests depend on it):**
- Tenant **Lumen** (code `lumen`), 8 nodes: `Lumen Beauty`(root) > `West` > `Bay Area` > {`SF store`[CVS], `Oakland store`[Walmart]}, and `Lumen Beauty` > `Central` > `Chicago` > `Chicago store`[CVS].
- Tenant **Acme** (code `acme`), 4 nodes: `Acme Cosmetics`(root) > `East` > `Boston` > `Boston store`[CVS].
- Users (all password `demo1234`): `dana@lumenbeauty.com` (admin, pinned at Lumen root), `sarah@lumenbeauty.com` (manager, pinned at Central), `marcus@lumenbeauty.com` (rep, pinned at Bay Area), `newbie@lumenbeauty.com` (rep, NO pin), `avery@acme.com` (admin, pinned at Acme root).
- Scope rule = pinned node AND everything below it. So Dana sees 8 Lumen nodes; Sarah sees 3 (Central, Chicago, Chicago store); Marcus sees 3 (Bay Area, SF store, Oakland store); newbie sees 0; Avery sees 4 Acme nodes; nobody sees another tenant's nodes.

---

### Task 1: Migration for the three hierarchy tables

**Files:**
- Create: `db/migrations/20260615000001_create_hierarchy.sql`

- [ ] **Step 1: Write the migration**

Create `db/migrations/20260615000001_create_hierarchy.sql`:
```sql
-- migrate:up

-- The names of the org-chart levels for a tenant (configurable per tenant).
-- Lumen example: 0 Company, 1 Region, 2 District, 3 Store.
create table org_level_definitions (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    level_order int not null,
    name        text not null,
    locked      boolean not null default false,
    unique (tenant_id, level_order)
);

-- The org tree. One row per spot (company root, region, district, store).
-- path is a materialized trail of ids from the top down to this node, like
-- /<rootid>/<regionid>/<districtid>/ , always starting and ending with a
-- slash. The subtree under a node X is every row whose path starts with
-- X.path. The slashes stop a short id from matching a longer one.
create table nodes (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    parent_id   uuid references nodes(id),
    level_order int not null,
    name        text not null,
    code        text not null,
    path        text not null default '',
    chain       text,
    address     text,
    lat         double precision,
    lng         double precision,
    tz          text,
    created_at  timestamptz not null default now(),
    unique (tenant_id, code)
);

-- "everything under here" prefix lookups: text_pattern_ops makes the btree
-- usable for path LIKE 'prefix%'.
create index nodes_path_idx on nodes (path text_pattern_ops);
create index nodes_tenant_parent_idx on nodes (tenant_id, parent_id);

-- The pin: which user sits at which node. One per user in v1.
create table assignments (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    user_id     uuid not null references users(id),
    node_id     uuid not null references nodes(id),
    created_at  timestamptz not null default now(),
    unique (tenant_id, user_id)
);

-- migrate:down
drop table assignments;
drop table nodes;
drop table org_level_definitions;
```

- [ ] **Step 2: Apply the migration to the dev database**

Run: `docker compose run --rm migrate up`
Expected: output shows `Applying: 20260615000001_create_hierarchy.sql` and finishes without error.

- [ ] **Step 3: Verify the tables exist**

Run:
```bash
docker compose exec -T db psql -U intelli -d intelli -c "\dt"
```
Expected: the list includes `assignments`, `nodes`, `org_level_definitions` (alongside `tenants`, `users`, `schema_migrations`).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/20260615000001_create_hierarchy.sql db/schema.sql
git commit -m "Phase 2: migration for org hierarchy (level defs, nodes with path, assignments)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
(Note: `docker compose run --rm migrate up` regenerates `db/schema.sql`; include it.)

---

### Task 2: Extend the seed with the two-tenant tree and pins

**Files:**
- Modify: `api/app/seed.py` (full replacement)

- [ ] **Step 1: Replace seed.py**

Replace the full contents of `api/app/seed.py` with:
```python
"""Seed demo tenants, the org tree, users, and their pins, so you can log in
and so the isolation tests have a known world to check.

Run after migrations:
    docker compose exec api python -m app.seed

Idempotent: running it twice will not create duplicates.

The world it builds (scope = a pinned node AND everything below it):
  Lumen Beauty (tenant 'lumen')           Acme Cosmetics (tenant 'acme')
    West > Bay Area > SF[CVS], Oakland[Walmart]   East > Boston > Boston store[CVS]
    Central > Chicago > Chicago store[CVS]
  Users (password demo1234):
    dana@lumenbeauty.com   admin   pinned at Lumen root
    sarah@lumenbeauty.com  manager pinned at Central
    marcus@lumenbeauty.com rep     pinned at Bay Area
    newbie@lumenbeauty.com rep     NO pin (sees nothing)
    avery@acme.com         admin   pinned at Acme root
"""
from sqlalchemy import text

from .db import engine
from .security import hash_password

LEVELS = ["Company", "Region", "District", "Store"]


def _tenant(conn, name, code):
    return conn.execute(
        text(
            "insert into tenants (name, code) values (:name, :code) "
            "on conflict (code) do update set name = excluded.name returning id"
        ),
        {"name": name, "code": code},
    ).scalar()


def _levels(conn, tenant_id):
    for order, name in enumerate(LEVELS):
        locked = order in (0, len(LEVELS) - 1)
        conn.execute(
            text(
                "insert into org_level_definitions (tenant_id, level_order, name, locked) "
                "values (:tid, :lo, :name, :locked) "
                "on conflict (tenant_id, level_order) do update set name = excluded.name"
            ),
            {"tid": tenant_id, "lo": order, "name": name, "locked": locked},
        )


def _node(conn, tenant_id, parent, level_order, name, code, **store):
    """Insert (or update) a node and set its materialized path. parent is the
    dict returned for the parent node, or None for a root."""
    node_id = conn.execute(
        text(
            "insert into nodes (tenant_id, parent_id, level_order, name, code, "
            "chain, address, lat, lng, tz) "
            "values (:tid, :pid, :lo, :name, :code, :chain, :address, :lat, :lng, :tz) "
            "on conflict (tenant_id, code) do update set name = excluded.name, "
            "parent_id = excluded.parent_id, level_order = excluded.level_order, "
            "chain = excluded.chain returning id"
        ),
        {
            "tid": tenant_id,
            "pid": parent["id"] if parent else None,
            "lo": level_order,
            "name": name,
            "code": code,
            "chain": store.get("chain"),
            "address": store.get("address"),
            "lat": store.get("lat"),
            "lng": store.get("lng"),
            "tz": store.get("tz"),
        },
    ).scalar()
    parent_path = parent["path"] if parent else "/"
    path = f"{parent_path}{node_id}/"
    conn.execute(
        text("update nodes set path = :path where id = :id"),
        {"path": path, "id": node_id},
    )
    return {"id": node_id, "path": path}


def _user(conn, tenant_id, email, name, role, node):
    """Insert (or update) a user and pin them to node (or no pin if node None)."""
    user_id = conn.execute(
        text(
            "insert into users (tenant_id, email, name, role, password_hash) "
            "values (:tid, :email, :name, :role, :ph) "
            "on conflict (tenant_id, email) do update set name = excluded.name, "
            "role = excluded.role returning id"
        ),
        {"tid": tenant_id, "email": email, "name": name, "role": role,
         "ph": hash_password("demo1234")},
    ).scalar()
    if node is not None:
        conn.execute(
            text(
                "insert into assignments (tenant_id, user_id, node_id) "
                "values (:tid, :uid, :nid) "
                "on conflict (tenant_id, user_id) do update set node_id = excluded.node_id"
            ),
            {"tid": tenant_id, "uid": user_id, "nid": node["id"]},
        )
    return user_id


def run() -> None:
    with engine.begin() as conn:
        # ----- Lumen Beauty -----
        lumen = _tenant(conn, "Lumen Beauty", "lumen")
        _levels(conn, lumen)
        l_root = _node(conn, lumen, None, 0, "Lumen Beauty", "lumen-co")
        west = _node(conn, lumen, l_root, 1, "West", "west")
        bayarea = _node(conn, lumen, west, 2, "Bay Area", "bayarea")
        _node(conn, lumen, bayarea, 3, "SF store", "sf", chain="CVS")
        _node(conn, lumen, bayarea, 3, "Oakland store", "oakland", chain="Walmart")
        central = _node(conn, lumen, l_root, 1, "Central", "central")
        chicago = _node(conn, lumen, central, 2, "Chicago", "chicago")
        _node(conn, lumen, chicago, 3, "Chicago store", "chicago-store", chain="CVS")

        _user(conn, lumen, "dana@lumenbeauty.com", "Dana Whitfield", "admin", l_root)
        _user(conn, lumen, "sarah@lumenbeauty.com", "Sarah Mitchell", "manager", central)
        _user(conn, lumen, "marcus@lumenbeauty.com", "Marcus Bell", "rep", bayarea)
        _user(conn, lumen, "newbie@lumenbeauty.com", "Newbie NoPin", "rep", None)

        # ----- Acme Cosmetics (proves cross-tenant isolation) -----
        acme = _tenant(conn, "Acme Cosmetics", "acme")
        _levels(conn, acme)
        a_root = _node(conn, acme, None, 0, "Acme Cosmetics", "acme-co")
        east = _node(conn, acme, a_root, 1, "East", "east")
        boston = _node(conn, acme, east, 2, "Boston", "boston")
        _node(conn, acme, boston, 3, "Boston store", "boston-store", chain="CVS")

        _user(conn, acme, "avery@acme.com", "Avery Stone", "admin", a_root)

    print("Seeded Lumen (8 nodes) + Acme (4 nodes) + 5 users with pins.")


if __name__ == "__main__":
    run()
```

- [ ] **Step 2: Run the seed against the dev database**

Run: `docker compose exec api python -m app.seed`
Expected: `Seeded Lumen (8 nodes) + Acme (4 nodes) + 5 users with pins.`

- [ ] **Step 3: Spot-check the data**

Run:
```bash
docker compose exec -T db psql -U intelli -d intelli -c "select t.code, count(*) from nodes n join tenants t on t.id=n.tenant_id group by t.code;"
```
Expected: `lumen | 8` and `acme | 4`.

- [ ] **Step 4: Commit**

```bash
git add api/app/seed.py
git commit -m "Phase 2: seed the two-tenant demo tree (Lumen + Acme) with pins for 5 users

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Backend test harness (pytest in Docker against a throwaway test DB)

**Files:**
- Modify: `api/Dockerfile` (add pytest + httpx)
- Modify: `docker-compose.yml` (mount code, tests, and migrations into the api container)
- Modify: `package.json` (root; add `test:api` shortcut)
- Create: `api/tests/conftest.py`
- Create: `api/tests/test_harness_smoke.py`

- [ ] **Step 1: Add the test tools to the backend image**

In `api/Dockerfile`, change the dependency install command to add pytest and httpx (the last two lines of the `RUN uv pip install` block):
```dockerfile
RUN pip install --no-cache-dir uv

WORKDIR /app

# install deps first (better layer caching)
COPY pyproject.toml ./
RUN uv pip install --system --no-cache \
    "fastapi>=0.115" "uvicorn[standard]>=0.30" \
    "sqlalchemy>=2.0" "psycopg[binary]>=3.2" "pydantic>=2.7" \
    "passlib[argon2]>=1.7" "pyjwt>=2.9" \
    "pytest>=8" "httpx>=0.27"
```

- [ ] **Step 2: Mount code, tests, and migrations into the api container**

In `docker-compose.yml`, add a `volumes` block to the `api` service (right after the `environment` block, before `ports`):
```yaml
  api:
    build: ./api
    container_name: intelli-api
    environment:
      DATABASE_URL: postgresql+psycopg://intelli:intelli_dev@db:5432/intelli
    volumes:
      # Live code + tests + migrations, so tests can run in-container and
      # code changes need only a restart, not a full rebuild.
      - ./api/app:/app/app
      - ./api/tests:/app/tests
      - ./db:/app/db:ro
    ports:
      - "8000:8000"
    depends_on:
      db:
        condition: service_healthy
```

- [ ] **Step 3: Create the test harness**

Create `api/tests/conftest.py`:
```python
"""Test setup: build a throwaway 'intelli_test' database, apply the real
migrations, seed the demo world, and hand tests a client + helpers.

Runs against a REAL Postgres (the db container), never SQLite, so the
path-prefix lookups behave exactly as in production. The test database is
separate from your dev data and rebuilt fresh each test session.
"""
import os
import pathlib

import psycopg
import pytest

# Point the app at the TEST database before any app module is imported.
_ADMIN = "host=db port=5432 user=intelli password=intelli_dev"
os.environ["DATABASE_URL"] = "postgresql+psycopg://intelli:intelli_dev@db:5432/intelli_test"

MIGRATIONS = pathlib.Path("/app/db/migrations")


def _statements(sql: str):
    """Yield individual SQL statements, dropping comment-only lines."""
    for chunk in sql.split(";"):
        lines = [ln for ln in chunk.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        if lines:
            yield "\n".join(lines)


def _build_test_db() -> None:
    # Fresh, empty test database (force-close any open connections).
    with psycopg.connect(f"{_ADMIN} dbname=intelli", autocommit=True) as conn:
        conn.execute("drop database if exists intelli_test with (force)")
        conn.execute("create database intelli_test")
    # Apply every migration's up-section, in filename order.
    with psycopg.connect(f"{_ADMIN} dbname=intelli_test", autocommit=True) as conn:
        for path in sorted(MIGRATIONS.glob("*.sql")):
            up = path.read_text().split("-- migrate:down")[0]
            for stmt in _statements(up):
                conn.execute(stmt)


@pytest.fixture(scope="session", autouse=True)
def _database():
    _build_test_db()
    from app.seed import run  # imported after env points at the test DB
    run()
    yield


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


@pytest.fixture()
def users():
    """email -> {id, tenant_id, email, role} for the seeded users."""
    from sqlalchemy import text
    from app.db import engine
    with engine.connect() as conn:
        rows = conn.execute(text("select id, tenant_id, email, role from users")).mappings().all()
    return {r["email"]: dict(r) for r in rows}


@pytest.fixture()
def login(client):
    """Returns a helper that logs in through the real API and returns the
    wristband (JWT). Used by the through-the-API tests."""
    def _login(email, password="demo1234"):
        resp = client.post("/auth/login", json={"email": email, "password": password})
        assert resp.status_code == 200, resp.text
        return resp.json()["token"]
    return _login
```

Create `api/tests/test_harness_smoke.py`:
```python
from sqlalchemy import text
from app.db import engine


def test_seed_built_the_two_trees():
    with engine.connect() as conn:
        counts = dict(
            conn.execute(
                text(
                    "select t.code, count(*) from nodes n "
                    "join tenants t on t.id = n.tenant_id group by t.code"
                )
            ).all()
        )
    assert counts == {"lumen": 8, "acme": 4}


def test_login_still_works(client):
    resp = client.post(
        "/auth/login",
        json={"email": "dana@lumenbeauty.com", "password": "demo1234"},
    )
    assert resp.status_code == 200
    assert resp.json()["user"]["name"] == "Dana Whitfield"
```

- [ ] **Step 4: Add the run shortcut**

In the root `package.json`, add to `"scripts"` (after `"test:admin"`):
```json
"test:api": "docker compose exec -T api pytest -q",
```

- [ ] **Step 5: Rebuild the image (gets pytest + the new mounts) and run the harness**

Run:
```bash
docker compose up -d --build api
docker compose exec -T api pytest -q
```
Expected: `2 passed`. If the api container is not up, `docker compose up -d` first.

- [ ] **Step 6: Commit**

```bash
git add api/Dockerfile docker-compose.yml package.json api/tests/conftest.py api/tests/test_harness_smoke.py
git commit -m "Phase 2: backend test harness (pytest in Docker vs throwaway intelli_test DB)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: "Who is calling" helper (verify the JWT on a request)

**Files:**
- Modify: `api/app/security.py` (add imports + `current_claims`)
- Create: `api/tests/test_current_claims.py`

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_current_claims.py`:
```python
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.security import current_claims, make_token


@pytest.fixture()
def tiny_app():
    app = FastAPI()

    @app.get("/whoami")
    def whoami(claims: dict = Depends(current_claims)) -> dict:
        return {"sub": claims["sub"], "role": claims["role"]}

    return TestClient(app)


def test_valid_token_passes(tiny_app):
    token = make_token("user-1", "tenant-1", "admin")
    resp = tiny_app.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"sub": "user-1", "role": "admin"}


def test_missing_token_is_401(tiny_app):
    resp = tiny_app.get("/whoami")
    assert resp.status_code == 401


def test_garbage_token_is_401(tiny_app):
    resp = tiny_app.get("/whoami", headers={"Authorization": "Bearer not-a-token"})
    assert resp.status_code == 401
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose exec -T api pytest api/tests/test_current_claims.py -q`
Expected: FAIL with an ImportError (cannot import name `current_claims`).

- [ ] **Step 3: Add current_claims to security.py**

In `api/app/security.py`, add these imports at the top (after the existing imports):
```python
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
```

Then add at the end of the file:
```python
_bearer = HTTPBearer(auto_error=False)


def current_claims(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Verify the caller's wristband (JWT) on an incoming request and return
    its contents. Raises 401 if it is missing, invalid, or expired."""
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return read_token(creds.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
```

- [ ] **Step 4: Restart the api (code is mounted live) and run the test**

Run:
```bash
docker compose restart api
docker compose exec -T api pytest api/tests/test_current_claims.py -q
```
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add api/app/security.py api/tests/test_current_claims.py
git commit -m "Phase 2: current_claims dependency (verify the JWT on a request, 401 otherwise)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: The scope guard and ScopedRepo (the core, with the isolation gate at the repo level)

**Files:**
- Create: `api/app/scope.py`
- Create: `api/tests/test_scope_isolation.py`

- [ ] **Step 1: Write the failing isolation tests FIRST**

Create `api/tests/test_scope_isolation.py`:
```python
"""THE GATE (repo level). Scope follows the pin: a caller sees only their
pinned node and everything below it, within their own tenant. Nothing else
builds on Phase 2 until these pass.
"""
from app.scope import ScopedRepo, scope_path_for


def _repo_for(users, email):
    u = users[email]
    return ScopedRepo(u["tenant_id"], scope_path_for(u["tenant_id"], u["id"]))


def _names(repo):
    return {n["name"] for n in repo.list_nodes()}


def test_admin_sees_whole_own_tenant(users):
    names = _names(_repo_for(users, "dana@lumenbeauty.com"))
    assert names == {
        "Lumen Beauty", "West", "Bay Area", "SF store", "Oakland store",
        "Central", "Chicago", "Chicago store",
    }


def test_admin_sees_zero_of_other_tenant(users):
    names = _names(_repo_for(users, "dana@lumenbeauty.com"))
    assert "Acme Cosmetics" not in names
    assert "Boston store" not in names


def test_manager_sees_only_their_branch(users):
    names = _names(_repo_for(users, "sarah@lumenbeauty.com"))
    assert names == {"Central", "Chicago", "Chicago store"}


def test_manager_sees_zero_of_sibling_region(users):
    names = _names(_repo_for(users, "sarah@lumenbeauty.com"))
    for west_node in ("West", "Bay Area", "SF store", "Oakland store"):
        assert west_node not in names


def test_rep_sees_only_their_stores(users):
    names = _names(_repo_for(users, "marcus@lumenbeauty.com"))
    assert names == {"Bay Area", "SF store", "Oakland store"}


def test_acme_admin_sees_only_acme(users):
    names = _names(_repo_for(users, "avery@acme.com"))
    assert names == {"Acme Cosmetics", "East", "Boston", "Boston store"}


def test_no_pin_sees_nothing(users):
    assert _names(_repo_for(users, "newbie@lumenbeauty.com")) == set()
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose exec -T api pytest api/tests/test_scope_isolation.py -q`
Expected: FAIL with ImportError (no module named `app.scope`).

- [ ] **Step 3: Write scope.py**

Create `api/app/scope.py`:
```python
"""The scope guard: scope follows the pin.

Every request for scoped data goes through get_scoped_repo, which reads the
caller's wristband (JWT), looks up the node they are pinned to, and returns a
ScopedRepo. The ScopedRepo is the ONLY object allowed to query scoped tables;
it automatically limits every query to the caller's tenant and the subtree
under their pinned node, so no endpoint can forget the filter.
"""
from fastapi import Depends
from sqlalchemy import text

from .db import engine
from .security import current_claims


class ScopedRepo:
    """The only object allowed to read scoped tables. tenant_id and scope_path
    are baked in; a scope_path of None means the caller sees nothing."""

    def __init__(self, tenant_id: str, scope_path: str | None):
        self.tenant_id = tenant_id
        self.scope_path = scope_path

    def list_nodes(self) -> list[dict]:
        if self.scope_path is None:
            return []
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "select id, name, code, level_order, parent_id, path, "
                    "chain, address, lat, lng, tz from nodes "
                    # cast(:tid as uuid) so a tenant id arriving as text (from
                    # the JWT) compares cleanly against the uuid column.
                    "where tenant_id = cast(:tid as uuid) and path like :scope || '%' "
                    "order by path"
                ),
                {"tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().all()
        return [dict(r) for r in rows]


def scope_path_for(tenant_id: str, user_id: str) -> str | None:
    """The path of the node a user is pinned to (their scope), or None if the
    user has no pin."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "select n.path from assignments a "
                "join nodes n on n.id = a.node_id "
                "where a.tenant_id = cast(:tid as uuid) and a.user_id = cast(:uid as uuid)"
            ),
            {"tid": str(tenant_id), "uid": str(user_id)},
        ).mappings().first()
    return row["path"] if row else None


def get_scoped_repo(claims: dict = Depends(current_claims)) -> ScopedRepo:
    """FastAPI dependency: build the caller's ScopedRepo from their wristband."""
    tenant_id = claims["tenant_id"]
    user_id = claims["sub"]
    return ScopedRepo(tenant_id, scope_path_for(tenant_id, user_id))
```

- [ ] **Step 4: Run the gate (repo level) to verify it passes**

Run: `docker compose exec -T api pytest api/tests/test_scope_isolation.py -q`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add api/app/scope.py api/tests/test_scope_isolation.py
git commit -m "Phase 2: scope guard + ScopedRepo, the repo-level isolation gate (7 tests green)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: GET /nodes and the same gate through the real API

**Files:**
- Create: `api/app/hierarchy.py`
- Modify: `api/app/main.py` (include the router)
- Create: `api/tests/test_nodes_api.py`

- [ ] **Step 1: Write the failing API tests FIRST**

Create `api/tests/test_nodes_api.py`:
```python
"""THE GATE (through the real API). Same isolation rules as the repo-level
tests, but proven end to end via GET /nodes with each user's real wristband.
"""


def _node_names(client, token):
    resp = client.get("/nodes", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return {n["name"] for n in resp.json()["nodes"]}


def test_api_admin_sees_whole_tenant_and_no_other(client, login):
    names = _node_names(client, login("dana@lumenbeauty.com"))
    assert "Lumen Beauty" in names and "Chicago store" in names
    assert "Acme Cosmetics" not in names and "Boston store" not in names


def test_api_manager_only_their_branch(client, login):
    names = _node_names(client, login("sarah@lumenbeauty.com"))
    assert names == {"Central", "Chicago", "Chicago store"}


def test_api_rep_only_their_stores(client, login):
    names = _node_names(client, login("marcus@lumenbeauty.com"))
    assert names == {"Bay Area", "SF store", "Oakland store"}


def test_api_acme_admin_only_acme(client, login):
    names = _node_names(client, login("avery@acme.com"))
    assert names == {"Acme Cosmetics", "East", "Boston", "Boston store"}


def test_api_no_pin_sees_nothing(client, login):
    names = _node_names(client, login("newbie@lumenbeauty.com"))
    assert names == set()


def test_api_requires_a_token(client):
    resp = client.get("/nodes")
    assert resp.status_code == 401
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose exec -T api pytest api/tests/test_nodes_api.py -q`
Expected: FAIL (GET /nodes returns 404, route does not exist yet).

- [ ] **Step 3: Write the router and wire it in**

Create `api/app/hierarchy.py`:
```python
"""The hierarchy API. GET /nodes returns the slice of the org tree the caller
is allowed to see, proving the scope guard holds end to end."""
from fastapi import APIRouter, Depends

from .scope import ScopedRepo, get_scoped_repo

router = APIRouter(tags=["hierarchy"])


@router.get("/nodes")
def list_nodes(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    nodes = repo.list_nodes()
    return {"nodes": nodes, "count": len(nodes)}
```

In `api/app/main.py`, add the import next to the existing auth import:
```python
from .auth import router as auth_router
from .hierarchy import router as hierarchy_router
from .db import db_ok
```
And add the include next to the existing `app.include_router(auth_router)`:
```python
app.include_router(auth_router)
app.include_router(hierarchy_router)
```

- [ ] **Step 4: Restart the api and run the API gate**

Run:
```bash
docker compose restart api
docker compose exec -T api pytest api/tests/test_nodes_api.py -q
```
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add api/app/hierarchy.py api/app/main.py api/tests/test_nodes_api.py
git commit -m "Phase 2: GET /nodes (scoped) + the same isolation gate through the real API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full verification (the whole gate, plus a live cross-user check)

**Files:** none created; verification only.

- [ ] **Step 1: Run the entire backend test suite**

Run: `docker compose exec -T api pytest -q`
Expected: all tests pass (harness 2 + current_claims 3 + scope isolation 7 + nodes api 6 = 18).

- [ ] **Step 2: Confirm the frontend tests still pass**

Run: `pnpm test:admin`
Expected: `Tests  27 passed (27)`.

- [ ] **Step 3: Live cross-user check through the running API**

Run:
```bash
SARAH=$(curl -s -X POST http://localhost:8000/auth/login -H 'Content-Type: application/json' -d '{"email":"sarah@lumenbeauty.com","password":"demo1234"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
echo "Sarah (Central manager) sees:"
curl -s http://localhost:8000/nodes -H "Authorization: Bearer $SARAH" | python3 -c "import sys,json;d=json.load(sys.stdin);print(' count:',d['count']);print(' names:',sorted(n['name'] for n in d['nodes']))"
```
Expected: count 3, names `['Central', 'Chicago', 'Chicago store']` (no West, no Acme).

- [ ] **Step 4: Confirm the no-token case is refused live**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/nodes`
Expected: `401`.

- [ ] **Step 5: Commit (only if a fix was needed during verification)**

```bash
git add -A api
git commit -m "Phase 2: fixes found during full verification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Update all the documentation (Tanya's standing rule)

**Files:**
- Modify: `api/README.md`, `db/README.md`, `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`
- Modify: `../hi-fi-intelli/Intelli_Complete_Handoff.md` (separate repo, separate commit)

- [ ] **Step 1: Update api/README.md**

Add to the "Every file in this folder" section of `api/README.md`, after the `app/seed.py` entry:
```markdown
### app/scope.py  (the scope guard: you only see your own branch)
The single checkpoint that keeps companies and branches separate. For any
request that reads org data, it reads the caller's wristband, looks up the node
they are pinned to, and hands back a ScopedRepo: the only object allowed to read
the scoped tables. Every query the ScopedRepo runs is automatically limited to
the caller's company and the part of the tree at or below their pin. Because the
filter lives only here, no screen can forget it.

### app/hierarchy.py  (the org-tree API)
Defines GET /nodes, which returns the slice of the org tree the caller is
allowed to see, using the ScopedRepo. This is the live proof the scope guard
works end to end.
```
And in the same file, update the `app/seed.py` entry to mention it now seeds the two-tenant tree and pins, and add a line to the `app/security.py` entry noting it also has `current_claims` (the "who is calling" check used by the scope guard).

- [ ] **Step 2: Update db/README.md**

In `db/README.md`, under "Every file in this folder", add after the first migration entry:
```markdown
### migrations/20260615000001_create_hierarchy.sql
The second renovation order. It adds the org chart: **org_level_definitions**
(the level names per company, like Company / Region / District / Store),
**nodes** (the tree itself, each row carrying a "path" that makes "everything
under here" a fast lookup, plus store-only columns including chain), and
**assignments** (the pin: which user sits at which node). These are what the
scope guard reads to decide who can see what.
```
And in the "What comes later" section, change the Phase 2 sentence to past tense noting it is now built.

- [ ] **Step 3: Update CODEBASE_MAP.md**

In `CODEBASE_MAP.md`, in the section 3 login walkthrough, leave as is, and in section 2's table the `api/` row already covers the backend. Add one sentence to the end of section 1 (after the diagram) :
```markdown
As of Phase 2, the backend also enforces "scope follows the pin": every person
is pinned to one spot on their company's org tree and can see only that spot and
below, never another company. That rule lives in one file (`api/app/scope.py`).
```

- [ ] **Step 4: Update CHECKING_THE_WORK.md**

In `CHECKING_THE_WORK.md`, under "Check 1: The test robot", add a second paragraph:
```markdown
The backend now has its own robot too. With the backend running, run
`pnpm test:api` (or `docker compose exec api pytest -q`). GOOD looks like all
tests passing, including the isolation checks that prove one company cannot see
another company's data and a manager cannot see a sibling region. If any go red,
copy the text to me.
```

- [ ] **Step 5: Update START_HERE.md**

Three edits to `START_HERE.md`:
(a) In section 1, add a new block after the Phase 1 screen block:
```markdown
**Phase 2 - the org chart + the "see only your branch" rule (done):**
- Every company now has an org tree (regions, districts, stores), and each
  person is pinned to one spot. A new safety checkpoint guarantees you can see
  only your spot and everything below it, never another company's data and never
  a sibling branch. This is the security backbone of the whole product.
- Chain (CVS, Walmart) is a label on each store, so you can view and target
  stores by chain across the company.
- Proven by a backend test robot whose isolation checks must pass: one company
  sees zero of another, a regional manager sees zero of a sibling region, a rep
  sees only their stores.
- This phase has no new screen. The org-chart screens come in a later phase.
```
Remove the now-outdated "What's NEXT: Phase 2 ..." line from the Phase 1 block.

(b) In section 4's command table, add a row:
```markdown
| Run the BACKEND test robot | `pnpm test:api` (backend must be running) |
```
And change the "Rebuild backend after code changes" row's command note: backend code is now mounted live, so most code changes need only `docker compose restart api`; rebuild (`docker compose up -d --build api`) only when dependencies change.

(c) In section 7, update to:
```markdown
## 7. Where we are right now
- Backend login + Admin login screen: DONE and tested.
- Org hierarchy + "see only your branch" scope guard: DONE and tested (backend
  isolation robot green).
- Phases 1 and 2 complete. NEXT: Phase 3 (catalog + surveys + versions).
- Everything is committed to git, so any step can be undone.
```

(d) In section 5's file tree, add the two new backend files under `app/`:
```
│       ├── scope.py      The "see only your branch" guard (scope follows pin)
│       ├── hierarchy.py  GET /nodes (the scoped org-tree API)
```
and add `└── tests/        Backend test robot (pytest), incl. the isolation gate` under `api/`.

- [ ] **Step 6: Update CONTEXT.md**

(a) Mark Phase 2 done in the build order:
```markdown
- [x] **Phase 2** - hierarchy + scope guard. Done: org_level_definitions, nodes (materialized path), assignments; one shared ScopedRepo enforces tenant + pinned-subtree on every query; GET /nodes. Gate MET: isolation tests pass (tenant, sibling region, rep, admin reach, no-pin), both at the repo level and through the API.
```
(b) Append to the progress log:
```markdown
- 2026-06-15: Phase 2 - org hierarchy + scope-follows-pin guard. Migration for
  org_level_definitions + nodes (materialized text path, prefix-indexed) +
  assignments. Shared FastAPI ScopedRepo auto-filters every scoped query to
  tenant + pinned-node subtree; current_claims verifies the JWT per request;
  GET /nodes is the first scoped endpoint. Seed builds a 2-tenant world (Lumen 8
  nodes, Acme 4) with 5 pinned/unpinned users. Backend test harness added
  (pytest + TestClient vs a throwaway intelli_test Postgres). MANDATORY GATE
  GREEN: 18 backend tests incl. cross-tenant, sibling-region, rep, and no-pin
  isolation, checked on the ScopedRepo and through the API. Chain kept as a
  store label (parallel chain hierarchy deferred). Phase 3 next.
```

- [ ] **Step 7: Commit the intelli-app docs**

```bash
git add api/README.md db/README.md CODEBASE_MAP.md CHECKING_THE_WORK.md START_HERE.md CONTEXT.md
git commit -m "Docs: Phase 2 complete (hierarchy + scope guard); guides, map, checks updated

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Update the prototype handoff CHANGELOG (sibling repo)**

In `../hi-fi-intelli/Intelli_Complete_Handoff.md`, add at the top of the CHANGELOG (right after the italic note line), matching the no-em-dash style (colon after the bold date):
```markdown
**2026-06-15 (production: Phase 2 complete):** The production repo finished Phase 2, the security backbone. Org hierarchy (org_level_definitions, nodes with an indexed materialized path, assignments as the pin) plus the scope-follows-pin guard: one shared FastAPI ScopedRepo auto-limits every scoped query to the caller's tenant and pinned-node subtree, with GET /nodes as the first scoped endpoint. The MANDATORY isolation gate is green (18 backend pytest checks: cross-tenant, sibling-region, rep, admin-reach, and no-pin, verified both on the ScopedRepo and through the API). Chain confirmed as a store attribute/label (a parallel chain hierarchy for chain-assigned managers is a deliberate later phase, per PART 8). Backend now has a pytest harness against a throwaway Postgres. Spec + plan in intelli-app/docs/superpowers/. Next: Phase 3 (catalog + surveys + immutable versions).
```

- [ ] **Step 9: Commit the handoff (sibling repo)**

```bash
cd /Users/tanyajustin/Documents/hi-fi-intelli
git add Intelli_Complete_Handoff.md
git commit -m "Handoff CHANGELOG: production Phase 2 complete (hierarchy + scope guard)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
cd /Users/tanyajustin/Documents/intelli-app
```
