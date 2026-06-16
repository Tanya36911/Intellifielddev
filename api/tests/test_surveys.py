"""Phase 3b gate. Surveys are company-wide-visible, admin-only to author, with
frozen versions, scoped assignments, and validated pass rules.
"""


def _surveys(client, token):
    resp = client.get("/surveys", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _find(client, token, name):
    for s in _surveys(client, token)["surveys"]:
        if s["name"] == name:
            return s
    return None


def test_listing_requires_auth(client):
    assert client.get("/surveys").status_code == 401


def test_company_isolation(client, login):
    lumen = {s["name"] for s in _surveys(client, login("dana@lumenbeauty.com"))["surveys"]}
    assert "Velvet Lip Shelf Check" in lumen
    assert "Glow Serum Check" not in lumen
    acme = {s["name"] for s in _surveys(client, login("avery@acme.com"))["surveys"]}
    assert "Glow Serum Check" in acme
    assert "Velvet Lip Shelf Check" not in acme


def test_admin_can_create_survey(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "New Audit", "type": "shelf_check",
              "questions": [{"id": "q1", "prompt": "Counter clean?", "type": "boolean"}]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "New Audit"
    assert body["status"] == "draft"
    assert len(body["versions"]) == 1
    assert body["versions"][0]["version_number"] == 1
    assert body["versions"][0]["published_at"] is None


def test_non_admin_cannot_create(client, login):
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        resp = client.post(
            "/surveys",
            headers={"Authorization": f"Bearer {login(email)}"},
            json={"name": "Nope", "type": None, "questions": []},
        )
        assert resp.status_code == 403, f"{email} got {resp.status_code}"


def test_get_one_survey_with_versions(client, login):
    token = login("dana@lumenbeauty.com")
    s = _find(client, token, "Velvet Lip Shelf Check")
    resp = client.get(f"/surveys/{s['id']}", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Velvet Lip Shelf Check"
    assert len(body["versions"]) >= 1
    assert body["versions"][0]["questions"][0]["id"] == "q1"


def test_bad_question_type_rejected(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Bad", "type": None,
              "questions": [{"id": "q1", "prompt": "x", "type": "nonsense"}]},
    )
    assert resp.status_code == 422, resp.text


def test_bad_pass_operator_rejected(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Bad2", "type": None,
              "questions": [{"id": "q1", "prompt": "x", "type": "number",
                             "pass": {"operator": "BETWEEN", "value": 4}}]},
    )
    assert resp.status_code == 422, resp.text


def test_choice_question_needs_options(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Bad3", "type": None,
              "questions": [{"id": "q1", "prompt": "pick", "type": "single_choice", "options": []}]},
    )
    assert resp.status_code == 422, resp.text


def test_cross_company_sku_link_rejected(client, login):
    # Dana (Lumen) cannot reference an Acme product id in a question.
    from sqlalchemy import text
    from app.db import engine
    with engine.connect() as conn:
        acme_sku = conn.execute(
            text("select s.id from skus s join tenants t on t.id = s.tenant_id where t.code = 'acme' limit 1")
        ).scalar()
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Sneaky", "type": None,
              "questions": [{"id": "q1", "prompt": "x", "type": "number", "sku_ids": [str(acme_sku)]}]},
    )
    assert resp.status_code == 400, resp.text
