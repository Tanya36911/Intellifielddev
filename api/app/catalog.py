"""The catalog API. GET /skus lists a company's products (any signed-in user in
the company); POST /skus and PATCH /skus/{id} add or edit products (admins
only). All access goes through the ScopedRepo, so it is always company-limited.
"""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .scope import ScopedRepo, get_scoped_repo
from .security import require_admin

router = APIRouter(tags=["catalog"])


class SkuCreate(BaseModel):
    line: str = Field(min_length=1)
    variant: str = Field(min_length=1)
    upc: str = Field(min_length=1)
    color: str | None = None
    status: Literal["active", "discontinued"] = "active"
    reference_images: list[dict] = []


class SkuUpdate(BaseModel):
    line: str | None = Field(default=None, min_length=1)
    variant: str | None = Field(default=None, min_length=1)
    upc: str | None = Field(default=None, min_length=1)
    color: str | None = None
    status: Literal["active", "discontinued"] | None = None
    reference_images: list[dict] | None = None


@router.get("/skus")
def list_skus(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    skus = repo.list_skus()
    return {"skus": skus, "count": len(skus)}


@router.post("/skus")
def create_sku(
    body: SkuCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    return repo.create_sku(
        body.line, body.variant, body.upc, body.color, body.status, body.reference_images
    )


@router.patch("/skus/{sku_id}")
def update_sku(
    sku_id: UUID,
    body: SkuUpdate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    updated = repo.update_sku(sku_id, body.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return updated
