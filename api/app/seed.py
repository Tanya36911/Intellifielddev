"""Seed demo tenants, the org tree, users, and their pins, so you can log in
and so the isolation tests have a known world to check.

Run after migrations:
    docker compose exec api python -m app.seed

Idempotent: running it twice will not create duplicates.

The world it builds (scope = a pinned node AND everything below it):
  Lumen Beauty (tenant 'lumen')                 Acme Cosmetics (tenant 'acme')
    West > Bay Area > SF[CVS], Oakland[Walmart]    East > Boston > Boston store[CVS]
    Central > Chicago > Chicago store[CVS]
  Users (password demo1234):
    dana@lumenbeauty.com   admin   pinned at Lumen root
    sarah@lumenbeauty.com  manager pinned at Central
    marcus@lumenbeauty.com rep     pinned at Bay Area
    newbie@lumenbeauty.com rep     NO pin (sees nothing)
    avery@acme.com         admin   pinned at Acme root
"""
import json

from sqlalchemy import text

from .db import engine
from .security import hash_password

LEVELS = ["Company", "Region", "District", "Store"]


def _tenant(conn, name, code):
    return conn.execute(
        text(
            "insert into tenants (name, code) values (:name, :code) "
            "on conflict (code) do update set name = excluded.name returning id"
        ),
        {"name": name, "code": code},
    ).scalar()


def _levels(conn, tenant_id):
    for order, name in enumerate(LEVELS):
        locked = order in (0, len(LEVELS) - 1)
        conn.execute(
            text(
                "insert into org_level_definitions (tenant_id, level_order, name, locked) "
                "values (:tid, :lo, :name, :locked) "
                "on conflict (tenant_id, level_order) do update set name = excluded.name"
            ),
            {"tid": tenant_id, "lo": order, "name": name, "locked": locked},
        )


def _node(conn, tenant_id, parent, level_order, name, code, **store):
    """Insert (or update) a node and set its materialized path. parent is the
    dict returned for the parent node, or None for a root."""
    node_id = conn.execute(
        text(
            "insert into nodes (tenant_id, parent_id, level_order, name, code, "
            "chain, address, lat, lng, tz) "
            "values (:tid, :pid, :lo, :name, :code, :chain, :address, :lat, :lng, :tz) "
            "on conflict (tenant_id, code) do update set name = excluded.name, "
            "parent_id = excluded.parent_id, level_order = excluded.level_order, "
            "chain = excluded.chain returning id"
        ),
        {
            "tid": tenant_id,
            "pid": parent["id"] if parent else None,
            "lo": level_order,
            "name": name,
            "code": code,
            "chain": store.get("chain"),
            "address": store.get("address"),
            "lat": store.get("lat"),
            "lng": store.get("lng"),
            "tz": store.get("tz"),
        },
    ).scalar()
    parent_path = parent["path"] if parent else "/"
    path = f"{parent_path}{node_id}/"
    conn.execute(
        text("update nodes set path = :path where id = :id"),
        {"path": path, "id": node_id},
    )
    return {"id": node_id, "path": path}


def _user(conn, tenant_id, email, name, role, node):
    """Insert (or update) a user and pin them to node (or no pin if node None)."""
    user_id = conn.execute(
        text(
            "insert into users (tenant_id, email, name, role, password_hash) "
            "values (:tid, :email, :name, :role, :ph) "
            "on conflict (tenant_id, email) do update set name = excluded.name, "
            "role = excluded.role returning id"
        ),
        {"tid": tenant_id, "email": email, "name": name, "role": role,
         "ph": hash_password("demo1234")},
    ).scalar()
    if node is not None:
        conn.execute(
            text(
                "insert into assignments (tenant_id, user_id, node_id) "
                "values (:tid, :uid, :nid) "
                "on conflict (tenant_id, user_id) do update set node_id = excluded.node_id"
            ),
            {"tid": tenant_id, "uid": user_id, "nid": node["id"]},
        )
    return user_id


