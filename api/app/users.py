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
        fields = self.model_fields_set
        if not fields:
            raise ValueError("provide role and/or node_id")
        # node_id may be explicitly null (means unpin); role may not be null.
        if "role" in fields and self.role is None:
            raise ValueError("role cannot be null")
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
