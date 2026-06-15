import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.security import current_claims, make_token


@pytest.fixture()
def tiny_app():
    app = FastAPI()

    @app.get("/whoami")
    def whoami(claims: dict = Depends(current_claims)) -> dict:
        return {"sub": claims["sub"], "role": claims["role"]}

    return TestClient(app)


def test_valid_token_passes(tiny_app):
    token = make_token("user-1", "tenant-1", "admin")
    resp = tiny_app.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"sub": "user-1", "role": "admin"}


def test_missing_token_is_401(tiny_app):
    resp = tiny_app.get("/whoami")
    assert resp.status_code == 401


def test_garbage_token_is_401(tiny_app):
    resp = tiny_app.get("/whoami", headers={"Authorization": "Bearer not-a-token"})
    assert resp.status_code == 401
