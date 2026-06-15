# Phase 3a: Product Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the per-company product catalog (a `skus` table plus list/add/edit endpoints), company-wide-visible but admin-only-editable, proven by tests including company isolation and the first admins-only rule.

**Architecture:** A new migration adds `skus` (one row per sellable variant, unique per company by UPC). The existing shared ScopedRepo (the only object allowed to touch scoped tables) gains `list_skus` / `create_sku` / `update_sku`, all limited to the caller's company (company-wide, not branch-path filtered, since the catalog is shared reference data). A new `require_admin` dependency enforces admin-only writes. A new `catalog.py` router exposes `GET /skus` (any signed-in company user), `POST /skus` and `PATCH /skus/{id}` (admin only).

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 + psycopg 3, Postgres 18, dbmate migrations, pytest + FastAPI TestClient. Spec: `docs/superpowers/specs/2026-06-15-phase-3a-catalog-design.md`. Builds on Phase 2 (ScopedRepo in `api/app/scope.py`, `current_claims` in `api/app/security.py`, the pytest harness in `api/tests/`).

**House rules (every commit):** run from repo root `/Users/tanyajustin/Documents/intelli-app`. No em dashes anywhere. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**Reminders about the dev loop (from Phase 2):**
- Backend code is live-mounted; after changing `api/app/*.py` run `docker compose restart api` to apply it to the running server (no rebuild needed).
- Run backend tests with `docker compose exec -T api pytest -q` (the conftest rebuilds a throwaway `intelli_test` DB and seeds it each run).

**Demo products this plan seeds (the tests depend on them):**
- Lumen (4): Velvet Lip / Rosewood (`LUM-VL-ROSE`), Velvet Lip / Mauve (`LUM-VL-MAUVE`), Velvet Lip / Coral (`LUM-VL-CORAL`), Silk Foundation / Ivory (`LUM-SF-IVORY`).
- Acme (1): Glow Serum / Original (`ACM-GS-ORIG`).

---

### Task 1: Migration for the skus table

**Files:**
- Create: `db/migrations/20260615000002_create_skus.sql`

- [ ] **Step 1: Write the migration**

Create `db/migrations/20260615000002_create_skus.sql`:
```sql
-- migrate:up

-- The product catalog. One row per sellable variant ("SKU"), e.g. Lumen's
-- Velvet Lip in Rosewood. Company-wide (every user in the tenant sees all of
-- its rows); never visible across tenants. Uniqueness is per tenant by UPC.
create table skus (
    id                uuid primary key default gen_random_uuid(),
    tenant_id         uuid not null references tenants(id),
    line              text not null,
    variant           text not null,
    upc               text not null,
    color             text,
    status            text not null default 'active'
                      check (status in ('active', 'discontinued')),
    reference_images  jsonb not null default '[]'::jsonb,
    created_at        timestamptz not null default now(),
    unique (tenant_id, upc)
);

create index skus_tenant_idx on skus (tenant_id);

-- migrate:down
drop table skus;
```

- [ ] **Step 2: Apply the migration to the dev database**

Run: `docker compose run --rm migrate up`
Expected: `Applying: 20260615000002_create_skus.sql` then `Applied: ...`, no error.

- [ ] **Step 3: Verify the table exists**

Run:
```bash
docker compose exec -T db psql -U intelli -d intelli -c "\d skus"
```
Expected: the column list shows `id, tenant_id, line, variant, upc, color, status, reference_images, created_at` and the `skus_tenant_id_upc_key` unique constraint.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/20260615000002_create_skus.sql db/schema.sql
git commit -m "Phase 3a: migration for the skus (product catalog) table

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Seed demo products

**Files:**
- Modify: `api/app/seed.py`

- [ ] **Step 1: Add a SKU helper**

