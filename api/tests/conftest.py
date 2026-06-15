"""Test setup: build a throwaway 'intelli_test' database, apply the real
migrations, seed the demo world, and hand tests a client + helpers.

Runs against a REAL Postgres (the db container), never SQLite, so the
path-prefix lookups behave exactly as in production. The test database is
separate from your dev data and rebuilt fresh each test session.
"""
import os
import pathlib
import sys

import psycopg
import pytest

# Make the app package importable (tests live in /app/tests, app in /app/app).
sys.path.insert(0, "/app")

# Point the app at the TEST database before any app module is imported.
_ADMIN = "host=db port=5432 user=intelli password=intelli_dev"
os.environ["DATABASE_URL"] = "postgresql+psycopg://intelli:intelli_dev@db:5432/intelli_test"

MIGRATIONS = pathlib.Path("/app/db/migrations")


def _build_test_db() -> None:
    # Fresh, empty test database (force-close any open connections).
    with psycopg.connect(f"{_ADMIN} dbname=intelli", autocommit=True) as conn:
        conn.execute("drop database if exists intelli_test with (force)")
        conn.execute("create database intelli_test")
    # Apply every migration's up-section as a whole script, in filename order.
    # Each migration manages its own BEGIN/COMMIT, so we hand the entire block to
    # Postgres, which parses comments and statement boundaries correctly (no
    # home-grown semicolon splitting).
    with psycopg.connect(f"{_ADMIN} dbname=intelli_test", autocommit=True) as conn:
        for path in sorted(MIGRATIONS.glob("*.sql")):
            up = path.read_text().split("-- migrate:down")[0]
            conn.execute(up)


@pytest.fixture(scope="session", autouse=True)
def _database():
    _build_test_db()
    from app.seed import run  # imported after env points at the test DB
    run()
    yield


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


@pytest.fixture()
def users():
    """email -> {id, tenant_id, email, role} for the seeded users."""
    from sqlalchemy import text
    from app.db import engine
    with engine.connect() as conn:
        rows = conn.execute(text("select id, tenant_id, email, role from users")).mappings().all()
    return {r["email"]: dict(r) for r in rows}


@pytest.fixture()
def login(client):
    """Returns a helper that logs in through the real API and returns the
    wristband (JWT). Used by the through-the-API tests."""
    def _login(email, password="demo1234"):
        resp = client.post("/auth/login", json={"email": email, "password": password})
        assert resp.status_code == 200, resp.text
        return resp.json()["token"]
    return _login
