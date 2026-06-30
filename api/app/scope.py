"""The scope guard: scope follows the pin.

Every request for scoped data goes through get_scoped_repo, which reads the
caller's wristband (JWT), looks up the node they are pinned to, and returns a
ScopedRepo. The ScopedRepo is the ONLY object allowed to query scoped tables;
it automatically limits every query to the caller's tenant and the subtree
under their pinned node, so no endpoint can forget the filter.
"""
import json
import re
from datetime import timezone

from fastapi import Depends
from sqlalchemy import text

from .compliance import evaluate_response
from .db import engine
from .security import current_claims


class PublishedVersionError(Exception):
    """Tried to edit a version that is already published (frozen)."""


class NoDraftError(Exception):
    """Tried to publish a survey that has no current draft version."""


class DraftExistsError(Exception):
    """Tried to start a new version while an unpublished draft already exists."""


class VersionNotPublishedError(Exception):
    """Tried to assign a survey version that is missing or not published."""


class PeriodSealedError(Exception):
    """Tried to add an entry to a sealed pay period."""


class EntryExistsError(Exception):
    """Tried to create a second time entry for the same rep + period."""


class EntrySealedError(Exception):
    """Tried to edit or re-approve a locked (sealed) time entry."""


class PeriodNotSealedError(Exception):
    """Tried to reopen a pay period that is not sealed."""


class RepEntriesNotFoundError(Exception):
    """Tried to reopen a rep who has no entries in the pay period."""


class LastAdminError(Exception):
    """Tried to remove the company's only remaining admin."""


