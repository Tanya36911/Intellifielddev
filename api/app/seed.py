"""Seed one demo tenant + one admin user so you can log in.

Run after migrations:
    docker compose exec api python -m app.seed

Idempotent: running it twice won't create duplicates.
Login: dana@lumenbeauty.com / demo1234
"""
from sqlalchemy import text

from .db import engine
from .security import hash_password


def run() -> None:
    with engine.begin() as conn:  # begin() = a transaction (all-or-nothing)
        tenant_id = conn.execute(
            text(
                "insert into tenants (name, code) values ('Lumen Beauty', 'lumen') "
                "on conflict (code) do update set name = excluded.name "
                "returning id"
            )
        ).scalar()

        conn.execute(
            text(
                "insert into users (tenant_id, email, name, role, password_hash) "
                "values (:tid, 'dana@lumenbeauty.com', 'Dana Whitfield', 'admin', :ph) "
                "on conflict (tenant_id, email) do nothing"
            ),
            {"tid": tenant_id, "ph": hash_password("demo1234")},
        )
    print("Seeded: Lumen Beauty + dana@lumenbeauty.com / demo1234")


if __name__ == "__main__":
    run()
