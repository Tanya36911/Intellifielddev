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
