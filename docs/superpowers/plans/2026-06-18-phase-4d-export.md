# Phase 4d: Export (CSV + read-only JSON feed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CSV downloads plus a matching read-only JSON feed over the responses, payroll, and compliance data, filterable by date / survey / chain / node / per-SKU, all branch-scoped through the existing `ScopedRepo`, with no new tables.

**Architecture:** One new router (`api/app/exports.py`) exposes three GET endpoints; each returns either a streamed CSV (`?format=csv`) or JSON (default), built from the same flat rows produced by three new `ScopedRepo` methods. The security guard (tenant + `path like scope_path || '%'`) is reused unchanged; pass/fail is computed live via the existing `evaluate_response`. A single ordered `COLUMNS` list per dataset drives both the CSV header and the JSON keys so they cannot drift.

**Tech Stack:** Python 3.12, FastAPI (`StreamingResponse`, `Query`), SQLAlchemy Core over Postgres, pytest + `TestClient` against the throwaway `intelli_test` database.

**Spec:** `docs/superpowers/specs/2026-06-18-phase-4d-export-design.md`

**Conventions to follow (read before starting):**
- Run everything inside the API container. Backend tests: `docker compose exec api pytest -q` (or a single file/test with `pytest path::name -v`). The backend must be running (`docker compose up -d`).
- The test harness (`api/tests/conftest.py`) builds `intelli_test`, applies migrations, and seeds once per session. Tests go **through the API** with the `client` + `login` fixtures. Tests do NOT roll back between cases and share one seeded DB, so **make assertions deterministic by filtering to data you create** (e.g. a uniquely-named survey + `survey_id` filter, or a pay period you create + `period_id` filter), never by total row counts.
- Seeded users (password `demo1234`): `dana@lumenbeauty.com` (admin, root), `sarah@lumenbeauty.com` (manager, Central), `marcus@lumenbeauty.com` (rep, Bay Area under West), `rico@lumenbeauty.com` (rep, Chicago under Central), `newbie@lumenbeauty.com` (rep, NO pin), `avery@acme.com` (admin, Acme, payroll OFF).
- Seeded nodes by `code`: `lumen-co`, `west`, `bayarea`, `sf` (chain CVS), `oakland` (chain Walmart), `central`, `chicago`, `chicago-store` (chain CVS); `acme-co`, `boston-store` (chain CVS).
- Seeded SKUs by `upc`: `LUM-VL-ROSE`, `LUM-VL-MAUVE`, `LUM-VL-CORAL`, `LUM-SF-IVORY`, `ACM-GS-ORIG`.
- Seeded payroll: Lumen payroll ON, period **"June 1-15"** (2026-06-01..2026-06-15, open) with entries for Marcus (pending) and Rico (approved). Acme payroll OFF.
- No em dashes anywhere (UI copy or comments).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `api/app/exports.py` | The export router: 3 endpoints, the `COLUMNS` lists, CSV streaming + cell rendering, filename, format/grain validation. | Create |
| `api/app/scope.py` | Add an "export" section to `ScopedRepo`: `export_compliance`, `export_responses`, `export_payroll`. | Modify |
| `api/app/main.py` | Mount the export router. | Modify |
| `api/tests/test_exports.py` | The 4d test gate (through-the-API). | Create |
| `api/README.md`, `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md` | Docs kept current. | Modify |
| `../hi-fi-intelli/Intelli_Complete_Handoff.md` | Prototype handoff CHANGELOG entry. | Modify |

`api/app/seed.py` is **not** changed: the existing seed has everything the tests need (the tests create their own surveys/periods where determinism matters).

---

## Task 1: Router scaffold + compliance export (the simplest dataset)

This stands up the whole router infrastructure (CSV helpers, `COLUMNS`, format switch, mount) against the easiest dataset, whose repo method is a one-line reuse of the existing analytics roll-up.

**Files:**
- Modify: `api/app/scope.py` (add the export section + `export_compliance`)
- Create: `api/app/exports.py`
- Modify: `api/app/main.py`
- Create: `api/tests/test_exports.py`

- [ ] **Step 1: Write the failing test (compliance parity, null-pct blank, 404, unpinned, format errors)**

Create `api/tests/test_exports.py`:

