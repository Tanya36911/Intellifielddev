"""THE GATE (repo level). Scope follows the pin: a caller sees only their
pinned node and everything below it, within their own tenant. Nothing else
builds on Phase 2 until these pass.
"""
from app.scope import ScopedRepo, scope_path_for


def _repo_for(users, email):
    u = users[email]
    return ScopedRepo(u["tenant_id"], scope_path_for(u["tenant_id"], u["id"]))


def _names(repo):
    return {n["name"] for n in repo.list_nodes()}


def test_admin_sees_whole_own_tenant(users):
    names = _names(_repo_for(users, "dana@lumenbeauty.com"))
    assert names == {
        "Lumen Beauty", "West", "Bay Area", "SF store", "Oakland store",
        "Central", "Chicago", "Chicago store",
    }


def test_admin_sees_zero_of_other_tenant(users):
    names = _names(_repo_for(users, "dana@lumenbeauty.com"))
    assert "Acme Cosmetics" not in names
    assert "Boston store" not in names


def test_manager_sees_only_their_branch(users):
    names = _names(_repo_for(users, "sarah@lumenbeauty.com"))
    assert names == {"Central", "Chicago", "Chicago store"}


def test_manager_sees_zero_of_sibling_region(users):
    names = _names(_repo_for(users, "sarah@lumenbeauty.com"))
    for west_node in ("West", "Bay Area", "SF store", "Oakland store"):
        assert west_node not in names


def test_rep_sees_only_their_stores(users):
    names = _names(_repo_for(users, "marcus@lumenbeauty.com"))
    assert names == {"Bay Area", "SF store", "Oakland store"}


def test_acme_admin_sees_only_acme(users):
    names = _names(_repo_for(users, "avery@acme.com"))
    assert names == {"Acme Cosmetics", "East", "Boston", "Boston store"}


def test_no_pin_sees_nothing(users):
    assert _names(_repo_for(users, "newbie@lumenbeauty.com")) == set()
