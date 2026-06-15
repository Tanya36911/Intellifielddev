"""Seed demo tenants, the org tree, users, and their pins, so you can log in
and so the isolation tests have a known world to check.

Run after migrations:
    docker compose exec api python -m app.seed

Idempotent: running it twice will not create duplicates.

The world it builds (scope = a pinned node AND everything below it):
  Lumen Beauty (tenant 'lumen')                 Acme Cosmetics (tenant 'acme')
    West > Bay Area > SF[CVS], Oakland[Walmart]    East > Boston > Boston store[CVS]
    Central > Chicago > Chicago store[CVS]
  Users (password demo1234):
    dana@lumenbeauty.com   admin   pinned at Lumen root
    sarah@lumenbeauty.com  manager pinned at Central
    marcus@lumenbeauty.com rep     pinned at Bay Area
    newbie@lumenbeauty.com rep     NO pin (sees nothing)
    avery@acme.com         admin   pinned at Acme root
"""
from sqlalchemy import text

from .db import engine
from .security import hash_password

LEVELS = ["Company", "Region", "District", "Store"]


def _tenant(conn, name, code):
    return conn.execute(
        text(
            "insert into tenants (name, code) values (:name, :code) "
            "on conflict (code) do update set name = excluded.name returning id"
        ),
        {"name": name, "code": code},
    ).scalar()


def _levels(conn, tenant_id):
    for order, name in enumerate(LEVELS):
        locked = order in (0, len(LEVELS) - 1)
        conn.execute(
            text(
                "insert into org_level_definitions (tenant_id, level_order, name, locked) "
                "values (:tid, :lo, :name, :locked) "
                "on conflict (tenant_id, level_order) do update set name = excluded.name"
            ),
            {"tid": tenant_id, "lo": order, "name": name, "locked": locked},
        )


def _node(conn, tenant_id, parent, level_order, name, code, **store):
    """Insert (or update) a node and set its materialized path. parent is the
    dict returned for the parent node, or None for a root."""
    node_id = conn.execute(
        text(
            "insert into nodes (tenant_id, parent_id, level_order, name, code, "
            "chain, address, lat, lng, tz) "
            "values (:tid, :pid, :lo, :name, :code, :chain, :address, :lat, :lng, :tz) "
            "on conflict (tenant_id, code) do update set name = excluded.name, "
            "parent_id = excluded.parent_id, level_order = excluded.level_order, "
            "chain = excluded.chain returning id"
        ),
        {
            "tid": tenant_id,
            "pid": parent["id"] if parent else None,
            "lo": level_order,
            "name": name,
            "code": code,
            "chain": store.get("chain"),
            "address": store.get("address"),
            "lat": store.get("lat"),
            "lng": store.get("lng"),
            "tz": store.get("tz"),
        },
    ).scalar()
    parent_path = parent["path"] if parent else "/"
    path = f"{parent_path}{node_id}/"
    conn.execute(
        text("update nodes set path = :path where id = :id"),
        {"path": path, "id": node_id},
    )
    return {"id": node_id, "path": path}


def _user(conn, tenant_id, email, name, role, node):
    """Insert (or update) a user and pin them to node (or no pin if node None)."""
    user_id = conn.execute(
        text(
            "insert into users (tenant_id, email, name, role, password_hash) "
            "values (:tid, :email, :name, :role, :ph) "
            "on conflict (tenant_id, email) do update set name = excluded.name, "
            "role = excluded.role returning id"
        ),
        {"tid": tenant_id, "email": email, "name": name, "role": role,
         "ph": hash_password("demo1234")},
    ).scalar()
    if node is not None:
        conn.execute(
            text(
                "insert into assignments (tenant_id, user_id, node_id) "
                "values (:tid, :uid, :nid) "
                "on conflict (tenant_id, user_id) do update set node_id = excluded.node_id"
            ),
            {"tid": tenant_id, "uid": user_id, "nid": node["id"]},
        )
    return user_id


def run() -> None:
    with engine.begin() as conn:
        # ----- Lumen Beauty -----
        lumen = _tenant(conn, "Lumen Beauty", "lumen")
        _levels(conn, lumen)
        l_root = _node(conn, lumen, None, 0, "Lumen Beauty", "lumen-co")
        west = _node(conn, lumen, l_root, 1, "West", "west")
        bayarea = _node(conn, lumen, west, 2, "Bay Area", "bayarea")
        _node(conn, lumen, bayarea, 3, "SF store", "sf", chain="CVS")
        _node(conn, lumen, bayarea, 3, "Oakland store", "oakland", chain="Walmart")
        central = _node(conn, lumen, l_root, 1, "Central", "central")
        chicago = _node(conn, lumen, central, 2, "Chicago", "chicago")
        _node(conn, lumen, chicago, 3, "Chicago store", "chicago-store", chain="CVS")

        _user(conn, lumen, "dana@lumenbeauty.com", "Dana Whitfield", "admin", l_root)
        _user(conn, lumen, "sarah@lumenbeauty.com", "Sarah Mitchell", "manager", central)
        _user(conn, lumen, "marcus@lumenbeauty.com", "Marcus Bell", "rep", bayarea)
        _user(conn, lumen, "newbie@lumenbeauty.com", "Newbie NoPin", "rep", None)

        # ----- Acme Cosmetics (proves cross-tenant isolation) -----
        acme = _tenant(conn, "Acme Cosmetics", "acme")
        _levels(conn, acme)
        a_root = _node(conn, acme, None, 0, "Acme Cosmetics", "acme-co")
        east = _node(conn, acme, a_root, 1, "East", "east")
        boston = _node(conn, acme, east, 2, "Boston", "boston")
        _node(conn, acme, boston, 3, "Boston store", "boston-store", chain="CVS")

        _user(conn, acme, "avery@acme.com", "Avery Stone", "admin", a_root)

    print("Seeded Lumen (8 nodes) + Acme (4 nodes) + 5 users with pins.")


if __name__ == "__main__":
    run()