In `api/app/seed.py`, add this helper after the existing `_user` function:
```python
def _sku(conn, tenant_id, line, variant, upc, color, status="active"):
    """Insert (or update) one catalog product."""
    conn.execute(
        text(
            "insert into skus (tenant_id, line, variant, upc, color, status, reference_images) "
            "values (:tid, :line, :variant, :upc, :color, :status, '[]'::jsonb) "
            "on conflict (tenant_id, upc) do update set line = excluded.line, "
            "variant = excluded.variant, color = excluded.color, status = excluded.status"
        ),
        {"tid": tenant_id, "line": line, "variant": variant, "upc": upc,
         "color": color, "status": status},
    )
```

- [ ] **Step 2: Seed Lumen and Acme products**

In `api/app/seed.py`, inside `run()`, add the Lumen products right after the Lumen users block (after the `_user(... "newbie@lumenbeauty.com" ...)` line):
```python
        _sku(conn, lumen, "Velvet Lip", "Rosewood", "LUM-VL-ROSE", "#9B5B5B")
        _sku(conn, lumen, "Velvet Lip", "Mauve", "LUM-VL-MAUVE", "#8B5E83")
        _sku(conn, lumen, "Velvet Lip", "Coral", "LUM-VL-CORAL", "#E5734D")
        _sku(conn, lumen, "Silk Foundation", "Ivory", "LUM-SF-IVORY", "#E8D3B8")
```
And add the Acme product right after the `_user(... "avery@acme.com" ...)` line:
```python
        _sku(conn, acme, "Glow Serum", "Original", "ACM-GS-ORIG", "#D8C7A0")
```

- [ ] **Step 3: Update the final print line**

In `api/app/seed.py`, change the final print statement to:
```python
    print("Seeded Lumen (8 nodes, 4 products) + Acme (4 nodes, 1 product) + 5 users with pins.")
```

- [ ] **Step 4: Run the seed and verify product counts**

Run:
```bash
docker compose exec -T api python -m app.seed
docker compose exec -T db psql -U intelli -d intelli -c "select t.code, count(*) from skus s join tenants t on t.id=s.tenant_id group by t.code order by t.code;"
```
Expected: seed prints the new line; the query shows `acme | 1` and `lumen | 4`.

- [ ] **Step 5: Commit**

```bash
git add api/app/seed.py
git commit -m "Phase 3a: seed demo catalog (4 Lumen products, 1 Acme product)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The "admins only" check (require_admin)

**Files:**
- Modify: `api/app/security.py`
- Create: `api/tests/test_require_admin.py`

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_require_admin.py`:
```python
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.security import make_token, require_admin


@pytest.fixture()
def tiny_app():
    app = FastAPI()

    @app.get("/admin-only")
    def admin_only(claims: dict = Depends(require_admin)) -> dict:
        return {"ok": True, "role": claims["role"]}

    return TestClient(app)


def test_admin_is_allowed(tiny_app):
    token = make_token("u1", "t1", "admin")
    resp = tiny_app.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_manager_is_forbidden(tiny_app):
    token = make_token("u1", "t1", "manager")
    resp = tiny_app.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_rep_is_forbidden(tiny_app):
    token = make_token("u1", "t1", "rep")
    resp = tiny_app.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_no_token_is_unauthorized(tiny_app):
    resp = tiny_app.get("/admin-only")
    assert resp.status_code == 401
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose exec -T api pytest tests/test_require_admin.py -q`
Expected: FAIL with ImportError (cannot import name `require_admin`).

- [ ] **Step 3: Add require_admin to security.py**

In `api/app/security.py`, add at the end of the file (after `current_claims`):
```python
def require_admin(claims: dict = Depends(current_claims)) -> dict:
    """Allow only admins past. Returns the caller's claims, or raises 403 for
    any non-admin (managers and reps). Used on catalog write endpoints."""
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return claims
```

- [ ] **Step 4: Restart the api and run the test**

Run:
```bash
docker compose restart api
docker compose exec -T api pytest tests/test_require_admin.py -q
```
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add api/app/security.py api/tests/test_require_admin.py
git commit -m "Phase 3a: require_admin dependency (403 for non-admins)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: The catalog (ScopedRepo methods + router) with its test gate

