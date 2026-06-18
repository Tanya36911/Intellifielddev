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
