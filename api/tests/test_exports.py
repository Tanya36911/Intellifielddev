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
