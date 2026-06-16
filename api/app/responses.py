"""The responses API. A response is one completed survey filled in at a store.
It is stored as atomic per-product rows (see ScopedRepo) and read back with
pass/fail computed live by compliance.py, never stored. Submission is
scope-follows-pin (the store must be in the caller's branch) and published-
version only. Any signed-in user may submit for an in-scope store.
"""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .scope import ScopedRepo, VersionNotPublishedError, get_scoped_repo
from .security import current_claims

router = APIRouter(tags=["responses"])


class Answer(BaseModel):
    question_id: str = Field(min_length=1)
    sku_id: UUID | None = None
    value: Any = None  # number / bool / str / list / None (blank)


class ResponseCreate(BaseModel):
    survey_version_id: UUID
    store_node_id: UUID
    answers: list[Answer] = []


@router.post("/responses")
def submit_response(
    body: ResponseCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    # No role guard on purpose: any authenticated user may submit for a store in
    # their own branch (typically the rep). The ScopedRepo enforces the branch.
    claims: dict = Depends(current_claims),
) -> dict:
    try:
        result = repo.create_response(
            body.survey_version_id,
            body.store_node_id,
            [a.model_dump(mode="json") for a in body.answers],
            claims["sub"],
        )
    except VersionNotPublishedError:
        raise HTTPException(status_code=400, detail="Survey version not found or not published")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if result is None:
        raise HTTPException(status_code=404, detail="Store not found in your scope")
    return result


@router.get("/responses")
def list_responses(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    rows = repo.list_responses()
    return {"responses": rows, "count": len(rows)}


@router.get("/responses/{response_id}")
def get_response(
    response_id: UUID, repo: ScopedRepo = Depends(get_scoped_repo)
) -> dict:
    result = repo.get_response(response_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Response not found in your scope")
    return result
