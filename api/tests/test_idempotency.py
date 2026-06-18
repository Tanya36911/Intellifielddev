"""Phase 5-BE-a: idempotency keys. A client-generated UUID (a claim ticket) on
POST /responses and POST /time-entries makes a re-sent submission return the
original row instead of duplicating. Optional: callers that send no key behave
exactly as before. Tests go through the API and isolate to data they create."""
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

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
    h = _auth(admin_token)
    survey = client.post("/surveys", headers=h,
                         json={"name": name, "type": None, "questions": questions}).json()
    client.post(f"/surveys/{survey['id']}/publish", headers=h)
    full = client.get(f"/surveys/{survey['id']}", headers=h).json()
    vid = next(v["id"] for v in full["versions"] if v["published_at"] is not None)
    client.post("/survey-assignments", headers=h,
                json={"survey_version_id": vid, "target_node_id": str(_node_id(target_code))})
    return vid


def _submit(client, token, vid, store_code, answers, idem=None):
    body = {"survey_version_id": str(vid),
            "store_node_id": str(_node_id(store_code)), "answers": answers}
    if idem is not None:
        body["idempotency_key"] = idem
    return client.post("/responses", headers=_auth(token), json=body)


def _bay_survey(client, dana):
    rose = _sku_id("LUM-VL-ROSE")
    q = [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
          "sku_ids": [str(rose)], "pass": {"operator": ">=", "value": 4}, "passScope": "each"}]
    return _publish_and_assign(client, dana, "Idem Responses", q, "bayarea"), rose