class ScopedRepo:
    """The only object allowed to read scoped tables. tenant_id and scope_path
    are baked in; a scope_path of None means the caller sees nothing."""

    def __init__(self, tenant_id: str, scope_path: str | None):
        self.tenant_id = tenant_id
        self.scope_path = scope_path

    def list_nodes(self) -> list[dict]:
        if self.scope_path is None:
            return []
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "select id, name, code, level_order, parent_id, path, "
                    "chain, address, lat, lng, tz from nodes "
                    # cast(:tid as uuid) so a tenant id arriving as text (from
                    # the JWT) compares cleanly against the uuid column.
                    "where tenant_id = cast(:tid as uuid) and path like :scope || '%' "
                    "order by path"
                ),
                {"tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().all()
        return [dict(r) for r in rows]

    def list_org_levels(self) -> list[dict]:
        """The company's org level definitions (Company, Region, ... Store), in
        order. Tenant-scoped, not branch-scoped: the level labels are company-wide,
        so any signed-in user (even an unpinned one) can read them."""
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "select level_order, name, locked from org_level_definitions "
                    "where tenant_id = cast(:tid as uuid) order by level_order"
                ),
                {"tid": str(self.tenant_id)},
            ).mappings().all()
        return [dict(r) for r in rows]

    # ----- node writes (add / rename / delete; admin-only at the router) -----

    _NODE_COLS = ("id, name, code, level_order, parent_id, path, chain, "
                  "address, lat, lng, tz")

    def get_node(self, node_id) -> dict | None:
        with engine.connect() as conn:
            row = conn.execute(
                text(f"select {self._NODE_COLS} from nodes "
                     "where id = cast(:id as uuid) and tenant_id = cast(:tid as uuid)"),
                {"id": str(node_id), "tid": str(self.tenant_id)},
            ).mappings().first()
        return dict(row) if row else None

    def _slug_code(self, conn, name: str) -> str:
        """A URL-safe code from the name, made unique within the tenant by a
        numeric suffix so the admin never types a code by hand."""
        base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "node"
        code, n = base, 2
        while conn.execute(
            text("select 1 from nodes where tenant_id = cast(:tid as uuid) and code = :code"),
            {"tid": str(self.tenant_id), "code": code},
        ).first() is not None:
            code, n = f"{base}-{n}", n + 1
        return code

    def create_node(self, parent_id, name, attrs: dict) -> dict | None:
        """Add a child under parent_id. Returns None if the parent is out of
        scope/tenant. Raises ValueError('bottom') when the parent is already at
        the locked lowest level (a store is a leaf)."""
        if self.scope_path is None:
            return None
        with engine.begin() as conn:
            parent = conn.execute(
                text("select id, level_order, path from nodes where id = cast(:nid as uuid) "
                     "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
                {"nid": str(parent_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            if parent is None:
                return None
            if parent["level_order"] >= self._max_level(conn):
                raise ValueError("bottom")
            code = self._slug_code(conn, name)
            nid = conn.execute(
                text("insert into nodes (tenant_id, parent_id, level_order, name, code, "
                     "chain, address, lat, lng, tz) values (cast(:tid as uuid), "
                     "cast(:pid as uuid), :lvl, :name, :code, :chain, :address, :lat, :lng, :tz) "
                     "returning id"),
                {"tid": str(self.tenant_id), "pid": str(parent_id),
                 "lvl": parent["level_order"] + 1, "name": name, "code": code,
                 "chain": attrs.get("chain"), "address": attrs.get("address"),
                 "lat": attrs.get("lat"), "lng": attrs.get("lng"), "tz": attrs.get("tz")},
            ).scalar()
            conn.execute(
                text("update nodes set path = :path where id = cast(:id as uuid)"),
                {"path": f"{parent['path']}{nid}/", "id": str(nid)},
            )
        return self.get_node(nid)

    def bulk_create_nodes(self, rows: list[dict]) -> dict:
        """Create many nodes from {level, name, parent} rows in one transaction.
        Valid rows are created; invalid rows are reported (never raise). A row's
        `parent` is resolved by name to a SINGLE in-scope node one level up,
        considering both pre-existing nodes and ones created earlier in this batch
        (so a District and its Stores can import together)."""
        if self.scope_path is None:
            return {"created": 0,
                    "errors": [{"row": i, "name": r.get("name", ""), "reason": "no scope"}
                               for i, r in enumerate(rows)]}
        # level name (case-insensitive) -> level_order
        levels = {lvl["name"].strip().lower(): lvl["level_order"] for lvl in self.list_org_levels()}
        errors: list[dict] = []
        created = 0
        with engine.begin() as conn:
            max_level = self._max_level(conn)
            # in-scope nodes indexed by (lower name, level_order) -> [{id, path}]
            index: dict[tuple[str, int], list[dict]] = {}
            for n in conn.execute(
                text("select id, name, level_order, path from nodes "
                     "where tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
                {"tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().all():
                index.setdefault((n["name"].strip().lower(), n["level_order"]), []).append(
                    {"id": n["id"], "path": n["path"]})

            for i, row in enumerate(rows):
                name = (row.get("name") or "").strip()
                raw_level = (row.get("level") or "").strip()
                raw_parent = (row.get("parent") or "").strip()
                if not name:
                    errors.append({"row": i, "name": "", "reason": "name is required"})
                    continue
                lvl = levels.get(raw_level.lower())
                if lvl is None:
                    errors.append({"row": i, "name": name, "reason": f"unknown level '{raw_level}'"})
                    continue
                if lvl == 0:
                    errors.append({"row": i, "name": name, "reason": "cannot import the top (Company) level"})
                    continue
                if lvl > max_level:
                    errors.append({"row": i, "name": name, "reason": "cannot import below the lowest level"})
                    continue
                matches = index.get((raw_parent.lower(), lvl - 1), [])
                if len(matches) == 0:
                    errors.append({"row": i, "name": name, "reason": f"parent '{raw_parent}' not found"})
                    continue
                if len(matches) > 1:
                    errors.append({"row": i, "name": name, "reason": f"parent '{raw_parent}' is ambiguous"})
                    continue
                parent = matches[0]
                code = self._slug_code(conn, name)
                nid = conn.execute(
                    text("insert into nodes (tenant_id, parent_id, level_order, name, code) "
                         "values (cast(:tid as uuid), cast(:pid as uuid), :lvl, :name, :code) "
                         "returning id"),
                    {"tid": str(self.tenant_id), "pid": str(parent["id"]),
                     "lvl": lvl, "name": name, "code": code},
                ).scalar()
                new_path = f"{parent['path']}{nid}/"
                conn.execute(text("update nodes set path = :path where id = cast(:id as uuid)"),
                             {"path": new_path, "id": str(nid)})
                index.setdefault((name.lower(), lvl), []).append({"id": nid, "path": new_path})
                created += 1
        return {"created": created, "errors": errors}

    def update_node(self, node_id, fields: dict) -> dict | None:
        """Rename / edit a node's own attributes (not its parent, level, or code).
        Returns None if the node is out of scope/tenant."""
        if self.scope_path is None:
            return None
        allowed = {"name", "chain", "address", "lat", "lng", "tz"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        with engine.begin() as conn:
            found = conn.execute(
                text("select 1 from nodes where id = cast(:id as uuid) "
                     "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
                {"id": str(node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).first()
            if found is None:
                return None
            if sets:
                clauses = ", ".join(f"{k} = :{k}" for k in sets)
                conn.execute(
                    text(f"update nodes set {clauses} where id = cast(:id as uuid)"),
                    {**sets, "id": str(node_id)},
                )
        return self.get_node(node_id)

    def delete_node(self, node_id) -> str | None:
        """Delete an empty node. Returns "not_found" if out of scope/tenant, a
        human blocker reason if it is not empty, or None on success."""
        if self.scope_path is None:
            return "not_found"
        with engine.begin() as conn:
            found = conn.execute(
                text("select 1 from nodes where id = cast(:id as uuid) "
                     "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
                {"id": str(node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).first()
            if found is None:
                return "not_found"
            checks = [
                ("select 1 from nodes where parent_id = cast(:id as uuid) limit 1", "it has child nodes"),
                ("select 1 from assignments where node_id = cast(:id as uuid) limit 1", "users are pinned to it"),
                ("select 1 from survey_assignments where target_node_id = cast(:id as uuid) limit 1", "surveys are assigned to it"),
                ("select 1 from responses where store_node_id = cast(:id as uuid) limit 1", "it has responses"),
            ]
            for sql, reason in checks:
                if conn.execute(text(sql), {"id": str(node_id)}).first() is not None:
                    return reason
            conn.execute(text("delete from nodes where id = cast(:id as uuid)"),
                         {"id": str(node_id)})
        return None

    # ----- org levels (set the company's level structure; admin-only at router) -----

    def _non_root_node_count(self, conn) -> int:
        return conn.execute(
            text("select count(*) from nodes where tenant_id = cast(:tid as uuid) "
                 "and parent_id is not null"),
            {"tid": str(self.tenant_id)},
        ).scalar()

    def set_org_levels(self, names: list[str]) -> list[dict] | None:
        """Replace the company's org level definitions with an ordered top-to-
        bottom list. Returns the new levels, or None (re-map blocked) when the
        company already has real nodes and the NUMBER of levels would change
        (which would leave existing nodes at an undefined level)."""
        with engine.begin() as conn:
            current = conn.execute(
                text("select count(*) from org_level_definitions "
                     "where tenant_id = cast(:tid as uuid)"),
                {"tid": str(self.tenant_id)},
            ).scalar()
            if self._non_root_node_count(conn) > 0 and len(names) != current:
                return None
            conn.execute(
                text("delete from org_level_definitions where tenant_id = cast(:tid as uuid)"),
                {"tid": str(self.tenant_id)},
            )
            n = len(names)
            for i, name in enumerate(names):
                conn.execute(
                    text("insert into org_level_definitions (tenant_id, level_order, name, locked) "
                         "values (cast(:tid as uuid), :lo, :name, :locked)"),
                    {"tid": str(self.tenant_id), "lo": i, "name": name,
                     "locked": (i == 0 or i == n - 1)},
                )
        return self.list_org_levels()

    # ----- catalog (company-wide: filtered by tenant only, not by path) -----

    _SKU_COLS = "id, line, variant, upc, color, status, reference_images, created_at"

    def list_skus(self) -> list[dict]:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"select {self._SKU_COLS} from skus "
                    "where tenant_id = cast(:tid as uuid) order by line, variant"
                ),
                {"tid": str(self.tenant_id)},
            ).mappings().all()
        return [dict(r) for r in rows]

    def create_sku(self, line, variant, upc, color, status, reference_images) -> dict:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    "insert into skus (tenant_id, line, variant, upc, color, status, "
                    "reference_images) values (cast(:tid as uuid), :line, :variant, :upc, "
                    ":color, :status, cast(:imgs as jsonb)) "
                    f"returning {self._SKU_COLS}"
                ),
                {"tid": str(self.tenant_id), "line": line, "variant": variant,
                 "upc": upc, "color": color, "status": status,
                 "imgs": json.dumps(reference_images or [])},
            ).mappings().first()
        return dict(row)

    def update_sku(self, sku_id, fields: dict) -> dict | None:
        allowed = {"line", "variant", "upc", "color", "status", "reference_images"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        params = {"id": str(sku_id), "tid": str(self.tenant_id)}
        with engine.begin() as conn:
            if sets:
                clauses = []
                for key, value in sets.items():
                    if key == "reference_images":
                        clauses.append("reference_images = cast(:reference_images as jsonb)")
                        params["reference_images"] = json.dumps(value)
                    else:
                        clauses.append(f"{key} = :{key}")
                        params[key] = value
                row = conn.execute(
                    text(
                        f"update skus set {', '.join(clauses)} "
                        "where id = cast(:id as uuid) and tenant_id = cast(:tid as uuid) "
                        f"returning {self._SKU_COLS}"
                    ),
                    params,
                ).mappings().first()
            else:
                row = conn.execute(
                    text(
                        f"select {self._SKU_COLS} from skus "
                        "where id = cast(:id as uuid) and tenant_id = cast(:tid as uuid)"
                    ),
                    params,
                ).mappings().first()
        return dict(row) if row else None

    # ----- users (company team; branch-scoped visibility; pin via assignments) -----

    _USER_COLS = (
        "u.id, u.name, u.email, u.role, "
        "n.id as pinned_node_id, n.name as pinned_node_name, "
        "n.level_order as pinned_node_level_order"
    )

    def _root_path(self, conn) -> str | None:
        return conn.execute(
            text("select path from nodes where tenant_id = cast(:tid as uuid) "
                 "and level_order = 0"),
            {"tid": str(self.tenant_id)},
        ).scalar()

    def list_users(self) -> list[dict]:
        if self.scope_path is None:
            return []
        with engine.connect() as conn:
            root = self._root_path(conn)
            at_root = root is not None and self.scope_path == root
            # A pinned user is visible when their node sits at/under the caller's
            # scope. Unpinned users (no node) are visible only to a caller at the
            # company root, so an admin can find and pin a new unpinned user while
            # a branch manager does not see company-wide unpinned users.
            unpinned_clause = "or (n.id is null)" if at_root else ""
            rows = conn.execute(
                text(
                    f"select {self._USER_COLS} from users u "
                    "left join assignments a on a.user_id = u.id and a.tenant_id = u.tenant_id "
                    "left join nodes n on n.id = a.node_id "
                    "where u.tenant_id = cast(:tid as uuid) and ("
                    "  (n.path like :scope || '%') "
                    f"  {unpinned_clause} "
                    ") order by u.name"
                ),
                {"tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().all()
        return [dict(r) for r in rows]

    def get_user(self, user_id) -> dict | None:
        """A single user in the GET shape, tenant-scoped (used after writes).
        Not branch-filtered: the writes that call it already enforced scope."""
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    f"select {self._USER_COLS} from users u "
                    "left join assignments a on a.user_id = u.id and a.tenant_id = u.tenant_id "
                    "left join nodes n on n.id = a.node_id "
                    "where u.id = cast(:uid as uuid) and u.tenant_id = cast(:tid as uuid)"
                ),
                {"uid": str(user_id), "tid": str(self.tenant_id)},
            ).mappings().first()
        return dict(row) if row else None

    def create_user(self, name, email, role, password_hash, node_id=None) -> dict:
        """Create a user and (optionally) pin them. Raises ValueError('node') if
        node_id is out of the caller's scope/tenant. A duplicate email raises
        IntegrityError (the router turns it into a 409)."""
        with engine.begin() as conn:
            if node_id is not None:
                if self.scope_path is None:
                    raise ValueError("node")
                ok = conn.execute(
                    text("select 1 from nodes where id = cast(:nid as uuid) "
                         "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
                    {"nid": str(node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
                ).first()
                if ok is None:
                    raise ValueError("node")
            uid = conn.execute(
                text("insert into users (tenant_id, name, email, role, password_hash) "
                     "values (cast(:tid as uuid), :name, :email, :role, :ph) returning id"),
                {"tid": str(self.tenant_id), "name": name, "email": email,
                 "role": role, "ph": password_hash},
            ).scalar()
            if node_id is not None:
                conn.execute(
                    text("insert into assignments (tenant_id, user_id, node_id) "
                         "values (cast(:tid as uuid), cast(:uid as uuid), cast(:nid as uuid))"),
                    {"tid": str(self.tenant_id), "uid": str(uid), "nid": str(node_id)},
                )
        return self.get_user(uid)

    def update_user(self, user_id, fields: dict) -> dict | None:
        """Change a user's role and/or pin. fields may hold 'role' and/or
        'node_id' (node_id None means unpin). Returns None if the user is not in
        the caller's tenant. Raises LastAdminError / ValueError('node')."""
        with engine.begin() as conn:
            target = conn.execute(
                text("select id, role from users where id = cast(:uid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"uid": str(user_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if target is None:
                return None
            if "role" in fields and fields["role"] != target["role"]:
                if target["role"] == "admin" and fields["role"] != "admin":
                    admins = conn.execute(
                        text("select count(*) from users where tenant_id = cast(:tid as uuid) "
                             "and role = 'admin'"),
                        {"tid": str(self.tenant_id)},
                    ).scalar()
                    if admins <= 1:
                        raise LastAdminError()
                conn.execute(
                    text("update users set role = :role where id = cast(:uid as uuid)"),
                    {"role": fields["role"], "uid": str(user_id)},
                )
            if "node_id" in fields:
                nid = fields["node_id"]
                if nid is None:
                    conn.execute(
                        text("delete from assignments where user_id = cast(:uid as uuid) "
                             "and tenant_id = cast(:tid as uuid)"),
                        {"uid": str(user_id), "tid": str(self.tenant_id)},
                    )
                else:
                    if self.scope_path is None:
                        raise ValueError("node")
                    ok = conn.execute(
                        text("select 1 from nodes where id = cast(:nid as uuid) "
                             "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
                        {"nid": str(nid), "tid": str(self.tenant_id), "scope": self.scope_path},
                    ).first()
                    if ok is None:
                        raise ValueError("node")
                    conn.execute(
                        text("insert into assignments (tenant_id, user_id, node_id) "
                             "values (cast(:tid as uuid), cast(:uid as uuid), cast(:nid as uuid)) "
                             "on conflict (tenant_id, user_id) do update set node_id = excluded.node_id"),
                        {"tid": str(self.tenant_id), "uid": str(user_id), "nid": str(nid)},
                    )
        return self.get_user(user_id)

    # ----- tenant config (this company only; tenant-scoped, not branch-scoped) -----

    _TENANT_COLS = "id, name, code, payroll_enabled"

    def get_tenant(self) -> dict | None:
        with engine.connect() as conn:
            row = conn.execute(
                text(f"select {self._TENANT_COLS} from tenants where id = cast(:tid as uuid)"),
                {"tid": str(self.tenant_id)},
            ).mappings().first()
        return dict(row) if row else None

    def update_tenant(self, fields: dict) -> dict | None:
        """Update this company's config. Only name and payroll_enabled are
        writable; any other key is ignored. Always scoped to self.tenant_id."""
        allowed = {"name", "payroll_enabled"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        if not sets:
            return self.get_tenant()
        clauses = ", ".join(f"{k} = :{k}" for k in sets)
        params = {**sets, "tid": str(self.tenant_id)}
        with engine.begin() as conn:
            row = conn.execute(
                text(f"update tenants set {clauses} where id = cast(:tid as uuid) "
                     f"returning {self._TENANT_COLS}"),
                params,
            ).mappings().first()
        return dict(row) if row else None

    # ----- surveys (company-wide: filtered by tenant only) -----

    _SURVEY_COLS = "id, name, type, status, created_at"
    _VERSION_COLS = "id, survey_id, version_number, questions, published_at, created_at"

    def _check_sku_ids(self, conn, questions: list[dict]) -> None:
        """Raise ValueError if any question references a SKU id that is not one
        of this company's products."""
        wanted = {sid for q in questions for sid in (q.get("sku_ids") or [])}
        if not wanted:
            return
        found = conn.execute(
            text(
                "select id from skus where tenant_id = cast(:tid as uuid) "
                "and id = any(cast(:ids as uuid[]))"
            ),
            {"tid": str(self.tenant_id), "ids": [str(s) for s in wanted]},
        ).scalars().all()
        missing = {str(s) for s in wanted} - {str(f) for f in found}
        if missing:
            raise ValueError(f"unknown sku_ids for this company: {sorted(missing)}")

    def list_surveys(self) -> list[dict]:
        # `assigned` is scope-aware: an assignment targeting a node within the
        # caller's subtree. Unpinned caller -> no scope -> nothing assigned.
        if self.scope_path is None:
            assigned_join = "left join (select null::uuid as survey_id where false) a on false"
        else:
            assigned_join = (
                "left join (select distinct sv.survey_id from survey_assignments sa "
                "join survey_versions sv on sv.id = sa.survey_version_id "
                "join nodes n on n.id = sa.target_node_id "
                "where sa.tenant_id = cast(:tid as uuid) and n.path like :scope || '%') "
                "a on a.survey_id = s.id"
            )
        params = {"tid": str(self.tenant_id)}
        if self.scope_path is not None:
            params["scope"] = self.scope_path
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"select {', '.join('s.' + c.strip() for c in self._SURVEY_COLS.split(','))}, "
                    "coalesce(v.latest_version, 1) as latest_version, "
                    "(a.survey_id is not null) as assigned "
                    "from surveys s "
                    "left join (select survey_id, max(version_number) as latest_version "
                    "from survey_versions group by survey_id) v on v.survey_id = s.id "
                    f"{assigned_join} "
                    "where s.tenant_id = cast(:tid as uuid) order by s.name"
                ),
                params,
            ).mappings().all()
        return [dict(r) for r in rows]

    def get_survey(self, survey_id) -> dict | None:
        with engine.connect() as conn:
            survey = conn.execute(
                text(
                    f"select {self._SURVEY_COLS} from surveys "
                    "where id = cast(:id as uuid) and tenant_id = cast(:tid as uuid)"
                ),
                {"id": str(survey_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if survey is None:
                return None
            versions = conn.execute(
                text(
                    f"select {self._VERSION_COLS} from survey_versions "
                    "where survey_id = cast(:id as uuid) order by version_number"
                ),
                {"id": str(survey_id)},
            ).mappings().all()
        result = dict(survey)
        result["versions"] = [dict(v) for v in versions]
        return result

    def create_survey(self, name, type_, questions: list[dict]) -> dict:
        with engine.begin() as conn:
            self._check_sku_ids(conn, questions)
            survey = conn.execute(
                text(
                    "insert into surveys (tenant_id, name, type) "
                    "values (cast(:tid as uuid), :name, :type) "
                    f"returning {self._SURVEY_COLS}"
                ),
                {"tid": str(self.tenant_id), "name": name, "type": type_},
            ).mappings().first()
            version = conn.execute(
                text(
                    "insert into survey_versions (survey_id, version_number, questions) "
                    "values (cast(:sid as uuid), 1, cast(:q as jsonb)) "
                    f"returning {self._VERSION_COLS}"
                ),
                {"sid": str(survey["id"]), "q": json.dumps(questions)},
            ).mappings().first()
        result = dict(survey)
        result["versions"] = [dict(version)]
        return result

    def update_version(self, survey_id, version_id, questions: list[dict]) -> dict | None:
        with engine.begin() as conn:
            ver = conn.execute(
                text(
                    "select v.published_at from survey_versions v "
                    "join surveys s on s.id = v.survey_id "
                    "where v.id = cast(:vid as uuid) and v.survey_id = cast(:sid as uuid) "
                    "and s.tenant_id = cast(:tid as uuid)"
                ),
                {"vid": str(version_id), "sid": str(survey_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if ver is None:
                return None
            if ver["published_at"] is not None:
                raise PublishedVersionError()
            self._check_sku_ids(conn, questions)
            row = conn.execute(
                text(
                    "update survey_versions set questions = cast(:q as jsonb) "
                    "where id = cast(:vid as uuid) "
                    f"returning {self._VERSION_COLS}"
                ),
                {"q": json.dumps(questions), "vid": str(version_id)},
            ).mappings().first()
        return dict(row)

    def publish_version(self, survey_id) -> dict | None:
        with engine.begin() as conn:
            survey = conn.execute(
                text(
                    "select id from surveys where id = cast(:id as uuid) "
                    "and tenant_id = cast(:tid as uuid)"
                ),
                {"id": str(survey_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if survey is None:
                return None
            draft = conn.execute(
                text(
                    "select id from survey_versions where survey_id = cast(:id as uuid) "
                    "and published_at is null order by version_number desc limit 1"
                ),
                {"id": str(survey_id)},
            ).mappings().first()
            if draft is None:
                raise NoDraftError()
            conn.execute(
                text("update survey_versions set published_at = now() where id = cast(:vid as uuid)"),
                {"vid": str(draft["id"])},
            )
            conn.execute(
                text(
                    "update surveys set status = 'published' "
                    "where id = cast(:id as uuid) and status = 'draft'"
                ),
                {"id": str(survey_id)},
            )
        return self.get_survey(survey_id)

    def new_version(self, survey_id) -> dict | None:
        with engine.begin() as conn:
            survey = conn.execute(
                text(
                    "select id from surveys where id = cast(:id as uuid) "
                    "and tenant_id = cast(:tid as uuid)"
                ),
                {"id": str(survey_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if survey is None:
                return None
            latest = conn.execute(
                text(
                    "select version_number, questions, published_at from survey_versions "
                    "where survey_id = cast(:id as uuid) order by version_number desc limit 1"
                ),
                {"id": str(survey_id)},
            ).mappings().first()
            if latest["published_at"] is None:
                raise DraftExistsError()
            row = conn.execute(
                text(
                    "insert into survey_versions (survey_id, version_number, questions) "
                    "values (cast(:id as uuid), :vn, cast(:q as jsonb)) "
                    f"returning {self._VERSION_COLS}"
                ),
                {"id": str(survey_id), "vn": latest["version_number"] + 1,
                 "q": json.dumps(latest["questions"])},
            ).mappings().first()
        return dict(row)

    def archive_survey(self, survey_id) -> dict | None:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    "update surveys set status = 'archived' "
                    "where id = cast(:id as uuid) and tenant_id = cast(:tid as uuid) "
                    f"returning {self._SURVEY_COLS}"
                ),
                {"id": str(survey_id), "tid": str(self.tenant_id)},
            ).mappings().first()
        return dict(row) if row else None

    # ----- survey assignments (branch-scoped, like nodes) -----

    _ASSIGNMENT_COLS = ("id, survey_version_id, target_node_id, deadline, "
                        "timezone_basis, created_by, created_at")

    def create_assignment(self, survey_version_id, target_node_id, deadline,
                          timezone_basis, created_by) -> dict | None:
        if self.scope_path is None:
            return None
        with engine.begin() as conn:
            version = conn.execute(
                text(
                    "select v.id from survey_versions v join surveys s on s.id = v.survey_id "
                    "where v.id = cast(:vid as uuid) and s.tenant_id = cast(:tid as uuid) "
                    "and v.published_at is not null"
                ),
                {"vid": str(survey_version_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if version is None:
                raise VersionNotPublishedError()
            node = conn.execute(
                text(
                    "select id from nodes where id = cast(:nid as uuid) "
                    "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"
                ),
                {"nid": str(target_node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            if node is None:
                return None
            row = conn.execute(
                text(
                    "insert into survey_assignments (tenant_id, survey_version_id, target_node_id, "
                    "deadline, timezone_basis, created_by) values (cast(:tid as uuid), "
                    "cast(:vid as uuid), cast(:nid as uuid), :deadline, :tzb, cast(:cb as uuid)) "
                    f"returning {self._ASSIGNMENT_COLS}"
                ),
                {"tid": str(self.tenant_id), "vid": str(survey_version_id),
                 "nid": str(target_node_id), "deadline": deadline,
                 "tzb": timezone_basis, "cb": str(created_by)},
            ).mappings().first()
        return dict(row)

    def list_assignments(self) -> list[dict]:
        if self.scope_path is None:
            return []
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "select a.id, a.survey_version_id, a.target_node_id, a.deadline, "
                    "a.timezone_basis, a.created_by, a.created_at from survey_assignments a "
                    "join nodes n on n.id = a.target_node_id "
                    "where a.tenant_id = cast(:tid as uuid) and n.path like :scope || '%' "
                    "order by a.created_at"
                ),
                {"tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().all()
        return [dict(r) for r in rows]

    def assignment_stores(self, assignment_id) -> list[dict] | None:
        if self.scope_path is None:
            return None
        with engine.connect() as conn:
            target = conn.execute(
                text(
                    "select n.path from survey_assignments a join nodes n on n.id = a.target_node_id "
                    "where a.id = cast(:aid as uuid) and a.tenant_id = cast(:tid as uuid) "
                    "and n.path like :scope || '%'"
                ),
                {"aid": str(assignment_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            if target is None:
                return None
            rows = conn.execute(
                text(
                    "select id, name, code, level_order, path, chain, address, lat, lng, tz "
                    "from nodes where tenant_id = cast(:tid as uuid) and path like :tpath || '%' "
                    "and level_order = (select max(level_order) from org_level_definitions "
                    "where tenant_id = cast(:tid as uuid)) order by path"
                ),
                {"tid": str(self.tenant_id), "tpath": target["path"]},
            ).mappings().all()
        return [dict(r) for r in rows]

    def delete_assignment(self, assignment_id) -> bool:
        if self.scope_path is None:
            return False
        with engine.begin() as conn:
            found = conn.execute(
                text(
                    "select a.id from survey_assignments a join nodes n on n.id = a.target_node_id "
                    "where a.id = cast(:aid as uuid) and a.tenant_id = cast(:tid as uuid) "
                    "and n.path like :scope || '%'"
                ),
                {"aid": str(assignment_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).first()
            if found is None:
                return False
            conn.execute(
                text("delete from survey_assignments where id = cast(:aid as uuid)"),
                {"aid": str(assignment_id)},
            )
        return True

    # ----- responses (branch-scoped, like assignments; atomic per-SKU rows) -----

    _RESPONSE_COLS = ("id, survey_version_id, store_node_id, store_path, user_id, "
                      "online, submitted_at, created_at")

    # Same columns r.-qualified, because the list/get queries join nodes (which
    # also has an `id` column) for the path filter.
    _RESPONSE_COLS_R = (
        "r.id, r.survey_version_id, r.store_node_id, r.store_path, "
        "r.user_id, r.online, r.submitted_at, r.created_at, "
        "n.name as store_name, "
        "s.name as survey_name, "
        "sv.survey_id as survey_id, "
        "sv.version_number as survey_version_number, "
        "u.name as rep_name"
    )

    def create_response(self, survey_version_id, store_node_id, answers, user_id,
                        idempotency_key=None) -> dict | None:
        """Store one completed response. Returns None if the store is not a store
        in the caller's scope. Raises VersionNotPublishedError if the version is
        missing/unpublished, ValueError if an answer does not fit the version."""
        if self.scope_path is None:
            return None
        with engine.begin() as conn:
            # Idempotency: a re-sent submission carrying a ticket we have already
            # seen returns the original (re-scored), never a duplicate. Tenant-only
            # lookup (no path filter); get_response re-applies the caller's scope.
            if idempotency_key is not None:
                existing = conn.execute(
                    text("select id from responses where tenant_id = cast(:tid as uuid) "
                         "and idempotency_key = cast(:idem as uuid)"),
                    {"tid": str(self.tenant_id), "idem": str(idempotency_key)},
                ).mappings().first()
                if existing is not None:
                    return self.get_response(existing["id"])
            version = conn.execute(
                text(
                    "select v.id, v.questions from survey_versions v "
                    "join surveys s on s.id = v.survey_id "
                    "where v.id = cast(:vid as uuid) and s.tenant_id = cast(:tid as uuid) "
                    "and v.published_at is not null"
                ),
                {"vid": str(survey_version_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if version is None:
                raise VersionNotPublishedError()
            store = conn.execute(
                text(
                    "select id, path from nodes where id = cast(:nid as uuid) "
                    "and tenant_id = cast(:tid as uuid) and path like :scope || '%' "
                    "and level_order = (select max(level_order) from org_level_definitions "
                    "where tenant_id = cast(:tid as uuid))"
                ),
                {"nid": str(store_node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            if store is None:
                return None
            rows = self._explode_answers(version["questions"], answers)
            resp = conn.execute(
                text(
                    "insert into responses (tenant_id, survey_version_id, store_node_id, "
                    "store_path, user_id, idempotency_key) values (cast(:tid as uuid), "
                    "cast(:vid as uuid), cast(:nid as uuid), :spath, cast(:uid as uuid), "
                    "cast(:idem as uuid)) "
                    f"returning {self._RESPONSE_COLS}"
                ),
                {"tid": str(self.tenant_id), "vid": str(survey_version_id),
                 "nid": str(store_node_id), "spath": store["path"], "uid": str(user_id),
                 "idem": str(idempotency_key) if idempotency_key is not None else None},
            ).mappings().first()
            for r in rows:
                conn.execute(
                    text(
                        "insert into response_items (response_id, tenant_id, store_node_id, "
                        "store_path, survey_version_id, submitted_at, question_id, sku_id, value) "
                        "values (cast(:rid as uuid), cast(:tid as uuid), cast(:nid as uuid), "
                        ":spath, cast(:vid as uuid), :sub, :qid, cast(:sku as uuid), cast(:val as jsonb))"
                    ),
                    {"rid": str(resp["id"]), "tid": str(self.tenant_id),
                     "nid": str(store_node_id), "spath": store["path"],
                     "vid": str(survey_version_id), "sub": resp["submitted_at"],
                     "qid": r["question_id"],
                     "sku": str(r["sku_id"]) if r["sku_id"] else None,
                     "val": json.dumps(r["value"])},
                )
        # Re-read through get_response (a fresh connection, after this write has
        # committed) so the caller gets the same scored shape as a GET, without
        # duplicating the scoring logic. Not a double write: this only reads.
        return self.get_response(resp["id"])

    def _explode_answers(self, questions: list[dict], answers: list[dict]) -> list[dict]:
        """Strict shape, skips allowed. Returns atomic rows (blanks dropped).
        Raises ValueError on anything that does not fit the version."""
        q_index = {q["id"]: q for q in questions}
        seen = set()
        rows = []
        for a in answers:
            qid = a["question_id"]
            q = q_index.get(qid)
            if q is None:
                raise ValueError(f"unknown question: {qid}")
            # sku_id arrives as a JSON string here (Pydantic UUID -> model_dump(mode="json")).
            sku_id = a.get("sku_id")
            if q.get("perSku", False):
                if sku_id is None:
                    raise ValueError(f"question {qid} is per-product; sku_id required")
                allowed = {str(s) for s in (q.get("sku_ids") or [])}
                if str(sku_id) not in allowed:
                    raise ValueError(f"sku {sku_id} is not covered by question {qid}")
            elif sku_id is not None:
                raise ValueError(f"question {qid} is not per-product; sku_id not allowed")
            key = (qid, str(sku_id) if sku_id else None)
            if key in seen:
                raise ValueError(f"duplicate answer for question {qid}")
            seen.add(key)
            value = a.get("value")
            if value is None:
                continue  # blank: allowed, simply not stored
            _check_value(value, q)
            rows.append({"question_id": qid, "sku_id": sku_id, "value": value})
        return rows

    def _score(self, conn, response_row) -> dict:
        """Load a response's items + its version questions and compute verdicts."""
        version = conn.execute(
            text("select questions from survey_versions where id = cast(:vid as uuid)"),
            {"vid": str(response_row["survey_version_id"])},
        ).mappings().first()
        items = conn.execute(
            text(
                "select question_id, sku_id, value from response_items "
                "where response_id = cast(:rid as uuid) order by question_id, sku_id"
            ),
            {"rid": str(response_row["id"])},
        ).mappings().all()
        return evaluate_response(version["questions"], [dict(i) for i in items])

    def list_responses(self) -> list[dict]:
        # Note: scores each response with _score (2 queries per row, N+1).
        # Fine for Phase 4a store counts; Phase 4b should replace per-row
        # scoring with an indexed roll-up before paging large result sets.
        if self.scope_path is None:
            return []
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"select {self._RESPONSE_COLS_R} from responses r "
                    "join nodes n on n.id = r.store_node_id "
                    "join survey_versions sv on sv.id = r.survey_version_id "
                    "join surveys s on s.id = sv.survey_id "
                    "join users u on u.id = r.user_id "
                    "where r.tenant_id = cast(:tid as uuid) and n.path like :scope || '%' "
                    "order by r.submitted_at desc"
                ),
                {"tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().all()
            result = []
            for r in rows:
                scored_result = self._score(conn, r)
                verdicts = list(scored_result.get("questions", {}).values())
                scored_count = sum(1 for v in verdicts if v is not None)
                passed_count = sum(1 for v in verdicts if v is True)
                result.append({
                    **dict(r),
                    "overall": scored_result["overall"],
                    "scored": scored_count,
                    "passed": passed_count,
                })
        return result

    def get_response(self, response_id) -> dict | None:
        if self.scope_path is None:
            return None
        with engine.connect() as conn:
            r = conn.execute(
                text(
                    f"select {self._RESPONSE_COLS_R} from responses r "
                    "join nodes n on n.id = r.store_node_id "
                    "join survey_versions sv on sv.id = r.survey_version_id "
                    "join surveys s on s.id = sv.survey_id "
                    "join users u on u.id = r.user_id "
                    "where r.id = cast(:rid as uuid) and r.tenant_id = cast(:tid as uuid) "
                    "and n.path like :scope || '%'"
                ),
                {"rid": str(response_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            if r is None:
                return None
            scored = self._score(conn, r)
        result = dict(r)
        result["items"] = scored["items"]
        result["questions"] = scored["questions"]
        result["overall"] = scored["overall"]
        return result

    # ----- analytics (read-only; branch-scoped like responses) -----

    def _max_level(self, conn) -> int:
        return conn.execute(
            text("select max(level_order) from org_level_definitions "
                 "where tenant_id = cast(:tid as uuid)"),
            {"tid": str(self.tenant_id)},
        ).scalar()

    def _base_path_in_scope(self, conn, node_id):
        """The path to analyze over: the given node's path (if it is in the
        caller's scope) or the caller's whole scope when node_id is None. Returns
        None if node_id is given but out of scope (-> 404)."""
        if node_id is None:
            return self.scope_path
        row = conn.execute(
            text("select path from nodes where id = cast(:nid as uuid) "
                 "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
            {"nid": str(node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
        ).mappings().first()
        return row["path"] if row else None

    def _store_ids_under(self, conn, path, maxlvl) -> list:
        return list(conn.execute(
            text("select id from nodes where tenant_id = cast(:tid as uuid) "
                 "and level_order = :ml and path like :p || '%'"),
            {"tid": str(self.tenant_id), "ml": maxlvl, "p": path},
        ).scalars().all())

    def _overall_for(self, conn, version_id, response_ids) -> dict:
        """{response_id: overall verdict} for the given responses, scored against
        the version's questions. Two queries + in-memory evaluation."""
        if not response_ids:
            return {}
        questions = conn.execute(
            text("select questions from survey_versions where id = cast(:vid as uuid)"),
            {"vid": str(version_id)},
        ).mappings().first()["questions"]
        rows = conn.execute(
            text("select response_id, question_id, sku_id, value from response_items "
                 "where response_id = any(cast(:ids as uuid[]))"),
            {"ids": [str(r) for r in response_ids]},
        ).mappings().all()
        by_resp: dict = {}
        for r in rows:
            by_resp.setdefault(r["response_id"], []).append(dict(r))
        return {rid: evaluate_response(questions, by_resp.get(rid, []))["overall"]
                for rid in response_ids}

    def _metrics_for_stores(self, conn, version_id, store_ids):
        """(expected, responded, scored, passed) for a version over a set of
        store node ids, using each store's latest response."""
        expected = len(store_ids)
        if not store_ids:
            return 0, 0, 0, 0
        latest = conn.execute(
            text("select distinct on (store_node_id) id, store_node_id from responses "
                 "where survey_version_id = cast(:vid as uuid) "
                 "and tenant_id = cast(:tid as uuid) "
                 "and store_node_id = any(cast(:sids as uuid[])) "
                 "order by store_node_id, submitted_at desc"),
            {"vid": str(version_id), "tid": str(self.tenant_id),
             "sids": [str(s) for s in store_ids]},
        ).mappings().all()
        responded = len(latest)
        overalls = self._overall_for(conn, version_id, [r["id"] for r in latest])
        scored = sum(1 for v in overalls.values() if v is not None)
        passed = sum(1 for v in overalls.values() if v is True)
        return expected, responded, scored, passed

    @staticmethod
    def _pct(numerator, denominator):
        return round(100 * numerator / denominator, 1) if denominator else None

    def assignment_compliance(self, node_id=None):
        """Per assignment whose coverage overlaps node_id (default: whole branch),
        completion % + pass % measured over (coverage ∩ node subtree ∩ scope).
        Returns None if node_id is given but out of scope (-> 404)."""
        if self.scope_path is None:
            return []
        with engine.connect() as conn:
            base = self._base_path_in_scope(conn, node_id)
            if base is None:
                return None
            maxlvl = self._max_level(conn)
            assigns = conn.execute(
                text("select a.id as assignment_id, a.survey_version_id, n.path as target_path, "
                     "n.id as target_node_id, n.name as target_node_name, "
                     "s.id as survey_id, s.name as survey_name "
                     "from survey_assignments a join nodes n on n.id = a.target_node_id "
                     "join survey_versions v on v.id = a.survey_version_id "
                     "join surveys s on s.id = v.survey_id "
                     "where a.tenant_id = cast(:tid as uuid) "
                     "and (:base like n.path || '%' or n.path like :base || '%')"),
                {"tid": str(self.tenant_id), "base": base},
            ).mappings().all()
            out = []
            # N+1: each assignment runs _store_ids_under + _metrics_for_stores
            # (2 queries). Fine for the handful of assignments per branch; revisit
            # with a roll-up if assignment counts ever grow large.
            for a in assigns:
                # The WHERE filter guarantees the two paths overlap, so one is a
                # prefix of the other; their intersection is the deeper subtree.
                # Path length is a valid proxy for depth (each level appends
                # "/<uuid>/"), so the longer path is the deeper, narrower one.
                measured = a["target_path"] if len(a["target_path"]) >= len(base) else base
                store_ids = self._store_ids_under(conn, measured, maxlvl)
                expected, responded, scored, passed = self._metrics_for_stores(
                    conn, a["survey_version_id"], store_ids)
                out.append({
                    "assignment_id": a["assignment_id"],
                    "survey_id": a["survey_id"], "survey_name": a["survey_name"],
                    "survey_version_id": a["survey_version_id"],
                    "target_node_id": a["target_node_id"],
                    "target_node_name": a["target_node_name"],
                    "expected": expected, "responded": responded,
                    "scored": scored, "passed": passed,
                    "completion_pct": self._pct(responded, expected),
                    "pass_pct": self._pct(passed, scored),
                })
        return out

    @staticmethod
    def _zero_dashboard():
        return {
            "footprint": {"nodes": 0, "stores": 0, "reps": 0},
            "current": {"completion_pct": None, "pass_pct": None, "expected": 0,
                        "responded": 0, "scored": 0, "passed": 0,
                        "surveys_completed": 0, "overdue": 0},
            "previous": None,
            "trend": [],
        }

    def dashboard(self, node_id=None, date_from=None, date_to=None):
        """Headline figures for the Admin dashboard, branch-scoped. Returns None
        only if node_id is given but out of scope (-> 404); an unpinned caller
        (scope_path None) returns the zero payload (200)."""
        if self.scope_path is None:
            return self._zero_dashboard()
        with engine.connect() as conn:
            base = self._base_path_in_scope(conn, node_id)
            if base is None:
                return None  # node_id out of scope -> 404
            maxlvl = self._max_level(conn)
            footprint = {
                "nodes": conn.execute(
                    text("select count(*) from nodes where tenant_id = cast(:tid as uuid) "
                         "and path like :base || '%'"),
                    {"tid": str(self.tenant_id), "base": base}).scalar(),
                "stores": conn.execute(
                    text("select count(*) from nodes where tenant_id = cast(:tid as uuid) "
                         "and level_order = :ml and path like :base || '%'"),
                    {"tid": str(self.tenant_id), "ml": maxlvl, "base": base}).scalar(),
                "reps": conn.execute(
                    text("select count(*) from users u "
                         "join assignments a on a.user_id = u.id and a.tenant_id = cast(:tid as uuid) "
                         "join nodes n on n.id = a.node_id "
                         "where u.tenant_id = cast(:tid as uuid) and u.role = 'rep' "
                         "and n.path like :base || '%'"),
                    {"tid": str(self.tenant_id), "base": base}).scalar(),
            }
            current = self._dashboard_window(conn, base, maxlvl, date_from, date_to)
            current["surveys_completed"] = self._surveys_completed(conn, base, maxlvl, date_from, date_to)
            current["overdue"] = self._overdue(conn, base, maxlvl)
            previous = None
            if date_from is not None and date_to is not None:
                window = date_to - date_from
                prev_from, prev_to = date_from - window, date_from
                previous = self._dashboard_window(conn, base, maxlvl, prev_from, prev_to)
                previous["surveys_completed"] = self._surveys_completed(conn, base, maxlvl, prev_from, prev_to)
                previous["overdue"] = 0  # overdue is as-of-now only (see Task 4); not windowed
            trend = self._trend(conn, base, maxlvl, date_from, date_to)
        return {"footprint": footprint, "current": current, "previous": previous, "trend": trend}

    def _covered_store_ids(self, conn, base, maxlvl):
        assigns = conn.execute(
            text("select n.path as target_path from survey_assignments a "
                 "join nodes n on n.id = a.target_node_id "
                 "where a.tenant_id = cast(:tid as uuid) "
                 "and (:base like n.path || '%' or n.path like :base || '%')"),
            {"tid": str(self.tenant_id), "base": base},
        ).mappings().all()
        ids = set()
        for a in assigns:
            measured = a["target_path"] if len(a["target_path"]) >= len(base) else base
            for sid in self._store_ids_under(conn, measured, maxlvl):
                ids.add(str(sid))
        return ids

    def _trend(self, conn, base, maxlvl, date_from, date_to):
        if date_from is None or date_to is None:
            return []
        store_ids = self._covered_store_ids(conn, base, maxlvl)
        expected = len(store_ids)
        rows = []
        # ISO weeks: bucket start = Monday 00:00 UTC. date_trunc('week', ...) in
        # Postgres is Monday-based. Group distinct responders per week.
        if expected and store_ids:
            counts = {r["wk"].date().isoformat(): r["n"] for r in conn.execute(
                text("select date_trunc('week', submitted_at at time zone 'UTC') as wk, "
                     "count(distinct store_node_id) as n from responses "
                     "where tenant_id = cast(:tid as uuid) "
                     "and store_node_id = any(cast(:sids as uuid[])) "
                     "and submitted_at >= cast(:df as timestamptz) "
                     "and submitted_at <= cast(:dt as timestamptz) "
                     "group by wk"),
                {"tid": str(self.tenant_id), "sids": list(store_ids),
                 "df": date_from.isoformat(), "dt": date_to.isoformat()},
            ).mappings().all()}
        else:
            counts = {}
        # walk Monday-aligned weeks across the range. Normalize to UTC first so
        # the Python week key lines up with Postgres date_trunc('week', ... at
        # time zone 'UTC') even if the caller sends a non-UTC offset.
        import datetime as _dt
        df_utc = date_from.astimezone(timezone.utc) if date_from.tzinfo else date_from
        dt_utc = date_to.astimezone(timezone.utc) if date_to.tzinfo else date_to
        start = (df_utc - _dt.timedelta(days=df_utc.weekday())).date()
        end = dt_utc.date()
        wk = start
        while wk <= end:
            key = wk.isoformat()
            responded = counts.get(key, 0)
            rows.append({"week_start": key, "responded": responded,
                         "expected": expected, "completion_pct": self._pct(responded, expected)})
            wk = wk + _dt.timedelta(days=7)
        return rows

    def _overdue(self, conn, base, maxlvl):
        """As-of-now overdue: covered stores under a past-deadline assignment that
        have no response for that version. NULL deadline = never overdue."""
        assigns = conn.execute(
            text("select a.survey_version_id, n.path as target_path "
                 "from survey_assignments a join nodes n on n.id = a.target_node_id "
                 "where a.tenant_id = cast(:tid as uuid) "
                 "and a.deadline is not null and a.deadline < now() "
                 "and (:base like n.path || '%' or n.path like :base || '%')"),
            {"tid": str(self.tenant_id), "base": base},
        ).mappings().all()
        overdue = 0
        for a in assigns:
            measured = a["target_path"] if len(a["target_path"]) >= len(base) else base
            store_ids = self._store_ids_under(conn, measured, maxlvl)
            if not store_ids:
                continue
            responded = conn.execute(
                text("select count(distinct store_node_id) from responses "
                     "where survey_version_id = cast(:vid as uuid) "
                     "and tenant_id = cast(:tid as uuid) "
                     "and store_node_id = any(cast(:sids as uuid[]))"),
                {"vid": str(a["survey_version_id"]), "tid": str(self.tenant_id),
                 "sids": [str(s) for s in store_ids]},
            ).scalar()
            overdue += len(store_ids) - responded
        return overdue

    def _surveys_completed(self, conn, base, maxlvl, date_from, date_to):
        clauses = ["r.tenant_id = cast(:tid as uuid)", "n.path like :base || '%'",
                   "n.level_order = :ml"]
        params = {"tid": str(self.tenant_id), "base": base, "ml": maxlvl}
        if date_from is not None:
            clauses.append("r.submitted_at >= cast(:df as timestamptz)"); params["df"] = date_from.isoformat()
        if date_to is not None:
            clauses.append("r.submitted_at <= cast(:dt as timestamptz)"); params["dt"] = date_to.isoformat()
        return conn.execute(
            text("select count(*) from responses r join nodes n on n.id = r.store_node_id "
                 "where " + " and ".join(clauses)), params).scalar()

    def _dashboard_window(self, conn, base, maxlvl, date_from, date_to):
        assigns = conn.execute(
            text("select a.survey_version_id, n.path as target_path "
                 "from survey_assignments a join nodes n on n.id = a.target_node_id "
                 "where a.tenant_id = cast(:tid as uuid) "
                 "and (:base like n.path || '%' or n.path like :base || '%')"),
            {"tid": str(self.tenant_id), "base": base},
        ).mappings().all()
        # distinct (store_id, version_id) obligations
        pairs = set()
        for a in assigns:
            measured = a["target_path"] if len(a["target_path"]) >= len(base) else base
            for sid in self._store_ids_under(conn, measured, maxlvl):
                pairs.add((str(sid), str(a["survey_version_id"])))
        expected = len(pairs)
        if expected == 0:
            return {"completion_pct": None, "pass_pct": None, "expected": 0,
                    "responded": 0, "scored": 0, "passed": 0}
        # group obligations by version; per version find each store's latest
        # in-window response, then score in bulk.
        by_version = {}
        for sid, vid in pairs:
            by_version.setdefault(vid, set()).add(sid)
        df = date_from.isoformat() if date_from is not None else None
        dt = date_to.isoformat() if date_to is not None else None
        df_clause = "and submitted_at >= cast(:df as timestamptz) " if df else ""
        dt_clause = "and submitted_at <= cast(:dt as timestamptz) " if dt else ""
        responded = scored = passed = 0
        for vid, store_ids in by_version.items():
            latest = conn.execute(
                text("select distinct on (store_node_id) id, store_node_id from responses "
                     "where survey_version_id = cast(:vid as uuid) "
                     "and tenant_id = cast(:tid as uuid) "
                     "and store_node_id = any(cast(:sids as uuid[])) "
                     + df_clause + dt_clause +
                     "order by store_node_id, submitted_at desc"),
                {"vid": vid, "tid": str(self.tenant_id), "sids": list(store_ids),
                 "df": df, "dt": dt},
            ).mappings().all()
            responded += len(latest)
            overalls = self._overall_for(conn, vid, [r["id"] for r in latest])
            scored += sum(1 for v in overalls.values() if v is not None)
            passed += sum(1 for v in overalls.values() if v is True)
        return {"completion_pct": self._pct(responded, expected),
                "pass_pct": self._pct(passed, scored), "expected": expected,
                "responded": responded, "scored": scored, "passed": passed}

    def _version_questions(self, conn, version_id):
        """The version's questions if it belongs to the caller's company, else
        None (-> 404)."""
        row = conn.execute(
            text("select v.questions from survey_versions v "
                 "join surveys s on s.id = v.survey_id "
                 "where v.id = cast(:vid as uuid) and s.tenant_id = cast(:tid as uuid)"),
            {"vid": str(version_id), "tid": str(self.tenant_id)},
        ).mappings().first()
        return row["questions"] if row else None

    def _score_one(self, conn, questions, response_id) -> dict:
        """Score one response's items against the already-fetched version
        questions. Takes questions directly so the caller (which already loaded
        them via _version_questions) need not query survey_versions twice."""
        items = conn.execute(
            text("select question_id, sku_id, value from response_items "
                 "where response_id = cast(:rid as uuid) order by question_id, sku_id"),
            {"rid": str(response_id)},
        ).mappings().all()
        return evaluate_response(questions, [dict(i) for i in items])

    def compliance_drill(self, node_id, survey_version_id):
        """Children rollup for a non-store node, or the per-product why-it-failed
        at a store. None if the node is out of scope or the version is not the
        caller's company (-> 404)."""
        if self.scope_path is None:
            return None
        with engine.connect() as conn:
            node = conn.execute(
                text("select id, path, level_order from nodes where id = cast(:nid as uuid) "
                     "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
                {"nid": str(node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            questions = self._version_questions(conn, survey_version_id)
            if node is None or questions is None:
                return None
            maxlvl = self._max_level(conn)
            if node["level_order"] == maxlvl:
                latest = conn.execute(
                    text("select id from responses where survey_version_id = cast(:vid as uuid) "
                         "and store_node_id = cast(:nid as uuid) and tenant_id = cast(:tid as uuid) "
                         "order by submitted_at desc limit 1"),
                    {"vid": str(survey_version_id), "nid": str(node_id), "tid": str(self.tenant_id)},
                ).mappings().first()
                if latest is None:
                    return {"is_store": True, "responded": False}
                scored = self._score_one(conn, questions, latest["id"])
                return {"is_store": True, "responded": True, "items": scored["items"],
                        "questions": scored["questions"], "overall": scored["overall"]}
            # Not a store: the version's covered stores under this node, by child.
            # The extra path-like-scope clause is redundant (node is already in
            # scope) but states the scope invariant explicitly, like every other
            # store-fetching query here.
            covered = conn.execute(
                text("select n.id, n.path from nodes n where n.tenant_id = cast(:tid as uuid) "
                     "and n.level_order = :ml and n.path like :np || '%' "
                     "and n.path like :scope || '%' and exists ("
                     "  select 1 from survey_assignments a join nodes tn on tn.id = a.target_node_id "
                     "  where a.survey_version_id = cast(:vid as uuid) "
                     "  and a.tenant_id = cast(:tid as uuid) and n.path like tn.path || '%')"),
                {"tid": str(self.tenant_id), "ml": maxlvl, "np": node["path"],
                 "scope": self.scope_path, "vid": str(survey_version_id)},
            ).mappings().all()
            covered = [dict(c) for c in covered]
            children = conn.execute(
                text("select id, name, level_order, path from nodes "
                     "where parent_id = cast(:nid as uuid) and tenant_id = cast(:tid as uuid) "
                     "order by name"),
                {"nid": str(node_id), "tid": str(self.tenant_id)},
            ).mappings().all()
            rows = []
            for c in children:
                # Each covered store sits under exactly one immediate child (a
                # node's path is a unique prefix of all its descendants).
                child_store_ids = [s["id"] for s in covered if s["path"].startswith(c["path"])]
                expected, responded, scored_n, passed = self._metrics_for_stores(
                    conn, survey_version_id, child_store_ids)
                rows.append({
                    "node_id": c["id"], "name": c["name"], "level_order": c["level_order"],
                    "is_store": c["level_order"] == maxlvl,
                    "expected": expected, "responded": responded,
                    "scored": scored_n, "passed": passed,
                    "completion_pct": self._pct(responded, expected),
                    "pass_pct": self._pct(passed, scored_n),
                })
        return {"is_store": False, "children": rows}

    def node_compliance(self, node_id=None, date_from=None, date_to=None):
        """Compliance rolled up by ORG NODE for the dashboard 'Compliance by node'
        card, WINDOWED to match the headline KPI. For a non-store base, returns its
        immediate child nodes, each aggregated over the DISTINCT (store, version)
        coverage beneath it (latest-in-window response per store, via the same
        _dashboard_window the headline uses, so the rows aggregate to the headline).
        For a store, returns the per-product why-it-(failed) across the version(s)
        covering it. None if node_id is given but out of scope (-> 404); an unpinned
        caller (scope_path None) returns an empty children payload (200)."""
        if self.scope_path is None:
            return {"is_store": False, "children": []}
        with engine.connect() as conn:
            base = self._base_path_in_scope(conn, node_id)
            if base is None:
                return None  # node_id out of scope -> 404
            maxlvl = self._max_level(conn)
            node = conn.execute(
                text("select id, name, level_order, path from nodes "
                     "where tenant_id = cast(:tid as uuid) and path = :base"),
                {"tid": str(self.tenant_id), "base": base},
            ).mappings().first()
            if node is None:
                return None  # scope_path with no matching node (defensive)
            if node["level_order"] == maxlvl:
                return self._store_node_compliance(conn, node, date_from, date_to)
            children = conn.execute(
                text("select id, name, level_order, path from nodes "
                     "where parent_id = cast(:nid as uuid) and tenant_id = cast(:tid as uuid) "
                     "order by level_order, name"),
                {"nid": str(node["id"]), "tid": str(self.tenant_id)},
            ).mappings().all()
            rows = []
            # When the caller passes a window, also measure the immediately prior
            # window of the same length so each child can carry a period-over-period
            # delta (the up/down arrow on the prototype's district cards).
            span = (date_to - date_from) if (date_from is not None and date_to is not None) else None
            # N+1: one _dashboard_window per child (each a few queries), plus a small
            # footprint count and an optional prior-window pass. Same bounded caveat
            # as assignment_compliance; fine for the handful of regions per branch.
            # Revisit with a single roll-up if node counts ever grow large.
            for c in children:
                m = self._dashboard_window(conn, c["path"], maxlvl, date_from, date_to)
                # Footprint beneath this child: store count (deepest level) and the
                # distinct reps pinned at-or-under it.
                stores = conn.execute(
                    text("select count(*) from nodes where tenant_id = cast(:tid as uuid) "
                         "and path like :p || '%' and level_order = :ml"),
                    {"tid": str(self.tenant_id), "p": c["path"], "ml": maxlvl},
                ).scalar() or 0
                reps = conn.execute(
                    text("select count(distinct a.user_id) from assignments a "
                         "join nodes n on n.id = a.node_id "
                         "join users u on u.id = a.user_id "
                         "where a.tenant_id = cast(:tid as uuid) and u.role = 'rep' "
                         "and n.path like :p || '%'"),
                    {"tid": str(self.tenant_id), "p": c["path"]},
                ).scalar() or 0
                # Stores with a failing latest reading. With one survey covering a
                # store, the scored (store, version) pairs are the stores, so the
                # failed pairs are the stores with failures.
                failing_stores = max(0, (m.get("scored") or 0) - (m.get("passed") or 0))
                # Period-over-period pass-% delta, when this and a prior window exist.
                delta = None
                if span is not None and m.get("pass_pct") is not None:
                    prev = self._dashboard_window(
                        conn, c["path"], maxlvl, date_from - span, date_from
                    )
                    if prev.get("pass_pct") is not None:
                        delta = round(m["pass_pct"] - prev["pass_pct"], 1)
                rows.append({"node_id": c["id"], "name": c["name"],
                             "level_order": c["level_order"],
                             "is_store": c["level_order"] == maxlvl,
                             "stores": stores, "reps": reps,
                             "failing_stores": failing_stores, "delta": delta, **m})
        return {"is_store": False, "children": rows}

    def _store_node_compliance(self, conn, node, date_from, date_to):
        """The store branch of node_compliance: one block per survey version that
        covers this store (assignment target is an ancestor-or-self), each scored
        from the store's latest-in-window response. ALWAYS includes items/questions/
        overall (empty defaults when unresponded) so the frontend reads them without
        optional-chaining surprises (unlike the leaner legacy compliance_drill)."""
        versions = conn.execute(
            text("select distinct a.survey_version_id as vid, s.name as survey_name "
                 "from survey_assignments a "
                 "join nodes tn on tn.id = a.target_node_id "
                 "join survey_versions v on v.id = a.survey_version_id "
                 "join surveys s on s.id = v.survey_id "
                 "where a.tenant_id = cast(:tid as uuid) "
                 "and :spath like tn.path || '%' "
                 "order by s.name"),
            {"tid": str(self.tenant_id), "spath": node["path"]},
        ).mappings().all()
        df = date_from.isoformat() if date_from is not None else None
        dt = date_to.isoformat() if date_to is not None else None
        df_clause = "and submitted_at >= cast(:df as timestamptz) " if df else ""
        dt_clause = "and submitted_at <= cast(:dt as timestamptz) " if dt else ""
        blocks = []
        for ver in versions:
            questions = self._version_questions(conn, ver["vid"])
            latest = conn.execute(
                text("select id from responses where survey_version_id = cast(:vid as uuid) "
                     "and store_node_id = cast(:nid as uuid) and tenant_id = cast(:tid as uuid) "
                     + df_clause + dt_clause +
                     "order by submitted_at desc limit 1"),
                {"vid": str(ver["vid"]), "nid": str(node["id"]), "tid": str(self.tenant_id),
                 "df": df, "dt": dt},
            ).mappings().first()
            if latest is None:
                blocks.append({"survey_version_id": ver["vid"], "survey_name": ver["survey_name"],
                               "responded": False, "items": [], "questions": {}, "overall": None})
            else:
                scored = self._score_one(conn, questions, latest["id"])
                blocks.append({"survey_version_id": ver["vid"], "survey_name": ver["survey_name"],
                               "responded": True, "items": scored["items"],
                               "questions": scored["questions"], "overall": scored["overall"]})
        return {"is_store": True, "name": node["name"], "surveys": blocks}

    def oos_by_sku(self, survey_version_id, question_id, node_id=None):
        """Out-of-stock by product for a per-product count question, using each
        store's latest response under the node. Out of stock = answer 0. Returns
        None if node/version not in scope (-> 404); raises ValueError for a bad
        question (-> 400)."""
        if self.scope_path is None:
            return None
        with engine.connect() as conn:
            base = self._base_path_in_scope(conn, node_id)
            if base is None:
                return None
            questions = self._version_questions(conn, survey_version_id)
            if questions is None:
                return None
            _count_question(questions, question_id)  # raises ValueError if invalid
            maxlvl = self._max_level(conn)
            # value is jsonb; (value::text)::numeric is the version-portable way
            # to read a stored number (direct jsonb::numeric needs PG15+). 4a's
            # _check_value guarantees number questions only ever store numbers.
            rows = conn.execute(
                text("with latest as ("
                     " select distinct on (r.store_node_id) r.id from responses r "
                     " join nodes n on n.id = r.store_node_id "
                     " where r.survey_version_id = cast(:vid as uuid) "
                     " and r.tenant_id = cast(:tid as uuid) "
                     " and n.path like :base || '%' and n.level_order = :ml "
                     " order by r.store_node_id, r.submitted_at desc) "
                     "select ri.sku_id, sk.line, sk.variant, "
                     " count(*) filter (where (ri.value::text)::numeric = 0) as oos_store_count, "
                     " count(*) as reporting_store_count "
                     "from response_items ri join latest l on l.id = ri.response_id "
                     "join skus sk on sk.id = ri.sku_id "
                     "where ri.question_id = :qid and ri.sku_id is not null "
                     "group by ri.sku_id, sk.line, sk.variant order by sk.line, sk.variant"),
                {"vid": str(survey_version_id), "tid": str(self.tenant_id),
                 "base": base, "ml": maxlvl, "qid": question_id},
            ).mappings().all()
        return [{"sku_id": str(r["sku_id"]), "line": r["line"], "variant": r["variant"],
                 "oos_store_count": r["oos_store_count"],
                 "reporting_store_count": r["reporting_store_count"]} for r in rows]

    def facings_trend(self, survey_version_id, question_id, sku_id,
                      node_id=None, date_from=None, date_to=None):
        """Time-series of a per-product count answer across a node's stores (all
        responses, not just latest), plus a per-UTC-day average. None if
        node/version not in scope (-> 404); raises ValueError for a bad question
        or a sku not on the question (-> 400)."""
        if self.scope_path is None:
            return None
        with engine.connect() as conn:
            base = self._base_path_in_scope(conn, node_id)
            if base is None:
                return None
            questions = self._version_questions(conn, survey_version_id)
            if questions is None:
                return None
            q = _count_question(questions, question_id)  # raises ValueError if invalid
            if str(sku_id) not in {str(s) for s in (q.get("sku_ids") or [])}:
                raise ValueError(f"sku {sku_id} is not on question {question_id}")
            df_str = date_from.isoformat() if date_from is not None else None
            dt_str = date_to.isoformat() if date_to is not None else None
            df_clause = "and ri.submitted_at >= cast(:df as timestamptz) " if df_str else ""
            dt_clause = "and ri.submitted_at <= cast(:dt as timestamptz) " if dt_str else ""
            rows = conn.execute(
                text("select ri.submitted_at, ri.store_node_id, n.name as store_name, ri.value "
                     "from response_items ri join nodes n on n.id = ri.store_node_id "
                     "where ri.survey_version_id = cast(:vid as uuid) "
                     "and ri.tenant_id = cast(:tid as uuid) "
                     "and ri.question_id = :qid and ri.sku_id = cast(:sku as uuid) "
                     "and n.path like :base || '%' "
                     + df_clause + dt_clause +
                     # ri.id is a stable tiebreaker for rows sharing a timestamp.
                     "order by ri.submitted_at, ri.id"),
                {"vid": str(survey_version_id), "tid": str(self.tenant_id), "qid": question_id,
                 "sku": str(sku_id), "base": base, "df": df_str, "dt": dt_str},
            ).mappings().all()
        points = [{"submitted_at": r["submitted_at"], "store_node_id": str(r["store_node_id"]),
                   "store_name": r["store_name"], "value": r["value"]} for r in rows]
        by_day: dict = {}
        for r in rows:
            # Bucket by UTC date explicitly (the docstring promises UTC), so the
            # bucket is correct regardless of the process/session timezone.
            day = r["submitted_at"].astimezone(timezone.utc).date().isoformat()
            # value is a jsonb number (int/float); 4a validation guarantees numeric.
            by_day.setdefault(day, []).append(float(r["value"]))
        daily_avg = [{"date": d, "avg": round(sum(v) / len(v), 1)}
                     for d, v in sorted(by_day.items())]
        return {"points": points, "daily_avg": daily_avg}

    # ----- payroll (periods company-wide; entries scoped by the rep's pin) -----

    _PERIOD_COLS = ("id, name, start_date, end_date, cutoff_at, timezone_basis, "
                    "grace_hours, lock_behavior, status, sealed_at, created_at")
    # _ENTRY_COLS is used by the time-entry methods. miles is cast to float so it
    # serializes as a JSON number, not a string (jsonb/numeric would stringify).
    _ENTRY_COLS = ("id, period_id, user_id, store_min, reset_min, drive_min, "
                   "miles::float as miles, mgr_status, sealed, created_at")

    def _audit(self, conn, actor_user_id, action, target, detail) -> None:
        conn.execute(
            text("insert into audit (tenant_id, actor_user_id, action, target, detail) "
                 "values (cast(:tid as uuid), cast(:actor as uuid), :action, :target, "
                 "cast(:detail as jsonb))"),
            {"tid": str(self.tenant_id), "actor": str(actor_user_id), "action": action,
             "target": target, "detail": json.dumps(detail or {})},
        )

    def create_pay_period(self, name, start_date, end_date, cutoff_at, timezone_basis,
                          grace_hours, lock_behavior, actor_user_id) -> dict:
        with engine.begin() as conn:
            row = conn.execute(
                text("insert into pay_periods (tenant_id, name, start_date, end_date, cutoff_at, "
                     "timezone_basis, grace_hours, lock_behavior) values (cast(:tid as uuid), :name, "
                     ":sd, :ed, :cut, :tzb, :grace, :lock) "
                     f"returning {self._PERIOD_COLS}"),
                {"tid": str(self.tenant_id), "name": name, "sd": start_date, "ed": end_date,
                 "cut": cutoff_at, "tzb": timezone_basis, "grace": grace_hours,
                 "lock": lock_behavior},
            ).mappings().first()
            self._audit(conn, actor_user_id, "pay_period.created", str(row["id"]), {"name": name})
        return dict(row)

    def list_pay_periods(self) -> list[dict]:
        with engine.connect() as conn:
            rows = conn.execute(
                text(f"select {self._PERIOD_COLS} from pay_periods "
                     "where tenant_id = cast(:tid as uuid) order by start_date desc"),
                {"tid": str(self.tenant_id)},
            ).mappings().all()
        return [dict(r) for r in rows]

    def get_pay_period(self, period_id) -> dict | None:
        with engine.connect() as conn:
            row = conn.execute(
                text(f"select {self._PERIOD_COLS} from pay_periods "
                     "where id = cast(:pid as uuid) and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            ).mappings().first()
        return dict(row) if row else None

    def create_time_entry(self, period_id, user_id, fields, idempotency_key=None) -> dict | None:
        """The caller's own entry for an OPEN period. None if the period is not
        the company's (-> 404); PeriodSealedError if sealed; EntryExistsError if
        the rep already has one."""
        with engine.begin() as conn:
            # Idempotency: a re-sent create carrying a ticket we have already seen
            # returns the original entry (200), before the sealed/exists checks, so
            # a genuine re-send is not mistaken for a duplicate. Same un-scoped
            # _ENTRY_COLS shape as a fresh insert.
            if idempotency_key is not None:
                prior = conn.execute(
                    text(f"select {self._ENTRY_COLS} from time_entries "
                         "where tenant_id = cast(:tid as uuid) "
                         "and idempotency_key = cast(:idem as uuid) "
                         "and user_id = cast(:uid as uuid)"),
                    {"tid": str(self.tenant_id), "idem": str(idempotency_key),
                     "uid": str(user_id)},
                ).mappings().first()
                if prior is not None:
                    return dict(prior)
            period = conn.execute(
                text("select status from pay_periods where id = cast(:pid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if period is None:
                return None
            if period["status"] != "open":
                raise PeriodSealedError()
            # Pre-check is enough for this single-writer app; the
            # unique(period_id, user_id) constraint is the real backstop.
            exists = conn.execute(
                text("select id from time_entries where period_id = cast(:pid as uuid) "
                     "and user_id = cast(:uid as uuid)"),
                {"pid": str(period_id), "uid": str(user_id)},
            ).first()
            if exists is not None:
                raise EntryExistsError()
            row = conn.execute(
                text("insert into time_entries (tenant_id, period_id, user_id, store_min, "
                     "reset_min, drive_min, miles, idempotency_key) values (cast(:tid as uuid), "
                     "cast(:pid as uuid), cast(:uid as uuid), :sm, :rm, :dm, :mi, "
                     "cast(:idem as uuid)) "
                     f"returning {self._ENTRY_COLS}"),
                {"tid": str(self.tenant_id), "pid": str(period_id), "uid": str(user_id),
                 "sm": fields["store_min"], "rm": fields["reset_min"],
                 "dm": fields["drive_min"], "mi": fields["miles"],
                 "idem": str(idempotency_key) if idempotency_key is not None else None},
            ).mappings().first()
        return dict(row)

    def update_time_entry(self, entry_id, user_id, fields) -> dict | None:
        """Edit the caller's OWN entry's hours. None if not found or not the
        caller's (-> 404); EntrySealedError if the entry is locked."""
        with engine.begin() as conn:
            entry = conn.execute(
                text("select sealed, user_id from time_entries where id = cast(:eid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"eid": str(entry_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if entry is None or str(entry["user_id"]) != str(user_id):
                return None
            if entry["sealed"]:
                raise EntrySealedError()
            row = conn.execute(
                text("update time_entries set store_min = :sm, reset_min = :rm, "
                     "drive_min = :dm, miles = :mi where id = cast(:eid as uuid) "
                     "and tenant_id = cast(:tid as uuid) "
                     f"returning {self._ENTRY_COLS}"),
                {"sm": fields["store_min"], "rm": fields["reset_min"],
                 "dm": fields["drive_min"], "mi": fields["miles"], "eid": str(entry_id),
                 "tid": str(self.tenant_id)},
            ).mappings().first()
        return dict(row)

    def list_entries(self, period_id, caller_user_id, caller_role) -> list[dict] | None:
        """Entries for a period. A rep sees only their own; a manager/admin sees
        entries for reps whose pin is within the caller's scope. None if the
        period is not the company's (-> 404)."""
        with engine.connect() as conn:
            period = conn.execute(
                text("select id from pay_periods where id = cast(:pid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            ).first()
            if period is None:
                return None
            if caller_role == "rep":
                rows = conn.execute(
                    text(f"select {self._ENTRY_COLS} from time_entries "
                         "where period_id = cast(:pid as uuid) and tenant_id = cast(:tid as uuid) "
                         "and user_id = cast(:uid as uuid) order by created_at"),
                    {"pid": str(period_id), "tid": str(self.tenant_id),
                     "uid": str(caller_user_id)},
                ).mappings().all()
            elif self.scope_path is None:
                rows = []
            else:
                # te.-qualified column list, derived from _ENTRY_COLS so the two
                # list paths can never drift, with the join tables also sharing
                # id/user_id names.
                te_cols = ", ".join(f"te.{c.strip()}" for c in self._ENTRY_COLS.split(","))
                rows = conn.execute(
                    text(f"select {te_cols} from time_entries te "
                         # a.tenant_id keeps the assignments join within the
                         # caller's company (defense-in-depth + a 1:1 join).
                         "join assignments a on a.user_id = te.user_id "
                         "and a.tenant_id = cast(:tid as uuid) "
                         "join nodes n on n.id = a.node_id "
                         "where te.period_id = cast(:pid as uuid) "
                         "and te.tenant_id = cast(:tid as uuid) "
                         "and n.path like :scope || '%' order by te.created_at"),
                    {"pid": str(period_id), "tid": str(self.tenant_id), "scope": self.scope_path},
                ).mappings().all()
        return [dict(r) for r in rows]

    def set_entry_status(self, entry_id, status) -> dict | None:
        """Approve/reject an entry. The entry's rep must be pinned within the
        caller's scope (the role is already gated by the endpoint dependency).
        None if not found / out of scope / the rep is unpinned (-> 404);
        EntrySealedError if the entry is locked."""
        if self.scope_path is None:
            return None
        with engine.begin() as conn:
            # The rep's pin must be within the caller's scope. The path-prefix
            # filter is in the WHERE (same idiom as everywhere else), so an
            # out-of-scope or unpinned rep simply returns no row -> 404.
            entry = conn.execute(
                text("select te.sealed from time_entries te "
                     "join assignments a on a.user_id = te.user_id "
                     "and a.tenant_id = cast(:tid as uuid) "
                     "join nodes n on n.id = a.node_id "
                     "where te.id = cast(:eid as uuid) and te.tenant_id = cast(:tid as uuid) "
                     "and n.path like :scope || '%'"),
                {"eid": str(entry_id), "tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().first()
            if entry is None:
                return None
            if entry["sealed"]:
                raise EntrySealedError()
            row = conn.execute(
                text("update time_entries set mgr_status = :st where id = cast(:eid as uuid) "
                     "and tenant_id = cast(:tid as uuid) "
                     f"returning {self._ENTRY_COLS}"),
                {"st": status, "eid": str(entry_id), "tid": str(self.tenant_id)},
            ).mappings().first()
        return dict(row)

    def seal_period(self, period_id, actor_user_id) -> dict | None:
        """Lock every entry in the period and mark it sealed (stamping sealed_at
        the first time). Re-callable: a re-seal re-locks reopened entries and
        writes its own pay_period.sealed audit row (re-seals are not
        distinguished from the initial seal in the log). None if the period is
        not the company's."""
        with engine.begin() as conn:
            period = conn.execute(
                text("select id from pay_periods where id = cast(:pid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            ).first()
            if period is None:
                return None
            conn.execute(
                text("update pay_periods set status = 'sealed', "
                     "sealed_at = coalesce(sealed_at, now()) where id = cast(:pid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            )
            conn.execute(
                text("update time_entries set sealed = true where period_id = cast(:pid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            )
            self._audit(conn, actor_user_id, "pay_period.sealed", str(period_id), {})
        return self.get_pay_period(period_id)

    def reopen_period(self, period_id, target_user_id, reason, actor_user_id) -> dict | None:
        """Unlock one rep's entries in a sealed period and log it. Returns the
        period dict on success, None if the period is not the company's (-> 404).
        Raises PeriodNotSealedError if the period is not sealed (-> 409), and
        RepEntriesNotFoundError if that rep has no entries in it (-> 404)."""
        with engine.begin() as conn:
            period = conn.execute(
                text("select status from pay_periods where id = cast(:pid as uuid) "
                     "and tenant_id = cast(:tid as uuid)"),
                {"pid": str(period_id), "tid": str(self.tenant_id)},
            ).mappings().first()
            if period is None:
                return None
            if period["status"] != "sealed":
                raise PeriodNotSealedError()
            unlocked = conn.execute(
                text("update time_entries set sealed = false "
                     "where period_id = cast(:pid as uuid) and user_id = cast(:uid as uuid) "
                     "and tenant_id = cast(:tid as uuid) returning id"),
                {"pid": str(period_id), "uid": str(target_user_id), "tid": str(self.tenant_id)},
            ).all()
            if not unlocked:
                raise RepEntriesNotFoundError()
            self._audit(conn, actor_user_id, "pay_period.reopened",
                        f"period:{period_id} user:{target_user_id}", {"reason": reason})
        return self.get_pay_period(period_id)

    def list_audit(self) -> list[dict]:
        with engine.connect() as conn:
            rows = conn.execute(
                text("select id, actor_user_id, action, target, detail, at from audit "
                     "where tenant_id = cast(:tid as uuid) order by at desc"),
                {"tid": str(self.tenant_id)},
            ).mappings().all()
        return [dict(r) for r in rows]

    # ----- export (read-only flat rows for CSV + the read API; reuses the
    # existing scoped readers, so the export can never widen the scope) -----

    def export_compliance(self, node_id=None):
        """Flat per-assignment compliance roll-up for export. Reuses
        assignment_compliance unchanged, so the export and the dashboard never
        disagree (including pass_pct/completion_pct being None, not 0, when their
        denominator is 0). Returns None only if node_id is out of scope (-> 404);
        an unpinned caller gets []."""
        return self.assignment_compliance(node_id)

    def export_responses(self, grain, date_from=None, date_to=None, survey_id=None,
                         chain=None, node_id=None, sku_id=None):
        """Flat response rows for export. grain='summary' returns EVERY stored
        response in scope (the audit trail, not latest-per-store); grain='sku'
        returns one row per stored response_item. Every filter is ANDed on top of
        the unconditional tenant + path-prefix scope filter. Pass/fail is the live
        evaluate_response output (full items + question verdicts). Returns None
        only if node_id is given but out of scope (-> 404); an unpinned caller
        gets []."""
        if self.scope_path is None:
            return []  # unpinned: sees nothing (never a 404, never a leak)
        with engine.connect() as conn:
            base = self._base_path_in_scope(conn, node_id)
            if base is None:
                return None  # node_id given but out of scope -> 404

            clauses = ["r.tenant_id = cast(:tid as uuid)", "n.path like :base || '%'"]
            params = {"tid": str(self.tenant_id), "base": base}
            if survey_id is not None:
                clauses.append("s.id = cast(:sid as uuid)")
                params["sid"] = str(survey_id)
            if chain is not None:
                clauses.append("n.chain = :chain")  # extra AND, never replaces scope
                params["chain"] = chain
            if date_from is not None:
                clauses.append("r.submitted_at >= cast(:df as timestamptz)")
                params["df"] = date_from.isoformat()
            if date_to is not None:
                clauses.append("r.submitted_at <= cast(:dt as timestamptz)")
                params["dt"] = date_to.isoformat()
            where = " and ".join(clauses)
            rows = conn.execute(
                text("select r.id, r.survey_version_id, r.store_node_id, n.name as store_name, "
                     "n.chain, s.id as survey_id, s.name as survey_name, v.version_number, "
                     "r.user_id, r.submitted_at, r.online "
                     "from responses r join nodes n on n.id = r.store_node_id "
                     "join survey_versions v on v.id = r.survey_version_id "
                     "join surveys s on s.id = v.survey_id "
                     f"where {where} order by r.submitted_at, r.id"),
                params,
            ).mappings().all()

            # Batch-score: group response ids by version, load each version's
            # questions once + that version's items in bulk, run evaluate_response.
            by_version: dict = {}
            for r in rows:
                by_version.setdefault(str(r["survey_version_id"]), []).append(str(r["id"]))
            scored: dict = {}
            for vid, resp_ids in by_version.items():
                questions = conn.execute(
                    text("select questions from survey_versions where id = cast(:vid as uuid)"),
                    {"vid": vid},
                ).mappings().first()["questions"]
                item_rows = conn.execute(
                    text("select response_id, question_id, sku_id, value from response_items "
                         "where response_id = any(cast(:ids as uuid[])) order by question_id, sku_id"),
                    {"ids": resp_ids},
                ).mappings().all()
                items_by_resp: dict = {}
                for it in item_rows:
                    items_by_resp.setdefault(str(it["response_id"]), []).append(dict(it))
                for rid in resp_ids:
                    scored[rid] = evaluate_response(questions, items_by_resp.get(rid, []))

            if grain == "summary":
                out = []
                for r in rows:
                    verdicts = list(scored[str(r["id"])]["questions"].values())
                    out.append({
                        "response_id": str(r["id"]),
                        "store_node_id": str(r["store_node_id"]),
                        "store_name": r["store_name"],
                        "chain": r["chain"],
                        "survey_id": str(r["survey_id"]),
                        "survey_name": r["survey_name"],
                        "survey_version_id": str(r["survey_version_id"]),
                        "version_number": r["version_number"],
                        "user_id": str(r["user_id"]),
                        "submitted_at": r["submitted_at"],
                        "online": r["online"],
                        "overall": scored[str(r["id"])]["overall"],
                        "num_passed": sum(1 for v in verdicts if v is True),
                        "num_failed": sum(1 for v in verdicts if v is False),
                    })
                return out

            # grain == "sku": one row per stored item, with denormalized sku.
            sku_map: dict = {}
            for sk in conn.execute(
                text("select id, line, variant from skus where tenant_id = cast(:tid as uuid)"),
                {"tid": str(self.tenant_id)},
            ).mappings().all():
                sku_map[str(sk["id"])] = (sk["line"], sk["variant"])
            out = []
            for r in rows:
                for it in scored[str(r["id"])]["items"]:
                    sid_str = str(it["sku_id"]) if it["sku_id"] is not None else None
                    if sku_id is not None and sid_str != str(sku_id):
                        continue
                    line, variant = sku_map.get(sid_str, (None, None))
                    out.append({
                        "response_id": str(r["id"]),
                        "store_node_id": str(r["store_node_id"]),
                        "store_name": r["store_name"],
                        "chain": r["chain"],
                        "survey_name": r["survey_name"],
                        "version_number": r["version_number"],
                        "submitted_at": r["submitted_at"],
                        "question_id": it["question_id"],
                        "sku_id": sid_str,
                        "sku_line": line,
                        "sku_variant": variant,
                        "value": it["value"],
                        "item_pass": it["pass"],
                    })
            return out

    def export_payroll(self, caller_user_id, caller_role, period_id=None,
                       date_from=None, date_to=None, node_id=None):
        """Flat payroll rows for export. Reuses list_entries' row-visibility rule
        (rep -> own entries; manager/admin -> entries for reps pinned within
        scope) but is a distinct query joining pay_periods + users + a LEFT join
        to the rep's pin (so an unpinned rep still exports, with a blank
        rep_node_name). te.tenant_id is always applied. Returns None only if
        node_id is given but out of scope (-> 404)."""
        with engine.connect() as conn:
            scope_filter_path = self.scope_path
            if node_id is not None:
                nrow = conn.execute(
                    text("select path from nodes where id = cast(:nid as uuid) "
                         "and tenant_id = cast(:tid as uuid) and path like :scope || '%'"),
                    {"nid": str(node_id), "tid": str(self.tenant_id), "scope": self.scope_path},
                ).mappings().first()
                if nrow is None:
                    return None  # node_id out of scope -> 404
                scope_filter_path = nrow["path"]

            clauses = ["te.tenant_id = cast(:tid as uuid)"]
            params = {"tid": str(self.tenant_id)}
            if caller_role == "rep":
                clauses.append("te.user_id = cast(:caller as uuid)")
                params["caller"] = str(caller_user_id)
            else:
                # The rep's pin (LEFT-joined) must be within scope. An unpinned rep
                # has rn.path NULL, so NULL like ... is false and they are excluded
                # from a manager/admin view (matching list_entries' inner-join);
                # an unpinned manager/admin (scope None) sees nobody.
                # Unpinned manager/admin sees nobody (matches the rest of
                # ScopedRepo); avoids relying on `path like NULL` returning no rows.
                if scope_filter_path is None:
                    return []
                clauses.append("rn.path like :scope || '%'")
                params["scope"] = scope_filter_path
            if period_id is not None:
                clauses.append("te.period_id = cast(:pid as uuid)")
                params["pid"] = str(period_id)
            if date_from is not None:
                clauses.append("pp.end_date >= cast(:df as date)")
                params["df"] = date_from.isoformat()
            if date_to is not None:
                clauses.append("pp.start_date <= cast(:dt as date)")
                params["dt"] = date_to.isoformat()
            where = " and ".join(clauses)
            rows = conn.execute(
                text("select te.id as entry_id, te.period_id, pp.name as period_name, "
                     "pp.start_date, pp.end_date, pp.status as period_status, "
                     "te.user_id, u.name as rep_name, u.email as rep_email, "
                     "te.store_min, te.reset_min, te.drive_min, te.miles::float as miles, "
                     "te.mgr_status, te.sealed, rn.name as rep_node_name "
                     "from time_entries te "
                     "join pay_periods pp on pp.id = te.period_id "
                     "join users u on u.id = te.user_id "
                     "left join assignments ra on ra.user_id = te.user_id "
                     "and ra.tenant_id = te.tenant_id "
                     "left join nodes rn on rn.id = ra.node_id "
                     f"where {where} order by pp.start_date, u.name, te.id"),
                params,
            ).mappings().all()
        return [{
            "entry_id": str(r["entry_id"]),
            "period_id": str(r["period_id"]),
            "period_name": r["period_name"],
            "start_date": r["start_date"],
            "end_date": r["end_date"],
            "period_status": r["period_status"],
            "user_id": str(r["user_id"]),
            "rep_name": r["rep_name"],
            "rep_email": r["rep_email"],
            "store_min": r["store_min"],
            "reset_min": r["reset_min"],
            "drive_min": r["drive_min"],
            "miles": r["miles"],
            "mgr_status": r["mgr_status"],
            "sealed": r["sealed"],
            "rep_node_name": r["rep_node_name"],
        } for r in rows]


def _count_question(questions, question_id):
    """Return the question if it is a per-product number question, else raise
    ValueError (-> 400). Used by the out-of-stock and trend analytics."""
    q = next((x for x in questions if x.get("id") == question_id), None)
    if q is None or q.get("type") != "number" or not q.get("perSku", False):
        raise ValueError(f"{question_id} is not a per-product number question")
    return q


def _check_value(value, q) -> None:
    """Raise ValueError if a non-blank answer value does not match its question
    type (and, for choice questions, its options)."""
    qtype = q["type"]
    if qtype == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"question {q['id']} expects a number")
    elif qtype == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"question {q['id']} expects true/false")
    elif qtype == "single_choice":
        if not isinstance(value, str) or value not in (q.get("options") or []):
            raise ValueError(f"question {q['id']} expects one of its options")
    elif qtype == "multi_choice":
        opts = q.get("options") or []
        if not isinstance(value, list) or not value or not all(v in opts for v in value):
            raise ValueError(f"question {q['id']} expects a non-empty subset of its options")
    elif qtype in ("text", "photo"):
        if not isinstance(value, str):
            raise ValueError(f"question {q['id']} expects text")
    else:
        raise ValueError(f"question {q['id']} has unknown type {qtype}")


def scope_path_for(tenant_id: str, user_id: str) -> str | None:
    """The path of the node a user is pinned to (their scope), or None if the
    user has no pin."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "select n.path from assignments a "
                "join nodes n on n.id = a.node_id "
                "where a.tenant_id = cast(:tid as uuid) and a.user_id = cast(:uid as uuid)"
            ),
            {"tid": str(tenant_id), "uid": str(user_id)},
        ).mappings().first()
    return row["path"] if row else None


def get_scoped_repo(claims: dict = Depends(current_claims)) -> ScopedRepo:
    """FastAPI dependency: build the caller's ScopedRepo from their wristband."""
    tenant_id = claims["tenant_id"]
    user_id = claims["sub"]
    return ScopedRepo(tenant_id, scope_path_for(tenant_id, user_id))
