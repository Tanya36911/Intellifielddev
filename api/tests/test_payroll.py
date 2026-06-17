"""Phase 4c: payroll. Pay periods are company-wide and admin-created; the whole
payroll surface is gated by a per-company switch; the seal/reopen lock and audit
log are exercised in later tests."""
from sqlalchemy import text

from app.db import engine


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


def _scalar(sql, **p):
    with engine.connect() as conn:
        return conn.execute(text(sql), p).scalar()


def _make_period(client, admin_token, name="Test Period"):
    return client.post("/pay-periods", headers=_auth(admin_token),
                       json={"name": name, "start_date": "2026-07-01",
                             "end_date": "2026-07-15"})


def test_payroll_requires_auth(client):
    assert client.get("/pay-periods").status_code == 401


def test_switch_blocks_company_with_payroll_off(client, login):
    avery = _auth(login("avery@acme.com"))
    assert client.get("/pay-periods", headers=avery).status_code == 403
    assert client.post("/pay-periods", headers=avery,
                       json={"name": "X", "start_date": "2026-07-01",
                             "end_date": "2026-07-15"}).status_code == 403


def test_admin_creates_period(client, login):
    resp = _make_period(client, login("dana@lumenbeauty.com"), "Admin Period")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "open"
    assert body["name"] == "Admin Period"
    n = _scalar("select count(*) from audit where action = 'pay_period.created' "
                "and target = :pid", pid=str(body["id"]))
    assert n == 1


def test_non_admin_cannot_create_period(client, login):
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        resp = _make_period(client, login(email))
        assert resp.status_code == 403, f"{email} got {resp.status_code}"


def test_list_periods_company_scoped(client, login):
    _make_period(client, login("dana@lumenbeauty.com"), "Listed Period")
    body = client.get("/pay-periods", headers=_auth(login("marcus@lumenbeauty.com"))).json()
    assert any(p["name"] == "Listed Period" for p in body["pay_periods"])


def test_reversed_dates_rejected(client, login):
    resp = client.post("/pay-periods", headers=_auth(login("dana@lumenbeauty.com")),
                       json={"name": "Backwards", "start_date": "2026-07-15",
                             "end_date": "2026-07-01"})
    assert resp.status_code == 422, resp.text


