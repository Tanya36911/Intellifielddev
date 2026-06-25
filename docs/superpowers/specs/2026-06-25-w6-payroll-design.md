# W6 Payroll Screen Design Spec

**Date:** 2026-06-25
**Screen:** Admin Payroll (`/payroll`)
**Status:** Implementation complete

---

## What this screen does

The Payroll screen lets admins and managers review and approve rep field-time entries for a pay period. Admins can create periods and seal them (lock all entries permanently). If a sealed entry needs a correction, an admin can reopen just that one rep's entry with a required reason that goes into an audit log.

---

## Pages and states

### Open period view
- A countdown card (monospace timer counting down to the period cutoff)
- Four stat tiles in a 2x2 grid: Pending (amber), Flagged (red), Approved (green), Reimbursable mileage (neutral)
- An hours table with one row per rep: visits, store hours, reset hours, drive hours, miles, status chip, and action buttons
- Approve and Flag actions on pending rows; Clear and approve on flagged rows; Flag only on approved rows
- A flagged row shows a red sub-row with the flag reason
- A Seal period button (disabled until every entry is approved; admin-only)

### Sealed period view
- A lock banner showing the period is locked, the total hours and miles
- The same table but with Reopen buttons instead of approve/flag (admin-only)
- A Reopen audit log card listing every reopen on this period

---

## Role rules

| Action | admin | manager | rep |
|---|---|---|---|
| View screen | yes | yes | no |
| Approve / Flag entries | yes | yes | no |
| Seal period | yes | no | no |
| Reopen one rep | yes | no | no |
| Read audit log | yes | no | no |
| Download CSV | yes | yes | no |

Non-admin controls (Seal, Reopen, audit log) are hidden rather than disabled.

---

## Payroll-disabled state

If the company has payroll switched off, the backend returns 403 on all endpoints. The screen shows a "Payroll is not enabled for this company" empty state instead of content.

---

## API endpoints used

All endpoints already exist in the backend.

| Method | Path | Purpose |
|---|---|---|
| GET | `/pay-periods` | List all periods |
| POST | `/pay-periods` | Create a new period (admin only) |
| GET | `/time-entries?period_id=X` | Get entries for a period |
| POST | `/time-entries/:id/approve` | Approve one entry |
| POST | `/time-entries/:id/reject` | Flag one entry |
| POST | `/pay-periods/:id/seal` | Seal a period (admin only) |
| POST | `/time-entries/:id/reopen` | Reopen one entry (admin only) |
| GET | `/audit?period_id=X` | Get the reopen audit log (admin only) |
| GET | `/export/payroll?format=csv` | Download CSV |

---

## Nav placement

Payroll is a new sidebar item in the `main` group, after Catalog. Icon: `dollar`. Route: `/payroll`. No `comingSoon` flag.

---

## Deferred (out of scope for W6)

- Per-rep hour drill-in detail modal
- Inline hour editing
- Creating new pay periods via the UI (POST /pay-periods)
