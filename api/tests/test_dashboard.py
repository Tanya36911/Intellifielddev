"""W1 Stage A: the dashboard endpoint + the login display fields. Branch-scoped,
no new tables. Tests go through the API and isolate to data they create."""
import datetime as dt

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


def _publish(client, admin_token, name, questions):
    """Create + publish a survey; return the published version id."""
    h = _auth(admin_token)
    survey = client.post("/surveys", headers=h,
                         json={"name": name, "type": None, "questions": questions}).json()
    client.post(f"/surveys/{survey['id']}/publish", headers=h)
    full = client.get(f"/surveys/{survey['id']}", headers=h).json()
    return next(v["id"] for v in full["versions"] if v["published_at"] is not None)


def _assign(client, admin_token, vid, target_code, deadline=None):
    body = {"survey_version_id": str(vid), "target_node_id": str(_node_id(target_code))}
    if deadline is not None:
        body["deadline"] = deadline
    return client.post("/survey-assignments", headers=_auth(admin_token), json=body)


def _submit(client, token, vid, store_code, answers):
    return client.post("/responses", headers=_auth(token),
                       json={"survey_version_id": str(vid),
                             "store_node_id": str(_node_id(store_code)), "answers": answers})


def _rose_q():
    rose = _sku_id("LUM-VL-ROSE")
    return [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
             "sku_ids": [str(rose)], "pass": {"operator": ">=", "value": 4},
             "passScope": "each"}], rose


def test_login_returns_company_and_pin_names(client):
    resp = client.post("/auth/login",
                       json={"email": "marcus@lumenbeauty.com", "password": "demo1234"})
    assert resp.status_code == 200, resp.text
    user = resp.json()["user"]
    assert user["company_name"] == "Lumen Beauty"     # the tenant's name
    assert user["pinned_node_name"] == "Bay Area"     # marcus is pinned at bayarea


def test_login_unpinned_user_pin_name_null(client):
    user = client.post("/auth/login",
                       json={"email": "newbie@lumenbeauty.com", "password": "demo1234"}).json()["user"]
    assert user["company_name"] == "Lumen Beauty"
    assert user["pinned_node_name"] is None           # newbie has no pin


def test_dashboard_footprint_counts(client, login):
    dana = login("dana@lumenbeauty.com")  # pinned at the company root
    body = client.get("/analytics/dashboard", headers=_auth(dana)).json()
    fp = body["footprint"]
    # Lumen seed: 8 nodes; stores = the max-level store nodes (sf, oakland,
    # chicago-store); reps = pinned rep users (marcus, rico), NOT unpinned newbie.
    assert fp["nodes"] == 8
    assert fp["stores"] == 3
    assert fp["reps"] == 2


def test_dashboard_node_id_narrows_footprint(client, login):
    dana = login("dana@lumenbeauty.com")
    body = client.get("/analytics/dashboard", headers=_auth(dana),
                      params={"node_id": str(_node_id("west"))}).json()
    # West contains Bay Area + its two stores (sf, oakland); marcus is pinned in it.
    assert body["footprint"]["stores"] == 2
    assert body["footprint"]["reps"] == 1   # marcus only (rico is under Central)


def test_dashboard_surveys_completed_counts_responses(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rose_q()
    vid = _publish(client, dana, "W1a Surveys Completed", q)
    _assign(client, dana, vid, "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    # Count over just this survey by reading the per-version count is awkward via
    # the aggregate; instead assert the company-wide count is at least the 3 seed
    # responses + this one, and that a fresh submit increments it.
    before = client.get("/analytics/dashboard", headers=_auth(dana)).json()["current"]["surveys_completed"]
    _submit(client, login("marcus@lumenbeauty.com"), vid, "oakland",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    after = client.get("/analytics/dashboard", headers=_auth(dana)).json()["current"]["surveys_completed"]
    assert after == before + 1


def test_dashboard_node_out_of_scope_404(client, login):
    # Sarah is pinned at Central and cannot reach Bay Area.
    resp = client.get("/analytics/dashboard", headers=_auth(login("sarah@lumenbeauty.com")),
                      params={"node_id": str(_node_id("bayarea"))})
    assert resp.status_code == 404, resp.text


def test_dashboard_unpinned_caller_zero_payload(client, login):
    body = client.get("/analytics/dashboard", headers=_auth(login("newbie@lumenbeauty.com"))).json()
    assert body["footprint"] == {"nodes": 0, "stores": 0, "reps": 0}
    assert body["current"]["expected"] == 0
    assert body["current"]["completion_pct"] is None
    assert body["previous"] is None
    assert body["trend"] == []
