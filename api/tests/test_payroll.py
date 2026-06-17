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
