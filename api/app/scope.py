"""The scope guard: scope follows the pin.

Every request for scoped data goes through get_scoped_repo, which reads the
caller's wristband (JWT), looks up the node they are pinned to, and returns a
ScopedRepo. The ScopedRepo is the ONLY object allowed to query scoped tables;
it automatically limits every query to the caller's tenant and the subtree
under their pinned node, so no endpoint can forget the filter.
"""
import json

from fastapi import Depends
from sqlalchemy import text

from .db import engine
from .security import current_claims


class PublishedVersionError(Exception):
    """Tried to edit a version that is already published (frozen)."""


class NoDraftError(Exception):
    """Tried to publish a survey that has no current draft version."""


class DraftExistsError(Exception):
    """Tried to start a new version while an unpublished draft already exists."""


class VersionNotPublishedError(Exception):
    """Tried to assign a survey version that is missing or not published."""


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

    # ----- catalog (company-wide: filtered by tenant only, not by path) -----

    _SKU_COLS = "id, line, variant, upc, color, status, reference_images, created_at"

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