def _sku(conn, tenant_id, line, variant, upc, color, status="active"):
    """Insert (or update) one catalog product. Returns its id."""
    return conn.execute(
        text(
            "insert into skus (tenant_id, line, variant, upc, color, status, reference_images) "
            "values (:tid, :line, :variant, :upc, :color, :status, '[]'::jsonb) "
            "on conflict (tenant_id, upc) do update set line = excluded.line, "
            "variant = excluded.variant, color = excluded.color, status = excluded.status "
            "returning id"
        ),
        {"tid": tenant_id, "line": line, "variant": variant, "upc": upc,
         "color": color, "status": status},
    ).scalar()


def _survey(conn, tenant_id, name, type_, questions, assign_node=None, created_by=None):
    """Insert (or fetch) a published survey with one frozen v1, optionally
    assigned to a node. Idempotent by (tenant_id, name): if it already exists,
    returns its id and does nothing else."""
    existing = conn.execute(
        text("select id from surveys where tenant_id = :tid and name = :name"),
        {"tid": tenant_id, "name": name},
    ).scalar()
    if existing:
        return existing
    survey_id = conn.execute(
        text(
            "insert into surveys (tenant_id, name, type, status) "
            "values (:tid, :name, :type, 'published') returning id"
        ),
        {"tid": tenant_id, "name": name, "type": type_},
    ).scalar()
    version_id = conn.execute(
        text(
            "insert into survey_versions (survey_id, version_number, questions, published_at) "
            "values (:sid, 1, cast(:q as jsonb), now()) returning id"
        ),
        {"sid": survey_id, "q": json.dumps(questions)},
    ).scalar()
    if assign_node is not None:
        conn.execute(
            text(
                "insert into survey_assignments (tenant_id, survey_version_id, target_node_id, created_by) "
                "values (:tid, :vid, :nid, :cb)"
            ),
            {"tid": tenant_id, "vid": version_id, "nid": assign_node["id"], "cb": created_by},
        )
    return survey_id


def _assign_survey(conn, tenant_id, survey_name, target_node, created_by=None, deadline=None):
    """Add a coverage assignment for an existing published survey at target_node.
    Idempotent by (tenant, latest published version, target node): a second run
    finds the existing row and does nothing, so it never duplicates coverage.
    deadline is an ISO/UTC string (or None for 'never overdue')."""
    version_id = conn.execute(
        text(
            "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
            "where s.tenant_id = :tid and s.name = :name and v.published_at is not null "
            "order by v.version_number desc limit 1"
        ),
        {"tid": tenant_id, "name": survey_name},
    ).scalar()
    assert version_id, f"no published version for survey {survey_name!r}"
    existing = conn.execute(
        text(
            "select id from survey_assignments where tenant_id = :tid "
            "and survey_version_id = :vid and target_node_id = :nid"
        ),
        {"tid": tenant_id, "vid": version_id, "nid": target_node["id"]},
    ).scalar()
    if existing:
        return existing
    return conn.execute(
        text(
            "insert into survey_assignments (tenant_id, survey_version_id, target_node_id, "
            "deadline, created_by) values (:tid, :vid, :nid, cast(:dl as timestamptz), :cb) "
            "returning id"
        ),
        {"tid": tenant_id, "vid": version_id, "nid": target_node["id"],
         "dl": deadline, "cb": created_by},
    ).scalar()


