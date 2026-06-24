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


def test_unknown_question_rejected(client, login):
    token = login("marcus@lumenbeauty.com")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "nope", "value": 5},
    ])
    assert resp.status_code == 400, resp.text
    assert "unknown question" in resp.json()["detail"].lower()


def test_wrong_value_type_rejected(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": "five"},  # q1 is a number
    ])
    assert resp.status_code == 400, resp.text
    assert "number" in resp.json()["detail"].lower()


def test_sku_not_covered_rejected(client, login):
    token = login("marcus@lumenbeauty.com")
    other = _sku_id("LUM-SF-IVORY")  # a real Lumen sku, but not on q1
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(other), "value": 5},
    ])
    assert resp.status_code == 400, resp.text
    assert "not covered" in resp.json()["detail"].lower()


def test_sku_on_non_per_product_rejected(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q2", "sku_id": str(rose), "value": True},  # q2 is not per-product
    ])
    assert resp.status_code == 400, resp.text
    assert "not per-product" in resp.json()["detail"].lower()


def test_per_product_requires_sku(client, login):
    token = login("marcus@lumenbeauty.com")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "value": 5},  # q1 is per-product, sku missing
    ])
    assert resp.status_code == 400, resp.text
    assert "sku_id required" in resp.json()["detail"].lower()


def test_duplicate_answer_rejected(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    resp = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
        {"question_id": "q1", "sku_id": str(rose), "value": 6},
    ])
    assert resp.status_code == 400, resp.text
    assert "duplicate" in resp.json()["detail"].lower()


def test_blank_answer_is_skipped_not_stored(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    created = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
        {"question_id": "q2", "value": None},  # blank -> dropped
    ]).json()
    assert len(created["items"]) == 1  # only q1 stored
    assert created["questions"]["q2"] is None  # not counted