**Files:**
- Create: `api/tests/test_catalog.py`
- Modify: `api/app/scope.py` (add list_skus / create_sku / update_sku)
- Create: `api/app/catalog.py`
- Modify: `api/app/main.py` (include the catalog router)

- [ ] **Step 1: Write the failing tests FIRST**

Create `api/tests/test_catalog.py`:
```python
"""Phase 3a gate. The catalog is company-wide-visible but admin-only-editable,
and never leaks across companies.
"""


def _skus(client, token):
    resp = client.get("/skus", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_company_isolation_lumen(client, login):
    data = _skus(client, login("dana@lumenbeauty.com"))
    variants = {(s["line"], s["variant"]) for s in data["skus"]}
    assert ("Velvet Lip", "Rosewood") in variants
    assert all(s["line"] != "Glow Serum" for s in data["skus"])  # no Acme products
    assert data["count"] >= 4


def test_company_isolation_acme(client, login):
    data = _skus(client, login("avery@acme.com"))
    lines = {s["line"] for s in data["skus"]}
    assert "Glow Serum" in lines
    assert "Velvet Lip" not in lines  # no Lumen products


def test_admin_can_add_product(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/skus",
        headers={"Authorization": f"Bearer {token}"},
        json={"line": "Velvet Lip", "variant": "Plum", "upc": "LUM-VL-PLUM", "color": "#6B4E71"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["variant"] == "Plum"
    assert any(s["upc"] == "LUM-VL-PLUM" for s in _skus(client, token)["skus"])


def test_non_admin_cannot_add_product(client, login):
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        resp = client.post(
            "/skus",
            headers={"Authorization": f"Bearer {login(email)}"},
            json={"line": "Nope", "variant": "Nope", "upc": "NOPE-1", "color": None},
        )
        assert resp.status_code == 403, f"{email} got {resp.status_code}"


def test_admin_can_edit_status(client, login):
    token = login("dana@lumenbeauty.com")
    sku = _skus(client, token)["skus"][0]
    resp = client.patch(
        f"/skus/{sku['id']}",
        headers={"Authorization": f"Bearer {token}"},
        json={"status": "discontinued"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "discontinued"


def test_no_cross_company_edit(client, login):
    acme_sku = _skus(client, login("avery@acme.com"))["skus"][0]
    resp = client.patch(
        f"/skus/{acme_sku['id']}",
        headers={"Authorization": f"Bearer {login('dana@lumenbeauty.com')}"},
        json={"status": "discontinued"},
    )
    assert resp.status_code == 404


def test_listing_requires_auth(client):
    assert client.get("/skus").status_code == 401
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker compose exec -T api pytest tests/test_catalog.py -q`
Expected: FAIL (GET /skus returns 404, route does not exist yet).

- [ ] **Step 3: Add the catalog methods to ScopedRepo**

In `api/app/scope.py`, add `import json` at the top (with the other imports):
```python
import json

from fastapi import Depends
from sqlalchemy import text

from .db import engine
from .security import current_claims
```