def _response(conn, tenant_id, survey_name, store_code, user_email, answers, submitted_at=None):
    """Insert one demo response with its atomic answer rows. Idempotent: if this
    user already has a response for this store+version, do nothing."""
    version_id = conn.execute(
        text(
            "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
            "where s.tenant_id = :tid and s.name = :name and v.published_at is not null "
            "order by v.version_number desc limit 1"
        ),
        {"tid": tenant_id, "name": survey_name},
    ).scalar()
    store = conn.execute(
        text("select id, path from nodes where tenant_id = :tid and code = :code"),
        {"tid": tenant_id, "code": store_code},
    ).mappings().first()
    user_id = conn.execute(
        text("select id from users where tenant_id = :tid and email = :email"),
        {"tid": tenant_id, "email": user_email},
    ).scalar()
    # Fail loudly on a mistyped name/code/email rather than passing None into the
    # inserts (matches the defensive style of the other seed helpers).
    assert version_id, f"no published version for survey {survey_name!r}"
    assert store, f"no node with code {store_code!r}"
    assert user_id, f"no user with email {user_email!r}"
    existing = conn.execute(
        text(
            "select id from responses where survey_version_id = :vid "
            "and store_node_id = :nid and user_id = :uid"
        ),
        {"vid": version_id, "nid": store["id"], "uid": user_id},
    ).scalar()
    if existing:
        return existing
    resp_id = conn.execute(
        text(
            "insert into responses (tenant_id, survey_version_id, store_node_id, store_path, "
            "user_id, submitted_at) values (:tid, :vid, :nid, :spath, :uid, "
            "coalesce(cast(:sub as timestamptz), now())) returning id"
        ),
        {"tid": tenant_id, "vid": version_id, "nid": store["id"], "spath": store["path"],
         "uid": user_id, "sub": submitted_at},
    ).scalar()
    for a in answers:
        conn.execute(
            text(
                "insert into response_items (response_id, tenant_id, store_node_id, store_path, "
                "survey_version_id, submitted_at, question_id, sku_id, value) values (:rid, :tid, "
                ":nid, :spath, :vid, coalesce(cast(:sub as timestamptz), now()), :qid, :sku, "
                "cast(:val as jsonb))"
            ),
            {"rid": resp_id, "tid": tenant_id, "nid": store["id"], "spath": store["path"],
             "vid": version_id, "sub": submitted_at, "qid": a["question_id"],
             "sku": a.get("sku_id"), "val": json.dumps(a["value"])},
        )
    return resp_id


def _pay_period(conn, tenant_id, name, start_date, end_date):
    """Insert (or fetch) an open pay period. Idempotent by (tenant_id, name)."""
    existing = conn.execute(
        text("select id from pay_periods where tenant_id = :tid and name = :name"),
        {"tid": tenant_id, "name": name},
    ).scalar()
    if existing:
        return existing
    return conn.execute(
        text("insert into pay_periods (tenant_id, name, start_date, end_date) "
             "values (:tid, :name, :sd, :ed) returning id"),
        {"tid": tenant_id, "name": name, "sd": start_date, "ed": end_date},
    ).scalar()


def _time_entry(conn, tenant_id, period_id, user_email, store_min, reset_min,
                drive_min, miles, mgr_status="pending"):
    """Insert (or skip) one rep's entry for a period. Idempotent by (period, user)."""
    user_id = conn.execute(
        text("select id from users where tenant_id = :tid and email = :email"),
        {"tid": tenant_id, "email": user_email},
    ).scalar()
    assert user_id, f"no user with email {user_email!r}"
    existing = conn.execute(
        text("select id from time_entries where period_id = :pid and user_id = :uid"),
        {"pid": period_id, "uid": user_id},
    ).scalar()
    if existing:
        return existing
    return conn.execute(
        text("insert into time_entries (tenant_id, period_id, user_id, store_min, reset_min, "
             "drive_min, miles, mgr_status) values (:tid, :pid, :uid, :sm, :rm, :dm, :mi, :ms) "
             "returning id"),
        {"tid": tenant_id, "pid": period_id, "uid": user_id, "sm": store_min, "rm": reset_min,
         "dm": drive_min, "mi": miles, "ms": mgr_status},
    ).scalar()


