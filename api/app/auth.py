"""Auth endpoints. Phase 1: just login.

POST /auth/login  { email, password }  ->  { token, user }
Returns 401 on a wrong email or password (without saying which - that leaks
less to an attacker).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from .db import engine
from .security import make_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(body: LoginIn) -> dict:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "select id, tenant_id, name, role, password_hash "
                "from users where email = :email"
            ),
            {"email": body.email},
        ).mappings().first()

    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = make_token(row["id"], row["tenant_id"], row["role"])
    return {"token": token, "user": {"name": row["name"], "role": row["role"]}}
