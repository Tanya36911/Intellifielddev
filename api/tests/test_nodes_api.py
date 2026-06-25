"""THE GATE (through the real API). Same isolation rules as the repo-level
tests, but proven end to end via GET /nodes with each user's real wristband.
"""


def _node_names(client, token):
    resp = client.get("/nodes", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return {n["name"] for n in resp.json()["nodes"]}


def test_api_admin_sees_whole_tenant_and_no_other(client, login):
    names = _node_names(client, login("dana@lumenbeauty.com"))
    assert "Lumen Beauty" in names and "Chicago store" in names
    assert "Acme Cosmetics" not in names and "Boston store" not in names


def test_api_manager_only_their_branch(client, login):
    names = _node_names(client, login("sarah@lumenbeauty.com"))
    assert names == {"Central", "Chicago", "Chicago store"}


def test_api_rep_only_their_stores(client, login):
    names = _node_names(client, login("marcus@lumenbeauty.com"))
    assert names == {"Bay Area", "SF store", "Oakland store"}


def test_api_acme_admin_only_acme(client, login):
    names = _node_names(client, login("avery@acme.com"))
    assert names == {"Acme Cosmetics", "East", "Boston", "Boston store"}


def test_api_no_pin_sees_nothing(client, login):
    names = _node_names(client, login("newbie@lumenbeauty.com"))
    assert names == set()


def test_api_requires_a_token(client):
    resp = client.get("/nodes")
    assert resp.status_code == 401


def test_api_org_levels(client, login):
    resp = client.get(
        "/org-levels", headers={"Authorization": f"Bearer {login('dana@lumenbeauty.com')}"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["count"] == 4
    levels = body["levels"]
    assert [lvl["level_order"] for lvl in levels] == [0, 1, 2, 3]
    assert [lvl["name"] for lvl in levels] == ["Company", "Region", "District", "Store"]
    # Company (first) and Store (last) are the locked ends; middle levels editable.
    assert levels[0]["locked"] is True and levels[3]["locked"] is True
    assert levels[1]["locked"] is False


def test_api_org_levels_requires_a_token(client):
    assert client.get("/org-levels").status_code == 401
