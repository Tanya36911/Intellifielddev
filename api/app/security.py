"""Password hashing (Argon2) and JWT tokens.

Passwords are never stored as plain text - only as a one-way Argon2 hash.
On login we hash the attempt and compare. A JWT is a signed token the client
sends on later requests to prove who it is (and which tenant + role).
"""
import datetime as dt

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext

from .config import JWT_ALG, JWT_SECRET, TOKEN_HOURS

# Argon2 is the current best-practice password hashing algorithm.
_pwd = CryptContext(schemes=["argon2"], deprecated="auto")


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


_bearer = HTTPBearer(auto_error=False)


def current_claims(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Verify the caller's wristband (JWT) on an incoming request and return
    its contents. Raises 401 if it is missing, invalid, or expired."""
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return read_token(creds.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_admin(claims: dict = Depends(current_claims)) -> dict:
    """Allow only admins past. Returns the caller's claims, or raises 403 for
    any non-admin (managers and reps). Used on catalog write endpoints."""
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return claims
