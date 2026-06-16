"""The analytics API: read-only views over the response rows. Compliance per node
(completion % + pass %), drill-down to per-product why-it-failed, out-of-stock by
a named count question, and a facings trend. Everything is branch-scoped through
the ScopedRepo and computed live (pass/fail is never stored).
"""
from datetime import datetime
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


@router.get("/compliance/drill")
def compliance_drill(
    node_id: UUID,
    survey_version_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
) -> dict:
    result = repo.compliance_drill(node_id, survey_version_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Node or version not found in your scope")
    return result


@router.get("/oos")
def oos(
    survey_version_id: UUID,
    question_id: str,
    node_id: UUID | None = None,
    repo: ScopedRepo = Depends(get_scoped_repo),
) -> dict:
    try:
        rows = repo.oos_by_sku(survey_version_id, question_id, node_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if rows is None:
        raise HTTPException(status_code=404, detail="Node or version not found in your scope")
    return {"rows": rows, "count": len(rows)}


@router.get("/trend")
def trend(
    survey_version_id: UUID,
    question_id: str,
    sku_id: UUID,
    node_id: UUID | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    repo: ScopedRepo = Depends(get_scoped_repo),
) -> dict:
    try:
        result = repo.facings_trend(survey_version_id, question_id, sku_id,
                                    node_id, date_from, date_to)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="Node or version not found in your scope")
    return result