def _create_published_version(client, admin_token, name, questions):
    """Create a survey with the given questions, publish v1, return the
    published version id."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    survey = client.post("/surveys", headers=headers,
                         json={"name": name, "type": None, "questions": questions}).json()
    client.post(f"/surveys/{survey['id']}/publish", headers=headers)
    full = client.get(f"/surveys/{survey['id']}", headers=headers).json()
    return next(v["id"] for v in full["versions"] if v["published_at"] is not None)


def test_same_question_two_skus_is_not_a_duplicate(client, login):
    rose, mauve = _sku_id("LUM-VL-ROSE"), _sku_id("LUM-VL-MAUVE")
    vid = _create_published_version(
        client, login("dana@lumenbeauty.com"), "Two SKU Survey",
        [{"id": "qa", "prompt": "facings?", "type": "number", "perSku": True,
          "sku_ids": [str(rose), str(mauve)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}],
    )
    resp = _submit(client, login("marcus@lumenbeauty.com"), vid, _node_id("sf"), [
        {"question_id": "qa", "sku_id": str(rose), "value": 5},
        {"question_id": "qa", "sku_id": str(mauve), "value": 6},
    ])
    assert resp.status_code == 200, resp.text  # two different skus, NOT a duplicate
    assert len(resp.json()["items"]) == 2


def test_empty_multi_choice_rejected(client, login):
    vid = _create_published_version(
        client, login("dana@lumenbeauty.com"), "Multi Choice Survey",
        [{"id": "qc", "prompt": "pick", "type": "multi_choice", "options": ["a", "b"]}],
    )
    resp = _submit(client, login("marcus@lumenbeauty.com"), vid, _node_id("sf"), [
        {"question_id": "qc", "value": []},  # empty selection -> rejected (omit to skip)
    ])
    assert resp.status_code == 400, resp.text
    assert "option" in resp.json()["detail"].lower()


def _seeded_lumen_response_id():
    return _scalar(
        "select r.id from responses r join survey_versions v on v.id = r.survey_version_id "
        "join surveys s on s.id = v.survey_id where s.name = 'Velvet Lip Shelf Check' "
        "order by r.submitted_at limit 1"
    )


def test_list_requires_auth(client):
    assert client.get("/responses").status_code == 401


def test_list_is_scoped_to_branch(client, login):
    # Marcus (Bay Area) submits, then sees his own response in the list.
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    _submit(client, token, _lumen_version_id(), _node_id("sf"),
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    listed = client.get("/responses", headers={"Authorization": f"Bearer {token}"})
    assert listed.status_code == 200, listed.text
    assert listed.json()["count"] >= 1
    assert all("overall" in r for r in listed.json()["responses"])


def test_company_isolation(client, login):
    # Avery (Acme) never sees a Lumen response, by list or by direct id.
    lumen_id = _seeded_lumen_response_id()
    avery = login("avery@acme.com")
    listed = client.get("/responses", headers={"Authorization": f"Bearer {avery}"}).json()
    assert all(str(r["id"]) != str(lumen_id) for r in listed["responses"])
    direct = client.get(f"/responses/{lumen_id}", headers={"Authorization": f"Bearer {avery}"})
    assert direct.status_code == 404, direct.text


def test_sibling_region_manager_sees_zero(client, login):
    # Marcus (Bay Area, West) submits; Sarah (Central) must not see it.
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    created = _submit(client, marcus, _lumen_version_id(), _node_id("sf"),
                      [{"question_id": "q1", "sku_id": str(rose), "value": 5}]).json()
    sarah = login("sarah@lumenbeauty.com")
    direct = client.get(f"/responses/{created['id']}",
                        headers={"Authorization": f"Bearer {sarah}"})
    assert direct.status_code == 404, direct.text


def test_no_pin_user_sees_nothing(client, login):
    token = login("newbie@lumenbeauty.com")  # rep with no pin
    listed = client.get("/responses", headers={"Authorization": f"Bearer {token}"})
    assert listed.status_code == 200
    assert listed.json()["count"] == 0


def test_revisit_keeps_both_submissions(client, login):
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    before = client.get("/responses", headers={"Authorization": f"Bearer {token}"}).json()["count"]
    _submit(client, token, _lumen_version_id(), _node_id("oakland"),
            [{"question_id": "q1", "sku_id": str(rose), "value": 4}])
    _submit(client, token, _lumen_version_id(), _node_id("oakland"),
            [{"question_id": "q1", "sku_id": str(rose), "value": 6}])
    after = client.get("/responses", headers={"Authorization": f"Bearer {token}"}).json()["count"]
    assert after == before + 2  # nothing overwritten


def test_store_path_snapshot_is_frozen(client, login):
    # The stored snapshot equals the store's path at submit time and does NOT
    # change when the node is later re-parented. Checked at the storage level:
    # re-parenting changes the live nodes.path, which would drop the row out of
    # every scope, so the freeze can only be observed on the stored column.
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    created = _submit(client, token, _lumen_version_id(), _node_id("sf"),
                      [{"question_id": "q1", "sku_id": str(rose), "value": 5}]).json()
    snapshot = created["store_path"]
    assert snapshot  # a snapshot was stored
    live = _scalar("select path from nodes where code = 'sf'")
    assert snapshot == live  # snapshot == the store's path at submit time
    # re-parent the node; the stored snapshot must NOT move with it
    with engine.begin() as conn:
        conn.execute(text("update nodes set path = '/tampered/' where code = 'sf'"))
    try:
        frozen = _scalar("select store_path from responses where id = cast(:rid as uuid)",
                         rid=created["id"])
        assert frozen == snapshot  # unchanged despite the re-parent
    finally:
        from app.seed import run
        run()  # idempotently restores sf's real path so later tests are unaffected


def test_submit_foreign_tenant_version_400(client, login):
    # A Lumen user cannot submit against another company's (Acme's) version.
    acme_vid = _scalar(
        "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
        "where s.name = 'Glow Serum Check' and v.published_at is not null limit 1"
    )
    token = login("marcus@lumenbeauty.com")
    resp = _submit(client, token, acme_vid, _node_id("sf"), [])
    assert resp.status_code == 400, resp.text
    assert "published" in resp.json()["detail"].lower()


def test_list_responses_includes_display_names(client, login):
    """GET /responses now returns store_name, survey_name, survey_version_number, rep_name."""
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
    ])
    listed = client.get("/responses", headers={"Authorization": f"Bearer {token}"}).json()
    assert listed["count"] >= 1
    r = listed["responses"][0]
    assert "store_name" in r, "store_name missing from list"
    assert "survey_name" in r, "survey_name missing from list"
    assert "survey_version_number" in r, "survey_version_number missing from list"
    assert "rep_name" in r, "rep_name missing from list"
    assert r["store_name"]  # non-empty
    assert r["survey_name"] == "Velvet Lip Shelf Check"
    assert isinstance(r["survey_version_number"], int)
    assert r["rep_name"]  # non-empty


def test_get_response_includes_display_names(client, login):
    """GET /responses/{id} also returns store_name, survey_name, survey_version_number, rep_name."""
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    created = _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
    ]).json()
    got = client.get(f"/responses/{created['id']}",
                     headers={"Authorization": f"Bearer {token}"}).json()
    assert got["store_name"], "store_name missing from detail"
    assert got["survey_name"] == "Velvet Lip Shelf Check"
    assert isinstance(got["survey_version_number"], int)
    assert got["rep_name"], "rep_name missing from detail"


def test_list_rows_include_survey_id_scored_passed(client, login):
    """GET /responses list rows must carry survey_id, scored, and passed."""
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    _submit(client, token, _lumen_version_id(), _node_id("sf"), [
        {"question_id": "q1", "sku_id": str(rose), "value": 5},
        {"question_id": "q2", "value": True},
    ])
    listed = client.get("/responses", headers={"Authorization": f"Bearer {token}"}).json()
    assert listed["count"] >= 1
    r = listed["responses"][0]
    assert "survey_id" in r, "survey_id missing from list row"
    assert "scored" in r, "scored missing from list row"
    assert "passed" in r, "passed missing from list row"
    assert isinstance(r["survey_id"], str)
    assert isinstance(r["scored"], int)
    assert isinstance(r["passed"], int)


def test_partial_response_has_0_lt_passed_lt_scored(client, login):
    """A response where only some scored questions pass must have 0 < passed < scored."""
    token = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    admin_token = login("dana@lumenbeauty.com")
    # Two questions: qA passes (facings ok), qB fails (endcap absent)
    vid = _create_published_version(
        client, admin_token, "Partial Two Q Survey",
        [
            {"id": "qA", "prompt": "facings?", "type": "number", "perSku": True,
             "sku_ids": [str(rose)],
             "pass": {"operator": ">=", "value": 4}, "passScope": "each"},
            {"id": "qB", "prompt": "endcap?", "type": "boolean",
             "pass": {"operator": "==", "value": True}, "passScope": "each"},
        ],
    )
    # qA passes (5 >= 4), qB fails (False != True) -> partial at question level
    resp = _submit(client, token, vid, _node_id("sf"), [
        {"question_id": "qA", "sku_id": str(rose), "value": 5},
        {"question_id": "qB", "value": False},
    ])
    assert resp.status_code == 200, resp.text
    listed = client.get("/responses", headers={"Authorization": f"Bearer {token}"}).json()
    # Find this specific response in the list
    partial_row = next(
        (r for r in listed["responses"] if r["id"] == resp.json()["id"]), None
    )
    assert partial_row is not None, "submitted response not found in list"
    assert partial_row["scored"] > 0, "scored should be > 0"
    assert 0 < partial_row["passed"] < partial_row["scored"], (
        f"expected 0 < passed < scored, got passed={partial_row['passed']} scored={partial_row['scored']}"
    )
