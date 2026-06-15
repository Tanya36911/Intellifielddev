"""Database engine + a simple connectivity check.

Phase 0 only proves the API can reach Postgres. The real schema, the
ScopedRepo (scope-follows-pin), and migrations arrive in Phases 1-2.
"""
from sqlalchemy import create_engine, text

from .config import DATABASE_URL

engine = create_engine(DATABASE_URL, pool_pre_ping=True)


def db_ok() -> bool:
    """Return True if a trivial query against Postgres succeeds."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
