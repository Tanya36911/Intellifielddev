# Users & Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Admin Users & Roles screen at `/users` (view the team, add a user, change a role, move a pin), backed by a small `GET/POST/PATCH /users` brick.

**Architecture:** Phase A adds three endpoints in the MAIN repo through the existing `ScopedRepo` (so the scope-follows-pin guard is reused) and the existing Argon2 `hash_password`. A user's pin is one row in the `assignments` table. Phase B builds the React screen in a git worktree, mocking those endpoints in its tests. The integrator merges the green worktree into main (resolving `nav.ts` and `App.tsx`).

**Tech Stack:** FastAPI + SQLAlchemy text() + Postgres (backend); React 19 + TanStack Query + CSS Modules + Vitest/Testing Library (frontend).

## Global Constraints

- No em dashes anywhere in code, copy, or comments. Use plain sentences.
- Backend bricks are built and tested in the MAIN repo folder (`pnpm test:api` needs the live Docker backend, which live-mounts the main folder). The frontend screen is built in a worktree and mocks the endpoints.
- All scoped DB access goes through `ScopedRepo` (never raw queries in routers). Tenancy + subtree scope must hold on every query.
- No new database tables or migrations: `users`, `assignments`, `tenants` already exist.
- Roles are the fixed set `admin | manager | rep` (matches the `users_role_check` constraint).
- Plain passwords are never stored or logged; only the Argon2 hash from `hash_password` is persisted.
- POST/PATCH return `200` with the resource body (match the catalog/surveys convention; FastAPI default).
- Frontend: read controls for everyone, write controls (Add, role change, move pin) only when `session.user.role === 'admin'` (matches the Catalog read-only pattern). The backend is the real guard.
- Match existing file/test conventions: hook + pure helpers in `useX.ts` with a `useX.test.ts`, components with `.module.css` and a `*.test.tsx`, tests mock `../../lib/api`.

---

## PHASE A: Backend brick (MAIN folder)

### Task A1: GET /users (list, branch-scoped) + ScopedRepo scaffolding

**Files:**
- Modify: `api/app/scope.py` (add a `LastAdminError` class + the users section)
- Create: `api/app/users.py` (router)
- Modify: `api/app/main.py` (register the router)
- Test: `api/tests/test_users.py`

**Interfaces:**
- Produces: `ScopedRepo.list_users() -> list[dict]`, `ScopedRepo.get_user(user_id) -> dict | None`, `ScopedRepo._root_path(conn) -> str | None`; `GET /users -> {"users": [...], "count": int}` where each user is `{id, name, email, role, pinned_node_id, pinned_node_name, pinned_node_level_order}` (the three pinned_* fields are null when unpinned).

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_users.py`:

```python
"""Users brick. GET /users is branch-scoped (scope follows the pin); POST/PATCH
are admin-only; the team never leaks across companies."""


