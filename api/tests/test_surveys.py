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


def _create_draft(client, token, name):
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name, "type": "shelf_check",
              "questions": [{"id": "q1", "prompt": "Counter clean?", "type": "boolean"}]},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_edit_draft_questions(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "Editable Draft")
    vid = survey["versions"][0]["id"]
    resp = client.patch(
        f"/surveys/{survey['id']}/versions/{vid}",
        headers={"Authorization": f"Bearer {token}"},
        json={"questions": [{"id": "q1", "prompt": "Counter spotless?", "type": "boolean"}]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["questions"][0]["prompt"] == "Counter spotless?"


def test_publish_freezes_the_version(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "To Publish")
    resp = client.post(
        f"/surveys/{survey['id']}/publish",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "published"
    assert body["versions"][0]["published_at"] is not None


def test_cannot_edit_published_version(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "Frozen Survey")
    vid = survey["versions"][0]["id"]
    client.post(f"/surveys/{survey['id']}/publish", headers={"Authorization": f"Bearer {token}"})
    resp = client.patch(
        f"/surveys/{survey['id']}/versions/{vid}",
        headers={"Authorization": f"Bearer {token}"},
        json={"questions": [{"id": "q1", "prompt": "changed", "type": "boolean"}]},
    )
    assert resp.status_code == 409, resp.text


def test_new_version_keeps_old_unchanged(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "Versioned Survey")
    v1_id = survey["versions"][0]["id"]
    client.post(f"/surveys/{survey['id']}/publish", headers={"Authorization": f"Bearer {token}"})
    new = client.post(f"/surveys/{survey['id']}/versions", headers={"Authorization": f"Bearer {token}"})
    assert new.status_code == 200, new.text
    v2 = new.json()
    assert v2["version_number"] == 2
    assert v2["published_at"] is None
    # edit v2
    client.patch(
        f"/surveys/{survey['id']}/versions/{v2['id']}",
        headers={"Authorization": f"Bearer {token}"},
        json={"questions": [{"id": "q1", "prompt": "v2 question", "type": "boolean"}]},
    )
    # v1 is unchanged
    full = client.get(f"/surveys/{survey['id']}", headers={"Authorization": f"Bearer {token}"}).json()
    v1 = next(v for v in full["versions"] if v["id"] == v1_id)
    assert v1["questions"][0]["prompt"] == "Counter clean?"


def test_new_version_requires_published_latest(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "Still A Draft")
    resp = client.post(f"/surveys/{survey['id']}/versions", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 409, resp.text


def test_archive_survey(client, login):
    token = login("dana@lumenbeauty.com")
    survey = _create_draft(client, token, "To Archive")
    resp = client.post(f"/surveys/{survey['id']}/archive", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "archived"


def test_non_admin_cannot_publish(client, login):
    dana = login("dana@lumenbeauty.com")
    survey = _create_draft(client, dana, "Mgr Cannot Publish")
    resp = client.post(
        f"/surveys/{survey['id']}/publish",
        headers={"Authorization": f"Bearer {login('sarah@lumenbeauty.com')}"},
    )
    assert resp.status_code == 403, resp.text


def _node_id(code):
    from sqlalchemy import text
    from app.db import engine
    with engine.connect() as conn:
        return conn.execute(text("select id from nodes where code = :c"), {"c": code}).scalar()


def _published_version_id(client, token, name):
    s = _find(client, token, name)
    full = client.get(f"/surveys/{s['id']}", headers={"Authorization": f"Bearer {token}"}).json()
    return next(v["id"] for v in full["versions"] if v["published_at"] is not None)


def test_manager_can_assign_within_branch(client, login):
    token = login("sarah@lumenbeauty.com")  # manager pinned at Central
    vid = _published_version_id(client, login("dana@lumenbeauty.com"), "Velvet Lip Shelf Check")
    resp = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("chicago"))},
    )
    assert resp.status_code == 200, resp.text


def test_manager_cannot_assign_sibling_region(client, login):
    token = login("sarah@lumenbeauty.com")  # Central
    vid = _published_version_id(client, login("dana@lumenbeauty.com"), "Velvet Lip Shelf Check")
    resp = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("west"))},
    )
    assert resp.status_code == 404, resp.text


def test_admin_can_assign_anywhere(client, login):
    token = login("dana@lumenbeauty.com")
    vid = _published_version_id(client, token, "Velvet Lip Shelf Check")
    resp = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("west"))},
    )
    assert resp.status_code == 200, resp.text


