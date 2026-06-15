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