def _users(client, token):
    resp = client.get("/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_admin_sees_whole_company(client, login):
    data = _users(client, login("dana@lumenbeauty.com"))
    emails = {u["email"] for u in data["users"]}
    # Dana is pinned at the company root, so she sees every Lumen user,
    # including the unpinned newbie.
    assert {"dana@lumenbeauty.com", "sarah@lumenbeauty.com",
            "marcus@lumenbeauty.com", "newbie@lumenbeauty.com"} <= emails
    assert "avery@acme.com" not in emails  # no cross-company leak


def test_company_isolation_acme(client, login):
    data = _users(client, login("avery@acme.com"))
    emails = {u["email"] for u in data["users"]}
    assert "avery@acme.com" in emails
    assert all(not e.endswith("@lumenbeauty.com") for e in emails)


def test_pinned_node_fields_present(client, login):
    data = _users(client, login("dana@lumenbeauty.com"))
    sarah = next(u for u in data["users"] if u["email"] == "sarah@lumenbeauty.com")
    assert sarah["role"] == "manager"
    assert sarah["pinned_node_name"] == "Central"
    assert sarah["pinned_node_level_order"] == 1
    newbie = next(u for u in data["users"] if u["email"] == "newbie@lumenbeauty.com")
    assert newbie["pinned_node_id"] is None
    assert newbie["pinned_node_name"] is None


def test_manager_sees_only_their_branch(client, login):
    # Sarah is a manager pinned at Central. She sees herself, not Marcus
    # (pinned under West) and not the company-wide unpinned newbie.
    data = _users(client, login("sarah@lumenbeauty.com"))
    emails = {u["email"] for u in data["users"]}
    assert "sarah@lumenbeauty.com" in emails
    assert "marcus@lumenbeauty.com" not in emails
    assert "newbie@lumenbeauty.com" not in emails


def test_unpinned_caller_sees_none(client, login):
    data = _users(client, login("newbie@lumenbeauty.com"))
    assert data["users"] == []


def test_users_requires_auth(client):
    assert client.get("/users").status_code == 401
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:api -- -k users`
Expected: FAIL (404 on `/users`, route not registered).

- [ ] **Step 3: Add `LastAdminError` + the users section to `ScopedRepo`**

In `api/app/scope.py`, add near the other exception classes:

```python
class LastAdminError(Exception):
    """Tried to remove the company's only remaining admin."""
```

Add this section inside `class ScopedRepo` (after the catalog section):

```python
    # ----- users (company team; branch-scoped visibility; pin via assignments) -----

    _USER_COLS = (
        "u.id, u.name, u.email, u.role, "
        "n.id as pinned_node_id, n.name as pinned_node_name, "
        "n.level_order as pinned_node_level_order"
    )

    def _root_path(self, conn) -> str | None:
        return conn.execute(
            text("select path from nodes where tenant_id = cast(:tid as uuid) "
                 "and level_order = 0"),
            {"tid": str(self.tenant_id)},
        ).scalar()

    def list_users(self) -> list[dict]:
        if self.scope_path is None:
            return []
        with engine.connect() as conn:
            root = self._root_path(conn)
            at_root = root is not None and self.scope_path == root
            # A pinned user is visible when their node sits at/under the caller's
            # scope. Unpinned users (no node) are visible only to a caller at the
            # company root, so an admin can find and pin a new unpinned user while
            # a branch manager does not see company-wide unpinned users.
            unpinned_clause = "or (n.id is null)" if at_root else ""
            rows = conn.execute(
                text(
                    f"select {self._USER_COLS} from users u "
                    "left join assignments a on a.user_id = u.id and a.tenant_id = u.tenant_id "
                    "left join nodes n on n.id = a.node_id "
                    "where u.tenant_id = cast(:tid as uuid) and ("
                    "  (n.path like :scope || '%') "
                    f"  {unpinned_clause} "
                    ") order by u.name"
                ),
                {"tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().all()
        return [dict(r) for r in rows]

    def get_user(self, user_id) -> dict | None:
        """A single user in the GET shape, tenant-scoped (used after writes).
        Not branch-filtered: the writes that call it already enforced scope."""
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    f"select {self._USER_COLS} from users u "
                    "left join assignments a on a.user_id = u.id and a.tenant_id = u.tenant_id "
                    "left join nodes n on n.id = a.node_id "
                    "where u.id = cast(:uid as uuid) and u.tenant_id = cast(:tid as uuid)"
                ),
                {"uid": str(user_id), "tid": str(self.tenant_id)},
            ).mappings().first()
        return dict(row) if row else None
```

- [ ] **Step 4: Create the router `api/app/users.py`**

```python
"""The users API. GET /users lists the team (branch-scoped through the ScopedRepo).
POST /users adds a user and pins them; PATCH /users/{id} changes a role or moves a
pin. Both writes are admin only. No new tables: the pin is a row in `assignments`."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.exc import IntegrityError

from .scope import ScopedRepo, get_scoped_repo, LastAdminError
from .security import hash_password, require_admin

router = APIRouter(tags=["users"])

Role = Literal["admin", "manager", "rep"]


class UserCreate(BaseModel):
    name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    role: Role
    password: str = Field(min_length=8)
    node_id: UUID | None = None


class UserUpdate(BaseModel):
    role: Role | None = None
    node_id: UUID | None = None

    @model_validator(mode="after")
    def _at_least_one(self):
        if not self.model_fields_set:
            raise ValueError("provide role and/or node_id")
        return self


@router.get("/users")
def list_users(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    users = repo.list_users()
    return {"users": users, "count": len(users)}


@router.post("/users")
def create_user(
    body: UserCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    try:
        return repo.create_user(
            body.name, body.email, body.role, hash_password(body.password),
            str(body.node_id) if body.node_id else None,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Node not found in your scope")
    except IntegrityError:
        raise HTTPException(status_code=409, detail="Email already in use")


@router.patch("/users/{user_id}")
def update_user(
    user_id: UUID,
    body: UserUpdate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    fields = body.model_dump(exclude_unset=True)
    try:
        updated = repo.update_user(user_id, fields)
    except LastAdminError:
        raise HTTPException(status_code=409, detail="Cannot remove the last admin")
    except ValueError:
        raise HTTPException(status_code=404, detail="Node not found in your scope")
    if updated is None:
        raise HTTPException(status_code=404, detail="User not found")
    return updated
```

(`create_user` / `update_user` are added to the repo in Tasks A2/A3; the router referencing them now is fine because the GET tests do not call them.)

- [ ] **Step 5: Register the router in `api/app/main.py`**

Add the import alongside the others and include it:

```python
from .users import router as users_router
```
```python
app.include_router(users_router)
```

- [ ] **Step 6: Run the GET tests to verify they pass**

Run: `pnpm test:api -- -k "users and (sees or isolation or pinned or unpinned or requires)"`
Expected: the list/isolation/scope/auth tests PASS. (POST/PATCH tests come next.)

- [ ] **Step 7: Commit**

```bash
git add api/app/scope.py api/app/users.py api/app/main.py api/tests/test_users.py
git commit -m "feat(api): GET /users (branch-scoped team list)"
```

---

### Task A2: POST /users (add + pin, admin only)

**Files:**
- Modify: `api/app/scope.py` (add `create_user`)
- Test: `api/tests/test_users.py` (append)

**Interfaces:**
- Consumes: `hash_password` (security.py), the `assignments` table, the in-scope node check.
- Produces: `ScopedRepo.create_user(name, email, role, password_hash, node_id=None) -> dict`. Raises `ValueError("node")` when `node_id` is out of scope/tenant; lets `IntegrityError` (duplicate email) propagate.

- [ ] **Step 1: Append the failing tests**

```python
def _post(client, token, **body):
    return client.post("/users", headers={"Authorization": f"Bearer {token}"}, json=body)


def test_admin_can_add_and_pin_user(client, login):
    token = login("dana@lumenbeauty.com")
    # West node id: read it from the tree the admin can see.
    nodes = client.get("/nodes", headers={"Authorization": f"Bearer {token}"}).json()["nodes"]
    west = next(n for n in nodes if n["name"] == "West")
    resp = _post(client, token, name="Jordan Lee", email="jordan@lumenbeauty.com",
                 role="rep", password="changeme123", node_id=west["id"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["email"] == "jordan@lumenbeauty.com"
    assert body["pinned_node_name"] == "West"
    assert any(u["email"] == "jordan@lumenbeauty.com" for u in _users(client, token)["users"])


def test_add_user_without_node_is_unpinned(client, login):
    token = login("dana@lumenbeauty.com")
    resp = _post(client, token, name="No Pin", email="nopin2@lumenbeauty.com",
                 role="rep", password="changeme123")
    assert resp.status_code == 200, resp.text
    assert resp.json()["pinned_node_id"] is None


def test_non_admin_cannot_add_user(client, login):
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        resp = _post(client, login(email), name="X", email="x@lumenbeauty.com",
                     role="rep", password="changeme123")
        assert resp.status_code == 403, f"{email} got {resp.status_code}"


def test_duplicate_email_rejected(client, login):
    token = login("dana@lumenbeauty.com")
    resp = _post(client, token, name="Dupe", email="dana@lumenbeauty.com",
                 role="rep", password="changeme123")
    assert resp.status_code == 409


def test_add_user_node_out_of_scope(client, login):
    # An Acme node id is unknown to Lumen's admin -> 404.
    acme_nodes = client.get("/nodes", headers={"Authorization": f"Bearer {login('avery@acme.com')}"}).json()["nodes"]
    acme_node = acme_nodes[0]["id"]
    resp = _post(client, login("dana@lumenbeauty.com"), name="X", email="x2@lumenbeauty.com",
                 role="rep", password="changeme123", node_id=acme_node)
    assert resp.status_code == 404


def test_add_user_validation(client, login):
    token = login("dana@lumenbeauty.com")
    # bad role
    assert _post(client, token, name="X", email="x3@lumenbeauty.com",
                 role="superuser", password="changeme123").status_code == 422
    # short password
    assert _post(client, token, name="X", email="x4@lumenbeauty.com",
                 role="rep", password="short").status_code == 422


def test_password_stored_as_hash(client, login):
    from sqlalchemy import text
    from app.db import engine
    token = login("dana@lumenbeauty.com")
    _post(client, token, name="Hash Check", email="hash@lumenbeauty.com",
          role="rep", password="changeme123")
    with engine.connect() as conn:
        ph = conn.execute(text("select password_hash from users where email = :e"),
                          {"e": "hash@lumenbeauty.com"}).scalar()
    assert ph != "changeme123" and ph.startswith("$argon2")
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:api -- -k "add or duplicate or password or validation"`
Expected: FAIL (`create_user` missing on the repo -> 500, or attribute error).

- [ ] **Step 3: Add `create_user` to `ScopedRepo`**

In the users section of `api/app/scope.py`:

```python
    def create_user(self, name, email, role, password_hash, node_id=None) -> dict:
        """Create a user and (optionally) pin them. Raises ValueError('node') if
        node_id is out of the caller's scope/tenant. A duplicate email raises
        IntegrityError (the router turns it into a 409)."""
        with engine.begin() as conn:
            if node_id is not None:
                if self.scope_path is None:
                    raise ValueError("node")
                ok = conn.execute(
                    text("select 1 from nodes where id = cast(:nid as uuid) "
                         "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
                    {"nid": str(node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
                ).first()
                if ok is None:
                    raise ValueError("node")
            uid = conn.execute(
                text("insert into users (tenant_id, name, email, role, password_hash) "
                     "values (cast(:tid as uuid), :name, :email, :role, :ph) returning id"),
                {"tid": str(self.tenant_id), "name": name, "email": email,
                 "role": role, "ph": password_hash},
            ).scalar()
            if node_id is not None:
                conn.execute(
                    text("insert into assignments (tenant_id, user_id, node_id) "
                         "values (cast(:tid as uuid), cast(:uid as uuid), cast(:nid as uuid))"),
                    {"tid": str(self.tenant_id), "uid": str(uid), "nid": str(node_id)},
                )
        return self.get_user(uid)
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:api -- -k users`
Expected: all GET + POST tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/app/scope.py api/tests/test_users.py
git commit -m "feat(api): POST /users (add + pin, admin only)"
```

---

### Task A3: PATCH /users/{id} (change role / move pin, admin only)

**Files:**
- Modify: `api/app/scope.py` (add `update_user`)
- Test: `api/tests/test_users.py` (append)

**Interfaces:**
- Produces: `ScopedRepo.update_user(user_id, fields: dict) -> dict | None`. `fields` may contain `"role"` and/or `"node_id"` (where `node_id=None` means unpin). Returns None if the user is not in the caller's tenant. Raises `LastAdminError` when demoting the only admin; `ValueError("node")` when `node_id` is out of scope.

- [ ] **Step 1: Append the failing tests**

```python
def _patch(client, token, uid, **body):
    return client.patch(f"/users/{uid}", headers={"Authorization": f"Bearer {token}"}, json=body)


def _find(client, token, email):
    return next(u for u in _users(client, token)["users"] if u["email"] == email)


def test_admin_can_change_role(client, login):
    token = login("dana@lumenbeauty.com")
    marcus = _find(client, token, "marcus@lumenbeauty.com")
    resp = _patch(client, token, marcus["id"], role="manager")
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "manager"
    # restore so the suite is order-independent
    _patch(client, token, marcus["id"], role="rep")


def test_admin_can_move_pin(client, login):
    token = login("dana@lumenbeauty.com")
    nodes = client.get("/nodes", headers={"Authorization": f"Bearer {token}"}).json()["nodes"]
    chicago = next(n for n in nodes if n["name"] == "Chicago")
    marcus = _find(client, token, "marcus@lumenbeauty.com")
    resp = _patch(client, token, marcus["id"], node_id=chicago["id"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["pinned_node_name"] == "Chicago"


def test_admin_can_unpin(client, login):
    token = login("dana@lumenbeauty.com")
    target = _find(client, token, "newbie@lumenbeauty.com")
    resp = _patch(client, token, target["id"], node_id=None)
    assert resp.status_code == 200, resp.text
    assert resp.json()["pinned_node_id"] is None


def test_non_admin_cannot_patch(client, login):
    token = login("dana@lumenbeauty.com")
    marcus = _find(client, token, "marcus@lumenbeauty.com")
    resp = _patch(client, login("sarah@lumenbeauty.com"), marcus["id"], role="admin")
    assert resp.status_code == 403


def test_cannot_remove_last_admin(client, login):
    token = login("dana@lumenbeauty.com")
    dana = _find(client, token, "dana@lumenbeauty.com")
    resp = _patch(client, token, dana["id"], role="rep")
    assert resp.status_code == 409


def test_patch_node_out_of_scope(client, login):
    token = login("dana@lumenbeauty.com")
    marcus = _find(client, token, "marcus@lumenbeauty.com")
    acme_node = client.get("/nodes", headers={"Authorization": f"Bearer {login('avery@acme.com')}"}).json()["nodes"][0]["id"]
    assert _patch(client, token, marcus["id"], node_id=acme_node).status_code == 404


def test_patch_no_fields_rejected(client, login):
    token = login("dana@lumenbeauty.com")
    marcus = _find(client, token, "marcus@lumenbeauty.com")
    assert _patch(client, token, marcus["id"]).status_code == 422


def test_patch_unknown_user(client, login):
    token = login("dana@lumenbeauty.com")
    assert _patch(client, token, "00000000-0000-0000-0000-000000000000", role="rep").status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:api -- -k "change_role or move_pin or unpin or last_admin or no_fields or unknown_user or patch_node"`
Expected: FAIL (`update_user` missing).

- [ ] **Step 3: Add `update_user` to `ScopedRepo`**

```python
    def update_user(self, user_id, fields: dict) -> dict | None:
        """Change a user's role and/or pin. fields may hold 'role' and/or
        'node_id' (node_id None means unpin). Returns None if the user is not in
        the caller's tenant. Raises LastAdminError / ValueError('node')."""
        with engine.begin() as conn:
            target = conn.execute(
                text("select id, role from users where id = cast(:uid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"uid": str(user_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if target is None:
                return None
            if "role" in fields and fields["role"] != target["role"]:
                if target["role"] == "admin" and fields["role"] != "admin":
                    admins = conn.execute(
                        text("select count(*) from users where tenant_id = cast(:tid as uuid) "
                             "and role = 'admin'"),
                        {"tid": str(self.tenant_id)},
                    ).scalar()
                    if admins <= 1:
                        raise LastAdminError()
                conn.execute(
                    text("update users set role = :role where id = cast(:uid as uuid)"),
                    {"role": fields["role"], "uid": str(user_id)},
                )
            if "node_id" in fields:
                nid = fields["node_id"]
                if nid is None:
                    conn.execute(
                        text("delete from assignments where user_id = cast(:uid as uuid) "
                             "and tenant_id = cast(:tid as uuid)"),
                        {"uid": str(user_id), "tid": str(self.tenant_id)},
                    )
                else:
                    if self.scope_path is None:
                        raise ValueError("node")
                    ok = conn.execute(
                        text("select 1 from nodes where id = cast(:nid as uuid) "
                             "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
                        {"nid": str(nid), "tid": str(self.tenant_id), "scope": self.scope_path},
                    ).first()
                    if ok is None:
                        raise ValueError("node")
                    conn.execute(
                        text("insert into assignments (tenant_id, user_id, node_id) "
                             "values (cast(:tid as uuid), cast(:uid as uuid), cast(:nid as uuid)) "
                             "on conflict (tenant_id, user_id) do update set node_id = excluded.node_id"),
                        {"tid": str(self.tenant_id), "uid": str(user_id), "nid": str(nid)},
                    )
        return self.get_user(user_id)
```

- [ ] **Step 4: Run the full backend suite to verify it passes**

Run: `pnpm test:api`
Expected: PASS. The new file adds ~21 tests (198 prior -> ~219). Confirm the count is non-decreasing and green.

- [ ] **Step 5: Commit**

```bash
git add api/app/scope.py api/tests/test_users.py
git commit -m "feat(api): PATCH /users/{id} (change role / move pin, admin only)"
```

---

## PHASE B: Frontend screen (git worktree `users-roles`)

> Built in a worktree off main (created via the using-git-worktrees skill). Tests mock `../../lib/api`. The integrator merges the green lane into main.

### Task B1: `useUsers.ts` types + pure helpers (TDD)

**Files:**
- Create: `apps/admin/src/pages/Users/useUsers.ts`
- Test: `apps/admin/src/pages/Users/useUsers.test.ts`

**Interfaces:**
- Produces: types `User`, `Role`, `UserInput`, `UserPatch`; hooks `useUsers()`, `useCreateUser()`, `useUpdateUser()`; pure helpers `roleCounts(users) -> {admin, manager, rep}`, `inheritanceText(role, levelName) -> string`.

- [ ] **Step 1: Write the failing helper tests**

`apps/admin/src/pages/Users/useUsers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { roleCounts, inheritanceText, type User } from './useUsers'

const U = (over: Partial<User>): User => ({
  id: 'x', name: 'X', email: 'x@y.com', role: 'rep',
  pinned_node_id: null, pinned_node_name: null, pinned_node_level_order: null, ...over,
})

describe('roleCounts', () => {
  it('counts each role', () => {
    const c = roleCounts([U({ role: 'admin' }), U({ role: 'manager' }), U({ role: 'rep' }), U({ role: 'rep' })])
    expect(c).toEqual({ admin: 1, manager: 1, rep: 2 })
  })
})

describe('inheritanceText', () => {
  it('admin or company level sees everything', () => {
    expect(inheritanceText('admin', 'Company')).toMatch(/entire company/i)
    expect(inheritanceText('rep', 'Company')).toMatch(/entire company/i)
  })
  it('region/district narrow down', () => {
    expect(inheritanceText('manager', 'Region')).toMatch(/districts and stores/i)
    expect(inheritanceText('rep', 'District')).toMatch(/stores in this district/i)
  })
  it('no level means no pin', () => {
    expect(inheritanceText('rep', null)).toMatch(/no pin/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- useUsers`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `useUsers.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiSend } from '../../lib/api'

export type Role = 'admin' | 'manager' | 'rep'

export type User = {
  id: string
  name: string
  email: string
  role: Role
  pinned_node_id: string | null
  pinned_node_name: string | null
  pinned_node_level_order: number | null
}

export type UserInput = {
  name: string
  email: string
  role: Role
  password: string
  node_id?: string | null
}

export type UserPatch = { role?: Role; node_id?: string | null }

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<{ users: User[]; count: number }>('/users'),
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UserInput) => apiSend<User>('POST', '/users', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserPatch }) =>
      apiSend<User>('PATCH', `/users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

// ----- pure helpers (unit-tested) -----

export function roleCounts(users: User[]): { admin: number; manager: number; rep: number } {
  return {
    admin: users.filter((u) => u.role === 'admin').length,
    manager: users.filter((u) => u.role === 'manager').length,
    rep: users.filter((u) => u.role === 'rep').length,
  }
}

export function inheritanceText(role: Role, levelName: string | null): string {
  if (!levelName) return 'No pin yet, so this person sees nothing until you pin them.'
  if (role === 'admin' || levelName === 'Company')
    return 'Sees the entire company: every region, district and store.'
  if (levelName === 'Region') return 'Sees all districts and stores in this region.'
  if (levelName === 'District') return 'Sees all stores in this district.'
  return 'Scoped to this node and everything below it.'
}

export const ROLE_META: Record<Role, { label: string; tone: 'violet' | 'blue' | 'green' }> = {
  admin: { label: 'Admin', tone: 'violet' },
  manager: { label: 'Manager', tone: 'blue' },
  rep: { label: 'Rep', tone: 'green' },
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:admin -- useUsers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/Users/useUsers.ts apps/admin/src/pages/Users/useUsers.test.ts
git commit -m "feat(admin): useUsers hook + role/inheritance helpers"
```

---

### Task B2: Pin picker helper + `RolesReference` tab

**Files:**
- Create: `apps/admin/src/pages/Users/pinOptions.ts`
- Create: `apps/admin/src/pages/Users/RolesReference.tsx`, `RolesReference.module.css`
- Test: `apps/admin/src/pages/Users/pinOptions.test.ts`

**Interfaces:**
- Consumes: `OrgNode`, `OrgLevel`, `getLevelName` from `../Hierarchy/useHierarchy`.
- Produces: `pinOptions(nodes, levels) -> { id, label, levelName }[]` (path-ordered, indented label like `"  Bay Area"`); `RolesReference` component (the Roles tab content).

- [ ] **Step 1: Write the failing test**

`pinOptions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pinOptions } from './pinOptions'

const nodes = [
  { id: 'c', name: 'Lumen Beauty', code: 'LB', level_order: 0, parent_id: null, path: 'c/', chain: null, address: null, lat: null, lng: null, tz: null },
  { id: 'w', name: 'West', code: 'W', level_order: 1, parent_id: 'c', path: 'c/w/', chain: null, address: null, lat: null, lng: null, tz: null },
  { id: 'b', name: 'Bay Area', code: 'BA', level_order: 2, parent_id: 'w', path: 'c/w/b/', chain: null, address: null, lat: null, lng: null, tz: null },
]
const levels = [
  { level_order: 0, name: 'Company', locked: false },
  { level_order: 1, name: 'Region', locked: false },
  { level_order: 2, name: 'District', locked: false },
]

describe('pinOptions', () => {
  it('orders by path and labels with level name + indent', () => {
    const opts = pinOptions(nodes, levels)
    expect(opts.map((o) => o.id)).toEqual(['c', 'w', 'b'])
    expect(opts[0].levelName).toBe('Company')
    expect(opts[2].levelName).toBe('District')
    expect(opts[2].label.startsWith(' ')).toBe(true) // indented
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- pinOptions`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `pinOptions.ts`**

```ts
import { getLevelName, type OrgLevel, type OrgNode } from '../Hierarchy/useHierarchy'

export type PinOption = { id: string; label: string; levelName: string }

// Path-ordered, indented by level so the <select> reads like an org tree.
export function pinOptions(nodes: OrgNode[], levels: OrgLevel[]): PinOption[] {
  return [...nodes]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((n) => {
      const levelName = getLevelName(n.level_order, levels)
      const indent = ' '.repeat(n.level_order)
      return { id: n.id, label: `${indent}${n.name}`, levelName }
    })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:admin -- pinOptions`
Expected: PASS.

- [ ] **Step 5: Implement `RolesReference.tsx`**

```tsx
import { Chip, Icon } from '../../ui'
import styles from './RolesReference.module.css'

type Cap = { cap: string; note: string; admin: Cell; manager: Cell; rep: Cell }
type Cell = 'Full' | 'Scoped' | 'None'

const CAPS: Cap[] = [
  { cap: 'Build & edit hierarchy', note: 'Add, rename, move, delete nodes', admin: 'Full', manager: 'None', rep: 'None' },
  { cap: 'Add & manage users', note: 'Add users, set role + pin', admin: 'Full', manager: 'None', rep: 'None' },
  { cap: 'Create & version surveys', note: 'Build forms, publish versions', admin: 'Full', manager: 'None', rep: 'None' },
  { cap: 'Assign surveys', note: 'Push surveys to nodes / stores', admin: 'Full', manager: 'Scoped', rep: 'None' },
  { cap: 'Approve payroll', note: 'Review & seal pay periods', admin: 'Full', manager: 'Scoped', rep: 'None' },
  { cap: 'Complete surveys', note: 'Answer assigned surveys in-store', admin: 'None', manager: 'Scoped', rep: 'Full' },
  { cap: 'View reports', note: 'Compliance, completion, responses', admin: 'Full', manager: 'Scoped', rep: 'Scoped' },
]

function CapCell({ v }: { v: Cell }) {
  if (v === 'Full') return <Chip tone="green"><Icon name="check" size={11} /> Full</Chip>
  if (v === 'Scoped') return <Chip tone="amber">Scoped</Chip>
  return <span className={styles.none}>None</span>
}

export function RolesReference() {
  return (
    <div>
      <div className={styles.explainer}>
        Intelli has three fixed roles. A role decides what someone can do; their pin
        decides where. An admin pins at the company root and sees everything. A
        manager pins at a branch and is scoped to it. A rep pins at the level above
        Store. This reference is read-only.
      </div>
      <div className={styles.card}>
        <table className={styles.tbl}>
          <thead>
            <tr>
              <th>Capability</th>
              <th><Chip tone="violet">Admin</Chip></th>
              <th><Chip tone="blue">Manager</Chip></th>
              <th><Chip tone="green">Rep</Chip></th>
            </tr>
          </thead>
          <tbody>
            {CAPS.map((r) => (
              <tr key={r.cap}>
                <td><div className={styles.capName}>{r.cap}</div><div className={styles.capNote}>{r.note}</div></td>
                <td className={styles.center}><CapCell v={r.admin} /></td>
                <td className={styles.center}><CapCell v={r.manager} /></td>
                <td className={styles.center}><CapCell v={r.rep} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.soon}>
        <div><div className={styles.soonTitle}>Custom roles</div><div className={styles.soonHint}>Define your own capability sets on the same scoping model.</div></div>
        <Chip>Coming soon</Chip>
      </div>
    </div>
  )
}
```

`RolesReference.module.css`:

```css
.explainer { font-size: 13px; color: var(--text-2); line-height: 1.6; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 14px 16px; margin-bottom: 16px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; }
.tbl { width: 100%; border-collapse: collapse; }
.tbl th { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); padding: 11px 16px; border-bottom: 1px solid var(--border); background: var(--surface-2); }
.tbl th:not(:first-child), .center { text-align: center; }
.tbl td { padding: 13px 16px; border-bottom: 1px solid var(--border-faint); font-size: 13.5px; vertical-align: middle; }
.tbl tr:last-child td { border-bottom: none; }
.capName { font-weight: 600; }
.capNote { font-size: 11.5px; color: var(--text-3); }
.none { color: var(--text-4); font-weight: 600; font-size: 12.5px; }
.soon { margin-top: 16px; display: flex; align-items: center; gap: 13px; padding: 14px 16px; border: 1px dashed var(--border-strong); border-radius: var(--r-lg); background: var(--surface-2); }
.soon > div:first-child { flex: 1; }
.soonTitle { font-weight: 600; font-size: 13.5px; }
.soonHint { font-size: 12.5px; color: var(--text-3); }
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/pages/Users/pinOptions.ts apps/admin/src/pages/Users/pinOptions.test.ts apps/admin/src/pages/Users/RolesReference.tsx apps/admin/src/pages/Users/RolesReference.module.css
git commit -m "feat(admin): pin-option helper + Roles reference tab"
```

---

### Task B3: `AddUserModal` and `MovePinModal`

**Files:**
- Create: `apps/admin/src/pages/Users/AddUserModal.tsx`, `MovePinModal.tsx`, `UserModals.module.css`

**Interfaces:**
- Consumes: `useCreateUser`, `useUpdateUser`, `inheritanceText`, `ROLE_META`, `pinOptions`, the UI kit (`Modal`, `Field`, `Input`, `Select`, `Button`, `Chip`, `Icon`), `ApiError`.
- Produces: `AddUserModal({ open, options, onClose })`, `MovePinModal({ open, user, options, onClose })`.

- [ ] **Step 1: Implement `AddUserModal.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Button, Chip, Field, Icon, Input, Modal, Select } from '../../ui'
import { ApiError } from '../../lib/api'
import { inheritanceText, ROLE_META, useCreateUser, type Role } from './useUsers'
import type { PinOption } from './pinOptions'
import styles from './UserModals.module.css'

export function AddUserModal({
  open, options, onClose,
}: { open: boolean; options: PinOption[]; onClose: () => void }) {
  const create = useCreateUser()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('rep')
  const [nodeId, setNodeId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(''); setEmail(''); setRole('rep'); setNodeId(''); setPassword(''); setError(null)
  }, [open])

  const picked = options.find((o) => o.id === nodeId)
  const ready = name.trim() && email.trim() && nodeId && password.length >= 8
  const preview = picked
    ? `Pinned to ${picked.label.trim()} as ${ROLE_META[role].label}. ${inheritanceText(role, picked.levelName)}`
    : 'Pick a role and a node to see what this person will be able to see.'

  async function save() {
    setError(null)
    try {
      await create.mutateAsync({ name: name.trim(), email: email.trim(), role, password, node_id: nodeId })
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the user. Try again.')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a user"
      subtitle="Create their login now. You set a starting password and share it. Email invites come later.">
      <div className={styles.body}>
        <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" /></Field>
        <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@lumenbeauty.com" /></Field>
        <Field label="Role">
          <div className={styles.rolePick}>
            {(Object.keys(ROLE_META) as Role[]).map((r) => (
              <button key={r} type="button" className={r === role ? styles.roleSel : styles.roleBtn} onClick={() => setRole(r)}>
                <Chip tone={ROLE_META[r].tone}>{ROLE_META[r].label}</Chip>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Pin to node">
          <Select value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
            <option value="">Select a node...</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.levelName})</option>)}
          </Select>
        </Field>
        <Field label="Starting password">
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </Field>
        <div className={styles.hint}>They use this to log in the first time. Tell them to change it. Stored safely (one-way scramble), never as plain text.</div>
        <div className={styles.preview}><Icon name="pin" size={15} /><span>{preview}</span></div>
        {error && <div className={styles.error} role="alert">{error}</div>}
      </div>
      <div className={styles.foot}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready || create.isPending} onClick={save}>
          <Icon name="plus" size={15} /> Add user
        </Button>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Implement `MovePinModal.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Button, Icon, Modal, Select } from '../../ui'
import { ApiError } from '../../lib/api'
import { inheritanceText, useUpdateUser, type User } from './useUsers'
import type { PinOption } from './pinOptions'
import styles from './UserModals.module.css'

export function MovePinModal({
  open, user, options, onClose,
}: { open: boolean; user: User | null; options: PinOption[]; onClose: () => void }) {
  const update = useUpdateUser()
  const [nodeId, setNodeId] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && user) { setNodeId(user.pinned_node_id ?? ''); setError(null) }
  }, [open, user])

  const picked = options.find((o) => o.id === nodeId)
  const preview = picked && user
    ? `${picked.label.trim()}. ${inheritanceText(user.role, picked.levelName)}`
    : 'No pin: this person will see nothing until pinned.'

  async function save() {
    if (!user) return
    setError(null)
    try {
      await update.mutateAsync({ id: user.id, body: { node_id: nodeId || null } })
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not move the pin. Try again.')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Move pin"
      subtitle={user ? `Change which node ${user.name} is pinned to.` : ''}>
      <div className={styles.body}>
        <Select value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
          <option value="">No pin (sees nothing)</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.levelName})</option>)}
        </Select>
        <div className={styles.preview}><Icon name="pin" size={15} /><span>{preview}</span></div>
        {error && <div className={styles.error} role="alert">{error}</div>}
      </div>
      <div className={styles.foot}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={update.isPending} onClick={save}>Save pin</Button>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: Implement `UserModals.module.css`**

```css
.body { padding: 20px 22px; display: flex; flex-direction: column; gap: 14px; }
.rolePick { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.roleBtn, .roleSel { padding: 10px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); cursor: pointer; text-align: center; }
.roleSel { border-color: var(--accent); background: var(--accent-subtle); }
.hint { font-size: 12px; color: var(--text-3); line-height: 1.5; }
.preview { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; background: var(--accent-subtle); border-radius: var(--r-md); font-size: 12.5px; color: var(--text-2); }
.preview svg { color: var(--accent); flex-shrink: 0; margin-top: 1px; }
.error { background: var(--red-bg); color: var(--red-fg); border-radius: var(--r-sm); padding: 9px 12px; font-size: 12.5px; }
.foot { padding: 14px 22px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }
```

- [ ] **Step 4: Build check + commit**

Run: `pnpm --filter admin build` (tsc + vite). Expected: compiles.

```bash
git add apps/admin/src/pages/Users/AddUserModal.tsx apps/admin/src/pages/Users/MovePinModal.tsx apps/admin/src/pages/Users/UserModals.module.css
git commit -m "feat(admin): add-user and move-pin modals"
```

---

### Task B4: `UserTable` + `RoleSelect` (inline role change)

**Files:**
- Create: `apps/admin/src/pages/Users/UserTable.tsx`, `RoleSelect.tsx`, `UserTable.module.css`

**Interfaces:**
- Consumes: `User`, `ROLE_META`, `inheritanceText`, `useUpdateUser`, `getLevelName`/`OrgLevel`, UI kit (`Avatar`, `Chip`, `Icon`).
- Produces: `UserTable({ users, levels, canEdit, onMovePin })`; `RoleSelect({ user, disabled })` (inline role chip + dropdown; calls `useUpdateUser`).

- [ ] **Step 1: Implement `RoleSelect.tsx`**

```tsx
import { useState } from 'react'
import { Chip, Icon } from '../../ui'
import { ROLE_META, useUpdateUser, type Role, type User } from './useUsers'
import styles from './UserTable.module.css'

export function RoleSelect({ user, disabled }: { user: User; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const update = useUpdateUser()
  const meta = ROLE_META[user.role]

  if (disabled) return <Chip tone={meta.tone}>{meta.label}</Chip>

  async function choose(r: Role) {
    setOpen(false)
    if (r !== user.role) await update.mutateAsync({ id: user.id, body: { role: r } }).catch(() => {})
  }

  return (
    <span className={styles.roleSel}>
      <button className={styles.roleChip} data-tone={meta.tone} onClick={() => setOpen((v) => !v)} aria-label="Change role">
        {meta.label} <Icon name="chevronDown" size={11} />
      </button>
      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} />
          <div className={styles.menu}>
            {(Object.keys(ROLE_META) as Role[]).map((r) => (
              <button key={r} className={styles.menuItem} onClick={() => choose(r)}>
                <Chip tone={ROLE_META[r].tone}>{ROLE_META[r].label}</Chip>
                {r === user.role && <Icon name="check" size={13} />}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  )
}
```

(Note: use whichever chevron/check icon names exist in `ui/icons`. If `chevronDown` is absent, use the nearest existing down-chevron icon name; confirm against `apps/admin/src/ui/icons.ts` before writing.)

- [ ] **Step 2: Implement `UserTable.tsx`**

```tsx
import { Avatar, Chip, Icon } from '../../ui'
import { getLevelName, type OrgLevel } from '../Hierarchy/useHierarchy'
import { inheritanceText, type User } from './useUsers'
import { RoleSelect } from './RoleSelect'
import styles from './UserTable.module.css'

export function UserTable({
  users, levels, canEdit, onMovePin,
}: { users: User[]; levels: OrgLevel[]; canEdit: boolean; onMovePin: (u: User) => void }) {
  return (
    <div className={styles.card}>
      <table className={styles.tbl}>
        <thead>
          <tr><th>User</th><th>Role</th><th>Pinned node &rarr; inherits</th><th>Status</th></tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const levelName = u.pinned_node_level_order !== null ? getLevelName(u.pinned_node_level_order, levels) : null
            return (
              <tr key={u.id}>
                <td><div className={styles.userCell}>
                  <Avatar name={u.name} />
                  <div><div className={styles.name}>{u.name}</div><div className={styles.email}>{u.email}</div></div>
                </div></td>
                <td><RoleSelect user={u} disabled={!canEdit} /></td>
                <td>
                  {u.pinned_node_name ? (
                    <div className={styles.pinRow}>
                      <Icon name="pin" size={13} /><span className={styles.nodeName}>{u.pinned_node_name}</span>
                      {levelName && <Chip>{levelName}</Chip>}
                      {canEdit && <button className={styles.change} onClick={() => onMovePin(u)}>Change</button>}
                    </div>
                  ) : (
                    <div className={styles.pinRow}>
                      <Chip tone="amber">No pin</Chip>
                      {canEdit && <button className={styles.change} onClick={() => onMovePin(u)}>Set pin</button>}
                    </div>
                  )}
                  <div className={styles.inherit}>&darr; {inheritanceText(u.role, levelName)}</div>
                </td>
                <td><Chip tone="green">Active</Chip></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Implement `UserTable.module.css`**

```css
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: visible; }
.tbl { width: 100%; border-collapse: collapse; }
.tbl th { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); padding: 11px 16px; border-bottom: 1px solid var(--border); background: var(--surface-2); }
.tbl td { padding: 13px 16px; border-bottom: 1px solid var(--border-faint); font-size: 13.5px; vertical-align: middle; }
.tbl tr:last-child td { border-bottom: none; }
.userCell { display: flex; align-items: center; gap: 10px; }
.name { font-weight: 600; }
.email { font-size: 11.5px; color: var(--text-3); font-family: var(--mono); }
.pinRow { display: flex; align-items: center; gap: 7px; }
.nodeName { font-weight: 600; }
.change { font-size: 11.5px; color: var(--accent); font-weight: 600; cursor: pointer; background: none; border: none; padding: 0; }
.change:hover { text-decoration: underline; }
.inherit { font-size: 11.5px; color: var(--text-3); margin-top: 3px; }
.roleSel { position: relative; display: inline-block; }
.roleChip { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border-radius: var(--r-full); font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
.roleChip[data-tone="violet"] { background: var(--violet-bg, #f5f0ff); color: var(--violet-fg, #6d28d9); }
.roleChip[data-tone="blue"] { background: var(--blue-bg, #eff4ff); color: var(--blue-fg, #1d4ed8); }
.roleChip[data-tone="green"] { background: var(--green-bg); color: var(--green-fg); }
.scrim { position: fixed; inset: 0; z-index: 30; }
.menu { position: absolute; top: 30px; left: 0; z-index: 40; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); box-shadow: var(--shadow-pop); padding: 5px; width: 160px; }
.menuItem { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: none; background: transparent; border-radius: var(--r-xs); cursor: pointer; }
.menuItem:hover { background: var(--surface-hover); }
.menuItem svg { margin-left: auto; color: var(--accent); }
```

- [ ] **Step 4: Build check + commit**

Run: `pnpm --filter admin build`. Expected: compiles.

```bash
git add apps/admin/src/pages/Users/UserTable.tsx apps/admin/src/pages/Users/RoleSelect.tsx apps/admin/src/pages/Users/UserTable.module.css
git commit -m "feat(admin): users table + inline role select"
```

---

### Task B5: `Users.tsx` page + route + nav (integration test)

**Files:**
- Create: `apps/admin/src/pages/Users/Users.tsx`, `Users.module.css`
- Modify: `apps/admin/src/App.tsx` (route), `apps/admin/src/shell/nav.ts` (drop `comingSoon`)
- Test: `apps/admin/src/pages/Users/Users.test.tsx`

**Interfaces:**
- Consumes: `useUsers`, `roleCounts`, `ROLE_META`, the modals, `UserTable`, `RolesReference`, `pinOptions`, `useHierarchy` (nodes + levels), the session (`selectSession`), UI kit (`Segmented`, `Button`, `Card`, `Chip`, `Icon`).

- [ ] **Step 1: Write the failing integration test**

`Users.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderApp } from '../../test/render'
import { adminSession, repSession } from '../../test/fixtures'
import Users from './Users'
import { apiGet, apiSend } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiGet: vi.fn(), apiSend: vi.fn() }
})

