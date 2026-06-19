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

        company_name = conn.execute(
            text("select name from tenants where id = :tid"),
            {"tid": row["tenant_id"]},
        ).scalar()
        pinned_node_name = conn.execute(
            text("select n.name from assignments a join nodes n on n.id = a.node_id "
                 "where a.tenant_id = :tid and a.user_id = :uid"),
            {"tid": row["tenant_id"], "uid": row["id"]},
        ).scalar()

    token = make_token(row["id"], row["tenant_id"], row["role"])
    return {"token": token, "user": {
        "name": row["name"], "role": row["role"],
        "company_name": company_name, "pinned_node_name": pinned_node_name,
    }}
