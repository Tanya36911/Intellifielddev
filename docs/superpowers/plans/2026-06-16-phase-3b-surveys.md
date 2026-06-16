# Phase 3b: Surveys, Versions, Assignments, Pass Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the surveys engine: three tables (`surveys`, `survey_versions`, `survey_assignments`), a survey lifecycle (draft -> publish -> new version), assignment of published versions to org nodes with coverage computed live by tree path, and structured per-question pass rules, all proven by tests.

**Architecture:** Approach A (two tables for the survey + its frozen versions, plus an assignments table). A draft version is editable; publishing stamps `published_at` and freezes it forever; editing a published survey spawns a new draft version. Surveys are company-wide (tenant-filtered, like the catalog); assignments are branch-scoped (path-prefixed, like nodes). All scoped queries live on the existing shared `ScopedRepo` so no endpoint can forget the rules. A new `surveys.py` router exposes the endpoints; admins author, admins-anywhere and managers-in-branch assign.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 + psycopg 3, Postgres, dbmate migrations, pytest + FastAPI TestClient. Spec: `docs/superpowers/specs/2026-06-16-phase-3b-surveys-design.md`. Builds on Phase 2 (`ScopedRepo` + `scope_path_for` in `api/app/scope.py`, `current_claims`/`require_admin` in `api/app/security.py`, pytest harness in `api/tests/`) and Phase 3a (`skus` table, catalog patterns).

**House rules (every commit):** run from repo root `/Users/tanyajustin/Documents/intelli-app`. No em dashes anywhere. Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Dev loop reminders:**
- Backend code is live-mounted; after changing `api/app/*.py` run `docker compose restart api` to apply it (no rebuild needed).
- Run backend tests with `docker compose exec -T api pytest -q` (conftest rebuilds a throwaway `intelli_test` DB and seeds it each run, so it picks up migration + seed changes automatically).
- Apply a new migration to the dev DB with `docker compose run --rm migrate up`.

**File structure for this phase:**
- Create `db/migrations/20260616000001_create_surveys.sql` — the three tables.
- Create `api/app/surveys.py` — Pydantic models + the survey/assignment router.
- Modify `api/app/scope.py` — add survey + assignment methods and custom exceptions to `ScopedRepo`.
- Modify `api/app/security.py` — add `require_manager_or_admin`.
- Modify `api/app/main.py` — plug in the surveys router.
- Modify `api/app/seed.py` — make `_sku` return its id, add `_survey`, seed demo surveys + one assignment.
- Create `api/tests/test_surveys.py` — the gate tests.
- Update docs (Task 6).

**Demo data this plan seeds (tests depend on it):**
- Lumen: survey "Velvet Lip Shelf Check" (type `shelf_check`), published v1, two questions (a per-SKU number question on Rosewood with pass `>= 4`, and a boolean endcap question), assigned to the Central node (created_by Dana).
- Acme: survey "Glow Serum Check" (type `shelf_check`), published v1, one boolean question, no assignment.

---

### Task 1: Migration for the three survey tables

**Files:**
- Create: `db/migrations/20260616000001_create_surveys.sql`

- [ ] **Step 1: Write the migration**

Create `db/migrations/20260616000001_create_surveys.sql`:
```sql
-- migrate:up transaction:false
-- transaction:false: dbmate skips its own transaction so this file can manage
-- its own (BEGIN/COMMIT), making it safe under dbmate or hand-run psql.
-- Error-stop is enforced by the runner (deploy script: psql -v ON_ERROR_STOP=1).
begin;
set local timezone = 'UTC';

-- A survey is a named checklist a rep fills out in a store. The survey row is
-- the identity; its questions live in survey_versions. status is the lifecycle
-- marker (draft until first publish, then published, or archived when retired).
create table surveys (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    name        text not null,
    type        text,
    status      text not null default 'draft'
                check (status in ('draft', 'published', 'archived')),
    created_at  timestamptz not null default now()
);
create index surveys_tenant_idx on surveys (tenant_id);

-- A frozen snapshot of a survey's questions. published_at NULL = an editable
-- draft; once set, the row is immutable (enforced in the app layer). Editing a
-- published survey adds a NEW version rather than changing an old one, so past
-- results (Phase 4) are never silently rewritten.
create table survey_versions (
    id              uuid primary key default gen_random_uuid(),
    survey_id       uuid not null references surveys(id),
    version_number  int not null,
    questions       jsonb not null default '[]'::jsonb,
    published_at    timestamptz,
    created_at      timestamptz not null default now(),
    unique (survey_id, version_number)
);
create index survey_versions_survey_idx on survey_versions (survey_id);

-- Points a published version at one org node with an optional deadline. Coverage
-- ("which stores?") is computed live from the node's path, not copied, so stores
-- added later are automatically included. created_by is informational history,
-- not a permission gate (anyone whose branch covers the node can manage it).
create table survey_assignments (
    id                 uuid primary key default gen_random_uuid(),
    tenant_id          uuid not null references tenants(id),
    survey_version_id  uuid not null references survey_versions(id),
    target_node_id     uuid not null references nodes(id),
    deadline           timestamptz,
    timezone_basis     text,
    created_by         uuid references users(id),
    created_at         timestamptz not null default now()
);
create index survey_assignments_tenant_idx on survey_assignments (tenant_id);
create index survey_assignments_node_idx on survey_assignments (target_node_id);
create index survey_assignments_version_idx on survey_assignments (survey_version_id);

commit;

-- migrate:down transaction:false
begin;
set local timezone = 'UTC';
drop table survey_assignments;
drop table survey_versions;
drop table surveys;
commit;
```

- [ ] **Step 2: Apply the migration to the dev database**

Run: `docker compose run --rm migrate up`
Expected: `Applying: 20260616000001_create_surveys.sql` then `Applied: ...`, no error.