const USERS = {
  users: [
    { id: 'u1', name: 'Dana Whitfield', email: 'dana@lumenbeauty.com', role: 'admin', pinned_node_id: 'c', pinned_node_name: 'Lumen Beauty', pinned_node_level_order: 0 },
    { id: 'u2', name: 'Sarah Mitchell', email: 'sarah@lumenbeauty.com', role: 'manager', pinned_node_id: 'r2', pinned_node_name: 'Central', pinned_node_level_order: 1 },
    { id: 'u4', name: 'Newbie NoPin', email: 'newbie@lumenbeauty.com', role: 'rep', pinned_node_id: null, pinned_node_name: null, pinned_node_level_order: null },
  ],
  count: 3,
}
const NODES = { nodes: [
  { id: 'c', name: 'Lumen Beauty', code: 'LB', level_order: 0, parent_id: null, path: 'c/', chain: null, address: null, lat: null, lng: null, tz: null },
  { id: 'r2', name: 'Central', code: 'CE', level_order: 1, parent_id: 'c', path: 'c/r2/', chain: null, address: null, lat: null, lng: null, tz: null },
] }
const LEVELS = { levels: [
  { level_order: 0, name: 'Company', locked: false },
  { level_order: 1, name: 'Region', locked: false },
  { level_order: 2, name: 'District', locked: false },
  { level_order: 3, name: 'Store', locked: true },
], count: 4 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiGet).mockImplementation((path: string) => {
    if (path === '/users') return Promise.resolve(USERS)
    if (path === '/nodes') return Promise.resolve(NODES)
    if (path === '/org-levels') return Promise.resolve(LEVELS)
    return Promise.reject(new Error(`Unknown path: ${path}`))
  })
  vi.mocked(apiSend).mockResolvedValue({} as never)
})