```python
"""Phase 4d: export. CSV downloads + a matching read-only JSON feed over the
responses, payroll, and compliance data. Branch-scoped through the ScopedRepo,
pass/fail computed live, no new tables. Tests go through the API and isolate to
data they create (the seeded DB is shared and not rolled back between tests)."""
import csv
import io

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


def _survey_id_of(vid):
    return _scalar("select survey_id from survey_versions where id = cast(:v as uuid)", v=str(vid))


def _publish_and_assign(client, admin_token, name, questions, target_code):
    """Create a survey, publish v1, assign it to target_code; return version id."""
    h = _auth(admin_token)
    survey = client.post("/surveys", headers=h,
                         json={"name": name, "type": None, "questions": questions}).json()
    client.post(f"/surveys/{survey['id']}/publish", headers=h)
    full = client.get(f"/surveys/{survey['id']}", headers=h).json()
    vid = next(v["id"] for v in full["versions"] if v["published_at"] is not None)
    client.post("/survey-assignments", headers=h,
                json={"survey_version_id": vid, "target_node_id": str(_node_id(target_code))})
    return vid


def _submit(client, token, vid, store_code, answers):
    return client.post("/responses", headers=_auth(token),
                       json={"survey_version_id": str(vid),
                             "store_node_id": str(_node_id(store_code)), "answers": answers})


def _grid(resp):
    """Parse a CSV response body into a list of rows (row 0 is the header)."""
    return list(csv.reader(io.StringIO(resp.text)))


def _rosewood_q():
    rose = _sku_id("LUM-VL-ROSE")
    return [{"id": "q1", "prompt": "facings?", "type": "number", "perSku": True,
             "sku_ids": [str(rose)], "pass": {"operator": ">=", "value": 4},
             "passScope": "each"}], rose


# ----- compliance export -----

def test_export_requires_auth(client):
    assert client.get("/export/compliance").status_code == 401


def test_compliance_export_matches_analytics(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Compliance", q, "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    node = str(_node_id("bayarea"))
    exp = client.get("/export/compliance", headers=_auth(dana),
                     params={"node_id": node}).json()["rows"]
    ana = client.get("/analytics/compliance", headers=_auth(dana),
                     params={"node_id": node}).json()["rows"]
    e = next(r for r in exp if r["survey_version_id"] == vid)
    a = next(r for r in ana if r["survey_version_id"] == vid)
    assert e == a  # identical rows, same brain


def test_compliance_export_null_pct_blank_not_zero(client, login):
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "Export Comp NoRule",
                              [{"id": "q1", "prompt": "note", "type": "text"}], "bayarea")
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "value": "ok"}])
    node = str(_node_id("bayarea"))
    e = next(r for r in client.get("/export/compliance", headers=_auth(dana),
                                   params={"node_id": node}).json()["rows"]
             if r["survey_version_id"] == vid)
    assert e["pass_pct"] is None
    grid = _grid(client.get("/export/compliance", headers=_auth(dana),
                            params={"node_id": node, "format": "csv"}))
    vidx, pidx = grid[0].index("survey_version_id"), grid[0].index("pass_pct")
    line = next(row for row in grid[1:] if row[vidx] == vid)
    assert line[pidx] == ""  # blank, never '0'


def test_compliance_export_node_out_of_scope_404(client, login):
    resp = client.get("/export/compliance", headers=_auth(login("sarah@lumenbeauty.com")),
                      params={"node_id": str(_node_id("bayarea"))})
    assert resp.status_code == 404, resp.text


def test_compliance_export_unpinned_caller_empty(client, login):
    body = client.get("/export/compliance",
                      headers=_auth(login("newbie@lumenbeauty.com"))).json()
    assert body == {"rows": [], "count": 0}


def test_bad_format_400(client, login):
    resp = client.get("/export/compliance", headers=_auth(login("dana@lumenbeauty.com")),
                      params={"format": "xml"})
    assert resp.status_code == 400, resp.text
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec api pytest api/tests/test_exports.py -q`
Expected: FAIL (404 from the router not existing yet, e.g. all `/export/...` return 404 / the assertions error).

- [ ] **Step 3: Add `export_compliance` to `ScopedRepo`**

In `api/app/scope.py`, immediately after the `list_audit` method (the end of the payroll section, around line 1129) and before the module-level `def _count_question`, add a new export section:

```python
    # ----- export (read-only flat rows for CSV + the read API; reuses the
    # existing scoped readers, so the export can never widen the scope) -----

    def export_compliance(self, node_id=None):
        """Flat per-assignment compliance roll-up for export. Reuses
        assignment_compliance unchanged, so the export and the dashboard never
        disagree (including pass_pct/completion_pct being None, not 0, when their
        denominator is 0). Returns None only if node_id is out of scope (-> 404);
        an unpinned caller gets []."""
        return self.assignment_compliance(node_id)
```

