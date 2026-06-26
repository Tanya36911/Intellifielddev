"""Set-org-levels brick (setup wizard step 2 backend). Admin-only PUT /org-levels
replaces the company's level structure, with a re-map guard: once real nodes exist,
the number of levels cannot change (rename/reorder labels only)."""

LUMEN_DEFAULT = ["Company", "Region", "District", "Store"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _levels(client, token):
    return client.get("/org-levels", headers=_h(token)).json()["levels"]


def test_rename_only_on_populated_company(client, login):
    token = login("dana@lumenbeauty.com")
    try:
        resp = client.put("/org-levels", headers=_h(token),
                         json={"levels": ["HQ", "Region", "District", "Outlet"]})
        assert resp.status_code == 200, resp.text
        assert [l["name"] for l in resp.json()["levels"]] == ["HQ", "Region", "District", "Outlet"]
        assert resp.json()["levels"][0]["locked"] is True
        assert resp.json()["levels"][3]["locked"] is True
        assert resp.json()["levels"][1]["locked"] is False
    finally:
        client.put("/org-levels", headers=_h(token), json={"levels": LUMEN_DEFAULT})


def test_structural_change_refused_on_populated(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.put("/org-levels", headers=_h(token),
                     json={"levels": ["Company", "Region", "District", "Sub", "Store"]})
    assert resp.status_code == 409
    assert [l["name"] for l in _levels(client, token)] == LUMEN_DEFAULT  # unchanged


def test_fresh_company_allows_structural_change(client, login):
    from sqlalchemy import text
    from app.db import engine
    from app.security import hash_password
    with engine.begin() as conn:
        tid = conn.execute(
            text("insert into tenants (name, code) values ('Empty Co', 'emptyco') "
                 "on conflict (code) do update set name = excluded.name returning id")
        ).scalar()
        conn.execute(
            text("insert into users (tenant_id, email, name, role, password_hash) "
                 "values (:tid, 'eadmin@emptyco.com', 'E Admin', 'admin', :ph) "
                 "on conflict (tenant_id, email) do nothing"),
            {"tid": tid, "ph": hash_password("demo1234")},
        )
    token = login("eadmin@emptyco.com")
    resp = client.put("/org-levels", headers=_h(token),
                     json={"levels": ["Org", "Zone", "Area", "District", "Outlet"]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["count"] == 5
    assert body["levels"][0] == {"level_order": 0, "name": "Org", "locked": True}
    assert body["levels"][4]["name"] == "Outlet" and body["levels"][4]["locked"] is True
    assert body["levels"][2]["locked"] is False  # a middle level is unlocked


def test_non_admin_cannot_set_levels(client, login):
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        resp = client.put("/org-levels", headers=_h(login(email)),
                         json={"levels": ["A", "B", "C", "D"]})
        assert resp.status_code == 403, f"{email} got {resp.status_code}"


def test_validation(client, login):
    h = _h(login("dana@lumenbeauty.com"))
    assert client.put("/org-levels", headers=h, json={"levels": ["Only"]}).status_code == 422
    assert client.put("/org-levels", headers=h, json={"levels": ["A", "   "]}).status_code == 422


def test_company_isolation(client, login):
    dana = _h(login("dana@lumenbeauty.com"))
    acme_before = _levels(client, login("avery@acme.com"))
    try:
        client.put("/org-levels", headers=dana, json={"levels": ["X1", "X2", "X3", "X4"]})
        acme_after = _levels(client, login("avery@acme.com"))
        assert acme_after == acme_before  # Lumen's change never touched Acme
    finally:
        client.put("/org-levels", headers=dana, json={"levels": LUMEN_DEFAULT})
