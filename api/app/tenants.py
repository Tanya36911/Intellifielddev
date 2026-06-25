"""The tenant-config API. GET /tenants returns the caller's company config (any
signed-in user); PATCH /tenants updates it (admin only). Tenant-scoped through the
ScopedRepo, so a caller only ever reads or edits their own company. `code` is a
permanent internal id and is not patchable."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from .scope import ScopedRepo, get_scoped_repo
from .security import require_admin

router = APIRouter(tags=["tenants"])


class TenantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    payroll_enabled: bool | None = None

    @model_validator(mode="after")
    def _at_least_one(self):
        if not self.model_fields_set:
            raise ValueError("provide name and/or payroll_enabled")
        return self


@router.get("/tenants")
def get_tenant(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    tenant = repo.get_tenant()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return tenant


@router.patch("/tenants")
def update_tenant(
    body: TenantUpdate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    updated = repo.update_tenant(body.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return updated
