"""Phase 4a: responses are stored as atomic per-product rows and read back with
pass/fail computed live. Submission is scope-follows-pin and published-version
only."""
from sqlalchemy import text

from app.db import engine


def _scalar(sql, **p):
    with engine.connect() as conn:
        return conn.execute(text(sql), p).scalar()


def _node_id(code):
    return _scalar("select id from nodes where code = :c", c=code)


def _sku_id(upc):
    return _scalar("select id from skus where upc = :u", u=upc)


def _lumen_version_id():
    return _scalar(
        "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
        "where s.name = 'Velvet Lip Shelf Check' and v.published_at is not null "
        "order by v.version_number desc limit 1"
    )


def _submit(client, token, version_id, store_id, answers):
    return client.post(
        "/responses",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": str(version_id), "store_node_id": str(store_id),
              "answers": answers},
    )


def test_submit_requires_auth(client):
    assert client.post("/responses", json={}).status_code in (401, 422)


def test_rep_submits_for_own_store(client, login):
    token = login("marcus@lumenbeauty.com")  # rep pinned at Bay Area
    rose = _sku_id("LUM-VL-ROSE")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
        {"question_id": "q2", "value": True},
    ])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["items"]) == 2          # one per (question, product)
    assert body["overall"] is True          # 5 >= 4 and endcap present
    assert body["questions"]["q1"] is True
    assert body["questions"]["q2"] is True


def test_submit_computes_fail_from_rule(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    resp = _submit(client, token, _lumen_version_id(), _node_id("oakland"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 2},  # 2 < 4 -> fail
        {"question_id": "q2", "value": True},
    ])
    assert resp.status_code == 200, resp.text
    assert resp.json()["overall"] is False


def test_submit_out_of_scope_store_404(client, login):
    token = login("marcus@lumenbeauty.com")  # Bay Area only
    resp = _submit(client, token, _lumen_version_id(), _node_id("chicago-store"), [])
    assert resp.status_code == 404, resp.text
    assert "scope" in resp.json()["detail"].lower()


def test_submit_cross_tenant_store_404(client, login):
    token = login("marcus@lumenbeauty.com")
    resp = _submit(client, token, _lumen_version_id(), _node_id("boston-store"), [])
    assert resp.status_code == 404, resp.text
    assert "scope" in resp.json()["detail"].lower()


def test_submit_target_must_be_a_store_404(client, login):
    token = login("dana@lumenbeauty.com")  # admin, whole company in scope
    resp = _submit(client, token, _lumen_version_id(), _node_id("west"), [])  # a Region, not a store
    assert resp.status_code == 404, resp.text


def test_submit_unpublished_version_400(client, login):
    token = login("dana@lumenbeauty.com")
    draft = client.post(
        "/surveys", headers={"Authorization": f"Bearer {token}"},
        json={"name": "Draft For Response", "type": None,
              "questions": [{"id": "q1", "prompt": "x", "type": "boolean"}]},
    ).json()
    draft_vid = draft["versions"][0]["id"]
    resp = _submit(client, token, draft_vid, _node_id("sf"), [])
    assert resp.status_code == 400, resp.text
    assert "published" in resp.json()["detail"].lower()


def test_get_one_response_returns_computed_verdicts(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    created = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
        {"question_id": "q2", "value": True},
    ]).json()
    got = client.get(f"/responses/{created['id']}",
                     headers={"Authorization": f"Bearer {token}"})
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["overall"] is True
    assert any(i["question_id"] == "q1" and i["pass"] is True for i in body["items"])
    assert body["store_path"]  # the tree snapshot was stored
