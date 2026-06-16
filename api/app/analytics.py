"""The analytics API: read-only views over the response rows. Compliance per node
(completion % + pass %), drill-down to per-product why-it-failed, out-of-stock by
a named count question, and a facings trend. Everything is branch-scoped through
the ScopedRepo and computed live (pass/fail is never stored).
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from .scope import ScopedRepo, get_scoped_repo

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/compliance")
def compliance(
    node_id: UUID | None = None,
    repo: ScopedRepo = Depends(get_scoped_repo),
) -> dict:
    rows = repo.assignment_compliance(node_id)
    if rows is None:
        raise HTTPException(status_code=404, detail="Node not found in your scope")
    return {"rows": rows, "count": len(rows)}