- [ ] **Step 4: Create the export router `api/app/exports.py`**

```python
"""Phase 4d: export. CSV downloads + a matching read-only JSON feed over the
responses, payroll, and compliance data. Each endpoint returns either a streamed
CSV (?format=csv) or JSON (?format=json, the default); the same ScopedRepo rows
feed both, so the file and the API are literally the same data. Read-only and
branch-scoped through the ScopedRepo, so no endpoint can widen the scope. No new
tables: this only reads what 4a/4b/4c already store.
"""
import csv
import io
import json
from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from .payroll import require_payroll
from .scope import ScopedRepo, get_scoped_repo
from .security import current_claims

router = APIRouter(prefix="/export", tags=["export"])

# One ordered column list per dataset/grain is the single source of truth for
# BOTH the CSV header/field order AND the JSON row key order, so they can never
# drift (the parity tests guard this).
RESPONSE_SUMMARY_COLUMNS = [
    "response_id", "store_node_id", "store_name", "chain", "survey_id",
    "survey_name", "survey_version_id", "version_number", "user_id",
    "submitted_at", "online", "overall", "num_passed", "num_failed",
]
RESPONSE_SKU_COLUMNS = [
    "response_id", "store_node_id", "store_name", "chain", "survey_name",
    "version_number", "submitted_at", "question_id", "sku_id", "sku_line",
    "sku_variant", "value", "item_pass",
]
PAYROLL_COLUMNS = [
    "entry_id", "period_id", "period_name", "start_date", "end_date",
    "period_status", "user_id", "rep_name", "rep_email", "store_min",
    "reset_min", "drive_min", "miles", "mgr_status", "sealed", "rep_node_name",
]
COMPLIANCE_COLUMNS = [
    "assignment_id", "survey_id", "survey_name", "survey_version_id",
    "target_node_id", "target_node_name", "expected", "responded", "scored",
    "passed", "completion_pct", "pass_pct",
]


def _csv_cell(value) -> str:
    """Render one value for a CSV cell. None -> empty (never 'false' or '0', so
    'not scored' stays blank); bool -> 'true'/'false'; date/datetime -> ISO (same
    text as the JSON feed); list/dict -> compact JSON (one column, one value)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, dict)):
        return json.dumps(value, separators=(",", ":"))
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _csv_response(columns, rows, filename) -> StreamingResponse:
    """Stream rows as CSV without building the whole file in memory: one StringIO
    buffer, written and flushed one row at a time. The header is yielded first, so
    an empty export still returns a valid header line and zero data rows."""
    buf = io.StringIO()
    writer = csv.writer(buf)

    def _flush() -> str:
        data = buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        return data

    def gen():
        writer.writerow(columns)
        yield _flush()
        for row in rows:
            writer.writerow([_csv_cell(row.get(c)) for c in columns])
            yield _flush()

    return StreamingResponse(
        gen(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _deliver(fmt, columns, rows, filename):
    """Return the rows as a CSV download or as JSON, by ?format. JSON rows are
    projected through `columns` so the JSON keys match the CSV header order."""
    if fmt == "csv":
        return _csv_response(columns, rows, filename)
    return {"rows": [{c: row.get(c) for c in columns} for row in rows], "count": len(rows)}


def _check_format(fmt):
    if fmt not in ("csv", "json"):
        raise HTTPException(status_code=400, detail="format must be csv or json")


def _date_tag(d) -> str:
    return d.isoformat() if d is not None else "all"


@router.get("/compliance")
def export_compliance(
    fmt: str = Query("json", alias="format"),
    node_id: UUID | None = None,
    repo: ScopedRepo = Depends(get_scoped_repo),
):
    _check_format(fmt)
    rows = repo.export_compliance(node_id)
    if rows is None:
        raise HTTPException(status_code=404, detail="Node not found in your scope")
    return _deliver(fmt, COMPLIANCE_COLUMNS, rows, "intelli_compliance.csv")
```

- [ ] **Step 5: Mount the router in `api/app/main.py`**

Add the import alongside the other routers (after the `payroll` import, line 16):

```python
from .exports import router as exports_router
```

And include it after `app.include_router(payroll_router)` (line 36):