def test_rep_logs_and_edits_own_hours(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Log Period").json()["id"]
    created = client.post("/time-entries", headers=_auth(marcus),
                          json={"period_id": pid, "store_min": 100, "reset_min": 10,
                                "drive_min": 20, "miles": 5})
    assert created.status_code == 200, created.text
    eid = created.json()["id"]
    edited = client.patch(f"/time-entries/{eid}", headers=_auth(marcus),
                          json={"store_min": 200, "reset_min": 10, "drive_min": 20, "miles": 5})
    assert edited.status_code == 200, edited.text
    assert edited.json()["store_min"] == 200


def test_duplicate_entry_rejected(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Dup Period").json()["id"]
    first = {"period_id": pid, "store_min": 10, "reset_min": 0, "drive_min": 0, "miles": 0}
    assert client.post("/time-entries", headers=_auth(marcus), json=first).status_code == 200
    assert client.post("/time-entries", headers=_auth(marcus), json=first).status_code == 409


def test_rep_cannot_edit_another_reps_entry(client, login):
    dana, marcus, rico = (login("dana@lumenbeauty.com"),
                          login("marcus@lumenbeauty.com"), login("rico@lumenbeauty.com"))
    pid = _make_period(client, dana, "Two Rep Period").json()["id"]
    marcus_eid = client.post("/time-entries", headers=_auth(marcus),
                             json={"period_id": pid, "store_min": 10, "reset_min": 0,
                                   "drive_min": 0, "miles": 0}).json()["id"]
    resp = client.patch(f"/time-entries/{marcus_eid}", headers=_auth(rico),
                        json={"store_min": 999, "reset_min": 0, "drive_min": 0, "miles": 0})
    assert resp.status_code == 404, resp.text


def test_entries_list_is_role_scoped(client, login):
    dana, marcus, rico = (login("dana@lumenbeauty.com"),
                          login("marcus@lumenbeauty.com"), login("rico@lumenbeauty.com"))
    pid = _make_period(client, dana, "Scope Period").json()["id"]
    client.post("/time-entries", headers=_auth(marcus),
                json={"period_id": pid, "store_min": 10, "reset_min": 0, "drive_min": 0, "miles": 0})
    client.post("/time-entries", headers=_auth(rico),
                json={"period_id": pid, "store_min": 20, "reset_min": 0, "drive_min": 0, "miles": 0})
    mine = client.get(f"/pay-periods/{pid}/entries", headers=_auth(marcus)).json()
    assert mine["count"] == 1
    sarah = client.get(f"/pay-periods/{pid}/entries",
                       headers=_auth(login("sarah@lumenbeauty.com"))).json()
    sarah_users = {e["user_id"] for e in sarah["entries"]}
    rico_id = str(_scalar("select id from users where email='rico@lumenbeauty.com'"))
    marcus_id = str(_scalar("select id from users where email='marcus@lumenbeauty.com'"))
    assert rico_id in sarah_users
    assert marcus_id not in sarah_users
    alld = client.get(f"/pay-periods/{pid}/entries", headers=_auth(dana)).json()
    assert {rico_id, marcus_id} <= {e["user_id"] for e in alld["entries"]}


def test_manager_approves_branch_rep(client, login):
    dana, rico = login("dana@lumenbeauty.com"), login("rico@lumenbeauty.com")
    pid = _make_period(client, dana, "Approve Period").json()["id"]
    eid = client.post("/time-entries", headers=_auth(rico),
                      json={"period_id": pid, "store_min": 10, "reset_min": 0,
                            "drive_min": 0, "miles": 0}).json()["id"]
    resp = client.post(f"/time-entries/{eid}/approve",
                       headers=_auth(login("sarah@lumenbeauty.com")))
    assert resp.status_code == 200, resp.text
    assert resp.json()["mgr_status"] == "approved"


def test_manager_cannot_approve_sibling_branch(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Sibling Approve").json()["id"]
    eid = client.post("/time-entries", headers=_auth(marcus),
                      json={"period_id": pid, "store_min": 10, "reset_min": 0,
                            "drive_min": 0, "miles": 0}).json()["id"]
    resp = client.post(f"/time-entries/{eid}/reject",
                       headers=_auth(login("sarah@lumenbeauty.com")))
    assert resp.status_code == 404, resp.text


def test_rep_cannot_approve(client, login):
    dana, marcus, rico = (login("dana@lumenbeauty.com"),
                          login("marcus@lumenbeauty.com"), login("rico@lumenbeauty.com"))
    pid = _make_period(client, dana, "Rep Approve").json()["id"]
    eid = client.post("/time-entries", headers=_auth(rico),
                      json={"period_id": pid, "store_min": 10, "reset_min": 0,
                            "drive_min": 0, "miles": 0}).json()["id"]
    resp = client.post(f"/time-entries/{eid}/approve", headers=_auth(marcus))
    assert resp.status_code == 403, resp.text


def _seal(client, admin_token, pid):
    return client.post(f"/pay-periods/{pid}/seal", headers=_auth(admin_token))


def test_seal_locks_entries(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Seal Lock").json()["id"]
    eid = client.post("/time-entries", headers=_auth(marcus),
                      json={"period_id": pid, "store_min": 10, "reset_min": 0,
                            "drive_min": 0, "miles": 0}).json()["id"]
    assert _seal(client, dana, pid).status_code == 200
    edit = client.patch(f"/time-entries/{eid}", headers=_auth(marcus),
                        json={"store_min": 99, "reset_min": 0, "drive_min": 0, "miles": 0})
    assert edit.status_code == 409, edit.text
    appr = client.post(f"/time-entries/{eid}/approve", headers=_auth(dana))
    assert appr.status_code == 409, appr.text
    new = client.post("/time-entries", headers=_auth(login("rico@lumenbeauty.com")),
                      json={"period_id": pid, "store_min": 5, "reset_min": 0, "drive_min": 0, "miles": 0})
    assert new.status_code == 409, new.text


def test_logged_reopen_unlocks_one_rep(client, login):
    dana, marcus, rico = (login("dana@lumenbeauty.com"),
                          login("marcus@lumenbeauty.com"), login("rico@lumenbeauty.com"))
    pid = _make_period(client, dana, "Reopen One").json()["id"]
    marcus_eid = client.post("/time-entries", headers=_auth(marcus),
                             json={"period_id": pid, "store_min": 10, "reset_min": 0,
                                   "drive_min": 0, "miles": 0}).json()["id"]
    rico_eid = client.post("/time-entries", headers=_auth(rico),
                           json={"period_id": pid, "store_min": 20, "reset_min": 0,
                                 "drive_min": 0, "miles": 0}).json()["id"]
    _seal(client, dana, pid)
    marcus_id = _scalar("select id from users where email='marcus@lumenbeauty.com'")
    reopen = client.post(f"/pay-periods/{pid}/reopen", headers=_auth(dana),
                         json={"user_id": str(marcus_id), "reason": "missed a visit"})
    assert reopen.status_code == 200, reopen.text
    assert client.patch(f"/time-entries/{marcus_eid}", headers=_auth(marcus),
                        json={"store_min": 30, "reset_min": 0, "drive_min": 0,
                              "miles": 0}).status_code == 200
    assert client.patch(f"/time-entries/{rico_eid}", headers=_auth(rico),
                        json={"store_min": 30, "reset_min": 0, "drive_min": 0,
                              "miles": 0}).status_code == 409
    n = _scalar("select count(*) from audit where action = 'pay_period.reopened' "
                "and detail->>'reason' = 'missed a visit'")
    assert n == 1  # exactly one reopen logged with this reason
    assert _seal(client, dana, pid).status_code == 200
    assert client.patch(f"/time-entries/{marcus_eid}", headers=_auth(marcus),
                        json={"store_min": 40, "reset_min": 0, "drive_min": 0,
                              "miles": 0}).status_code == 409


def test_non_admin_cannot_seal_or_reopen(client, login):
    dana = login("dana@lumenbeauty.com")
    pid = _make_period(client, dana, "Admin Only Lock").json()["id"]
    marcus_id = _scalar("select id from users where email='marcus@lumenbeauty.com'")
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):  # manager, rep
        tok = _auth(login(email))
        assert client.post(f"/pay-periods/{pid}/seal", headers=tok).status_code == 403
        assert client.post(f"/pay-periods/{pid}/reopen", headers=tok,
                           json={"user_id": str(marcus_id), "reason": "x"}).status_code == 403


def test_reopen_requires_sealed_period(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Reopen Open").json()["id"]
    client.post("/time-entries", headers=_auth(marcus),
                json={"period_id": pid, "store_min": 10, "reset_min": 0, "drive_min": 0, "miles": 0})
    marcus_id = _scalar("select id from users where email='marcus@lumenbeauty.com'")
    resp = client.post(f"/pay-periods/{pid}/reopen", headers=_auth(dana),
                       json={"user_id": str(marcus_id), "reason": "x"})
    assert resp.status_code == 409, resp.text


def test_reopen_rep_with_no_entries_404(client, login):
    dana, marcus = login("dana@lumenbeauty.com"), login("marcus@lumenbeauty.com")
    pid = _make_period(client, dana, "Reopen No Entries").json()["id"]
    client.post("/time-entries", headers=_auth(marcus),
                json={"period_id": pid, "store_min": 10, "reset_min": 0, "drive_min": 0, "miles": 0})
    _seal(client, dana, pid)
    rico_id = _scalar("select id from users where email='rico@lumenbeauty.com'")
    resp = client.post(f"/pay-periods/{pid}/reopen", headers=_auth(dana),
                       json={"user_id": str(rico_id), "reason": "x"})
    assert resp.status_code == 404, resp.text


def test_audit_log_admin_only_and_records_actions(client, login):
    dana = login("dana@lumenbeauty.com")
    pid = _make_period(client, dana, "Audit Period").json()["id"]
    _seal(client, dana, pid)
    log = client.get("/audit", headers=_auth(dana))
    assert log.status_code == 200, log.text
    actions = {r["action"] for r in log.json()["audit"]}
    assert {"pay_period.created", "pay_period.sealed"} <= actions
    assert client.get("/audit", headers=_auth(login("marcus@lumenbeauty.com"))).status_code == 403
