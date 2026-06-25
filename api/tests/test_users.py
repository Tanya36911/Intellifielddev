"""Users brick. GET /users is branch-scoped (scope follows the pin); POST/PATCH
are admin-only; the team never leaks across companies."""


def _users(client, token):
    resp = client.get("/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _post(client, token, **body):
    return client.post("/users", headers={"Authorization": f"Bearer {token}"}, json=body)


def _patch(client, token, uid, **body):
    return client.patch(f"/users/{uid}", headers={"Authorization": f"Bearer {token}"}, json=body)


def _find(client, token, email):
    return next(u for u in _users(client, token)["users"] if u["email"] == email)


# ----- GET /users -----

def test_admin_sees_whole_company(client, login):
    data = _users(client, login("dana@lumenbeauty.com"))
    emails = {u["email"] for u in data["users"]}
    # Dana is pinned at the company root, so she sees every Lumen user,
    # including the unpinned newbie.
    assert {"dana@lumenbeauty.com", "sarah@lumenbeauty.com",
            "marcus@lumenbeauty.com", "newbie@lumenbeauty.com"} <= emails
    assert "avery@acme.com" not in emails  # no cross-company leak


def test_company_isolation_acme(client, login):
    data = _users(client, login("avery@acme.com"))
    emails = {u["email"] for u in data["users"]}
    assert "avery@acme.com" in emails
    assert all(not e.endswith("@lumenbeauty.com") for e in emails)


def test_pinned_node_fields_present(client, login):
    data = _users(client, login("dana@lumenbeauty.com"))
    sarah = next(u for u in data["users"] if u["email"] == "sarah@lumenbeauty.com")
    assert sarah["role"] == "manager"
    assert sarah["pinned_node_name"] == "Central"
    assert sarah["pinned_node_level_order"] == 1
    newbie = next(u for u in data["users"] if u["email"] == "newbie@lumenbeauty.com")
    assert newbie["pinned_node_id"] is None
    assert newbie["pinned_node_name"] is None


def test_manager_sees_only_their_branch(client, login):
    # Sarah is a manager pinned at Central. She sees herself, not Marcus
    # (pinned under West) and not the company-wide unpinned newbie.
    data = _users(client, login("sarah@lumenbeauty.com"))
    emails = {u["email"] for u in data["users"]}
    assert "sarah@lumenbeauty.com" in emails
    assert "marcus@lumenbeauty.com" not in emails
    assert "newbie@lumenbeauty.com" not in emails


def test_unpinned_caller_sees_none(client, login):
    data = _users(client, login("newbie@lumenbeauty.com"))
    assert data["users"] == []


def test_users_requires_auth(client):
    assert client.get("/users").status_code == 401


# ----- POST /users -----

def test_admin_can_add_and_pin_user(client, login):
    token = login("dana@lumenbeauty.com")
    nodes = client.get("/nodes", headers={"Authorization": f"Bearer {token}"}).json()["nodes"]
    west = next(n for n in nodes if n["name"] == "West")
    resp = _post(client, token, name="Jordan Lee", email="jordan@lumenbeauty.com",
                 role="rep", password="changeme123", node_id=west["id"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["email"] == "jordan@lumenbeauty.com"
    assert body["pinned_node_name"] == "West"
    assert any(u["email"] == "jordan@lumenbeauty.com" for u in _users(client, token)["users"])


def test_add_user_without_node_is_unpinned(client, login):
    token = login("dana@lumenbeauty.com")
    resp = _post(client, token, name="No Pin", email="nopin2@lumenbeauty.com",
                 role="rep", password="changeme123")
    assert resp.status_code == 200, resp.text
    assert resp.json()["pinned_node_id"] is None


def test_non_admin_cannot_add_user(client, login):
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        resp = _post(client, login(email), name="X", email="x@lumenbeauty.com",
                     role="rep", password="changeme123")
        assert resp.status_code == 403, f"{email} got {resp.status_code}"


def test_duplicate_email_rejected(client, login):
    token = login("dana@lumenbeauty.com")
    resp = _post(client, token, name="Dupe", email="dana@lumenbeauty.com",
                 role="rep", password="changeme123")
    assert resp.status_code == 409


def test_add_user_node_out_of_scope(client, login):
    acme_nodes = client.get(
        "/nodes", headers={"Authorization": f"Bearer {login('avery@acme.com')}"}
    ).json()["nodes"]
    acme_node = acme_nodes[0]["id"]
    resp = _post(client, login("dana@lumenbeauty.com"), name="X", email="x2@lumenbeauty.com",
                 role="rep", password="changeme123", node_id=acme_node)
    assert resp.status_code == 404


def test_add_user_validation(client, login):
    token = login("dana@lumenbeauty.com")
    assert _post(client, token, name="X", email="x3@lumenbeauty.com",
                 role="superuser", password="changeme123").status_code == 422
    assert _post(client, token, name="X", email="x4@lumenbeauty.com",
                 role="rep", password="short").status_code == 422


def test_password_stored_as_hash(client, login):
    from sqlalchemy import text
    from app.db import engine
    token = login("dana@lumenbeauty.com")
    _post(client, token, name="Hash Check", email="hash@lumenbeauty.com",
          role="rep", password="changeme123")
    with engine.connect() as conn:
        ph = conn.execute(text("select password_hash from users where email = :e"),
                          {"e": "hash@lumenbeauty.com"}).scalar()
    assert ph != "changeme123" and ph.startswith("$argon2")


# ----- PATCH /users/{id} -----

def test_admin_can_change_role(client, login):
    token = login("dana@lumenbeauty.com")
    marcus = _find(client, token, "marcus@lumenbeauty.com")
    resp = _patch(client, token, marcus["id"], role="manager")
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "manager"
    _patch(client, token, marcus["id"], role="rep")  # restore


def test_admin_can_move_pin(client, login):
    token = login("dana@lumenbeauty.com")
    nodes = client.get("/nodes", headers={"Authorization": f"Bearer {token}"}).json()["nodes"]
    chicago = next(n for n in nodes if n["name"] == "Chicago")
    marcus = _find(client, token, "marcus@lumenbeauty.com")
    resp = _patch(client, token, marcus["id"], node_id=chicago["id"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["pinned_node_name"] == "Chicago"
    # restore Marcus to Bay Area so the suite is order-independent
    bayarea = next(n for n in nodes if n["name"] == "Bay Area")
    _patch(client, token, marcus["id"], node_id=bayarea["id"])


def test_admin_can_unpin(client, login):
    token = login("dana@lumenbeauty.com")
    target = _find(client, token, "newbie@lumenbeauty.com")
    resp = _patch(client, token, target["id"], node_id=None)
    assert resp.status_code == 200, resp.text
    assert resp.json()["pinned_node_id"] is None


def test_non_admin_cannot_patch(client, login):
    token = login("dana@lumenbeauty.com")
    marcus = _find(client, token, "marcus@lumenbeauty.com")
    resp = _patch(client, login("sarah@lumenbeauty.com"), marcus["id"], role="admin")
    assert resp.status_code == 403


def test_cannot_remove_last_admin(client, login):
    token = login("dana@lumenbeauty.com")
    dana = _find(client, token, "dana@lumenbeauty.com")
    resp = _patch(client, token, dana["id"], role="rep")
    assert resp.status_code == 409


def test_patch_node_out_of_scope(client, login):
    token = login("dana@lumenbeauty.com")
    marcus = _find(client, token, "marcus@lumenbeauty.com")
    acme_node = client.get(
        "/nodes", headers={"Authorization": f"Bearer {login('avery@acme.com')}"}
    ).json()["nodes"][0]["id"]
    assert _patch(client, token, marcus["id"], node_id=acme_node).status_code == 404


def test_patch_no_fields_rejected(client, login):
    token = login("dana@lumenbeauty.com")
    marcus = _find(client, token, "marcus@lumenbeauty.com")
    assert _patch(client, token, marcus["id"]).status_code == 422


def test_patch_unknown_user(client, login):
    token = login("dana@lumenbeauty.com")
    assert _patch(client, token, "00000000-0000-0000-0000-000000000000",
                  role="rep").status_code == 404
