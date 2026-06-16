"""Intelli API — Phase 0 skeleton.

Just enough to prove the plumbing: the API boots, serves docs, can reach
Postgres, and is reachable from the web app (CORS). Auth, tenancy, and the
scope guard come in Phases 1-2.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import router as auth_router
from .hierarchy import router as hierarchy_router
from .catalog import router as catalog_router
from .surveys import router as surveys_router
from .db import db_ok

app = FastAPI(title="Intelli API", version="0.0.0")

# Dev CORS: let the local web apps (Vite) call the API. Tightened in prod.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router)
app.include_router(hierarchy_router)
app.include_router(catalog_router)
app.include_router(surveys_router)


@app.get("/health")
def health() -> dict:
    """Liveness: the API process is up."""
    return {"status": "ok", "service": "intelli-api", "version": "0.0.0"}


@app.get("/health/db")
def health_db() -> dict:
    """Readiness: the API can reach Postgres."""
    ok = db_ok()
    return {"database": "ok" if ok else "unreachable"}