- [ ] **Step 3: Verify the tables exist**

Run:
```bash
docker compose exec -T db psql -U intelli -d intelli -c "\dt survey*"
```
Expected: lists `surveys`, `survey_versions`, `survey_assignments`.

- [ ] **Step 4: Verify down+up is clean (self-protecting format works)**

Run:
```bash
docker compose run --rm migrate down && docker compose run --rm migrate up
```
Expected: the down drops the three tables, the up re-creates them, no error.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/20260616000001_create_surveys.sql db/schema.sql
git commit -m "Phase 3b: migration for surveys, survey_versions, survey_assignments

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Seed demo surveys (and make _sku return its id)

**Files:**
- Modify: `api/app/seed.py`

- [ ] **Step 1: Add the json import**

At the top of `api/app/seed.py`, add `import json` above `from sqlalchemy import text`:
```python
import json

from sqlalchemy import text
```

- [ ] **Step 2: Make _sku return its id**

Replace the existing `_sku` function body so it returns the row id (questions will reference these ids). The function becomes:
```python
def _sku(conn, tenant_id, line, variant, upc, color, status="active"):
    """Insert (or update) one catalog product. Returns its id."""
    return conn.execute(
        text(
            "insert into skus (tenant_id, line, variant, upc, color, status, reference_images) "
            "values (:tid, :line, :variant, :upc, :color, :status, '[]'::jsonb) "
            "on conflict (tenant_id, upc) do update set line = excluded.line, "
            "variant = excluded.variant, color = excluded.color, status = excluded.status "
            "returning id"
        ),
        {"tid": tenant_id, "line": line, "variant": variant, "upc": upc,
         "color": color, "status": status},
    ).scalar()
```

- [ ] **Step 3: Add the _survey helper**

After `_sku`, add:
```python
def _survey(conn, tenant_id, name, type_, questions, assign_node=None, created_by=None):
    """Insert (or fetch) a published survey with one frozen v1, optionally
    assigned to a node. Idempotent by (tenant_id, name): if it already exists,
    returns its id and does nothing else."""
    existing = conn.execute(
        text("select id from surveys where tenant_id = :tid and name = :name"),
        {"tid": tenant_id, "name": name},
    ).scalar()
    if existing:
        return existing
    survey_id = conn.execute(
        text(
            "insert into surveys (tenant_id, name, type, status) "
            "values (:tid, :name, :type, 'published') returning id"
        ),
        {"tid": tenant_id, "name": name, "type": type_},
    ).scalar()
    version_id = conn.execute(
        text(
            "insert into survey_versions (survey_id, version_number, questions, published_at) "
            "values (:sid, 1, cast(:q as jsonb), now()) returning id"
        ),
        {"sid": survey_id, "q": json.dumps(questions)},
    ).scalar()
    if assign_node is not None:
        conn.execute(
            text(
                "insert into survey_assignments (tenant_id, survey_version_id, target_node_id, created_by) "
                "values (:tid, :vid, :nid, :cb)"
            ),
            {"tid": tenant_id, "vid": version_id, "nid": assign_node["id"], "cb": created_by},
        )
    return survey_id
```

- [ ] **Step 4: Capture Dana's id and seed Lumen surveys**

In `run()`, change the Dana line to capture her id, then add the survey block after the Lumen `_sku` calls. The Lumen section becomes (showing the changed/added lines in context):
```python
        dana_id = _user(conn, lumen, "dana@lumenbeauty.com", "Dana Whitfield", "admin", l_root)
        _user(conn, lumen, "sarah@lumenbeauty.com", "Sarah Mitchell", "manager", central)
        _user(conn, lumen, "marcus@lumenbeauty.com", "Marcus Bell", "rep", bayarea)
        _user(conn, lumen, "newbie@lumenbeauty.com", "Newbie NoPin", "rep", None)

        rose = _sku(conn, lumen, "Velvet Lip", "Rosewood", "LUM-VL-ROSE", "#9B5B5B")
        _sku(conn, lumen, "Velvet Lip", "Mauve", "LUM-VL-MAUVE", "#8B5E83")
        _sku(conn, lumen, "Velvet Lip", "Coral", "LUM-VL-CORAL", "#E5734D")
        _sku(conn, lumen, "Silk Foundation", "Ivory", "LUM-SF-IVORY", "#E8D3B8")

        _survey(
            conn, lumen, "Velvet Lip Shelf Check", "shelf_check",
            [
                {"id": "q1", "prompt": "How many facings of Rosewood are on the shelf?",
                 "type": "number", "sku_ids": [str(rose)], "perSku": True,
                 "pass": {"operator": ">=", "value": 4}, "passScope": "each"},
                {"id": "q2", "prompt": "Is the Velvet Lip endcap display present?",
                 "type": "boolean", "pass": {"operator": "==", "value": True}},
            ],
            assign_node=central, created_by=dana_id,
        )
```

- [ ] **Step 5: Seed an Acme survey**

In the Acme section, after the Acme `_sku` line, add:
```python
        _survey(
            conn, acme, "Glow Serum Check", "shelf_check",
            [{"id": "q1", "prompt": "Is Glow Serum in stock?", "type": "boolean"}],
        )
```

- [ ] **Step 6: Update the final print line**

Change the print at the end of `run()` to mention surveys:
```python
    print("Seeded Lumen (8 nodes, 4 products, 1 survey) + Acme (4 nodes, 1 product, 1 survey) + 5 users with pins.")
```

- [ ] **Step 7: Re-seed the dev database and verify**

Run:
```bash
docker compose exec api python -m app.seed
docker compose exec -T db psql -U intelli -d intelli -c "select s.name, s.status, count(v.id) versions from surveys s join survey_versions v on v.survey_id = s.id group by s.id, s.name, s.status order by s.name"
```
Expected: rows for "Glow Serum Check" (published, 1) and "Velvet Lip Shelf Check" (published, 1).