```python
app.include_router(exports_router)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `docker compose exec api pytest api/tests/test_exports.py -q`
Expected: PASS (6 tests: auth, compliance parity, null-pct blank, 404, unpinned empty, bad-format 400).

- [ ] **Step 7: Commit**

```bash
git add api/app/exports.py api/app/scope.py api/app/main.py api/tests/test_exports.py
git commit -m "Phase 4d: export router scaffold + compliance CSV/JSON export

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Responses export (summary + per-SKU detail)

The headline dataset: two grains, live pass/fail from the full `evaluate_response`, the chain/date/survey/node/sku filters (all ANDed onto the scope filter), and the blank-not-false rule.

**Files:**
- Modify: `api/app/scope.py` (add `export_responses` to the export section)
- Modify: `api/app/exports.py` (add the `/export/responses` endpoint)
- Modify: `api/tests/test_exports.py` (add the responses tests)

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_exports.py`:

```python
# ----- responses export -----

def test_responses_format_parity(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Parity", q, "bayarea")
    sid = str(_survey_id_of(vid))
    marcus = login("marcus@lumenbeauty.com")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    _submit(client, marcus, vid, "oakland", [{"question_id": "q1", "sku_id": str(rose), "value": 2}])
    j = client.get("/export/responses", headers=_auth(dana), params={"survey_id": sid}).json()
    assert j["count"] == 2 == len(j["rows"])
    csv_resp = client.get("/export/responses", headers=_auth(dana),
                          params={"survey_id": sid, "format": "csv"})
    assert csv_resp.headers["content-type"].startswith("text/csv")
    grid = _grid(csv_resp)
    assert grid[0] == list(j["rows"][0].keys())   # CSV header == JSON keys (column order)
    assert len(grid) - 1 == j["count"]            # same row count


def test_responses_summary_verdicts(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Verdicts", q, "bayarea")
    sid = str(_survey_id_of(vid))
    marcus = login("marcus@lumenbeauty.com")
    _submit(client, marcus, vid, "sf", [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    _submit(client, marcus, vid, "oakland", [{"question_id": "q1", "sku_id": str(rose), "value": 2}])
    rows = client.get("/export/responses", headers=_auth(dana), params={"survey_id": sid}).json()["rows"]
    sf = next(r for r in rows if r["store_name"] == "SF store")
    assert sf["overall"] is True and sf["num_passed"] == 1 and sf["num_failed"] == 0
    oak = next(r for r in rows if r["store_name"] == "Oakland store")
    assert oak["overall"] is False and oak["num_passed"] == 0 and oak["num_failed"] == 1


def test_responses_sku_grain(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Sku Grain", q, "bayarea")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    rows = client.get("/export/responses", headers=_auth(dana),
                      params={"survey_id": sid, "grain": "sku"}).json()["rows"]
    item = next(r for r in rows if r["question_id"] == "q1")
    assert item["sku_id"] == str(rose)
    assert item["sku_line"] == "Velvet Lip"
    assert item["sku_variant"] == "Rosewood"
    assert item["value"] == 5
    assert item["item_pass"] is True


def test_responses_not_scored_blank_not_false(client, login):
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "Export No Rule",
                              [{"id": "q1", "prompt": "note", "type": "text"}], "bayarea")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "value": "looks ok"}])
    j = client.get("/export/responses", headers=_auth(dana), params={"survey_id": sid}).json()
    assert j["rows"][0]["overall"] is None
    js = client.get("/export/responses", headers=_auth(dana),
                    params={"survey_id": sid, "grain": "sku"}).json()
    assert js["rows"][0]["item_pass"] is None
    grid = _grid(client.get("/export/responses", headers=_auth(dana),
                            params={"survey_id": sid, "format": "csv"}))
    oidx = grid[0].index("overall")
    assert grid[1][oidx] == ""  # blank, never 'false'


def test_responses_multichoice_cell(client, login):
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "Export Multi",
                              [{"id": "q1", "prompt": "issues", "type": "multi_choice",
                                "options": ["a", "b", "c"]}], "bayarea")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "value": ["a", "b"]}])
    row = next(r for r in client.get("/export/responses", headers=_auth(dana),
                                     params={"survey_id": sid, "grain": "sku"}).json()["rows"]
               if r["question_id"] == "q1")
    assert row["value"] == ["a", "b"]      # real list in JSON
    assert row["sku_id"] is None           # not a per-product question
    grid = _grid(client.get("/export/responses", headers=_auth(dana),
                            params={"survey_id": sid, "grain": "sku", "format": "csv"}))
    vidx = grid[0].index("value")
    assert grid[1][vidx] == '["a","b"]'    # compact JSON in one CSV cell


