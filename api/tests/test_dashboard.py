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
    # Assign + submit under Central (chicago-store), via dana (pinned at root, so
    # she can submit anywhere), NOT under West. This keeps West free of extra
    # coverage so the no-double-count test (which is West-scoped) is not polluted
    # by this test's assignment in the shared, non-rolled-back DB.
    _assign(client, dana, vid, "chicago")
    _submit(client, dana, vid, "chicago-store",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    # Count over just this survey by reading the per-version count is awkward via
    # the aggregate; instead assert the company-wide count is at least the 3 seed
    # responses + this one, and that a fresh submit increments it.
    before = client.get("/analytics/dashboard", headers=_auth(dana)).json()["current"]["surveys_completed"]
    _submit(client, dana, vid, "chicago-store",
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


def test_dashboard_compliance_no_double_count(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rose_q()
    vid = _publish(client, dana, "W1a No Double Count", q)

    def west_current():
        return client.get("/analytics/dashboard", headers=_auth(dana),
                          params={"node_id": str(_node_id("west"))}).json()["current"]

    # The dashboard compliance aggregate is company-wide over the DISTINCT set of
    # (store, survey_version) obligations in scope. The shared seeded DB is not
    # rolled back, so West already carries coverage from other tests/files; we
    # therefore prove the no-double-count contract with DELTAS against this version
    # rather than an absolute count (which would assume a pristine West).
    base = west_current()

    # First assignment of THIS version at Bay Area: covers {sf, oakland} = 2 new
    # distinct (store, version) obligations under West.
    _assign(client, dana, vid, "bayarea")
    after_one = west_current()
    assert after_one["expected"] == base["expected"] + 2  # sf + oakland, once each

    # A SECOND, overlapping assignment of the SAME version at West: it covers the
    # same two stores. A per-assignment SUM would add 2 again (double-count); the
    # distinct-coverage aggregate must add ZERO.
    _assign(client, dana, vid, "west")
    after_two = west_current()
    assert after_two["expected"] == after_one["expected"]  # no double-count

    # One passing response at sf: responded/scored/passed each rise by exactly 1
    # for this store+version (counted once, not once per overlapping assignment).
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])  # pass
    after_resp = west_current()
    assert after_resp["responded"] == after_two["responded"] + 1
    assert after_resp["scored"] == after_two["scored"] + 1
    assert after_resp["passed"] == after_two["passed"] + 1


def test_dashboard_previous_window(client, login):
    dana = login("dana@lumenbeauty.com")
    # With a date range, previous is the equal-length window before date_from.
    body = client.get("/analytics/dashboard", headers=_auth(dana),
                      params={"date_from": "2026-06-15T00:00:00Z",
                              "date_to": "2026-06-22T00:00:00Z"}).json()
    assert body["previous"] is not None
    assert "completion_pct" in body["previous"]


def test_dashboard_previous_null_without_range(client, login):
    dana = login("dana@lumenbeauty.com")
    body = client.get("/analytics/dashboard", headers=_auth(dana)).json()
    assert body["previous"] is None


def test_dashboard_overdue_zero_without_deadline(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rose_q()
    vid = _publish(client, dana, "W1a No Deadline", q)
    _assign(client, dana, vid, "bayarea")  # no deadline
    # No deadline => never overdue, regardless of responses.
    body = client.get("/analytics/dashboard", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()
    assert body["current"]["overdue"] == 0


def test_dashboard_overdue_counts_past_deadline_unanswered(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rose_q()
    vid = _publish(client, dana, "W1a Overdue", q)
    past = "2020-01-01T00:00:00Z"
    _assign(client, dana, vid, "bayarea", deadline=past)  # past deadline, 2 stores
    # sf responds; oakland does not. Overdue = 1 (oakland still owes it).
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    body = client.get("/analytics/dashboard", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea"))}).json()
    assert body["current"]["overdue"] == 1


def test_dashboard_weekly_trend(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rose_q()
    vid = _publish(client, dana, "W1a Trend", q)
    _assign(client, dana, vid, "bayarea")  # expected = 2 stores (sf, oakland)
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    body = client.get("/analytics/dashboard", headers=_auth(dana),
                      params={"node_id": str(_node_id("bayarea")),
                              "date_from": "2026-06-15T00:00:00Z",
                              "date_to": "2026-06-29T00:00:00Z"}).json()
    trend = body["trend"]
    assert len(trend) >= 1                       # weekly buckets across the range
    assert all(set(p) == {"week_start", "completion_pct", "responded", "expected"} for p in trend)
    assert all(p["expected"] == 2 for p in trend)  # expected is the constant covered-store count
    # the week marcus responded shows 1-2 responded stores (the seed also has an
    # oakland response dated now()), completion bounded 50-100%, never over.
    hit = [p for p in trend if p["responded"] >= 1]
    assert hit and 1 <= hit[0]["responded"] <= 2
    assert 50.0 <= hit[0]["completion_pct"] <= 100.0


def test_dashboard_manager_scoped_to_branch(client, login):
    # Sarah (manager at Central) sees only Central's footprint, never West's.
    body = client.get("/analytics/dashboard",
                      headers=_auth(login("sarah@lumenbeauty.com"))).json()
    fp = body["footprint"]
    # Central subtree: central, chicago, chicago-store => 1 store; rico is the
    # only pinned rep under Central. West's sf/oakland and marcus never appear.
    assert fp["stores"] == 1
    assert fp["reps"] == 1
