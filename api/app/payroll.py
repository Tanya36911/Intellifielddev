"""The payroll API. Pay periods are company-wide and admin-created; reps log
their own hours; managers approve their branch; an admin seals at the cutoff and
is the only one who can do the audit-logged reopen-for-one-rep. The whole surface
is gated by a per-company payroll switch (require_payroll).
"""
from datetime import date, datetime

from sqlalchemy import text
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator

from .db import engine
from .scope import ScopedRepo, get_scoped_repo
from .security import current_claims, require_admin

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
