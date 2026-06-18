"""The scope guard: scope follows the pin.

Every request for scoped data goes through get_scoped_repo, which reads the
caller's wristband (JWT), looks up the node they are pinned to, and returns a
ScopedRepo. The ScopedRepo is the ONLY object allowed to query scoped tables;
it automatically limits every query to the caller's tenant and the subtree
under their pinned node, so no endpoint can forget the filter.
"""
import json
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
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"select {self._SURVEY_COLS} from surveys "
                    "where tenant_id = cast(:tid as uuid) order by name"
                ),
                {"tid": str(self.tenant_id)},
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
    _RESPONSE_COLS_R = ("r.id, r.survey_version_id, r.store_node_id, r.store_path, "
                        "r.user_id, r.online, r.submitted_at, r.created_at")

    def create_response(self, survey_version_id, store_node_id, answers, user_id) -> dict | None:
        """Store one completed response. Returns None if the store is not a store
        in the caller's scope. Raises VersionNotPublishedError if the version is
        missing/unpublished, ValueError if an answer does not fit the version."""
        if self.scope_path is None:
            return None
        with engine.begin() as conn:
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
                    "store_path, user_id) values (cast(:tid as uuid), cast(:vid as uuid), "
                    "cast(:nid as uuid), :spath, cast(:uid as uuid)) "
                    f"returning {self._RESPONSE_COLS}"
                ),
                {"tid": str(self.tenant_id), "vid": str(survey_version_id),
                 "nid": str(store_node_id), "spath": store["path"], "uid": str(user_id)},
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
                    "where r.tenant_id = cast(:tid as uuid) and n.path like :scope || '%' "
                    "order by r.submitted_at desc"
                ),
                {"tid": str(self.tenant_id), "scope": self.scope_path},
            ).mappings().all()
            result = []
            for r in rows:
                result.append({**dict(r), "overall": self._score(conn, r)["overall"]})
        return result

    def get_response(self, response_id) -> dict | None:
        if self.scope_path is None:
            return None
        with engine.connect() as conn:
            r = conn.execute(
                text(
                    f"select {self._RESPONSE_COLS_R} from responses r "
                    "join nodes n on n.id = r.store_node_id "
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

    def create_time_entry(self, period_id, user_id, fields) -> dict | None:
        """The caller's own entry for an OPEN period. None if the period is not
        the company's (-> 404); PeriodSealedError if sealed; EntryExistsError if
        the rep already has one."""
        with engine.begin() as conn:
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
                     "reset_min, drive_min, miles) values (cast(:tid as uuid), cast(:pid as uuid), "
                     "cast(:uid as uuid), :sm, :rm, :dm, :mi) "
                     f"returning {self._ENTRY_COLS}"),
                {"tid": str(self.tenant_id), "pid": str(period_id), "uid": str(user_id),
                 "sm": fields["store_min"], "rm": fields["reset_min"],
                 "dm": fields["drive_min"], "mi": fields["miles"]},
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
