"""Phase 4b: read-only analytics over the 4a response rows. Compliance reports
completion % (of expected stores, how many responded) and pass % (of scored
responses, how many passed); both are computed live, branch-scoped, never stored."""
from sqlalchemy import text

from app.db import engine


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


def _scalar(sql, **p):
    with engine.connect() as conn:
        return conn.execute(text(sql), p).scalar()


def _node_id(code):
    return _scalar("select id from nodes where code = :c", c=code)


def _sku_id(upc):
    return _scalar("select id from skus where upc = :u", u=upc)


def _publish_and_assign(client, admin_token, name, questions, target_code):
    """Create a survey, publish v1, assign it to the node with target_code.
    Returns the published survey_version_id."""
    h = _auth(admin_token)
    survey = client.post("/surveys", headers=h,
                         json={"name": name, "type": None, "questions": questions}).json()
    client.post(f"/surveys/{survey['id']}/publish", headers=h)
    full = client.get(f"/surveys/{survey['id']}", headers=h).json()
    vid = next(v["id"] for v in full["versions"] if v["published_at"] is not None)
    client.post("/survey-assignments", headers=h,
                json={"survey_version_id": vid, "target_node_id": str(_node_id(target_code))})
    return vid


def _submit(client, token, vid, store_code, answers):
    return client.post("/responses", headers=_auth(token),
                       json={"survey_version_id": str(vid),
                             "store_node_id": str(_node_id(store_code)), "answers": answers})


def _row_for(rows, vid):
    return next(r for r in rows if r["survey_version_id"] == vid)


def test_compliance_requires_auth(client):
    assert client.get("/analytics/compliance").status_code == 401


def test_compliance_counts(client, login):
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
          "sku_ids": [str(rose)], "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Bay Compliance", q, "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    rows = client.get("/analytics/compliance", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()["rows"]
    r = _row_for(rows, vid)
    assert r["expected"] == 2
    assert r["responded"] == 1
    assert r["scored"] == 1
    assert r["passed"] == 1
    assert r["completion_pct"] == 50.0
    assert r["pass_pct"] == 100.0


def test_company_wide_survey_shows_per_node(client, login):
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
          "sku_ids": [str(rose)], "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Company Wide", q, "lumen-co")
    rows = client.get("/analytics/compliance", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()["rows"]
    r = _row_for(rows, vid)
    assert r["expected"] == 2  # only Bay Area's two stores, not the whole company


def test_pass_pct_recomputes_from_rule(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    lenient = _publish_and_assign(client, dana, "Lenient",
        [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}], "bayarea")
    strict = _publish_and_assign(client, dana, "Strict",
        [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 6}, "passScope": "each"}], "bayarea")
    _submit(client, marcus, lenient, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    _submit(client, marcus, strict, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    rows = client.get("/analytics/compliance", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()["rows"]
    assert _row_for(rows, lenient)["pass_pct"] == 100.0
    assert _row_for(rows, strict)["pass_pct"] == 0.0


def test_not_scored_excluded_from_pass_pct(client, login):
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "No Rule Survey",
        [{"id": "q1", "prompt": "note", "type": "text"}], "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "value": "looks fine"}])
    rows = client.get("/analytics/compliance", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()["rows"]
    r = _row_for(rows, vid)
    assert r["responded"] == 1
    assert r["scored"] == 0
    assert r["pass_pct"] is None


def test_compliance_node_out_of_scope_404(client, login):
    resp = client.get("/analytics/compliance", headers=_auth(login("sarah@lumenbeauty.com")),
                      params={"node_id": str(_node_id("bayarea"))})
    assert resp.status_code == 404, resp.text


def test_compliance_company_isolation(client, login):
    rows = client.get("/analytics/compliance", headers=_auth(login("avery@acme.com"))).json()["rows"]
    assert all("Velvet" not in r["survey_name"] for r in rows)


def test_drill_children_rollup(client, login):
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "West Drill", q, "west")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    body = client.get("/analytics/compliance/drill", headers=_auth(dana),
                      params={"node_id": str(_node_id("west")), "survey_version_id": vid}).json()
    assert body["is_store"] is False
    bay = next(c for c in body["children"] if c["name"] == "Bay Area")
    assert bay["expected"] == 2
    assert bay["responded"] == 1
    assert bay["passed"] == 1


def test_drill_store_shows_why_failed(client, login):
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Why Failed", q, "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 2}])
    body = client.get("/analytics/compliance/drill", headers=_auth(dana),
                      params={"node_id": str(_node_id("sf")), "survey_version_id": vid}).json()
    assert body["is_store"] is True
    assert body["responded"] is True
    assert body["overall"] is False
    assert body["questions"]["q1"] is False


def test_drill_store_no_response(client, login):
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Drill No Resp", q, "bayarea")
    body = client.get("/analytics/compliance/drill", headers=_auth(dana),
                      params={"node_id": str(_node_id("oakland")), "survey_version_id": vid}).json()
    assert body["is_store"] is True
    assert body["responded"] is False


def test_drill_node_out_of_scope_404(client, login):
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    vid = _publish_and_assign(client, dana, "Drill Scope",
        [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}], "bayarea")
    resp = client.get("/analytics/compliance/drill",
                      headers=_auth(login("sarah@lumenbeauty.com")),
                      params={"node_id": str(_node_id("bayarea")), "survey_version_id": vid})
    assert resp.status_code == 404, resp.text