describe('Users page', () => {
  it('lists the team with roles and pins', async () => {
    renderApp(<Users />, { session: adminSession() })
    expect(await screen.findByText('Dana Whitfield')).toBeTruthy()
    expect(screen.getByText('Sarah Mitchell')).toBeTruthy()
    expect(screen.getByText('Central')).toBeTruthy()
    expect(screen.getByText('No pin')).toBeTruthy()
  })

  it('admin sees the Add user button; switching to Roles shows the matrix', async () => {
    renderApp(<Users />, { session: adminSession() })
    await screen.findByText('Dana Whitfield')
    expect(screen.getByRole('button', { name: /add user/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Roles' }))
    expect(await screen.findByText('Build & edit hierarchy')).toBeTruthy()
  })

  it('opens the Add user modal and submits a create', async () => {
    renderApp(<Users />, { session: adminSession() })
    await screen.findByText('Dana Whitfield')
    fireEvent.click(screen.getByRole('button', { name: /add user/i }))
    fireEvent.change(await screen.findByPlaceholderText('Jordan Lee'), { target: { value: 'Jordan Lee' } })
    fireEvent.change(screen.getByPlaceholderText('jordan@lumenbeauty.com'), { target: { value: 'jordan@lumenbeauty.com' } })
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'changeme123' } })
    // pick the Central node (the select has a node option)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'r2' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add user$/ }))
    await waitFor(() => expect(apiSend).toHaveBeenCalledWith('POST', '/users', expect.objectContaining({ email: 'jordan@lumenbeauty.com' })))
  })

  it('is read-only for a rep (no Add user button)', async () => {
    renderApp(<Users />, { session: repSession() })
    await screen.findByText('Dana Whitfield')
    expect(screen.queryByRole('button', { name: /add user/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:admin -- Users.test`
Expected: FAIL (Users page not implemented).

- [ ] **Step 3: Implement `Users.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { Button, Card, Chip, Icon, Segmented } from '../../ui'
import { selectSession, useAppSelector } from '../../store'
import { useHierarchy } from '../Hierarchy/useHierarchy'
import { roleCounts, ROLE_META, useUsers, type Role, type User } from './useUsers'
import { pinOptions } from './pinOptions'
import { UserTable } from './UserTable'
import { RolesReference } from './RolesReference'
import { AddUserModal } from './AddUserModal'
import { MovePinModal } from './MovePinModal'
import styles from './Users.module.css'

const ROLE_DESC: Record<Role, { desc: string; sees: string }> = {
  admin: { desc: 'Owns the company. Configures hierarchy, surveys, payroll, users.', sees: 'everything in the company' },
  manager: { desc: 'Oversees a branch. Assigns surveys, reviews compliance, approves payroll.', sees: 'their node and everything below it' },
  rep: { desc: 'Field user. Completes assigned surveys at their stores.', sees: 'stores in their node only' },
}

export default function Users() {
  const session = useAppSelector(selectSession)
  const canEdit = session?.user.role === 'admin'
  const usersQ = useUsers()
  const { nodes, levels } = useHierarchy()
  const [tab, setTab] = useState<'people' | 'roles'>('people')
  const [addOpen, setAddOpen] = useState(false)
  const [pinUser, setPinUser] = useState<User | null>(null)

  const users = usersQ.data?.users ?? []
  const counts = roleCounts(users)
  const options = useMemo(() => pinOptions(nodes, levels), [nodes, levels])

  return (
    <>
      <div className={styles.topbar}>
        <div>
          <div className={styles.title}>Users &amp; Roles</div>
          <div className={styles.sub}>{users.length} users: {counts.admin} admin, {counts.manager} manager, {counts.rep} reps.</div>
        </div>
        <div className={styles.sp} />
        <Segmented
          options={['People', 'Roles']}
          value={tab === 'people' ? 'People' : 'Roles'}
          onChange={(v) => setTab(v === 'People' ? 'people' : 'roles')}
        />
        {canEdit && tab === 'people' && (
          <Button variant="primary" onClick={() => setAddOpen(true)}><Icon name="plus" size={15} /> Add user</Button>
        )}
      </div>

      <div className={styles.page}>
        {usersQ.isLoading && <div className={styles.muted}>Loading the team...</div>}
        {usersQ.isError && <div className={styles.error}>Could not load users. Is the backend running?</div>}

        {!usersQ.isLoading && !usersQ.isError && tab === 'people' && (
          <>
            <div className={styles.roleCards}>
              {(Object.keys(ROLE_META) as Role[]).map((r) => (
                <Card key={r} className={styles.roleCard}>
                  <div className={styles.roleCardHead}>
                    <Chip tone={ROLE_META[r].tone}>{ROLE_META[r].label}</Chip>
                    <span className={styles.count}>{counts[r]}</span>
                  </div>
                  <div className={styles.roleDesc}>{ROLE_DESC[r].desc}</div>
                  <div className={styles.roleSees}>Sees: {ROLE_DESC[r].sees}</div>
                </Card>
              ))}
            </div>
            <UserTable users={users} levels={levels} canEdit={canEdit} onMovePin={setPinUser} />
          </>
        )}

        {!usersQ.isLoading && tab === 'roles' && <RolesReference />}
      </div>

      <AddUserModal open={addOpen} options={options} onClose={() => setAddOpen(false)} />
      <MovePinModal open={pinUser !== null} user={pinUser} options={options} onClose={() => setPinUser(null)} />
    </>
  )
}
```

(`Segmented` takes `options: string[]`, `value: string`, `onChange: (v: string) => void` (confirmed against `apps/admin/src/ui/Segmented.tsx`), so the labels "People" / "Roles" are mapped to the internal `tab` state above.)

- [ ] **Step 4: Implement `Users.module.css`**

```css
.topbar { height: 56px; border-bottom: 1px solid var(--border); background: var(--surface); display: flex; align-items: center; gap: 12px; padding: 0 22px; }
.title { font-size: 15.5px; font-weight: 700; }
.sub { font-size: 12px; color: var(--text-3); }
.sp { flex: 1; }
.page { padding: 22px; max-width: 1100px; width: 100%; margin: 0 auto; }
.muted { color: var(--text-3); padding: 40px; text-align: center; }
.error { color: var(--red-fg); background: var(--red-bg); border-radius: var(--r-md); padding: 14px; }
.roleCards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 16px; }
.roleCard { padding: 16px; }
.roleCardHead { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.count { font-family: var(--mono); font-size: 18px; font-weight: 700; margin-left: auto; }
.roleDesc { font-size: 12.5px; color: var(--text-3); line-height: 1.45; }
.roleSees { font-size: 11.5px; color: var(--text-3); margin-top: 8px; }
```

- [ ] **Step 5: Wire the route and nav**

In `apps/admin/src/App.tsx`: add the import `import Users from './pages/Users/Users'` and replace the `/users` route element:

```tsx
<Route path="/users" element={<Users />} />
```

In `apps/admin/src/shell/nav.ts`, remove `comingSoon: true` from the `users` item:

```ts
{ id: 'users', label: 'Users & Roles', icon: 'users', group: 'org', path: '/users' },
```

- [ ] **Step 6: Run the page tests + full suite**

Run: `pnpm test:admin -- Users.test`  then  `pnpm test:admin`
Expected: PASS, no regressions.

- [ ] **Step 7: Build check + commit**

Run: `pnpm --filter admin build`. Expected: compiles.

```bash
git add apps/admin/src/pages/Users/Users.tsx apps/admin/src/pages/Users/Users.module.css apps/admin/src/App.tsx apps/admin/src/shell/nav.ts apps/admin/src/pages/Users/Users.test.tsx
git commit -m "feat(admin): Users & Roles screen at /users (route + nav live)"
```

---

### Task B6: Docs + integrator merge

**Files:**
- Modify: `apps/admin/README.md`, `CODEBASE_MAP.md`, `START_HERE.md`, `CONTEXT.md`, `ROADMAP.md`, `api/README.md`, and the prototype handoff CHANGELOG in `../hi-fi-intelli`.

- [ ] **Step 1: Update docs** (done in the same change as the merge to main; see the shared Docs task at the end of the Settings plan if both screens land together). Each doc gains a Users & Roles entry: the screen at `/users`, the `GET/POST/PATCH /users` brick, no migration, deferred items (email invites, enable/disable, manager-scoped invite, custom roles).

- [ ] **Step 2: Integrator merge.** From main: `git merge --no-ff users-roles`. Resolve `nav.ts` and `App.tsx` if the Settings lane also touched them (keep both new routes/items). Run `pnpm test:admin` and `pnpm test:api` on the merged main; both green.

- [ ] **Step 3: Commit the merge + docs** (no push; Tanya pushes).

---

## Self-Review notes

- Spec coverage: GET (A1) / POST (A2) / PATCH (A3) with the visibility rule, last-admin guard, node-in-scope, dup-email, validation, and password-as-hash all map to tasks. Frontend People+Roles tabs, add/edit/move-pin, read-only gating, and the honest "coming soon" / "Active" framing map to B1-B5.
- Deferred items (email invites, enable/disable, manager-scoped invite, custom roles) are not built; the screen shows them honestly.
- Type consistency: `User` / `Role` / `UserInput` / `UserPatch` and the `pinned_node_*` field names are identical across the hook, components, and the backend response shape.