- [ ] **Step 8: Commit**

```bash
git add api/app/seed.py
git commit -m "Phase 3b: seed demo surveys (Lumen + Acme) and one assignment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Survey create / list / view (models, repo, router)

**Files:**
- Create: `api/app/surveys.py`
- Modify: `api/app/scope.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_surveys.py`

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_surveys.py`:
```python
"""Phase 3b gate. Surveys are company-wide-visible, admin-only to author, with
frozen versions, scoped assignments, and validated pass rules.
"""


def _surveys(client, token):
    resp = client.get("/surveys", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _find(client, token, name):
    for s in _surveys(client, token)["surveys"]:
        if s["name"] == name:
            return s
    return None


def test_listing_requires_auth(client):
    assert client.get("/surveys").status_code == 401


def test_company_isolation(client, login):
    lumen = {s["name"] for s in _surveys(client, login("dana@lumenbeauty.com"))["surveys"]}
    assert "Velvet Lip Shelf Check" in lumen
    assert "Glow Serum Check" not in lumen
    acme = {s["name"] for s in _surveys(client, login("avery@acme.com"))["surveys"]}
    assert "Glow Serum Check" in acme
    assert "Velvet Lip Shelf Check" not in acme


def test_admin_can_create_survey(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "New Audit", "type": "shelf_check",
              "questions": [{"id": "q1", "prompt": "Counter clean?", "type": "boolean"}]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "New Audit"
    assert body["status"] == "draft"
    assert len(body["versions"]) == 1
    assert body["versions"][0]["version_number"] == 1
    assert body["versions"][0]["published_at"] is None


def test_non_admin_cannot_create(client, login):
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        resp = client.post(
            "/surveys",
            headers={"Authorization": f"Bearer {login(email)}"},
            json={"name": "Nope", "type": None, "questions": []},
        )
        assert resp.status_code == 403, f"{email} got {resp.status_code}"


def test_get_one_survey_with_versions(client, login):
    token = login("dana@lumenbeauty.com")
    s = _find(client, token, "Velvet Lip Shelf Check")
    resp = client.get(f"/surveys/{s['id']}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Velvet Lip Shelf Check"
    assert len(body["versions"]) >= 1
    assert body["versions"][0]["questions"][0]["id"] == "q1"


def test_bad_question_type_rejected(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Bad", "type": None,
              "questions": [{"id": "q1", "prompt": "x", "type": "nonsense"}]},
    )
    assert resp.status_code == 422, resp.text


def test_bad_pass_operator_rejected(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Bad2", "type": None,
              "questions": [{"id": "q1", "prompt": "x", "type": "number",
                             "pass": {"operator": "BETWEEN", "value": 4}}]},
    )
    assert resp.status_code == 422, resp.text


def test_choice_question_needs_options(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Bad3", "type": None,
              "questions": [{"id": "q1", "prompt": "pick", "type": "single_choice", "options": []}]},
    )
    assert resp.status_code == 422, resp.text


def test_cross_company_sku_link_rejected(client, login):
    # Dana (Lumen) cannot reference an Acme product id in a question.
    from sqlalchemy import text
    from app.db import engine
    with engine.connect() as conn:
        acme_sku = conn.execute(
            text("select s.id from skus s join tenants t on t.id = s.tenant_id where t.code = 'acme' limit 1")
        ).scalar()
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Sneaky", "type": None,
              "questions": [{"id": "q1", "prompt": "x", "type": "number", "sku_ids": [str(acme_sku)]}]},
    )
    assert resp.status_code == 400, resp.text
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec -T api pytest api/tests/test_surveys.py -q`
Expected: FAIL (404s / connection — the `/surveys` endpoints do not exist yet).

- [ ] **Step 3: Add survey read/create methods + exceptions to ScopedRepo**

In `api/app/scope.py`, add these exception classes just below the imports (above `class ScopedRepo`):
```python
class PublishedVersionError(Exception):
    """Tried to edit a version that is already published (frozen)."""


class NoDraftError(Exception):
    """Tried to publish a survey that has no current draft version."""


class DraftExistsError(Exception):
    """Tried to start a new version while an unpublished draft already exists."""


class VersionNotPublishedError(Exception):
    """Tried to assign a survey version that is missing or not published."""
```

