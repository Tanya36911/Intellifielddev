"""The payroll API. Pay periods are company-wide and admin-created; reps log
their own hours; managers approve their branch; an admin seals at the cutoff and
is the only one who can do the audit-logged reopen-for-one-rep. The whole surface
is gated by a per-company payroll switch (require_payroll).
"""
from datetime import date, datetime
from uuid import UUID

from sqlalchemy import text
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from .db import engine
from .scope import (
    EntryExistsError,
    EntrySealedError,
    PeriodNotSealedError,
    PeriodSealedError,
    RepEntriesNotFoundError,
    ScopedRepo,
    get_scoped_repo,
)
from .security import current_claims, require_admin, require_manager_or_admin

router = APIRouter(tags=["payroll"])


def require_payroll(claims: dict = Depends(current_claims)) -> dict:
    """Allow the request only if the caller's company has payroll switched on,
    else 403. Applied to every payroll endpoint."""
    with engine.connect() as conn:
        enabled = conn.execute(
            text("select payroll_enabled from tenants where id = cast(:tid as uuid)"),
            {"tid": str(claims["tenant_id"])},
        ).scalar()
    if not enabled:
        raise HTTPException(status_code=403, detail="Payroll is not enabled for this company")
    return claims


class PayPeriodCreate(BaseModel):
    name: str | None = None
    start_date: date
    end_date: date
    cutoff_at: datetime | None = None
    timezone_basis: str | None = None
    grace_hours: int = 0
    lock_behavior: str = "manual"

    @model_validator(mode="after")
    def _end_after_start(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")
        return self


@router.post("/pay-periods")
def create_pay_period(
    body: PayPeriodCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(require_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    return repo.create_pay_period(body.name, body.start_date, body.end_date, body.cutoff_at,
                                  body.timezone_basis, body.grace_hours, body.lock_behavior,
                                  claims["sub"])


@router.get("/pay-periods")
def list_pay_periods(
    repo: ScopedRepo = Depends(get_scoped_repo),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    rows = repo.list_pay_periods()
    return {"pay_periods": rows, "count": len(rows)}


class TimeEntryFields(BaseModel):
    store_min: int = 0
    reset_min: int = 0
    drive_min: int = 0
    miles: float = 0


class TimeEntryCreate(TimeEntryFields):
    period_id: UUID
    idempotency_key: UUID | None = None


def _fields(body: TimeEntryFields) -> dict:
    return {"store_min": body.store_min, "reset_min": body.reset_min,
            "drive_min": body.drive_min, "miles": body.miles}


@router.post("/time-entries")
def create_time_entry(
    body: TimeEntryCreate,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(current_claims),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    try:
        result = repo.create_time_entry(body.period_id, claims["sub"], _fields(body),
                                        body.idempotency_key)
    except PeriodSealedError:
        raise HTTPException(status_code=409, detail="This pay period is sealed")
    except EntryExistsError:
        raise HTTPException(status_code=409, detail="You already have an entry for this period")
    if result is None:
        raise HTTPException(status_code=404, detail="Pay period not found")
    return result


@router.patch("/time-entries/{entry_id}")
def update_time_entry(
    entry_id: UUID,
    body: TimeEntryFields,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(current_claims),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    try:
        result = repo.update_time_entry(entry_id, claims["sub"], _fields(body))
    except EntrySealedError:
        raise HTTPException(status_code=409, detail="This entry is sealed")
    if result is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result


@router.get("/pay-periods/{period_id}/entries")
def list_entries(
    period_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(current_claims),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    rows = repo.list_entries(period_id, claims["sub"], claims["role"])
    if rows is None:
        raise HTTPException(status_code=404, detail="Pay period not found")
    return {"entries": rows, "count": len(rows)}


def _set_status(repo: ScopedRepo, entry_id: UUID, status: str) -> dict:
    try:
        result = repo.set_entry_status(entry_id, status)
    except EntrySealedError:
        raise HTTPException(status_code=409, detail="This entry is sealed")
    if result is None:
        raise HTTPException(status_code=404, detail="Entry not found in your scope")
    return result


@router.post("/time-entries/{entry_id}/approve")
def approve_entry(
    entry_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _claims: dict = Depends(require_manager_or_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    return _set_status(repo, entry_id, "approved")


@router.post("/time-entries/{entry_id}/reject")
def reject_entry(
    entry_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    _claims: dict = Depends(require_manager_or_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    return _set_status(repo, entry_id, "rejected")


class ReopenBody(BaseModel):
    user_id: UUID
    reason: str = Field(min_length=1)


@router.post("/pay-periods/{period_id}/seal")
def seal_period(
    period_id: UUID,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(require_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    result = repo.seal_period(period_id, claims["sub"])
    if result is None:
        raise HTTPException(status_code=404, detail="Pay period not found")
    return result


@router.post("/pay-periods/{period_id}/reopen")
def reopen_period(
    period_id: UUID,
    body: ReopenBody,
    repo: ScopedRepo = Depends(get_scoped_repo),
    claims: dict = Depends(require_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    try:
        result = repo.reopen_period(period_id, body.user_id, body.reason, claims["sub"])
    except PeriodNotSealedError:
        raise HTTPException(status_code=409, detail="This pay period is not sealed")
    except RepEntriesNotFoundError:
        raise HTTPException(status_code=404, detail="That rep has no entries in this pay period")
    if result is None:
        raise HTTPException(status_code=404, detail="Pay period not found")
    return result


@router.get("/audit")
def get_audit(
    repo: ScopedRepo = Depends(get_scoped_repo),
    _claims: dict = Depends(require_admin),
    _payroll: dict = Depends(require_payroll),
) -> dict:
    rows = repo.list_audit()
    return {"audit": rows, "count": len(rows)}
