"""The hierarchy API. GET /nodes returns the slice of the org tree the caller
is allowed to see, proving the scope guard holds end to end."""
from fastapi import APIRouter, Depends

from .scope import ScopedRepo, get_scoped_repo

router = APIRouter(tags=["hierarchy"])


@router.get("/nodes")
def list_nodes(repo: ScopedRepo = Depends(get_scoped_repo)) -> dict:
    nodes = repo.list_nodes()
    return {"nodes": nodes, "count": len(nodes)}