Then add this block inside `class ScopedRepo`, after the catalog section (after `update_sku`):
```python
    # ----- surveys (company-wide: filtered by tenant only) -----

    _SURVEY_COLS = "id, name, type, status, created_at"
    _VERSION_COLS = "id, survey_id, version_number, questions, published_at, created_at"

    def _check_sku_ids(self, conn, questions: list[dict]) -> None:
        """Raise ValueError if any question references a SKU id that is not one
        of this company's products."""
        wanted = {sid for q in questions for sid in (q.get("sku_ids") or [])}
        if not wanted:
            return
        found = conn.execute(
            text(
                "select id from skus where tenant_id = cast(:tid as uuid) "
                "and id = any(cast(:ids as uuid[]))"
            ),
            {"tid": str(self.tenant_id), "ids": [str(s) for s in wanted]},
        ).scalars().all()
        missing = {str(s) for s in wanted} - {str(f) for f in found}
        if missing:
            raise ValueError(f"unknown sku_ids for this company: {sorted(missing)}")

    def list_surveys(self) -> list[dict]:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"select {self._SURVEY_COLS} from surveys "
                    "where tenant_id = cast(:tid as uuid) order by name"
                ),
                {"tid": str(self.tenant_id)},
            ).mappings().all()
        return [dict(r) for r in rows]

    def get_survey(self, survey_id) -> dict | None:
        with engine.connect() as conn:
            survey = conn.execute(
                text(
                    f"select {self._SURVEY_COLS} from surveys "
                    "where id = cast(:id as uuid) and tenant_id = cast(:tid as uuid)"
                ),
                {"id": str(survey_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if survey is None:
                return None
            versions = conn.execute(
                text(
                    f"select {self._VERSION_COLS} from survey_versions "
                    "where survey_id = cast(:id as uuid) order by version_number"
                ),
                {"id": str(survey_id)},
            ).mappings().all()
        result = dict(survey)
        result["versions"] = [dict(v) for v in versions]
        return result

    def create_survey(self, name, type_, questions: list[dict]) -> dict:
        with engine.begin() as conn:
            self._check_sku_ids(conn, questions)
            survey = conn.execute(
                text(
                    "insert into surveys (tenant_id, name, type) "
                    "values (cast(:tid as uuid), :name, :type) "
                    f"returning {self._SURVEY_COLS}"
                ),
                {"tid": str(self.tenant_id), "name": name, "type": type_},
            ).mappings().first()
            version = conn.execute(
                text(
                    "insert into survey_versions (survey_id, version_number, questions) "
                    "values (cast(:sid as uuid), 1, cast(:q as jsonb)) "
                    f"returning {self._VERSION_COLS}"
                ),
                {"sid": str(survey["id"]), "q": json.dumps(questions)},
            ).mappings().first()
        result = dict(survey)
        result["versions"] = [dict(version)]
        return result
```

- [ ] **Step 4: Create the surveys router with models**

Create `api/app/surveys.py`:
```python
"""The surveys API. Surveys are company-wide reference data (like the catalog):
any signed-in company user can view, only admins can author/edit/publish. A
published version is frozen forever; editing makes a new version. Assignments
point a published version at an org node and are branch-scoped. Everything goes
through the ScopedRepo, so access is always company- and branch-limited.
"""
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from .scope import (
    DraftExistsError,
    NoDraftError,
    PublishedVersionError,
    ScopedRepo,
    VersionNotPublishedError,
    get_scoped_repo,
)
from .security import require_admin, require_manager_or_admin

router = APIRouter(tags=["surveys"])

QuestionType = Literal["number", "boolean", "single_choice", "multi_choice", "photo", "text"]
PassOperator = Literal[">=", "<=", ">", "<", "==", "!=", "in", "not_in"]


class PassRule(BaseModel):
    operator: PassOperator
    value: bool | int | float | str | list


class Question(BaseModel):
    id: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    type: QuestionType
    options: list[str] = []
    sku_ids: list[UUID] = []
    perSku: bool = False
    pass_: PassRule | None = Field(default=None, alias="pass")
    passScope: Literal["each", "total"] = "each"

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _choice_needs_options(self):
        if self.type in ("single_choice", "multi_choice") and not self.options:
            raise ValueError("choice questions need at least one option")
        return self


class SurveyCreate(BaseModel):
    name: str = Field(min_length=1)
    type: str | None = None
    questions: list[Question] = []


class VersionUpdate(BaseModel):
    questions: list[Question]


class AssignmentCreate(BaseModel):
    survey_version_id: UUID
    target_node_id: UUID
    deadline: datetime | None = None
    timezone_basis: str | None = None


def _questions_json(questions: list[Question]) -> list[dict]:
    """Plain JSON-ready dicts (UUIDs -> strings, 'pass' alias kept)."""
    return [q.model_dump(by_alias=True, mode="json") for q in questions]


@router.get("/surveys")
def list_surveys(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    surveys = repo.list_surveys()
    return {"surveys": surveys, "count": len(surveys)}


@router.post("/surveys")
def create_survey(
    body: SurveyCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    try:
        return repo.create_survey(body.name, body.type, _questions_json(body.questions))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/surveys/{survey_id}")
def get_survey(
    survey_id: UUID, repo: ScopedRepo = Depends(get_scoped_repo)
) -> dict:
    survey = repo.get_survey(survey_id)
    if survey is None:
        raise HTTPException(status_code=404, detail="Survey not found")
    return survey
```

- [ ] **Step 5: Add require_manager_or_admin to security.py**

In `api/app/security.py`, after `require_admin`, add:
```python
def require_manager_or_admin(claims: dict = Depends(current_claims)) -> dict:
    """Allow admins and managers past; reps get 403. Used on assignment writes
    (the ScopedRepo still limits a manager to their own branch)."""
    if claims.get("role") not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Managers or admins only")
    return claims
```

- [ ] **Step 6: Plug the router into main.py**

In `api/app/main.py`, add the import beside the others:
```python
from .surveys import router as surveys_router
```
and after `app.include_router(catalog_router)` add:
```python
app.include_router(surveys_router)
```

- [ ] **Step 7: Apply and run the tests**

Run:
```bash
docker compose restart api
docker compose exec -T api pytest api/tests/test_surveys.py -q
```
Expected: all Task 3 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add api/app/surveys.py api/app/scope.py api/app/security.py api/app/main.py api/tests/test_surveys.py
git commit -m "Phase 3b: survey create/list/view with validated questions + pass rules

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Version lifecycle (edit draft, publish, new version, archive)