def test_responses_same_ticket_returns_original(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    vid, rose = _bay_survey(client, dana)
    tk = str(uuid.uuid4())
    a = [{"question_id": "q1", "sku_id": str(rose), "value": 5}]
    r1 = _submit(client, marcus, vid, "sf", a, idem=tk)
    r2 = _submit(client, marcus, vid, "sf", a, idem=tk)
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    assert r1.json()["id"] == r2.json()["id"]          # same row
    assert r1.json() == r2.json()                      # identical body
    assert "idempotency_key" not in r1.json()          # key stays internal
    n = _scalar("select count(*) from responses where idempotency_key = cast(:k as uuid)", k=tk)
    assert n == 1                                       # exactly one row for the ticket


def test_responses_no_ticket_creates_two(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    vid, rose = _bay_survey(client, dana)
    a = [{"question_id": "q1", "sku_id": str(rose), "value": 5}]
    r1 = _submit(client, marcus, vid, "sf", a)
    r2 = _submit(client, marcus, vid, "sf", a)
    assert r1.json()["id"] != r2.json()["id"]          # re-visits retained


def test_responses_keyed_then_unkeyed_inserts(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    vid, rose = _bay_survey(client, dana)
    a = [{"question_id": "q1", "sku_id": str(rose), "value": 5}]
    r1 = _submit(client, marcus, vid, "sf", a, idem=str(uuid.uuid4()))
    r2 = _submit(client, marcus, vid, "sf", a)         # no ticket -> never deduped
    assert r1.json()["id"] != r2.json()["id"]


def test_responses_duplicate_key_rejected_by_index(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    vid, rose = _bay_survey(client, dana)
    tk = str(uuid.uuid4())
    _submit(client, marcus, vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}], idem=tk)
    # A direct second row with the same (tenant_id, idempotency_key) must be rejected
    # by the partial unique index (the endpoint short-circuits, so this is the only
    # way to prove the index bites).
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(text(
                "insert into responses (tenant_id, survey_version_id, store_node_id, "
                "store_path, user_id, idempotency_key) "
                "select tenant_id, survey_version_id, store_node_id, store_path, user_id, "
                "cast(:k as uuid) from responses where idempotency_key = cast(:k as uuid)"),
                {"k": tk})


def test_responses_cross_company_ticket_no_collision(client, login):
    dana = login("dana@lumenbeauty.com")
    marcus = login("marcus@lumenbeauty.com")
    avery = login("avery@acme.com")
    tk = str(uuid.uuid4())
    vid_l, rose = _bay_survey(client, dana)
    rl = _submit(client, marcus, vid_l, "sf",
                 [{"question_id": "q1", "sku_id": str(rose), "value": 5}], idem=tk)
    acme_vid = _scalar(
        "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
        "where s.name = 'Glow Serum Check' and v.published_at is not null limit 1")
    ra = client.post("/responses", headers=_auth(avery),
                     json={"survey_version_id": str(acme_vid),
                           "store_node_id": str(_node_id("boston-store")),
                           "answers": [{"question_id": "q1", "value": True}],
                           "idempotency_key": tk})
    assert rl.status_code == 200 and ra.status_code == 200, (rl.text, ra.text)
    assert rl.json()["id"] != ra.json()["id"]          # same ticket, two companies, two rows
    n = _scalar("select count(*) from responses where idempotency_key = cast(:k as uuid)", k=tk)
    assert n == 2


def test_responses_keyed_first_submit_still_scoped_and_validated(client, login):
    dana = login("dana@lumenbeauty.com")
    sarah = login("sarah@lumenbeauty.com")     # Central, cannot reach Bay Area
    marcus = login("marcus@lumenbeauty.com")
    vid, rose = _bay_survey(client, dana)
    out = _submit(client, sarah, vid, "sf",
                  [{"question_id": "q1", "sku_id": str(rose), "value": 5}], idem=str(uuid.uuid4()))
    assert out.status_code == 404, out.text          # ticket does not bypass scope
    bad = _submit(client, marcus, vid, "sf",
                  [{"question_id": "q1", "sku_id": str(rose), "value": "notnum"}],
                  idem=str(uuid.uuid4()))
    assert bad.status_code == 400, bad.text          # ticket does not bypass validation


def _open_period(client, dana):
    return client.post("/pay-periods", headers=_auth(dana),
                       json={"start_date": "2026-12-01", "end_date": "2026-12-15",
                             "name": "Idem Hours"}).json()["id"]


def _post_entry(client, token, pid, idem=None, store_min=120):
    body = {"period_id": pid, "store_min": store_min, "reset_min": 0,
            "drive_min": 0, "miles": 0}
    if idem is not None:
        body["idempotency_key"] = idem
    return client.post("/time-entries", headers=_auth(token), json=body)


def test_hours_same_ticket_returns_original(client, login):
    dana = login("dana@lumenbeauty.com")
    rico = login("rico@lumenbeauty.com")
    pid = _open_period(client, dana)
    tk = str(uuid.uuid4())
    e1 = _post_entry(client, rico, pid, idem=tk)
    e2 = _post_entry(client, rico, pid, idem=tk)
    assert e1.status_code == 200 and e2.status_code == 200, (e1.text, e2.text)
    assert e1.json()["id"] == e2.json()["id"]
    assert e1.json() == e2.json()                      # identical body (miles a number)
    assert isinstance(e1.json()["miles"], (int, float))
    assert "idempotency_key" not in e1.json()
    rico_id = _scalar("select id from users where email = 'rico@lumenbeauty.com'")
    n = _scalar("select count(*) from time_entries where period_id = cast(:p as uuid) "
                "and user_id = cast(:u as uuid)", p=str(pid), u=str(rico_id))
    assert n == 1
    k = _scalar("select idempotency_key from time_entries where period_id = cast(:p as uuid) "
                "and user_id = cast(:u as uuid)", p=str(pid), u=str(rico_id))
    assert str(k) == tk                                # the row carries the sent ticket


def test_hours_different_ticket_same_period_409(client, login):
    dana = login("dana@lumenbeauty.com")
    rico = login("rico@lumenbeauty.com")
    pid = _open_period(client, dana)
    e1 = _post_entry(client, rico, pid, idem=str(uuid.uuid4()))
    assert e1.status_code == 200, e1.text
    e2 = _post_entry(client, rico, pid, idem=str(uuid.uuid4()))   # different ticket, same (period, rep)
    assert e2.status_code == 409, e2.text              # genuine second entry still blocked


def test_hours_payroll_off_company_403(client, login):
    avery = login("avery@acme.com")                    # Acme: payroll off
    r = client.post("/time-entries", headers=_auth(avery),
                    json={"period_id": str(uuid.uuid4()), "store_min": 10,
                          "idempotency_key": str(uuid.uuid4())})
    assert r.status_code == 403, r.text                # gate runs before ticket logic
