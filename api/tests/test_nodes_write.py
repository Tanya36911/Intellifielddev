"""Node-editing brick (setup wizard slice 1). Admin-only add/rename/delete on the
org tree, branch-scoped, with delete blocked unless the node is empty. Add tests
clean up after themselves so the seeded tree (and other suites' counts) are
unchanged."""


def _nodes(client, token):
    resp = client.get("/nodes", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return resp.json()["nodes"]


def _find(client, token, name):
    return next(n for n in _nodes(client, token) if n["name"] == name)


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ----- POST /nodes -----

def test_admin_can_add_child(client, login):
    token = login("dana@lumenbeauty.com")
    west = _find(client, token, "West")
    resp = client.post("/nodes", headers=_h(token),
                       json={"parent_id": west["id"], "name": "North Bay"})
    assert resp.status_code == 200, resp.text
    node = resp.json()
    assert node["name"] == "North Bay"
    assert node["level_order"] == west["level_order"] + 1
    assert node["parent_id"] == west["id"]
    assert node["code"] == "north-bay"  # auto-generated from the name
    assert node["path"].startswith(west["path"])  # sits under the parent
    # clean up
    assert client.delete(f"/nodes/{node['id']}", headers=_h(token)).status_code == 200


def test_add_below_store_refused(client, login):
    token = login("dana@lumenbeauty.com")
    sf = _find(client, token, "SF store")  # locked bottom level
    resp = client.post("/nodes", headers=_h(token),
                       json={"parent_id": sf["id"], "name": "Aisle 5"})
    assert resp.status_code == 400


def test_auto_code_uniqueness(client, login):
    token = login("dana@lumenbeauty.com")
    root = _find(client, token, "Lumen Beauty")
    a = client.post("/nodes", headers=_h(token), json={"parent_id": root["id"], "name": "Test Region"}).json()
    b = client.post("/nodes", headers=_h(token), json={"parent_id": root["id"], "name": "Test Region"}).json()
    assert a["code"] != b["code"]
    assert a["code"] == "test-region" and b["code"] == "test-region-2"
    client.delete(f"/nodes/{a['id']}", headers=_h(token))
    client.delete(f"/nodes/{b['id']}", headers=_h(token))


def test_non_admin_cannot_add(client, login):
    west = _find(client, login("dana@lumenbeauty.com"), "West")
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        resp = client.post("/nodes", headers=_h(login(email)),
                          json={"parent_id": west["id"], "name": "Nope"})
        assert resp.status_code == 403, f"{email} got {resp.status_code}"


def test_add_parent_out_of_scope(client, login):
    acme_root = _nodes(client, login("avery@acme.com"))[0]["id"]
    resp = client.post("/nodes", headers=_h(login("dana@lumenbeauty.com")),
                       json={"parent_id": acme_root, "name": "Sneaky"})
    assert resp.status_code == 404


# ----- PATCH /nodes/{id} -----

def test_rename_changes_name_not_code(client, login):
    token = login("dana@lumenbeauty.com")
    west = _find(client, token, "West")
    node = client.post("/nodes", headers=_h(token),
                      json={"parent_id": west["id"], "name": "Temp District"}).json()
    original_code = node["code"]
    resp = client.patch(f"/nodes/{node['id']}", headers=_h(token), json={"name": "Renamed District"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Renamed District"
    assert resp.json()["code"] == original_code  # code is permanent
    client.delete(f"/nodes/{node['id']}", headers=_h(token))


def test_patch_out_of_scope(client, login):
    acme_node = _nodes(client, login("avery@acme.com"))[0]["id"]
    resp = client.patch(f"/nodes/{acme_node}", headers=_h(login("dana@lumenbeauty.com")),
                       json={"name": "Hacked"})
    assert resp.status_code == 404


def test_patch_no_fields_rejected(client, login):
    token = login("dana@lumenbeauty.com")
    west = _find(client, token, "West")
    assert client.patch(f"/nodes/{west['id']}", headers=_h(token), json={}).status_code == 422


# ----- DELETE /nodes/{id} -----

def test_delete_empty_leaf(client, login):
    token = login("dana@lumenbeauty.com")
    west = _find(client, token, "West")
    node = client.post("/nodes", headers=_h(token),
                      json={"parent_id": west["id"], "name": "Disposable"}).json()
    assert client.delete(f"/nodes/{node['id']}", headers=_h(token)).status_code == 200
    assert all(n["id"] != node["id"] for n in _nodes(client, token))  # really gone


def test_delete_refused_when_has_children(client, login):
    token = login("dana@lumenbeauty.com")
    west = _find(client, token, "West")  # has Bay Area beneath it
    resp = client.delete(f"/nodes/{west['id']}", headers=_h(token))
    assert resp.status_code == 409
    assert "child" in resp.json()["detail"].lower()


def test_delete_refused_when_user_pinned(client, login):
    # Build a fresh store leaf (no children, no responses) with a user pinned to
    # it, so the only blocker is the pinned user.
    token = login("dana@lumenbeauty.com")
    bay = _find(client, token, "Bay Area")
    store = client.post("/nodes", headers=_h(token),
                       json={"parent_id": bay["id"], "name": "Pin Test Store", "chain": "CVS"}).json()
    user = client.post("/users", headers=_h(token),
                      json={"name": "Pin Tester", "email": "pintester@lumenbeauty.com",
                            "role": "rep", "password": "changeme123", "node_id": store["id"]}).json()
    resp = client.delete(f"/nodes/{store['id']}", headers=_h(token))
    assert resp.status_code == 409
    assert "pinned" in resp.json()["detail"].lower()
    # unpin the user, then the now-empty store is deletable (cleanup)
    client.patch(f"/users/{user['id']}", headers=_h(token), json={"node_id": None})
    assert client.delete(f"/nodes/{store['id']}", headers=_h(token)).status_code == 200


def test_delete_refused_when_has_responses(client, login):
    token = login("dana@lumenbeauty.com")
    sf = _find(client, token, "SF store")  # the seed adds SF responses
    resp = client.delete(f"/nodes/{sf['id']}", headers=_h(token))
    assert resp.status_code == 409


def test_non_admin_cannot_delete(client, login):
    west = _find(client, login("dana@lumenbeauty.com"), "West")
    resp = client.delete(f"/nodes/{west['id']}", headers=_h(login("sarah@lumenbeauty.com")))
    assert resp.status_code == 403