def test_rep_cannot_assign(client, login):
    token = login("marcus@lumenbeauty.com")  # rep
    vid = _published_version_id(client, login("dana@lumenbeauty.com"), "Velvet Lip Shelf Check")
    resp = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("bayarea"))},
    )
    assert resp.status_code == 403, resp.text


def test_cannot_assign_draft_version(client, login):
    token = login("dana@lumenbeauty.com")
    draft = _create_draft(client, token, "Unpublished For Assign")
    resp = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": draft["versions"][0]["id"], "target_node_id": str(_node_id("west"))},
    )
    assert resp.status_code == 400, resp.text


def test_assignment_stores_by_path(client, login):
    token = login("dana@lumenbeauty.com")
    vid = _published_version_id(client, token, "Velvet Lip Shelf Check")
    created = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("west"))},
    ).json()
    resp = client.get(
        f"/survey-assignments/{created['id']}/stores",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    codes = {s["code"] for s in resp.json()["stores"]}
    assert {"sf", "oakland"} <= codes        # West's stores are covered
    assert "chicago-store" not in codes      # a different region's store is not


def test_store_added_later_is_included(client, login):
    from sqlalchemy import text
    from app.db import engine
    token = login("dana@lumenbeauty.com")
    vid = _published_version_id(client, token, "Velvet Lip Shelf Check")
    created = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("bayarea"))},
    ).json()
    # add a brand-new store under Bay Area AFTER the assignment exists
    with engine.begin() as conn:
        bay = conn.execute(
            text("select id, path, tenant_id from nodes where code = 'bayarea'")
        ).mappings().first()
        nid = conn.execute(
            text(
                "insert into nodes (tenant_id, parent_id, level_order, name, code, chain) "
                "values (:tid, :pid, 3, 'Late Store', 'late-store', 'CVS') returning id"
            ),
            {"tid": bay["tenant_id"], "pid": bay["id"]},
        ).scalar()
        conn.execute(
            text("update nodes set path = :p where id = :id"),
            {"p": f"{bay['path']}{nid}/", "id": nid},
        )
    resp = client.get(
        f"/survey-assignments/{created['id']}/stores",
        headers={"Authorization": f"Bearer {token}"},
    )
    codes = {s["code"] for s in resp.json()["stores"]}
    assert "late-store" in codes  # computed live, not copied


def test_assignment_company_isolation(client, login):
    # Sarah (Central) sees the seeded Central assignment; Avery (Acme) sees none of Lumen's.
    sarah_resp = client.get(
        "/survey-assignments", headers={"Authorization": f"Bearer {login('sarah@lumenbeauty.com')}"}
    )
    assert sarah_resp.status_code == 200, sarah_resp.text
    lumen_ids = {a["id"] for a in sarah_resp.json()["assignments"]}
    assert len(lumen_ids) >= 1
    avery_resp = client.get(
        "/survey-assignments", headers={"Authorization": f"Bearer {login('avery@acme.com')}"}
    ).json()
    avery_ids = {a["id"] for a in avery_resp["assignments"]}
    # Avery must not be able to see any of Lumen's assignment records.
    assert avery_ids.isdisjoint(lumen_ids), "Acme user saw a Lumen assignment"


def test_delete_assignment(client, login):
    token = login("dana@lumenbeauty.com")
    vid = _published_version_id(client, token, "Velvet Lip Shelf Check")
    created = client.post(
        "/survey-assignments",
        headers={"Authorization": f"Bearer {token}"},
        json={"survey_version_id": vid, "target_node_id": str(_node_id("central"))},
    ).json()
    resp = client.delete(
        f"/survey-assignments/{created['id']}", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200, resp.text
    again = client.delete(
        f"/survey-assignments/{created['id']}", headers={"Authorization": f"Bearer {token}"}
    )
    assert again.status_code == 404


def test_question_extra_fields_round_trip(client, login):
    token = login("dana@lumenbeauty.com")
    resp = client.post(
        "/surveys",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Extra Fields", "type": None,
              "questions": [{"id": "q1", "prompt": "How many facings?", "type": "number",
                             "required": True, "unit": "facings", "lines": ["Velvet Lip"]}]},
    )
    assert resp.status_code == 200, resp.text
    sid = resp.json()["id"]
    full = client.get(f"/surveys/{sid}", headers={"Authorization": f"Bearer {token}"}).json()
    q = full["versions"][0]["questions"][0]
    assert q["required"] is True
    assert q["unit"] == "facings"
    assert q["lines"] == ["Velvet Lip"]