def test_responses_empty_export(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Empty", q, "bayarea")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    j = client.get("/export/responses", headers=_auth(dana),
                   params={"survey_id": sid, "date_to": "2000-01-01T00:00:00Z"}).json()
    assert j == {"rows": [], "count": 0}
    grid = _grid(client.get("/export/responses", headers=_auth(dana),
                            params={"survey_id": sid, "date_to": "2000-01-01T00:00:00Z",
                                    "format": "csv"}))
    assert len(grid) == 1 and grid[0][0] == "response_id"  # header only


def test_responses_date_boundary_inclusive(client, login):
    # The seeded "Velvet Lip Shelf Check" has exactly one response at this instant.
    dana = login("dana@lumenbeauty.com")
    vlid = _scalar("select v.id from survey_versions v join surveys s on s.id = v.survey_id "
                   "where s.name = 'Velvet Lip Shelf Check' and v.published_at is not null limit 1")
    sid = str(_survey_id_of(vlid))
    on = client.get("/export/responses", headers=_auth(dana),
                    params={"survey_id": sid, "date_from": "2026-06-10T09:00:00Z",
                            "date_to": "2026-06-10T09:00:00Z"}).json()
    assert on["count"] == 1
    assert on["rows"][0]["submitted_at"].startswith("2026-06-10T09:00:00")
    off = client.get("/export/responses", headers=_auth(dana),
                     params={"survey_id": sid, "date_from": "2026-06-10T09:00:00Z",
                             "date_to": "2026-06-10T08:59:59Z"}).json()
    assert off["count"] == 0


def test_responses_sku_id_ignored_at_summary(client, login):
    dana = login("dana@lumenbeauty.com")
    q, rose = _rosewood_q()
    vid = _publish_and_assign(client, dana, "Export Sku Ignored", q, "bayarea")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "sku_id": str(rose), "value": 5}])
    base = client.get("/export/responses", headers=_auth(dana), params={"survey_id": sid}).json()
    withsku = client.get("/export/responses", headers=_auth(dana),
                         params={"survey_id": sid, "sku_id": str(rose)}).json()
    assert base["count"] == withsku["count"]  # sku_id has no effect at grain=summary


def test_responses_chain_does_not_leak_across_scope(client, login):
    dana = login("dana@lumenbeauty.com")
    vid = _publish_and_assign(client, dana, "Export Chain Leak",
                              [{"id": "q1", "prompt": "present?", "type": "boolean",
                                "pass": {"operator": "==", "value": True}}], "lumen-co")
    sid = str(_survey_id_of(vid))
    _submit(client, login("marcus@lumenbeauty.com"), vid, "sf",
            [{"question_id": "q1", "value": True}])           # CVS, Bay Area (West)
    _submit(client, login("rico@lumenbeauty.com"), vid, "chicago-store",
            [{"question_id": "q1", "value": True}])           # CVS, Chicago (Central)
    names = {r["store_name"] for r in client.get(
        "/export/responses", headers=_auth(login("sarah@lumenbeauty.com")),
        params={"survey_id": sid, "chain": "CVS"}).json()["rows"]}
    assert "Chicago store" in names      # in-scope CVS store included
    assert "SF store" not in names       # sibling-branch CVS store excluded


def test_responses_node_out_of_scope_404(client, login):
    resp = client.get("/export/responses", headers=_auth(login("sarah@lumenbeauty.com")),
                      params={"node_id": str(_node_id("bayarea"))})
    assert resp.status_code == 404, resp.text


def test_responses_unpinned_caller_empty(client, login):
    body = client.get("/export/responses", headers=_auth(login("newbie@lumenbeauty.com"))).json()
    assert body == {"rows": [], "count": 0}


def test_responses_bad_grain_400(client, login):
    resp = client.get("/export/responses", headers=_auth(login("dana@lumenbeauty.com")),
                      params={"grain": "weird"})
    assert resp.status_code == 400, resp.text
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `docker compose exec api pytest api/tests/test_exports.py -k responses -q`
Expected: FAIL (`/export/responses` endpoint does not exist yet -> 404, assertions error).

- [ ] **Step 3: Add `export_responses` to `ScopedRepo`**

In `api/app/scope.py`, in the export section (right after `export_compliance`), add:

