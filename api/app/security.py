"""Password hashing (Argon2) and JWT tokens.

Passwords are never stored as plain text - only as a one-way Argon2 hash.
On login we hash the attempt and compare. A JWT is a signed token the client
sends on later requests to prove who it is (and which tenant + role).
"""
import datetime as dt
import os

import jwt
from passlib.context import CryptContext

# Argon2 is the current best-practice password hashing algorithm.
_pwd = CryptContext(schemes=["argon2"], deprecated="auto")

# In production this secret comes from the environment and is long + random.
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"
TOKEN_HOURS = 12


def hash_password(plain: str) -> str:
    """Turn a plain password into a one-way hash for storage."""
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Check a login attempt against the stored hash."""
    try:
        return _pwd.verify(plain, hashed)
    except Exception:
        return False


def make_token(user_id, tenant_id, role: str) -> str:
    """Create a signed JWT carrying who the user is, their tenant, and role."""
    payload = {
        "sub": str(user_id),
        "tenant_id": str(tenant_id),
        "role": role,
        "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=TOKEN_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def read_token(token: str) -> dict:
    """Verify a token's signature + expiry and return its contents."""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
