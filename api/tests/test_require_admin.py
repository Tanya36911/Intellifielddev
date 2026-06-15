import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.security import make_token, require_admin


@pytest.fixture()
def tiny_app():
    app = FastAPI()

    @app.get("/admin-only")
    def admin_only(claims: dict = Depends(require_admin)) -> dict:
        return {"ok": True, "role": claims["role"]}

    return TestClient(app)


def test_admin_is_allowed(tiny_app):
    token = make_token("u1", "t1", "admin")
    resp = tiny_app.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_manager_is_forbidden(tiny_app):
    token = make_token("u1", "t1", "manager")
    resp = tiny_app.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_rep_is_forbidden(tiny_app):
    token = make_token("u1", "t1", "rep")
    resp = tiny_app.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_no_token_is_unauthorized(tiny_app):
    resp = tiny_app.get("/admin-only")
    assert resp.status_code == 401
