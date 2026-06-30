"""Bulk node import (POST /nodes/bulk). Admin-only, branch-scoped, reuses the
node-insert path. Rows are {level, name, parent}: valid rows are created, the rest
reported per-row. Tests create then delete (deepest-first) so the seeded tree (and
other suites' counts) are unchanged."""


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _nodes(client, token):
    return client.get("/nodes", headers=_h(token)).json()["nodes"]


def _find(client, token, name):
    return next(n for n in _nodes(client, token) if n["name"] == name)


def _cleanup(client, token, names):
    """Delete the named nodes deepest-first so a parent is empty when removed."""
    nodes = [n for n in _nodes(client, token) if n["name"] in names]
    for n in sorted(nodes, key=lambda x: -x["level_order"]):
        client.delete(f"/nodes/{n['id']}", headers=_h(token))


def test_bulk_import_creates_subtree(client, login):
    token = login("dana@lumenbeauty.com")
    rows = [
        {"level": "District", "name": "Bulk District", "parent": "West"},
        {"level": "Store", "name": "Bulk Store A", "parent": "Bulk District"},
        {"level": "Store", "name": "Bulk Store B", "parent": "Bulk District"},
    ]
    resp = client.post("/nodes/bulk", headers=_h(token), json={"rows": rows})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["created"] == 3
    assert body["errors"] == []
    names = {n["name"] for n in _nodes(client, token)}
    assert {"Bulk District", "Bulk Store A", "Bulk Store B"} <= names
    _cleanup(client, token, {"Bulk Store A", "Bulk Store B", "Bulk District"})


def test_bulk_unknown_level_errors_only_that_row(client, login):
    token = login("dana@lumenbeauty.com")
    rows = [
        {"level": "District", "name": "Keeper District", "parent": "West"},
        {"level": "Borough", "name": "Bad Level Node", "parent": "West"},
    ]
    body = client.post("/nodes/bulk", headers=_h(token), json={"rows": rows}).json()
    assert body["created"] == 1
    assert len(body["errors"]) == 1
    assert body["errors"][0]["row"] == 1
    assert "level" in body["errors"][0]["reason"].lower()
    _cleanup(client, token, {"Keeper District"})


def test_bulk_parent_not_found(client, login):
    token = login("dana@lumenbeauty.com")
    rows = [{"level": "Store", "name": "Orphan Store", "parent": "Nowhere District"}]
    body = client.post("/nodes/bulk", headers=_h(token), json={"rows": rows}).json()
    assert body["created"] == 0
    assert "not found" in body["errors"][0]["reason"].lower()


def test_bulk_ambiguous_parent(client, login):
    token = login("dana@lumenbeauty.com")
    west = _find(client, token, "West")
    central = _find(client, token, "Central")
    a = client.post("/nodes", headers=_h(token),
                    json={"parent_id": west["id"], "name": "Dup District"}).json()
    b = client.post("/nodes", headers=_h(token),
                    json={"parent_id": central["id"], "name": "Dup District"}).json()
    rows = [{"level": "Store", "name": "Confused Store", "parent": "Dup District"}]
    body = client.post("/nodes/bulk", headers=_h(token), json={"rows": rows}).json()
    assert body["created"] == 0
    assert "ambiguous" in body["errors"][0]["reason"].lower()
    client.delete(f"/nodes/{a['id']}", headers=_h(token))
    client.delete(f"/nodes/{b['id']}", headers=_h(token))


def test_bulk_company_root_refused(client, login):
    token = login("dana@lumenbeauty.com")
    rows = [{"level": "Company", "name": "Second HQ", "parent": ""}]
    body = client.post("/nodes/bulk", headers=_h(token), json={"rows": rows}).json()
    assert body["created"] == 0
    assert len(body["errors"]) == 1


def test_bulk_wrong_parent_level(client, login):
    # A Store's parent must be a District. Pointing a Store at a Region (West) has no
    # district named "West", so the parent does not resolve.
    token = login("dana@lumenbeauty.com")
    rows = [{"level": "Store", "name": "Misplaced Store", "parent": "West"}]
    body = client.post("/nodes/bulk", headers=_h(token), json={"rows": rows}).json()
    assert body["created"] == 0
    assert len(body["errors"]) == 1


def test_bulk_non_admin_forbidden(client, login):
    rows = [{"level": "District", "name": "Nope", "parent": "Central"}]
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        resp = client.post("/nodes/bulk", headers=_h(login(email)), json={"rows": rows})
        assert resp.status_code == 403, f"{email} got {resp.status_code}"


def test_bulk_out_of_scope_parent(client, login):
    # Dana (Lumen) cannot attach to an Acme node (a different tenant): the parent
    # name does not resolve inside her scope, so the row errors and nothing is made.
    acme_root_name = _nodes(client, login("avery@acme.com"))[0]["name"]
    rows = [{"level": "Region", "name": "Sneaky Region", "parent": acme_root_name}]
    body = client.post("/nodes/bulk", headers=_h(login("dana@lumenbeauty.com")),
                       json={"rows": rows}).json()
    assert body["created"] == 0
    assert len(body["errors"]) == 1
