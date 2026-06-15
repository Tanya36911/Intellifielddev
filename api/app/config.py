"""Central configuration. Every secret and environment-specific setting is read
here, in ONE place, so nothing sensitive is hardcoded anywhere else in the code.

Where the values come from:
- Local development: docker-compose passes them in (and reads the secrets from
  your .env file, which is never committed to git).
- Production: set them in the real deploy environment.

Secrets have NO baked-in default on purpose. If a required one is missing, the
app refuses to start with a clear error, which is far safer than silently
falling back to a weak, publicly-known value.
"""
import os


def _required(name: str) -> str:
    """Read a required environment variable, or fail loudly if it is missing."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"Missing required environment variable {name}. "
            "Set it in your .env file (local) or the deploy environment. "
            "See .env.example."
        )
    return value


# The database connection string (carries the DB password).
DATABASE_URL = _required("DATABASE_URL")

# The secret used to sign login wristbands (JWTs). Must be long and random in
# production; never the same across environments.
JWT_SECRET = _required("JWT_SECRET")

# Non-secret token settings.
JWT_ALG = "HS256"
TOKEN_HOURS = 12