**Files:**
- Modify: `api/app/scope.py`
- Modify: `api/app/surveys.py`
- Test: `api/tests/test_surveys.py`

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_surveys.py`:
```python
def _create_draft(client, token, name):
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name, "type": "shelf_check",
              "questions": [{"id": "q1", "prompt": "Counter clean?", "type": "boolean"}]},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_edit_draft_questions(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "Editable Draft")
    vid = survey["versions"][0]["id"]
    resp = client.patch(
        f"/surveys/{survey['id']}/versions/{vid}",
        headers={"Authorization": f"Bearer {token}"},
        json={"questions": [{"id": "q1", "prompt": "Counter spotless?", "type": "boolean"}]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["questions"][0]["prompt"] == "Counter spotless?"


def test_publish_freezes_the_version(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "To Publish")
    resp = client.post(
        f"/surveys/{survey['id']}/publish",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "published"
    assert body["versions"][0]["published_at"] is not None


def test_cannot_edit_published_version(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "Frozen Survey")
    vid = survey["versions"][0]["id"]
    client.post(f"/surveys/{survey['id']}/publish", headers={"Authorization": f"Bearer {token}"})
    resp = client.patch(
        f"/surveys/{survey['id']}/versions/{vid}",
        headers={"Authorization": f"Bearer {token}"},
        json={"questions": [{"id": "q1", "prompt": "changed", "type": "boolean"}]},
    )
    assert resp.status_code == 409, resp.text


def test_new_version_keeps_old_unchanged(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "Versioned Survey")
    v1_id = survey["versions"][0]["id"]
    client.post(f"/surveys/{survey['id']}/publish", headers={"Authorization": f"Bearer {token}"})
    new = client.post(f"/surveys/{survey['id']}/versions", headers={"Authorization": f"Bearer {token}"})
    assert new.status_code == 200, new.text
    v2 = new.json()
    assert v2["version_number"] == 2
    assert v2["published_at"] is None
    # edit v2
    client.patch(
        f"/surveys/{survey['id']}/versions/{v2['id']}",
        headers={"Authorization": f"Bearer {token}"},
        json={"questions": [{"id": "q1", "prompt": "v2 question", "type": "boolean"}]},
    )
    # v1 is unchanged
    full = client.get(f"/surveys/{survey['id']}", headers={"Authorization": f"Bearer {token}"}).json()
    v1 = next(v for v in full["versions"] if v["id"] == v1_id)
    assert v1["questions"][0]["prompt"] == "Counter clean?"


def test_new_version_requires_published_latest(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "Still A Draft")
    resp = client.post(f"/surveys/{survey['id']}/versions", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 409, resp.text


def test_archive_survey(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "To Archive")
    resp = client.post(f"/surveys/{survey['id']}/archive", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "archived"


def test_non_admin_cannot_publish(client, login):
    dana = login("dana@lumenbeauty.com")
    survey = _create_draft(client, dana, "Mgr Cannot Publish")
    resp = client.post(
        f"/surveys/{survey['id']}/publish",
        headers={"Authorization": f"Bearer {login('sarah@lumenbeauty.com')}"},
    )
    assert resp.status_code == 403, resp.text
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec -T api pytest api/tests/test_surveys.py -k "edit_draft or publish or new_version or archive or cannot_edit" -q`
Expected: FAIL (the version endpoints do not exist yet).

- [ ] **Step 3: Add lifecycle methods to ScopedRepo**

In `api/app/scope.py`, add after `create_survey`:
```python
    def update_version(self, survey_id, version_id, questions: list[dict]) -> dict | None:
        with engine.begin() as conn:
            ver = conn.execute(
                text(
                    "select v.published_at from survey_versions v "
                    "join surveys s on s.id = v.survey_id "
                    "where v.id = cast(:vid as uuid) and v.survey_id = cast(:sid as uuid) "
                    "and s.tenant_id = cast(:tid as uuid)"
                ),
                {"vid": str(version_id), "sid": str(survey_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if ver is None:
                return None
            if ver["published_at"] is not None:
                raise PublishedVersionError()
            self._check_sku_ids(conn, questions)
            row = conn.execute(
                text(
                    "update survey_versions set questions = cast(:q as jsonb) "
                    "where id = cast(:vid as uuid) "
                    f"returning {self._VERSION_COLS}"
                ),
                {"q": json.dumps(questions), "vid": str(version_id)},
            ).mappings().first()
        return dict(row)

    def publish_version(self, survey_id) -> dict | None:
        with engine.begin() as conn:
            survey = conn.execute(
                text(
                    "select id from surveys where id = cast(:id as uuid) "
                    "and tenant_id = cast(:tid as uuid)"
                ),
                {"id": str(survey_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if survey is None:
                return None
            draft = conn.execute(
                text(
                    "select id from survey_versions where survey_id = cast(:id as uuid) "
                    "and published_at is null order by version_number desc limit 1"
                ),
                {"id": str(survey_id)},
            ).mappings().first()
            if draft is None:
                raise NoDraftError()
            conn.execute(
                text("update survey_versions set published_at = now() where id = cast(:vid as uuid)"),
                {"vid": str(draft["id"])},
            )
            conn.execute(
                text(
                    "update surveys set status = 'published' "
                    "where id = cast(:id as uuid) and status = 'draft'"
                ),
                {"id": str(survey_id)},
            )
        return self.get_survey(survey_id)

    def new_version(self, survey_id) -> dict | None:
        with engine.begin() as conn:
            survey = conn.execute(
                text(
                    "select id from surveys where id = cast(:id as uuid) "
                    "and tenant_id = cast(:tid as uuid)"
                ),
                {"id": str(survey_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if survey is None:
                return None
            latest = conn.execute(
                text(
                    "select version_number, questions, published_at from survey_versions "
                    "where survey_id = cast(:id as uuid) order by version_number desc limit 1"
                ),
                {"id": str(survey_id)},
            ).mappings().first()
            if latest["published_at"] is None:
                raise DraftExistsError()
            row = conn.execute(
                text(
                    "insert into survey_versions (survey_id, version_number, questions) "
                    "values (cast(:id as uuid), :vn, cast(:q as jsonb)) "
                    f"returning {self._VERSION_COLS}"
                ),
                {"id": str(survey_id), "vn": latest["version_number"] + 1,
                 "q": json.dumps(latest["questions"])},
            ).mappings().first()
        return dict(row)

    def archive_survey(self, survey_id) -> dict | None:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    "update surveys set status = 'archived' "
                    "where id = cast(:id as uuid) and tenant_id = cast(:tid as uuid) "
                    f"returning {self._SURVEY_COLS}"
                ),
                {"id": str(survey_id), "tid": str(self.tenant_id)},
            ).mappings().first()
        return dict(row) if row else None
```

- [ ] **Step 4: Add the lifecycle endpoints to surveys.py**

In `api/app/surveys.py`, add after `get_survey`:
```python
@router.patch("/surveys/{survey_id}/versions/{version_id}")
def update_version(
    survey_id: UUID,
    version_id: UUID,
    body: VersionUpdate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    try:
        updated = repo.update_version(survey_id, version_id, _questions_json(body.questions))
    except PublishedVersionError:
        raise HTTPException(status_code=409, detail="This version is published and cannot be edited")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if updated is None:
        raise HTTPException(status_code=404, detail="Survey version not found")
    return updated


@router.post("/surveys/{survey_id}/publish")
def publish_survey(
    survey_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    try:
        published = repo.publish_version(survey_id)
    except NoDraftError:
        raise HTTPException(status_code=409, detail="No draft version to publish")
    if published is None:
        raise HTTPException(status_code=404, detail="Survey not found")
    return published


@router.post("/surveys/{survey_id}/versions")
def new_version(
    survey_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    try:
        created = repo.new_version(survey_id)
    except DraftExistsError:
        raise HTTPException(status_code=409, detail="A draft version already exists; edit or publish it first")
    if created is None:
        raise HTTPException(status_code=404, detail="Survey not found")
    return created


@router.post("/surveys/{survey_id}/archive")
def archive_survey(
    survey_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    archived = repo.archive_survey(survey_id)
    if archived is None:
        raise HTTPException(status_code=404, detail="Survey not found")
    return archived
```

- [ ] **Step 5: Apply and run the tests**

Run:
```bash
docker compose restart api
docker compose exec -T api pytest api/tests/test_surveys.py -q
```
Expected: all Task 3 and Task 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add api/app/scope.py api/app/surveys.py api/tests/test_surveys.py
git commit -m "Phase 3b: survey version lifecycle (edit draft, publish, new version, archive)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Assignments (create, list, computed stores, delete)

**Files:**
- Modify: `api/app/scope.py`
- Modify: `api/app/surveys.py`
- Test: `api/tests/test_surveys.py`

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_surveys.py`:
```python
def _node_id(code):
    from sqlalchemy import text
    from app.db import engine
    with engine.connect() as conn:
        return conn.execute(text("select id from nodes where code = :c"), {"c": code}).scalar()


def _published_version_id(client, token, name):
    s = _find(client, token, name)
    full = client.get(f"/surveys/{s['id']}", headers={"Authorization": f"Bearer {token}"}).json()
    return next(v["id"] for v in full["versions"] if v["published_at"] is not None)


def test_manager_can_assign_within_branch(client, login):
    token = login("sarah@lumenbeauty.com")  # manager pinned at Central
    vid = _published_version_id(client, login("dana@lumenbeauty.com"), "Velvet Lip Shelf Check")
    resp = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("chicago"))},
    )
    assert resp.status_code == 200, resp.text


def test_manager_cannot_assign_sibling_region(client, login):
    token = login("sarah@lumenbeauty.com")  # Central
    vid = _published_version_id(client, login("dana@lumenbeauty.com"), "Velvet Lip Shelf Check")
    resp = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("west"))},
    )
    assert resp.status_code == 404, resp.text


def test_admin_can_assign_anywhere(client, login):
    token = login("dana@lumenbeauty.com")
    vid = _published_version_id(client, token, "Velvet Lip Shelf Check")
    resp = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("west"))},
    )
    assert resp.status_code == 200, resp.text


def test_rep_cannot_assign(client, login):
    token = login("marcus@lumenbeauty.com")  # rep
    vid = _published_version_id(client, login("dana@lumenbeauty.com"), "Velvet Lip Shelf Check")
    resp = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("bayarea"))},
    )
    assert resp.status_code == 403, resp.text


def test_cannot_assign_draft_version(client, login):
    token = login("dana@lumenbeauty.com")
    draft = _create_draft(client, token, "Unpublished For Assign")
    resp = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": draft["versions"][0]["id"], "target_node_id": str(_node_id("west"))},
    )
    assert resp.status_code == 400, resp.text


def test_assignment_stores_by_path(client, login):
    token = login("dana@lumenbeauty.com")
    vid = _published_version_id(client, token, "Velvet Lip Shelf Check")
    created = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("west"))},
    ).json()
    resp = client.get(
        f"/survey-assignments/{created['id']}/stores",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    codes = {s["code"] for s in resp.json()["stores"]}
    assert {"sf", "oakland"} <= codes        # West's stores are covered
    assert "chicago-store" not in codes      # a different region's store is not


def test_store_added_later_is_included(client, login):
    from sqlalchemy import text
    from app.db import engine
    token = login("dana@lumenbeauty.com")
    vid = _published_version_id(client, token, "Velvet Lip Shelf Check")
    created = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("bayarea"))},
    ).json()
    # add a brand-new store under Bay Area AFTER the assignment exists
    with engine.begin() as conn:
        bay = conn.execute(
            text("select id, path, tenant_id from nodes where code = 'bayarea'")
        ).mappings().first()
        nid = conn.execute(
            text(
                "insert into nodes (tenant_id, parent_id, level_order, name, code, chain) "
                "values (:tid, :pid, 3, 'Late Store', 'late-store', 'CVS') returning id"
            ),
            {"tid": bay["tenant_id"], "pid": bay["id"]},
        ).scalar()
        conn.execute(
            text("update nodes set path = :p where id = :id"),
            {"p": f"{bay['path']}{nid}/", "id": nid},
        )
    resp = client.get(
        f"/survey-assignments/{created['id']}/stores",
        headers={"Authorization": f"Bearer {token}"},
    )
    codes = {s["code"] for s in resp.json()["stores"]}
    assert "late-store" in codes  # computed live, not copied


def test_assignment_company_isolation(client, login):
    # Sarah (Central) sees the seeded Central assignment; Avery (Acme) sees none of Lumen's.
    sarah = client.get(
        "/survey-assignments", headers={"Authorization": f"Bearer {login('sarah@lumenbeauty.com')}"}
    )
    assert sarah.status_code == 200, sarah.text
    assert sarah.json()["count"] >= 1
    avery_nodes = client.get(
        "/survey-assignments", headers={"Authorization": f"Bearer {login('avery@acme.com')}"}
    ).json()
    # Acme has no assignments; certainly none pointing at Lumen nodes.
    assert avery_nodes["count"] == 0


def test_delete_assignment(client, login):
    token = login("dana@lumenbeauty.com")
    vid = _published_version_id(client, token, "Velvet Lip Shelf Check")
    created = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("central"))},
    ).json()
    resp = client.delete(
        f"/survey-assignments/{created['id']}", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200, resp.text
    # second delete is a 404 (already gone)
    again = client.delete(
        f"/survey-assignments/{created['id']}", headers={"Authorization": f"Bearer {token}"}
    )
    assert again.status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec -T api pytest api/tests/test_surveys.py -k "assign or stores or delete_assignment" -q`
Expected: FAIL (the assignment endpoints do not exist yet).

- [ ] **Step 3: Add assignment methods to ScopedRepo**

In `api/app/scope.py`, add after `archive_survey`:
```python
    # ----- survey assignments (branch-scoped, like nodes) -----

    _ASSIGNMENT_COLS = ("id, survey_version_id, target_node_id, deadline, "
                        "timezone_basis, created_by, created_at")

    def create_assignment(self, survey_version_id, target_node_id, deadline,
                          timezone_basis, created_by) -> dict | None:
        if self.scope_path is None:
            return None
        with engine.begin() as conn:
            version = conn.execute(
                text(
                    "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
                    "where v.id = cast(:vid as uuid) and s.tenant_id = cast(:tid as uuid) "
                    "and v.published_at is not null"
                ),
                {"vid": str(survey_version_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if version is None:
                raise VersionNotPublishedError()
            node = conn.execute(
                text(
                    "select id from nodes where id = cast(:nid as uuid) "
                    "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"
                ),
                {"nid": str(target_node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            if node is None:
                return None
            row = conn.execute(
                text(
                    "insert into survey_assignments (tenant_id, survey_version_id, target_node_id, "
                    "deadline, timezone_basis, created_by) values (cast(:tid as uuid), "
                    "cast(:vid as uuid), cast(:nid as uuid), :deadline, :tzb, cast(:cb as uuid)) "
                    f"returning {self._ASSIGNMENT_COLS}"
                ),
                {"tid": str(self.tenant_id), "vid": str(survey_version_id),
                 "nid": str(target_node_id), "deadline": deadline,
                 "tzb": timezone_basis, "cb": str(created_by)},
            ).mappings().first()
        return dict(row)

    def list_assignments(self) -> list[dict]:
        if self.scope_path is None:
            return []
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "select a.id, a.survey_version_id, a.target_node_id, a.deadline, "
                    "a.timezone_basis, a.created_by, a.created_at from survey_assignments a "
                    "join nodes n on n.id = a.target_node_id "
                    "where a.tenant_id = cast(:tid as uuid) and n.path like :scope || '%' "
                    "order by a.created_at"
                ),
                {"tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().all()
        return [dict(r) for r in rows]

    def assignment_stores(self, assignment_id) -> list[dict] | None:
        if self.scope_path is None:
            return None
        with engine.connect() as conn:
            target = conn.execute(
                text(
                    "select n.path from survey_assignments a join nodes n on n.id = a.target_node_id "
                    "where a.id = cast(:aid as uuid) and a.tenant_id = cast(:tid as uuid) "
                    "and n.path like :scope || '%'"
                ),
                {"aid": str(assignment_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            if target is None:
                return None
            rows = conn.execute(
                text(
                    "select id, name, code, level_order, path, chain, address, lat, lng, tz "
                    "from nodes where tenant_id = cast(:tid as uuid) and path like :tpath || '%' "
                    "and level_order = (select max(level_order) from org_level_definitions "
                    "where tenant_id = cast(:tid as uuid)) order by path"
                ),
                {"tid": str(self.tenant_id), "tpath": target["path"]},
            ).mappings().all()
        return [dict(r) for r in rows]

    def delete_assignment(self, assignment_id) -> bool:
        if self.scope_path is None:
            return False
        with engine.begin() as conn:
            found = conn.execute(
                text(
                    "select a.id from survey_assignments a join nodes n on n.id = a.target_node_id "
                    "where a.id = cast(:aid as uuid) and a.tenant_id = cast(:tid as uuid) "
                    "and n.path like :scope || '%'"
                ),
                {"aid": str(assignment_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).first()
            if found is None:
                return False
            conn.execute(
                text("delete from survey_assignments where id = cast(:aid as uuid)"),
                {"aid": str(assignment_id)},
            )
        return True
```

- [ ] **Step 4: Add the assignment endpoints to surveys.py**

In `api/app/surveys.py`, add at the end:
```python
@router.get("/survey-assignments")
def list_assignments(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    assignments = repo.list_assignments()
    return {"assignments": assignments, "count": len(assignments)}


@router.post("/survey-assignments")
def create_assignment(
    body: AssignmentCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(require_manager_or_admin),
) -> dict:
    try:
        created = repo.create_assignment(
            body.survey_version_id, body.target_node_id, body.deadline,
            body.timezone_basis, claims["sub"],
        )
    except VersionNotPublishedError:
        raise HTTPException(status_code=400, detail="Survey version not found or not published")
    if created is None:
        raise HTTPException(status_code=404, detail="Target node not found in your scope")
    return created


@router.get("/survey-assignments/{assignment_id}/stores")
def assignment_stores(
    assignment_id: UUID, repo: ScopedRepo = Depends(get_scoped_repo)
) -> dict:
    stores = repo.assignment_stores(assignment_id)
    if stores is None:
        raise HTTPException(status_code=404, detail="Assignment not found in your scope")
    return {"stores": stores, "count": len(stores)}


@router.delete("/survey-assignments/{assignment_id}")
def delete_assignment(
    assignment_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _claims: dict = Depends(require_manager_or_admin),
) -> dict:
    if not repo.delete_assignment(assignment_id):
        raise HTTPException(status_code=404, detail="Assignment not found in your scope")
    return {"deleted": True}
```

- [ ] **Step 5: Apply and run the full survey test file**

Run:
```bash
docker compose restart api
docker compose exec -T api pytest api/tests/test_surveys.py -q
```
Expected: every test in the file PASSES.

- [ ] **Step 6: Run the whole backend suite (no regressions)**

Run: `docker compose exec -T api pytest -q`
Expected: all prior tests plus the new survey tests PASS.

- [ ] **Step 7: Commit**

```bash
git add api/app/scope.py api/app/surveys.py api/tests/test_surveys.py
git commit -m "Phase 3b: survey assignments (scoped create/list/delete + computed stores)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Documentation + final verification

**Files:**
- Modify: `api/README.md`, `db/README.md`, `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`
- Modify: `../hi-fi-intelli/Intelli_Complete_Handoff.md` (the handoff CHANGELOG)

- [ ] **Step 1: Update api/README.md**

Add a plain-English section describing `surveys.py` (the new router), the new `ScopedRepo` survey/assignment methods, and the `require_manager_or_admin` dependency. Match the existing style (one paragraph per file, no em dashes). Note: surveys are company-wide like the catalog; assignments are branch-scoped like nodes; a published version is frozen and editing makes a new version.

- [ ] **Step 2: Update db/README.md**

Add the three new tables (`surveys`, `survey_versions`, `survey_assignments`) to the schema walkthrough, in plain English: what each holds, the `published_at = frozen` rule, and that assignment coverage is computed by node path (not copied).

- [ ] **Step 3: Update CODEBASE_MAP.md**

Add a short paragraph in the "30-second mental model" area noting that, as of Phase 3b, the backend also holds surveys (checklists), their frozen versions, and assignments to org nodes. Add `api/app/surveys.py` to the file map under `api/app/`.

- [ ] **Step 4: Update CHECKING_THE_WORK.md**

Add a "Surveys (Phase 3b)" section showing how to check it with no coding: log in as Dana at `/docs`, `GET /surveys`, create one, publish it, assign it, and `GET /survey-assignments/{id}/stores` to see the computed store list. Note what "good" looks like (a published version cannot be edited; a manager cannot assign outside their branch).

- [ ] **Step 5: Update START_HERE.md**

In section 1, add a "Phase 3b - surveys (done)" bullet group. In section 5 (file structure), add `api/app/surveys.py` with its one-line description. In section 7 ("Where we are right now"), update the status line and the test counts (run the suite to get the exact backend count and use it).

- [ ] **Step 6: Update CONTEXT.md**

Flip the Phase 3b checkbox to `[x]` in the build order, and add a progress-log entry dated 2026-06-16 summarizing what was built (surveys + frozen versions + scoped assignments + validated pass rules, the gate that passed, and the test count).

- [ ] **Step 7: Update the handoff CHANGELOG**

Add a newest-first entry to `../hi-fi-intelli/Intelli_Complete_Handoff.md` dated 2026-06-16 (production: Phase 3b complete), summarizing the surveys engine, the immutability rule, the computed-by-path assignment coverage, the admin-author / manager-assign split, and the gate results. Use a colon after the date, not an em dash.

- [ ] **Step 8: Final full verification**

Run both suites and capture the real counts for the docs:
```bash
docker compose exec -T api pytest -q
pnpm test:admin
```
Expected: both green. Update any test-count numbers in the docs to match the actual output.

- [ ] **Step 9: Commit**

```bash
git add api/README.md db/README.md CODEBASE_MAP.md CHECKING_THE_WORK.md START_HERE.md CONTEXT.md
git add ../hi-fi-intelli/Intelli_Complete_Handoff.md
git commit -m "Phase 3b: docs (READMEs, map, checking guide, START_HERE, CONTEXT, handoff)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Note: `../hi-fi-intelli` is a separate git repo. Commit it from its own root:
```bash
cd ../hi-fi-intelli && git add Intelli_Complete_Handoff.md && git commit -m "CHANGELOG: production Phase 3b (surveys) complete

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" && cd ../intelli-app
```

---

## Done criteria

- All `api/tests/test_surveys.py` tests green: company isolation, auth required, admin-only authoring, draft edit, publish freezes, cannot edit published (409), new version keeps old unchanged, new version requires published latest (409), archive, manager assign in-branch, manager cannot assign sibling (404), admin assign anywhere, rep 403, cannot assign draft (400), stores-by-path, store-added-later included, assignment isolation, delete.
- Full backend suite and `pnpm test:admin` green.
- A live walk-through at `/docs` (create -> edit draft -> publish -> new version -> assign -> list stores) behaves as described.
- All guides updated in the same change set.
```