Then add these three methods to the `ScopedRepo` class (after `list_nodes`):
```python
    # ----- catalog (company-wide: filtered by tenant only, not by path) -----

    _SKU_COLS = (
        "id, line, variant, upc, color, status, reference_images, created_at"
    )

    def list_skus(self) -> list[dict]:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"select {self._SKU_COLS} from skus "
                    "where tenant_id = cast(:tid as uuid) order by line, variant"
                ),
                {"tid": str(self.tenant_id)},
            ).mappings().all()
        return [dict(r) for r in rows]

    def create_sku(self, line, variant, upc, color, status, reference_images) -> dict:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    "insert into skus (tenant_id, line, variant, upc, color, status, "
                    "reference_images) values (cast(:tid as uuid), :line, :variant, :upc, "
                    ":color, :status, cast(:imgs as jsonb)) "
                    f"returning {self._SKU_COLS}"
                ),
                {"tid": str(self.tenant_id), "line": line, "variant": variant,
                 "upc": upc, "color": color, "status": status,
                 "imgs": json.dumps(reference_images or [])},
            ).mappings().first()
        return dict(row)

    def update_sku(self, sku_id, fields: dict) -> dict | None:
        allowed = {"line", "variant", "upc", "color", "status", "reference_images"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        params = {"id": str(sku_id), "tid": str(self.tenant_id)}
        with engine.begin() as conn:
            if sets:
                clauses = []
                for key, value in sets.items():
                    if key == "reference_images":
                        clauses.append("reference_images = cast(:reference_images as jsonb)")
                        params["reference_images"] = json.dumps(value)
                    else:
                        clauses.append(f"{key} = :{key}")
                        params[key] = value
                row = conn.execute(
                    text(
                        f"update skus set {', '.join(clauses)} "
                        "where id = cast(:id as uuid) and tenant_id = cast(:tid as uuid) "
                        f"returning {self._SKU_COLS}"
                    ),
                    params,
                ).mappings().first()
            else:
                row = conn.execute(
                    text(
                        f"select {self._SKU_COLS} from skus "
                        "where id = cast(:id as uuid) and tenant_id = cast(:tid as uuid)"
                    ),
                    params,
                ).mappings().first()
        return dict(row) if row else None
```

- [ ] **Step 4: Create the catalog router**

Create `api/app/catalog.py`:
```python
"""The catalog API. GET /skus lists a company's products (any signed-in user in
the company); POST /skus and PATCH /skus/{id} add or edit products (admins
only). All access goes through the ScopedRepo, so it is always company-limited.
"""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .scope import ScopedRepo, get_scoped_repo
from .security import require_admin

router = APIRouter(tags=["catalog"])


class SkuCreate(BaseModel):
    line: str = Field(min_length=1)
    variant: str = Field(min_length=1)
    upc: str = Field(min_length=1)
    color: str | None = None
    status: Literal["active", "discontinued"] = "active"
    reference_images: list[dict] = []


class SkuUpdate(BaseModel):
    line: str | None = Field(default=None, min_length=1)
    variant: str | None = Field(default=None, min_length=1)
    upc: str | None = Field(default=None, min_length=1)
    color: str | None = None
    status: Literal["active", "discontinued"] | None = None
    reference_images: list[dict] | None = None


@router.get("/skus")
def list_skus(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    skus = repo.list_skus()
    return {"skus": skus, "count": len(skus)}


@router.post("/skus")
def create_sku(
    body: SkuCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    return repo.create_sku(
        body.line, body.variant, body.upc, body.color, body.status, body.reference_images
    )


@router.patch("/skus/{sku_id}")
def update_sku(
    sku_id: UUID,
    body: SkuUpdate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    updated = repo.update_sku(sku_id, body.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return updated
```

- [ ] **Step 5: Wire the router into the app**

In `api/app/main.py`, add the import next to the existing router imports:
```python
from .auth import router as auth_router
from .hierarchy import router as hierarchy_router
from .catalog import router as catalog_router
from .db import db_ok
```
And add the include next to the existing ones:
```python
app.include_router(auth_router)
app.include_router(hierarchy_router)
app.include_router(catalog_router)
```

- [ ] **Step 6: Restart the api and run the catalog gate**

Run:
```bash
docker compose restart api
docker compose exec -T api pytest tests/test_catalog.py -q
```
Expected: `7 passed`.

- [ ] **Step 7: Commit**