```python
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
```

- [ ] **Step 4: Add the `/export/responses` endpoint to `api/app/exports.py`**

Add after the `export_compliance` endpoint:

```python
@router.get("/responses")
def export_responses(
    fmt: str = Query("json", alias="format"),
    grain: str = "summary",
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    survey_id: UUID | None = None,
    chain: str | None = None,
    node_id: UUID | None = None,
    sku_id: UUID | None = None,
    repo: ScopedRepo = Depends(get_scoped_repo),
):
    _check_format(fmt)
    if grain not in ("summary", "sku"):
        raise HTTPException(status_code=400, detail="grain must be summary or sku")
    rows = repo.export_responses(grain, date_from, date_to, survey_id, chain, node_id, sku_id)
    if rows is None:
        raise HTTPException(status_code=404, detail="Node not found in your scope")
    columns = RESPONSE_SUMMARY_COLUMNS if grain == "summary" else RESPONSE_SKU_COLUMNS
    filename = f"intelli_responses_{grain}_{_date_tag(date_from)}_{_date_tag(date_to)}.csv"
    return _deliver(fmt, columns, rows, filename)
```

- [ ] **Step 5: Run the responses tests to verify they pass**

Run: `docker compose exec api pytest api/tests/test_exports.py -k responses -q`
Expected: PASS (parity, verdicts, sku grain, blank-not-false, multichoice, empty, date boundary, sku_id-ignored, chain-leak, node 404, unpinned, bad grain).

- [ ] **Step 6: Commit**

```bash
git add api/app/exports.py api/app/scope.py api/tests/test_exports.py
git commit -m "Phase 4d: responses export (summary + per-SKU detail, CSV/JSON)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Payroll export

A new multi-join query reusing only `list_entries`' row-visibility rule, plus the company switch and the LEFT join so an unpinned rep is not dropped.

**Files:**
- Modify: `api/app/scope.py` (add `export_payroll` to the export section)
- Modify: `api/app/exports.py` (add the `/export/payroll` endpoint)
- Modify: `api/tests/test_exports.py` (add the payroll tests)

- [ ] **Step 1: Write the failing tests**

Append to `api/tests/test_exports.py`:

```python
# ----- payroll export -----

def _period_with_entries(client, login, start, end, name=None):
    """As admin, create a pay period; as Rico (Central) and Marcus (Bay Area)
    create their own entries. Returns the period id. Fully deterministic."""
    dana = login("dana@lumenbeauty.com")
    body = {"start_date": start, "end_date": end}
    if name:
        body["name"] = name
    pid = client.post("/pay-periods", headers=_auth(dana), json=body).json()["id"]
    client.post("/time-entries", headers=_auth(login("rico@lumenbeauty.com")),
                json={"period_id": pid, "store_min": 100, "reset_min": 10,
                      "drive_min": 20, "miles": 5})
    client.post("/time-entries", headers=_auth(login("marcus@lumenbeauty.com")),
                json={"period_id": pid, "store_min": 200, "reset_min": 20,
                      "drive_min": 30, "miles": 9})
    return pid


def test_payroll_manager_sees_only_branch(client, login):
    pid = _period_with_entries(client, login, "2026-07-01", "2026-07-15", "July 1-15")
    rows = client.get("/export/payroll", headers=_auth(login("sarah@lumenbeauty.com")),
                      params={"period_id": pid}).json()["rows"]
    assert {r["rep_email"] for r in rows} == {"rico@lumenbeauty.com"}  # Marcus (Bay Area) excluded
    r0 = rows[0]
    assert r0["period_name"] == "July 1-15"
    assert r0["start_date"] == "2026-07-01"
    assert r0["end_date"] == "2026-07-15"
    assert r0["period_status"] == "open"
    assert r0["rep_name"] == "Rico Vance"
    assert r0["rep_node_name"] == "Chicago"
    assert r0["miles"] == 5.0
    assert r0["mgr_status"] == "pending"
    assert r0["sealed"] is False


def test_payroll_rep_sees_only_own(client, login):
    pid = _period_with_entries(client, login, "2026-07-16", "2026-07-31")
    rows = client.get("/export/payroll", headers=_auth(login("marcus@lumenbeauty.com")),
                      params={"period_id": pid}).json()["rows"]
    assert {r["rep_email"] for r in rows} == {"marcus@lumenbeauty.com"}


