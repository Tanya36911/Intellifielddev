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