def test_oos_counts_zero_answers(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "OOS Survey", q, "bayarea")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 0}])
    _submit(client, marcus, vid, "oakland", [{"question_id": "q1", "sku_id": str(rose), "value": 7}])
    body = client.get("/analytics/oos", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1"}).json()
    row = next(r for r in body["rows"] if r["sku_id"] == str(rose))
    assert row["oos_store_count"] == 1
    assert row["reporting_store_count"] == 2


def test_oos_uses_latest_response(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "OOS Latest", q, "bayarea")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 0}])
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    body = client.get("/analytics/oos", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1"}).json()
    row = next(r for r in body["rows"] if r["sku_id"] == str(rose))
    assert row["oos_store_count"] == 0  # latest is 5


def test_oos_bad_question_400(client, login):
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "OOS Bad Q",
        [{"id": "q1", "prompt": "present?", "type": "boolean"}], "bayarea")
    resp = client.get("/analytics/oos", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1"})
    assert resp.status_code == 400, resp.text


def test_oos_version_out_of_company_404(client, login):
    acme_vid = _scalar(
        "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
        "where s.name = 'Glow Serum Check' and v.published_at is not null limit 1")
    resp = client.get("/analytics/oos", headers=_auth(login("dana@lumenbeauty.com")),
                      params={"survey_version_id": str(acme_vid), "question_id": "q1"})
    assert resp.status_code == 404, resp.text


def test_oos_company_isolation(client, login):
    # Avery (Acme) runs out-of-stock on an Acme survey; no Lumen product appears.
    avery = login("avery@acme.com")
    acme_sku, lumen_sku = _sku_id("ACM-GS-ORIG"), _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
          "sku_ids": [str(acme_sku)], "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, avery, "Acme OOS", q, "acme-co")
    _submit(client, avery, vid, "boston-store",
            [{"question_id": "q1", "sku_id": str(acme_sku), "value": 0}])
    body = client.get("/analytics/oos", headers=_auth(avery),
                      params={"survey_version_id": vid, "question_id": "q1"}).json()
    sku_ids = {r["sku_id"] for r in body["rows"]}
    assert str(acme_sku) in sku_ids
    assert str(lumen_sku) not in sku_ids


def test_trend_returns_points_and_daily_avg(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Trend Survey", q, "bayarea")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 4}])
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 8}])
    body = client.get("/analytics/trend", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1",
                              "sku_id": str(rose)}).json()
    assert len(body["points"]) == 2
    assert [p["value"] for p in body["points"]] == [4, 8]
    assert len(body["daily_avg"]) == 1
    assert body["daily_avg"][0]["avg"] == 6.0


def test_trend_respects_date_range(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Trend Range", q, "bayarea")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    body = client.get("/analytics/trend", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1", "sku_id": str(rose),
                              "date_from": "2000-01-01T00:00:00Z",
                              "date_to": "2000-01-02T00:00:00Z"}).json()
    assert body["points"] == []


def test_trend_sku_not_on_question_400(client, login):
    dana = login("dana@lumenbeauty.com")
    rose, ivory = _sku_id("LUM-VL-ROSE"), _sku_id("LUM-SF-IVORY")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Trend Bad Sku", q, "bayarea")
    resp = client.get("/analytics/trend", headers=_auth(dana),
                      params={"survey_version_id": vid, "question_id": "q1", "sku_id": str(ivory)})
    assert resp.status_code == 400, resp.text


def test_trend_node_out_of_scope_404(client, login):
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Trend Scope", q, "bayarea")
    resp = client.get("/analytics/trend", headers=_auth(login("sarah@lumenbeauty.com")),  # Central
                      params={"survey_version_id": vid, "question_id": "q1", "sku_id": str(rose),
                              "node_id": str(_node_id("bayarea"))})
    assert resp.status_code == 404, resp.text


def test_trend_version_out_of_company_404(client, login):
    acme_vid = _scalar(
        "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
        "where s.name = 'Glow Serum Check' and v.published_at is not null limit 1")
    rose = _sku_id("LUM-VL-ROSE")
    resp = client.get("/analytics/trend", headers=_auth(login("dana@lumenbeauty.com")),
                      params={"survey_version_id": str(acme_vid), "question_id": "q1",
                              "sku_id": str(rose)})
    assert resp.status_code == 404, resp.text


def test_compliance_expected_includes_store_added_later(client, login):
    # The analytics 'expected' count is computed live from the tree, so a store
    # added under the target node after the assignment raises it.
    dana = login("dana@lumenbeauty.com")
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "f", "type": "number", "perSku": True, "sku_ids": [str(rose)],
          "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    vid = _publish_and_assign(client, dana, "Live Coverage", q, "bayarea")

    def _expected():
        rows = client.get("/analytics/compliance", headers=_auth(dana),
                          params={"node_id": str(_node_id("bayarea"))}).json()["rows"]
        return next(r for r in rows if r["survey_version_id"] == vid)["expected"]

    before = _expected()
    nid = None
    try:
        with engine.begin() as conn:
            bay = conn.execute(
                text("select id, path, tenant_id from nodes where code = 'bayarea'")
            ).mappings().first()
            nid = conn.execute(
                text("insert into nodes (tenant_id, parent_id, level_order, name, code, chain) "
                     "values (:tid, :pid, 3, 'Late 4b Store', 'late-4b-store', 'CVS') returning id"),
                {"tid": bay["tenant_id"], "pid": bay["id"]},
            ).scalar()
            conn.execute(text("update nodes set path = :p where id = :id"),
                         {"p": f"{bay['path']}{nid}/", "id": nid})
        assert _expected() == before + 1  # coverage recomputed live, not copied
    finally:
        if nid is not None:
            with engine.begin() as conn:
                conn.execute(text("delete from nodes where id = cast(:id as uuid)"),
                             {"id": str(nid)})
