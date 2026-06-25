"""Tenant-config brick. Any signed-in user reads their own company; PATCH is
admin only; a caller only ever sees/edits their own tenant."""


def _get(client, token):
    return client.get("/tenants", headers={"Authorization": f"Bearer {token}"})


def _patch(client, token, **body):
    return client.patch("/tenants", headers={"Authorization": f"Bearer {token}"}, json=body)


def test_any_user_reads_own_company(client, login):
    for email in ("dana@lumenbeauty.com", "sarah@lumenbeauty.com",
                  "marcus@lumenbeauty.com", "newbie@lumenbeauty.com"):
        resp = _get(client, login(email))
        assert resp.status_code == 200, f"{email}: {resp.text}"
        body = resp.json()
        assert body["name"] == "Lumen Beauty"
        assert body["code"] == "lumen"
        assert set(body.keys()) == {"id", "name", "code", "payroll_enabled"}


def test_company_isolation(client, login):
    lumen = _get(client, login("dana@lumenbeauty.com")).json()
    acme = _get(client, login("avery@acme.com")).json()
    assert lumen["name"] == "Lumen Beauty"
    assert acme["name"] != "Lumen Beauty"
    assert acme["code"] != "lumen"


def test_tenants_requires_auth(client):
    assert client.get("/tenants").status_code == 401


def test_admin_can_rename_company(client, login):
    token = login("dana@lumenbeauty.com")
    resp = _patch(client, token, name="Lumen Beauty Co")
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Lumen Beauty Co"
    _patch(client, token, name="Lumen Beauty")  # restore


def test_admin_can_toggle_payroll(client, login):
    token = login("dana@lumenbeauty.com")
    assert _patch(client, token, payroll_enabled=False).json()["payroll_enabled"] is False
    assert _patch(client, token, payroll_enabled=True).json()["payroll_enabled"] is True


def test_non_admin_cannot_patch(client, login):
    for email in ("sarah@lumenbeauty.com", "marcus@lumenbeauty.com"):
        assert _patch(client, login(email), name="Nope").status_code == 403


def test_empty_name_rejected(client, login):
    assert _patch(client, login("dana@lumenbeauty.com"), name="").status_code == 422


def test_no_fields_rejected(client, login):
    assert _patch(client, login("dana@lumenbeauty.com")).status_code == 422


def test_code_is_not_changed(client, login):
    token = login("dana@lumenbeauty.com")
    # `code` is not a model field, so it is ignored; name still applies.
    resp = _patch(client, token, name="Lumen Beauty", code="hacked")
    assert resp.status_code == 200, resp.text
    assert resp.json()["code"] == "lumen"


def test_null_fields_rejected(client, login):
    # Explicit nulls must be a clean 422, never a 500 from a NULL write.
    token = login("dana@lumenbeauty.com")
    assert _patch(client, token, name=None).status_code == 422
    assert _patch(client, token, payroll_enabled=None).status_code == 422
