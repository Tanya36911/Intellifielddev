"""Phase 3a gate. The catalog is company-wide-visible but admin-only-editable,
and never leaks across companies.
"""


def _skus(client, token):
    resp = client.get("/skus", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_company_isolation_lumen(client, login):
    data = _skus(client, login("dana@lumenbeauty.com"))
    variants = {(s["line"], s["variant"]) for s in data["skus"]}
    assert ("Velvet Lip", "Rosewood") in variants
    assert all(s["line"] != "Glow Serum" for s in data["skus"])  # no Acme products
    assert data["count"] >= 4


def test_company_isolation_acme(client, login):
    data = _skus(client, login("avery@acme.com"))
    lines = {s["line"] for s in data["skus"]}
    assert "Glow Serum" in lines
    assert "Velvet Lip" not in lines  # no Lumen products


def test_admin_can_add_product(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/skus",
        headers={"Authorization": f"Bearer {token}"},
        json={"line": "Velvet Lip", "variant": "Plum", "upc": "LUM-VL-PLUM", "color": "#6B4E71"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["variant"] == "Plum"
    assert any(s["upc"] == "LUM-VL-PLUM" for s in _skus(client, token)["skus"])


def test_non_admin_cannot_add_product(client, login):
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        resp = client.post(
            "/skus",
            headers={"Authorization": f"Bearer {login(email)}"},
            json={"line": "Nope", "variant": "Nope", "upc": "NOPE-1", "color": None},
        )
        assert resp.status_code == 403, f"{email} got {resp.status_code}"


def test_admin_can_edit_status(client, login):
    token = login("dana@lumenbeauty.com")
    sku = _skus(client, token)["skus"][0]
    resp = client.patch(
        f"/skus/{sku['id']}",
        headers={"Authorization": f"Bearer {token}"},
        json={"status": "discontinued"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "discontinued"


def test_no_cross_company_edit(client, login):
    acme_sku = _skus(client, login("avery@acme.com"))["skus"][0]
    resp = client.patch(
        f"/skus/{acme_sku['id']}",
        headers={"Authorization": f"Bearer {login('dana@lumenbeauty.com')}"},
        json={"status": "discontinued"},
    )
    assert resp.status_code == 404


def test_listing_requires_auth(client):
    assert client.get("/skus").status_code == 401