def run(demo_extras: bool = False) -> None:
    """Seed the demo world. The TESTS call run() with demo_extras=False, which
    keeps a small, stable world their assertions depend on. The dev/demo database
    (seeded via `python -m app.seed`) calls run(demo_extras=True), which adds a
    richer Central branch (more districts/stores/reps/responses) so the Manager
    app demos look full. The extras are purely additive and dev-only, so the
    backend test suite never sees them and stays green untouched."""
    with engine.begin() as conn:
        # ----- Lumen Beauty -----
        lumen = _tenant(conn, "Lumen Beauty", "lumen")
        _levels(conn, lumen)
        l_root = _node(conn, lumen, None, 0, "Lumen Beauty", "lumen-co")
        west = _node(conn, lumen, l_root, 1, "West", "west")
        bayarea = _node(conn, lumen, west, 2, "Bay Area", "bayarea")
        _node(conn, lumen, bayarea, 3, "SF store", "sf", chain="CVS")
        _node(conn, lumen, bayarea, 3, "Oakland store", "oakland", chain="Walmart")
        central = _node(conn, lumen, l_root, 1, "Central", "central")
        chicago = _node(conn, lumen, central, 2, "Chicago", "chicago")
        _node(conn, lumen, chicago, 3, "Chicago store", "chicago-store", chain="CVS")

        dana_id = _user(conn, lumen, "dana@lumenbeauty.com", "Dana Whitfield", "admin", l_root)
        _user(conn, lumen, "sarah@lumenbeauty.com", "Sarah Mitchell", "manager", central)
        _user(conn, lumen, "marcus@lumenbeauty.com", "Marcus Bell", "rep", bayarea)
        _user(conn, lumen, "newbie@lumenbeauty.com", "Newbie NoPin", "rep", None)

        # --- Velvet Lip (existing rose/mauve/coral kept; rose is referenced below) ---
        rose = _sku(conn, lumen, "Velvet Lip", "Rosewood", "LUM-VL-ROSE", "#9B5B5B")
        _sku(conn, lumen, "Velvet Lip", "Mauve", "LUM-VL-MAUVE", "#8B5E83")
        _sku(conn, lumen, "Velvet Lip", "Coral", "LUM-VL-CORAL", "#E5734D")
        _sku(conn, lumen, "Velvet Lip", "Brick", "LUM-VL-BRICK", "#8d3b2f")
        _sku(conn, lumen, "Velvet Lip", "Nude Petal", "LUM-VL-NUDE", "#c98e83")
        _sku(conn, lumen, "Velvet Lip", "Crimson", "LUM-VL-CRIMSON", "#b01030")
        _sku(conn, lumen, "Velvet Lip", "Plum", "LUM-VL-PLUM-SEED", "#6d3b5e")
        _sku(conn, lumen, "Velvet Lip", "Terracotta", "LUM-VL-TERRA", "#b5613f")
        # --- Silk Foundation (existing ivory kept) ---
        _sku(conn, lumen, "Silk Foundation", "Ivory", "LUM-SF-IVORY", "#E8D3B8")
        _sku(conn, lumen, "Silk Foundation", "Porcelain", "LUM-SF-PORC", "#f0d8c4")
        _sku(conn, lumen, "Silk Foundation", "Beige", "LUM-SF-BEIGE", "#ddb591")
        _sku(conn, lumen, "Silk Foundation", "Sand", "LUM-SF-SAND", "#cda077")
        _sku(conn, lumen, "Silk Foundation", "Honey", "LUM-SF-HONEY", "#b9885a")
        _sku(conn, lumen, "Silk Foundation", "Caramel", "LUM-SF-CARAMEL", "#9c6b41")
        _sku(conn, lumen, "Silk Foundation", "Almond", "LUM-SF-ALMOND", "#7d5237")
        _sku(conn, lumen, "Silk Foundation", "Espresso", "LUM-SF-ESPRESSO", "#4a3122")
        # --- Lash Volume ---
        _sku(conn, lumen, "Lash Volume", "Blackest Black", "LUM-LV-BLACK", "#0b0b0d")
        _sku(conn, lumen, "Lash Volume", "Brown-Black", "LUM-LV-BROWNBLACK", "#2a211c")
        _sku(conn, lumen, "Lash Volume", "Cocoa", "LUM-LV-COCOA", "#4a3328")
        # --- Glow Blush (Bronze discontinued, so the status filter has something) ---
        _sku(conn, lumen, "Glow Blush", "Peach", "LUM-GB-PEACH", "#f0a07a")
        _sku(conn, lumen, "Glow Blush", "Rose", "LUM-GB-ROSE", "#e08aa0")
        _sku(conn, lumen, "Glow Blush", "Berry", "LUM-GB-BERRY", "#b14a6e")
        _sku(conn, lumen, "Glow Blush", "Bronze", "LUM-GB-BRONZE", "#b3754a", status="discontinued")
        # --- Cushion Compact ---
        _sku(conn, lumen, "Cushion Compact", "Fair", "LUM-CC-FAIR", "#f2dcc8")
        _sku(conn, lumen, "Cushion Compact", "Light", "LUM-CC-LIGHT", "#e8c3a3")
        _sku(conn, lumen, "Cushion Compact", "Medium", "LUM-CC-MEDIUM", "#cf9e74")
        _sku(conn, lumen, "Cushion Compact", "Tan", "LUM-CC-TAN", "#b07d4f")
        _sku(conn, lumen, "Cushion Compact", "Deep", "LUM-CC-DEEP", "#6e4a30")
        # --- Brow Define ---
        _sku(conn, lumen, "Brow Define", "Blonde", "LUM-BD-BLONDE", "#b89968")
        _sku(conn, lumen, "Brow Define", "Taupe", "LUM-BD-TAUPE", "#8a7355")
        _sku(conn, lumen, "Brow Define", "Soft Brown", "LUM-BD-SOFTBROWN", "#6d513a")
        _sku(conn, lumen, "Brow Define", "Dark Brown", "LUM-BD-DARKBROWN", "#4a3526")
        _sku(conn, lumen, "Brow Define", "Ebony", "LUM-BD-EBONY", "#211913")

        _survey(
            conn, lumen, "Velvet Lip Shelf Check", "shelf_check",
            [
                {"id": "q1", "prompt": "How many facings of Rosewood are on the shelf?",
                 "type": "number", "sku_ids": [str(rose)], "perSku": True,
                 "pass": {"operator": ">=", "value": 4}, "passScope": "each"},
                {"id": "q2", "prompt": "Is the Velvet Lip endcap display present?",
                 "type": "boolean", "pass": {"operator": "==", "value": True}},
            ],
            assign_node=central, created_by=dana_id,
        )

        # SF's LATEST reading (no submitted_at -> now(), so it is the current
        # reading): Rosewood 6 >= 4 and endcap present -> overall PASS. Bay Area's
        # SF store reads healthy on the dashboard.
        _response(
            conn, lumen, "Velvet Lip Shelf Check", "sf", "marcus@lumenbeauty.com",
            [{"question_id": "q1", "sku_id": str(rose), "value": 6},
             {"question_id": "q2", "value": True}],
        )
        # Oakland's LATEST reading: Rosewood 2 < 4 (two facings short of the
        # planogram) so q1 FAILS, even though the endcap is present. This is the
        # drillable failure: West -> Bay Area -> Oakland -> "Rosewood: 2".
        _response(
            conn, lumen, "Velvet Lip Shelf Check", "oakland", "marcus@lumenbeauty.com",
            [{"question_id": "q1", "sku_id": str(rose), "value": 2},
             {"question_id": "q2", "value": True}],
        )
        # An earlier SF reading so the facings trend has more than one point.
        # NOTE: an export test filters to exactly this instant and expects 1 row,
        # so do NOT add another response at 2026-06-10T09:00:00Z.
        _response(
            conn, lumen, "Velvet Lip Shelf Check", "sf", "dana@lumenbeauty.com",
            [{"question_id": "q1", "sku_id": str(rose), "value": 6}],
            submitted_at="2026-06-10T09:00:00Z",
        )

        # Payroll on for Lumen. A rep pinned under Central (Sarah's branch) so
        # manager-approval scope is testable: Sarah can approve Rico, not Marcus.
        conn.execute(text("update tenants set payroll_enabled = true where id = :id"),
                     {"id": lumen})
        _user(conn, lumen, "rico@lumenbeauty.com", "Rico Vance", "rep", chicago)

        # Company-wide coverage (all three stores). The earlier central assignment
        # (no deadline) stays; the latest published version is shared, so coverage
        # de-dupes per distinct (store, version) and never double-counts. A past
        # deadline is kept for realism, but every covered store now has a reading
        # (see the chicago response below), so the dashboard shows a healthy
        # "compliance by node" with no empty rows and Overdue 0. Placed here (not
        # next to the survey) because the spread below needs rico, created just
        # above in the payroll section.
        _assign_survey(
            conn, lumen, "Velvet Lip Shelf Check", l_root,
            created_by=dana_id, deadline="2026-06-12T00:00:00Z",
        )

        # A spread of Velvet Lip readings at sf and oakland across the last ~8
        # weeks (UTC), one per (store, user) pair since the seed is idempotent on
        # that key. Varied Rosewood facings: passing (>=4), failing (<4), and 0
        # (out of stock), with the endcap boolean mixed. This gives the weekly
        # completion trend several points that rise as more stores report. The
        # current (latest) readings are set by the now()-dated sf/oakland responses
        # above plus the recent chicago response below. None of these use
        # 2026-06-10T09:00:00Z (an export test pins exactly one response there).
        _spread = [
            # week, store, author, rosewood facings, endcap present
            ("2026-04-28T10:00:00Z", "oakland", "dana@lumenbeauty.com", 2, False),
            ("2026-05-05T11:00:00Z", "sf", "sarah@lumenbeauty.com", 3, False),
            ("2026-05-12T10:30:00Z", "oakland", "sarah@lumenbeauty.com", 0, False),
            ("2026-05-19T09:30:00Z", "sf", "rico@lumenbeauty.com", 4, True),
            ("2026-05-26T14:00:00Z", "oakland", "rico@lumenbeauty.com", 5, True),
            ("2026-06-02T10:00:00Z", "sf", "newbie@lumenbeauty.com", 6, True),
            ("2026-06-02T15:00:00Z", "oakland", "newbie@lumenbeauty.com", 0, False),
        ]
        for when, store_code, author, facings, endcap in _spread:
            _response(
                conn, lumen, "Velvet Lip Shelf Check", store_code, author,
                [{"question_id": "q1", "sku_id": str(rose), "value": facings},
                 {"question_id": "q2", "value": endcap}],
                submitted_at=when,
            )

        # Chicago store's reading (rico, pinned at Chicago): Rosewood 5 >= 4 and
        # endcap present -> overall PASS. This is Central's only store, so Central
        # reads 100% on the dashboard and is no longer overdue. Dated recently so
        # it lifts the latest weekly-trend point.
        _response(
            conn, lumen, "Velvet Lip Shelf Check", "chicago-store", "rico@lumenbeauty.com",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5},
             {"question_id": "q2", "value": True}],
            submitted_at="2026-06-16T10:00:00Z",
        )

        period = _pay_period(conn, lumen, "June 1-15", "2026-06-01", "2026-06-15")
        _time_entry(conn, lumen, period, "marcus@lumenbeauty.com", 480, 60, 90, 42, "pending")
        _time_entry(conn, lumen, period, "rico@lumenbeauty.com", 510, 45, 70, 33, "approved")

        if demo_extras:
            # ----- Demo-only enrichment of Sarah's Central branch -----
            # Additive and dev-only (tests run with demo_extras=False). Gives the
            # Manager app a full, varied branch: more districts and stores, reps
            # pinned in them, and a mix of passing/failing readings so the
            # compliance drill shows real variety. The company-wide Velvet Lip
            # assignment (at l_root) already covers these new stores by path.
            _node(conn, lumen, chicago, 3, "Naperville store", "naperville", chain="Walmart")
            _node(conn, lumen, chicago, 3, "Evanston store", "evanston", chain="Target")
            detroit = _node(conn, lumen, central, 2, "Detroit", "detroit")
            _node(conn, lumen, detroit, 3, "Detroit store", "detroit-store", chain="CVS")
            _node(conn, lumen, detroit, 3, "Ann Arbor store", "annarbor", chain="Walgreens")
            indy = _node(conn, lumen, central, 2, "Indianapolis", "indianapolis")
            _node(conn, lumen, indy, 3, "Indianapolis store", "indy-store", chain="CVS")
            _node(conn, lumen, indy, 3, "Bloomington store", "bloomington", chain="Walmart")
            # Reps pinned in the new districts.
            _user(conn, lumen, "tasha@lumenbeauty.com", "Tasha Green", "rep", detroit)
            _user(conn, lumen, "omar@lumenbeauty.com", "Omar Reyes", "rep", indy)
            # Latest readings (Velvet Lip Shelf Check: q1 Rosewood facings >= 4
            # passes; q2 endcap present). Bloomington is left unread on purpose so
            # the demo also shows an expected-but-not-responded store.
            for store_code, author, facings, endcap in [
                ("naperville", "rico@lumenbeauty.com", 5, True),       # pass
                ("evanston", "rico@lumenbeauty.com", 2, True),         # fail: Rosewood short
                ("detroit-store", "tasha@lumenbeauty.com", 6, True),   # pass
                ("annarbor", "tasha@lumenbeauty.com", 0, False),       # fail: OOS + no endcap
                ("indy-store", "omar@lumenbeauty.com", 4, True),       # pass
            ]:
                _response(
                    conn, lumen, "Velvet Lip Shelf Check", store_code, author,
                    [{"question_id": "q1", "sku_id": str(rose), "value": facings},
                     {"question_id": "q2", "value": endcap}],
                    submitted_at="2026-06-17T10:00:00Z",
                )
            # Hours for the new reps so the (upcoming) Payroll Approval demo is full.
            _time_entry(conn, lumen, period, "tasha@lumenbeauty.com", 465, 50, 80, 28, "pending")
            _time_entry(conn, lumen, period, "omar@lumenbeauty.com", 495, 40, 95, 51, "pending")

        # ----- Acme Cosmetics (proves cross-tenant isolation) -----
        acme = _tenant(conn, "Acme Cosmetics", "acme")
        _levels(conn, acme)
        a_root = _node(conn, acme, None, 0, "Acme Cosmetics", "acme-co")
        east = _node(conn, acme, a_root, 1, "East", "east")
        boston = _node(conn, acme, east, 2, "Boston", "boston")
        _node(conn, acme, boston, 3, "Boston store", "boston-store", chain="CVS")

        _user(conn, acme, "avery@acme.com", "Avery Stone", "admin", a_root)

        _sku(conn, acme, "Glow Serum", "Original", "ACM-GS-ORIG", "#D8C7A0")

        _survey(
            conn, acme, "Glow Serum Check", "shelf_check",
            [{"id": "q1", "prompt": "Is Glow Serum in stock?", "type": "boolean"}],
        )

        # Acme demo response (q1 has no pass rule -> overall not counted).
        _response(
            conn, acme, "Glow Serum Check", "boston-store", "avery@acme.com",
            [{"question_id": "q1", "value": True}],
        )

    print("Seeded Lumen (8 nodes, 33 products across 6 lines, 1 survey, 2 assignments, 11 responses, payroll on, 6 users, 1 period, 2 entries) + Acme (4 nodes, 1 product, 1 survey, 1 response, payroll off) + 6 users with pins.")
    if demo_extras:
        print("  + demo extras on Central: 2 districts (Detroit, Indianapolis), 6 stores, 2 reps, 5 readings, 2 hours entries (dev/demo only, not seeded for tests).")


if __name__ == "__main__":
    # The dev/demo database gets the richer Central branch.
    run(demo_extras=True)