def test_payroll_admin_sees_all(client, login):
    pid = _period_with_entries(client, login, "2026-08-01", "2026-08-15")
    rows = client.get("/export/payroll", headers=_auth(login("dana@lumenbeauty.com")),
                      params={"period_id": pid}).json()["rows"]
    assert {"rico@lumenbeauty.com", "marcus@lumenbeauty.com"} <= {r["rep_email"] for r in rows}


def test_payroll_unpinned_rep_exports_own_with_blank_node(client, login):
    dana = login("dana@lumenbeauty.com")
    pid = client.post("/pay-periods", headers=_auth(dana),
                      json={"start_date": "2026-09-01", "end_date": "2026-09-15"}).json()["id"]
    newbie = login("newbie@lumenbeauty.com")
    client.post("/time-entries", headers=_auth(newbie),
                json={"period_id": pid, "store_min": 60})
    rows = client.get("/export/payroll", headers=_auth(newbie),
                      params={"period_id": pid}).json()["rows"]
    assert len(rows) == 1
    assert rows[0]["rep_email"] == "newbie@lumenbeauty.com"
    assert rows[0]["rep_node_name"] is None  # unpinned -> blank, but row is present


def test_payroll_off_company_403(client, login):
    resp = client.get("/export/payroll", headers=_auth(login("avery@acme.com")))
    assert resp.status_code == 403, resp.text


def test_payroll_csv_parity(client, login):
    pid = _period_with_entries(client, login, "2026-10-01", "2026-10-15")
    dana = login("dana@lumenbeauty.com")
    j = client.get("/export/payroll", headers=_auth(dana), params={"period_id": pid}).json()
    grid = _grid(client.get("/export/payroll", headers=_auth(dana),
                            params={"period_id": pid, "format": "csv"}))
    assert grid[0] == list(j["rows"][0].keys())
    assert len(grid) - 1 == j["count"]
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `docker compose exec api pytest api/tests/test_exports.py -k payroll -q`
Expected: FAIL (`/export/payroll` endpoint does not exist yet).

- [ ] **Step 3: Add `export_payroll` to `ScopedRepo`**

In `api/app/scope.py`, in the export section (after `export_responses`), add:

```python
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
```

- [ ] **Step 4: Add the `/export/payroll` endpoint to `api/app/exports.py`**

Add after the `/export/responses` endpoint:

```python
@router.get("/payroll")
def export_payroll(
    fmt: str = Query("json", alias="format"),
    period_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    node_id: UUID | None = None,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(current_claims),
    _payroll: dict = Depends(require_payroll),  # 403 if the company has payroll off
):
    _check_format(fmt)
    rows = repo.export_payroll(claims["sub"], claims["role"], period_id,
                               date_from, date_to, node_id)
    if rows is None:
        raise HTTPException(status_code=404, detail="Node not found in your scope")
    tag = f"period-{period_id}" if period_id is not None else f"{_date_tag(date_from)}_{_date_tag(date_to)}"
    return _deliver(fmt, PAYROLL_COLUMNS, rows, f"intelli_payroll_{tag}.csv")
```

- [ ] **Step 5: Run the payroll tests to verify they pass**

Run: `docker compose exec api pytest api/tests/test_exports.py -k payroll -q`
Expected: PASS (manager-branch, rep-own, admin-all, unpinned-blank-node, payroll-off 403, csv parity).

- [ ] **Step 6: Run the full export suite**

Run: `docker compose exec api pytest api/tests/test_exports.py -q`
Expected: PASS (all export tests across the three datasets).

- [ ] **Step 7: Commit**

