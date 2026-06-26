"""The hierarchy API. GET /nodes returns the slice of the org tree the caller is
allowed to see; GET /org-levels returns the company's level names. POST/PATCH/
DELETE /nodes add, rename, and delete nodes (admin only), the editing brick the
setup wizard and the editable Hierarchy screen need."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from .scope import ScopedRepo, get_scoped_repo
from .security import require_admin

router = APIRouter(tags=["hierarchy"])


class NodeCreate(BaseModel):
    parent_id: UUID
    name: str = Field(min_length=1)
    chain: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    tz: str | None = None


class NodeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    chain: str | None = None
    address: str | None = None
    lat: float | None = None
    lng: float | None = None
    tz: str | None = None

    @model_validator(mode="after")
    def _at_least_one(self):
        if not self.model_fields_set:
            raise ValueError("provide at least one field to update")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self


@router.get("/nodes")
def list_nodes(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    nodes = repo.list_nodes()
    return {"nodes": nodes, "count": len(nodes)}


@router.get("/org-levels")
def list_org_levels(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    """The company's org level names (Company, Region, ... Store), in order, so a
    screen can label a node's numeric level_order. Tenant-scoped (company-wide)."""
    levels = repo.list_org_levels()
    return {"levels": levels, "count": len(levels)}


@router.post("/nodes")
def create_node(
    body: NodeCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    try:
        node = repo.create_node(
            body.parent_id, body.name,
            body.model_dump(exclude={"parent_id", "name"}),
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Cannot add a node below the lowest level")
    if node is None:
        raise HTTPException(status_code=404, detail="Parent node not found in your scope")
    return node


@router.patch("/nodes/{node_id}")
def update_node(
    node_id: UUID,
    body: NodeUpdate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    updated = repo.update_node(node_id, body.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="Node not found in your scope")
    return updated


@router.delete("/nodes/{node_id}")
def delete_node(
    node_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _admin: dict = Depends(require_admin),
) -> dict:
    result = repo.delete_node(node_id)
    if result == "not_found":
        raise HTTPException(status_code=404, detail="Node not found in your scope")
    if result is not None:
        raise HTTPException(status_code=409, detail=f"Cannot delete this node: {result}")
    return {"ok": True}
