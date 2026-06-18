"""Phase 4d: export. CSV downloads + a matching read-only JSON feed over the
responses, payroll, and compliance data. Branch-scoped through the ScopedRepo,
pass/fail computed live, no new tables. Tests go through the API and isolate to
data they create (the seeded DB is shared and not rolled back between tests)."""
import csv
import io

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


def _survey_id_of(vid):
    return _scalar("select survey_id from survey_versions where id = cast(:v as uuid)", v=str(vid))


def _publish_and_assign(client, admin_token, name, questions, target_code):
    """Create a survey, publish v1, assign it to target_code; return version id."""
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


def _grid(resp):
    """Parse a CSV response body into a list of rows (row 0 is the header)."""
    return list(csv.reader(io.StringIO(resp.text)))


def _rosewood_q():
    rose = _sku_id("LUM-VL-ROSE")
    return [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
             "sku_ids": [str(rose)], "pass": {"operator": ">=", "value": 4},
             "passScope": "each"}], rose


# ----- compliance export -----

def test_export_requires_auth(client):
    assert client.get("/export/compliance").status_code == 401


def test_compliance_export_matches_analytics(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Compliance", q, "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    node = str(_node_id("bayarea"))
    exp = client.get("/export/compliance", headers=_auth(dana),
                     params={"node_id": node}).json()["rows"]
    ana = client.get("/analytics/compliance", headers=_auth(dana),
                     params={"node_id": node}).json()["rows"]
    e = next(r for r in exp if r["survey_version_id"] == vid)
    a = next(r for r in ana if r["survey_version_id"] == vid)
    assert e == a  # identical rows, same brain


def test_compliance_export_null_pct_blank_not_zero(client, login):
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "Export Comp NoRule",
                              [{"id": "q1", "prompt": "note", "type": "text"}], "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "value": "ok"}])
    node = str(_node_id("bayarea"))
    e = next(r for r in client.get("/export/compliance", headers=_auth(dana),
                                   params={"node_id": node}).json()["rows"]
             if r["survey_version_id"] == vid)
    assert e["pass_pct"] is None
    grid = _grid(client.get("/export/compliance", headers=_auth(dana),
                            params={"node_id": node, "format": "csv"}))
    vidx, pidx = grid[0].index("survey_version_id"), grid[0].index("pass_pct")
    line = next(row for row in grid[1:] if row[vidx] == vid)
    assert line[pidx] == ""  # blank, never '0'


def test_compliance_export_node_out_of_scope_404(client, login):
    resp = client.get("/export/compliance", headers=_auth(login("sarah@lumenbeauty.com")),
                      params={"node_id": str(_node_id("bayarea"))})
    assert resp.status_code == 404, resp.text


def test_compliance_export_unpinned_caller_empty(client, login):
    body = client.get("/export/compliance",
                      headers=_auth(login("newbie@lumenbeauty.com"))).json()
    assert body == {"rows": [], "count": 0}


def test_bad_format_400(client, login):
    resp = client.get("/export/compliance", headers=_auth(login("dana@lumenbeauty.com")),
                      params={"format": "xml"})
    assert resp.status_code == 400, resp.text


# ----- responses export -----

def test_responses_format_parity(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Parity", q, "bayarea")
    sid = str(_survey_id_of(vid))
    marcus = login("marcus@lumenbeauty.com")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    _submit(client, marcus, vid, "oakland", [{"question_id": "q1", "sku_id": str(rose), "value": 2}])
    j = client.get("/export/responses", headers=_auth(dana), params={"survey_id": sid}).json()
    assert j["count"] == 2 == len(j["rows"])
    csv_resp = client.get("/export/responses", headers=_auth(dana),
                          params={"survey_id": sid, "format": "csv"})
    assert csv_resp.headers["content-type"].startswith("text/csv")
    grid = _grid(csv_resp)
    assert grid[0] == list(j["rows"][0].keys())   # CSV header == JSON keys (column order)
    assert len(grid) - 1 == j["count"]            # same row count


def test_responses_summary_verdicts(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Verdicts", q, "bayarea")
    sid = str(_survey_id_of(vid))
    marcus = login("marcus@lumenbeauty.com")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    _submit(client, marcus, vid, "oakland", [{"question_id": "q1", "sku_id": str(rose), "value": 2}])
    rows = client.get("/export/responses", headers=_auth(dana), params={"survey_id": sid}).json()["rows"]
    sf = next(r for r in rows if r["store_name"] == "SF store")
    assert sf["overall"] is True and sf["num_passed"] == 1 and sf["num_failed"] == 0
    oak = next(r for r in rows if r["store_name"] == "Oakland store")
    assert oak["overall"] is False and oak["num_passed"] == 0 and oak["num_failed"] == 1


def test_responses_sku_grain(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Sku Grain", q, "bayarea")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    rows = client.get("/export/responses", headers=_auth(dana),
                      params={"survey_id": sid, "grain": "sku"}).json()["rows"]
    item = next(r for r in rows if r["question_id"] == "q1")
    assert item["sku_id"] == str(rose)
    assert item["sku_line"] == "Velvet Lip"
    assert item["sku_variant"] == "Rosewood"
    assert item["value"] == 5
    assert item["item_pass"] is True


def test_responses_not_scored_blank_not_false(client, login):
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "Export No Rule",
                              [{"id": "q1", "prompt": "note", "type": "text"}], "bayarea")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "value": "looks ok"}])
    j = client.get("/export/responses", headers=_auth(dana), params={"survey_id": sid}).json()
    assert j["rows"][0]["overall"] is None
    js = client.get("/export/responses", headers=_auth(dana),
                    params={"survey_id": sid, "grain": "sku"}).json()
    assert js["rows"][0]["item_pass"] is None
    grid = _grid(client.get("/export/responses", headers=_auth(dana),
                            params={"survey_id": sid, "format": "csv"}))
    oidx = grid[0].index("overall")
    assert grid[1][oidx] == ""  # blank, never 'false'