```bash
git add api/app/scope.py api/app/catalog.py api/app/main.py api/tests/test_catalog.py
git commit -m "Phase 3a: catalog API (GET/POST/PATCH /skus), company-scoped, admin-only writes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:** none created; verification only.

- [ ] **Step 1: Run the entire backend suite**

Run: `docker compose exec -T api pytest -q`
Expected: 29 passed (Phase 2's 18 + require_admin 4 + catalog 7).

- [ ] **Step 2: Confirm the frontend tests still pass**

Run: `pnpm test:admin`
Expected: `Tests  27 passed (27)`.

- [ ] **Step 3: Live check through the running API**

Run:
```bash
DANA=$(curl -s -X POST http://localhost:8000/auth/login -H 'Content-Type: application/json' -d '{"email":"dana@lumenbeauty.com","password":"demo1234"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
echo "Lumen catalog:"; curl -s http://localhost:8000/skus -H "Authorization: Bearer $DANA" | python3 -c "import sys,json;d=json.load(sys.stdin);print(' count:',d['count']);print(' items:',sorted(s['line']+' / '+s['variant'] for s in d['skus']))"
```
Expected: count 4 (or more if a test added Plum to the dev DB; the dev DB is separate from the test DB, so it should be 4), items include `Velvet Lip / Rosewood` etc., and no Acme product.

- [ ] **Step 4: Confirm a non-admin is refused live**

Run:
```bash
MARCUS=$(curl -s -X POST http://localhost:8000/auth/login -H 'Content-Type: application/json' -d '{"email":"marcus@lumenbeauty.com","password":"demo1234"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s -o /dev/null -w "rep POST /skus -> %{http_code}\n" -X POST http://localhost:8000/skus -H "Authorization: Bearer $MARCUS" -H 'Content-Type: application/json' -d '{"line":"x","variant":"y","upc":"REP-TEST-1"}'
```
Expected: `rep POST /skus -> 403`.

- [ ] **Step 5: Commit (only if a fix was needed)**

```bash
git add -A api
git commit -m "Phase 3a: fixes found during full verification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Update all the documentation

**Files:**
- Modify: `api/README.md`, `db/README.md`, `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`
- Modify: `../hi-fi-intelli/Intelli_Complete_Handoff.md` (separate repo, separate commit)

- [ ] **Step 1: Update api/README.md**

In `api/README.md`, in the "Every file in this folder" section, add after the `app/hierarchy.py` entry:
```markdown
### app/catalog.py  (the product catalog API)
Defines the product list endpoints: `GET /skus` (any signed-in person in the
company can view), and `POST /skus` + `PATCH /skus/{id}` (admins only, guarded
by require_admin). All of them go through the ScopedRepo, so they only ever
touch the caller's own company's products.
```
And update the `app/security.py` entry to note it now also has `require_admin`
(the "admins only" check), and update the `app/scope.py` entry to note the
ScopedRepo also lists/creates/edits catalog products (company-wide, not
branch-filtered).

- [ ] **Step 2: Update db/README.md**

In `db/README.md`, under "Every file in this folder", add after the hierarchy
migration entry:
```markdown
### migrations/20260615000002_create_skus.sql
The third renovation order. It adds **skus**, the product catalog: one row per
sellable variant (line, variant, UPC barcode, color, active/discontinued status,
and a list of reference photo links). Each product belongs to one company and is
unique per company by barcode. This is company-wide reference data (everyone in
the company sees all of it), unlike the org tree which is branch-scoped.
```
And in the "What comes later" section, change it to say the catalog (Phase 3a)
is now built and Phase 3b adds surveys.

- [ ] **Step 3: Update CODEBASE_MAP.md**

In `CODEBASE_MAP.md`, at the end of section 1 (after the Phase 2 paragraph), add:
```markdown
As of Phase 3a, the backend also holds each company's product catalog (its
SKUs, meaning product variants). Everyone in a company can view the catalog;
only admins can change it. Like everything else, one company never sees
another's.
```

- [ ] **Step 4: Update CHECKING_THE_WORK.md**

In `CHECKING_THE_WORK.md`, in the backend-robot paragraph (the one that mentions
`pnpm test:api`), add a sentence:
```markdown
As of Phase 3a these backend checks also cover the product catalog: one company
cannot see another's products, and only admins can add or edit products.
```

- [ ] **Step 5: Update START_HERE.md**

Three edits to `START_HERE.md`:
(a) In section 1, add a new block after the Phase 2 block:
```markdown
**Phase 3a - the product catalog (done):**
- Each company now has a product list (its "SKUs", meaning product variants
  like Velvet Lip in Rosewood vs Mauve), with barcode, color, an
  active/discontinued status, and optional reference photo links.
- Everyone in a company can view the catalog; only admins can add or edit
  products. One company never sees another's catalog.
- This is the foundation for surveys (Phase 3b), which ask questions about these
  exact products.
```
Remove the now-outdated "What's NEXT: Phase 3 ..." line from the Phase 2 block,
and under this new block add: `**What's NEXT:** Phase 3b, surveys (with
versioning and pass/fail rules).`

(b) In section 5's file tree, add under `app/` (after `hierarchy.py`):
```
│   │   ├── catalog.py    GET/POST/PATCH /skus (the product catalog API)
```

(c) In section 7, update the status lines to:
```markdown
- Org hierarchy + "see only your branch" scope guard: DONE and tested.
- Product catalog (company-wide, admin-edited): DONE and tested.
- Phases 1, 2, and 3a complete. NEXT: Phase 3b (surveys + versions + pass rules).
```

- [ ] **Step 6: Update CONTEXT.md**

(a) Replace the single Phase 3 build-order line with two lines:
```markdown
- [~] **Phase 3** - catalog + surveys + versions + assignments. Split into 3a + 3b.
  - [x] **Phase 3a** - catalog (skus): company-wide list, admin-only add/edit, company isolation. Gate met (tests green).
  - [ ] **Phase 3b** - surveys + immutable versions + assignments + structured pass conditions.
```
(b) Append to the progress log:
```markdown
- 2026-06-15: Phase 3a - product catalog. Migration for skus (tenant_id, line,
  variant, upc, color, status, reference_images jsonb; unique per tenant by upc).
  ScopedRepo gained company-wide list_skus/create_sku/update_sku (tenant-only
  filter, not branch path). New require_admin dependency (403 for non-admins).
  catalog.py: GET /skus (any tenant user), POST/PATCH /skus (admin only) with
  Pydantic validation. Seed adds 4 Lumen + 1 Acme products. Tests green (28
  backend total): company isolation, admin add/edit, non-admin 403, no
  cross-company edit, auth required (29 backend tests total). Phase 3b (surveys) next.
```

- [ ] **Step 7: Commit the intelli-app docs**

```bash
git add api/README.md db/README.md CODEBASE_MAP.md CHECKING_THE_WORK.md START_HERE.md CONTEXT.md
git commit -m "Docs: Phase 3a complete (product catalog); guides, map, checks updated

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Update the prototype handoff CHANGELOG (sibling repo)**

In `../hi-fi-intelli/Intelli_Complete_Handoff.md`, add at the top of the
CHANGELOG (right after the italic note line), no em dashes (colon after date):
```markdown
**2026-06-15 (production: Phase 3a complete):** The production repo built the product catalog (Phase 3, split into 3a catalog + 3b surveys). New skus table (line, variant, UPC, color, active/discontinued, reference-image links; unique per tenant by UPC). The shared ScopedRepo gained company-wide list/create/update for SKUs (tenant-only filter, since the catalog is shared reference data, not branch-scoped). First role-based rule landed: a require_admin dependency makes adding/editing products admin-only, while any signed-in company user can view. Endpoints GET /skus (all), POST/PATCH /skus (admin). Tests green (29 backend): company isolation, admin-only writes, no cross-company edit, auth required. Next: Phase 3b (surveys + immutable versions + assignments + structured pass conditions).
```

- [ ] **Step 9: Commit the handoff (sibling repo)**

```bash
cd /Users/tanyajustin/Documents/hi-fi-intelli
git add Intelli_Complete_Handoff.md
git commit -m "Handoff CHANGELOG: production Phase 3a complete (product catalog)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
cd /Users/tanyajustin/Documents/intelli-app
```
