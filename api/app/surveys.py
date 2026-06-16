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