def test_responses_multichoice_cell(client, login):
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "Export Multi",
                              [{"id": "q1", "prompt": "issues", "type": "multi_choice",
                                "options": ["a", "b", "c"]}], "bayarea")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "value": ["a", "b"]}])
    row = next(r for r in client.get("/export/responses", headers=_auth(dana),
                                     params={"survey_id": sid, "grain": "sku"}).json()["rows"]
               if r["question_id"] == "q1")
    assert row["value"] == ["a", "b"]      # real list in JSON
    assert row["sku_id"] is None           # not a per-product question
    grid = _grid(client.get("/export/responses", headers=_auth(dana),
                            params={"survey_id": sid, "grain": "sku", "format": "csv"}))
    vidx = grid[0].index("value")
    assert grid[1][vidx] == '["a","b"]'    # compact JSON in one CSV cell


def test_responses_empty_export(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Empty", q, "bayarea")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    j = client.get("/export/responses", headers=_auth(dana),
                   params={"survey_id": sid, "date_to": "2000-01-01T00:00:00Z"}).json()
    assert j == {"rows": [], "count": 0}
    grid = _grid(client.get("/export/responses", headers=_auth(dana),
                            params={"survey_id": sid, "date_to": "2000-01-01T00:00:00Z",
                                    "format": "csv"}))
    assert len(grid) == 1 and grid[0][0] == "response_id"  # header only


def test_responses_date_boundary_inclusive(client, login):
    # The seeded "Velvet Lip Shelf Check" has exactly one response at this instant.
    dana = login("dana@lumenbeauty.com")
    vlid = _scalar("select v.id from survey_versions v join surveys s on s.id = v.survey_id "
                   "where s.name = 'Velvet Lip Shelf Check' and v.published_at is not null limit 1")
    sid = str(_survey_id_of(vlid))
    on = client.get("/export/responses", headers=_auth(dana),
                    params={"survey_id": sid, "date_from": "2026-06-10T09:00:00Z",
                            "date_to": "2026-06-10T09:00:00Z"}).json()
    assert on["count"] == 1
    assert on["rows"][0]["submitted_at"].startswith("2026-06-10T09:00:00")
    off = client.get("/export/responses", headers=_auth(dana),
                     params={"survey_id": sid, "date_from": "2026-06-10T09:00:00Z",
                             "date_to": "2026-06-10T08:59:59Z"}).json()
    assert off["count"] == 0


def test_responses_sku_id_ignored_at_summary(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Sku Ignored", q, "bayarea")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    base = client.get("/export/responses", headers=_auth(dana), params={"survey_id": sid}).json()
    withsku = client.get("/export/responses", headers=_auth(dana),
                         params={"survey_id": sid, "sku_id": str(rose)}).json()
    assert base["count"] == withsku["count"]  # sku_id has no effect at grain=summary


def test_responses_chain_does_not_leak_across_scope(client, login):
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "Export Chain Leak",
                              [{"id": "q1", "prompt": "present?", "type": "boolean",
                                "pass": {"operator": "==", "value": True}}], "lumen-co")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "value": True}])           # CVS, Bay Area (West)
    _submit(client, login("rico@lumenbeauty.com"), vid, "chicago-store",
            [{"question_id": "q1", "value": True}])           # CVS, Chicago (Central)
    names = {r["store_name"] for r in client.get(
        "/export/responses", headers=_auth(login("sarah@lumenbeauty.com")),
        params={"survey_id": sid, "chain": "CVS"}).json()["rows"]}
    assert "Chicago store" in names      # in-scope CVS store included
    assert "SF store" not in names       # sibling-branch CVS store excluded


def test_responses_node_out_of_scope_404(client, login):
    resp = client.get("/export/responses", headers=_auth(login("sarah@lumenbeauty.com")),
                      params={"node_id": str(_node_id("bayarea"))})
    assert resp.status_code == 404, resp.text


def test_responses_unpinned_caller_empty(client, login):
    body = client.get("/export/responses", headers=_auth(login("newbie@lumenbeauty.com"))).json()
    assert body == {"rows": [], "count": 0}


def test_responses_bad_grain_400(client, login):
    resp = client.get("/export/responses", headers=_auth(login("dana@lumenbeauty.com")),
                      params={"grain": "weird"})
    assert resp.status_code == 400, resp.text
