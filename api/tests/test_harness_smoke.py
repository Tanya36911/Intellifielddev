from sqlalchemy import text
from app.db import engine


def test_seed_built_the_two_trees():
    with engine.connect() as conn:
        counts = dict(
            conn.execute(
                text(
                    "select t.code, count(*) from nodes n "
                    "join tenants t on t.id = n.tenant_id group by t.code"
                )
            ).all()
        )
    assert counts == {"lumen": 8, "acme": 4}


def test_login_still_works(client):
    resp = client.post(
        "/auth/login",
        json={"email": "dana@lumenbeauty.com", "password": "demo1234"},
    )
    assert resp.status_code == 200
    assert resp.json()["user"]["name"] == "Dana Whitfield"