```bash
git add api/app/exports.py api/app/scope.py api/tests/test_exports.py
git commit -m "Phase 4d: payroll export (role-scoped, company-switch gated, CSV/JSON)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Full-suite verification + docs

**Files:**
- Modify: `api/README.md`, `CODEBASE_MAP.md`, `CHECKING_THE_WORK.md`, `START_HERE.md`, `CONTEXT.md`
- Modify: `../hi-fi-intelli/Intelli_Complete_Handoff.md`

- [ ] **Step 1: Run the full backend suite (the gate)**

Run: `docker compose exec api pytest -q`
Expected: PASS, all backend tests (the prior count plus the new export tests). Note the new total in the docs below.

- [ ] **Step 2: Run the frontend checks (must stay green)**

Run: `pnpm test:admin`
Expected: PASS (27 frontend checks unchanged).

- [ ] **Step 3: Update `api/README.md`**

Add an `exports.py` entry to the backend file guide, in the same plain style as the `analytics.py` / `payroll.py` entries: explain that it serves `/export/responses`, `/export/payroll`, and `/export/compliance`, each as a CSV download or JSON via `?format=`, all branch-scoped through the `ScopedRepo`, reusing the login token, with no new tables.

- [ ] **Step 4: Update `CODEBASE_MAP.md`**

Add an "As of Phase 4d" paragraph after the Phase 4c paragraph (around line 61-68), in plain terms: the backend can now export the responses, payroll, and compliance data as CSV files or the same data as JSON, filtered by date / survey / chain / node / product, branch-scoped, with `api/app/exports.py` linked.

- [ ] **Step 5: Update `CHECKING_THE_WORK.md`**

Add a short "Phase 4d (export)" section telling Tanya how to see it with no coding: in the API docs (`http://localhost:8000/docs`) open `GET /export/responses`, "Try it out", and download the CSV or read the JSON; mention `?format=csv` vs `?format=json`, and that a manager only ever gets their own branch.

- [ ] **Step 6: Update `START_HERE.md`**

In section 1, add a "Phase 4d (export, done)" bullet after the 4c bullet, and update section 7 ("Where we are right now") so the status line reads that Phases 1-4d are complete and the next is Phase 5 (Field app + offline sync). Update the backend check count to the new total from Step 1.

- [ ] **Step 7: Update `CONTEXT.md`**

Flip `- [ ] **Phase 4d** - export.` to `- [x]` (line 36), and add a progress-log entry dated 2026-06-18 summarizing 4d (three export endpoints, CSV + JSON via `?format=`, responses summary + per-SKU with live pass/fail, payroll role-scoped + company-switch gated, compliance reuses the 4b roll-up, login-token auth, no new tables, the new test count, frontend still 27).

- [ ] **Step 8: Update the prototype handoff CHANGELOG**

In `../hi-fi-intelli/Intelli_Complete_Handoff.md`, add a newest-first entry dated **2026-06-18 (production: Phase 4d complete)** describing the export layer in the same voice as the 4c entry, and noting Phase 5 (Field app + offline sync) is next.

- [ ] **Step 9: Commit the docs**

```bash
git add api/README.md CODEBASE_MAP.md CHECKING_THE_WORK.md START_HERE.md CONTEXT.md
git commit -m "Docs: Phase 4d export (guides + status + progress log)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git -C ../hi-fi-intelli add Intelli_Complete_Handoff.md
git -C ../hi-fi-intelli commit -m "Docs: Phase 4d export complete (production handoff CHANGELOG)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Three domains (responses summary + per-SKU, payroll, compliance): Tasks 2, 3, 1. ✓
- One feed two shapes (`?format=csv|json`): `_deliver` in Task 1; tested by the parity tests. ✓
- Login-token auth (no new tables): no auth change; `get_scoped_repo` reused; `require_payroll` imported. ✓
- Live pass/fail in responses, blank not false: Task 2 `export_responses` + `_csv_cell`; `test_responses_not_scored_blank_not_false`. ✓
- Branch scope + 404 / unpinned 200: every method reuses the scope filter; `test_*_node_out_of_scope_404`, `test_*_unpinned_caller_empty`. ✓
- Chain ANDed onto scope: `export_responses` chain clause; `test_responses_chain_does_not_leak_across_scope`. ✓
- Date inclusive + deterministic filename: `export_responses` date clauses + `_date_tag`; `test_responses_date_boundary_inclusive`. ✓
- Payroll new joins + LEFT join for unpinned + company switch + role scope: Task 3; `test_payroll_*`. ✓
- Compliance == dashboard incl. null pct blank: Task 1; `test_compliance_export_matches_analytics`, `test_compliance_export_null_pct_blank_not_zero`. ✓
- CSV streaming recipe + single COLUMNS source of truth: `_csv_response`, `_deliver`. ✓
- Empty export keeps header: `test_responses_empty_export`. ✓
- Docs updated: Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test shows complete asserts. ✓

**Type/name consistency:** `export_compliance`/`export_responses`/`export_payroll` signatures match between `scope.py` and the endpoints; `COLUMNS` names match the dict keys built in the repo methods; `_check_format`/`_deliver`/`_date_tag`/`_csv_cell`/`_csv_response` defined once in Task 1 and used in Tasks 2-3. The `fmt`/`Query(alias="format")` and `require_payroll` import are consistent. ✓
