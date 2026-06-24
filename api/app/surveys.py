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
    required: bool = False
    unit: str | None = None
    lines: list[str] = []

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
