# Settings Screen Design Spec

**Date:** 2026-06-25
**Screen:** Admin Settings (`/settings`)
**Status:** Approved (based on settings-mockup.html)

---

## What this screen does

The Settings screen lets an admin edit their company's basic configuration. It
ports the prototype `apps/admin/screens/settings.jsx`, scoped down to what the
real backend stores today (the "lean and honest" choice). It drops the
`comingSoon` flag from the `settings` nav item.

Only two things are genuinely editable and saved in v1:

- **Company name** (`tenants.name`).
- **Payroll on/off** (`tenants.payroll_enabled`), which genuinely controls whether
  the Payroll screen and its backend actions are available.

Everything else from the prototype (pay-period defaults, work model, store-chain
logos, audit log, data & security) is shown as a clearly-labelled "coming soon"
section so the screen looks complete without faking any data.

---

## Backend brick (built in the MAIN folder, test-first)

The `tenants` table already exists with `id, name, code, payroll_enabled`. No
migration is needed. We add two endpoints through the existing `ScopedRepo` so the
caller only ever reads/writes their own company.

### GET /tenants  (any signed-in user)

Returns the caller's company config (a single object, since a caller belongs to
exactly one tenant). Works for any signed-in user, including an unpinned one
(`tenant_id` comes from the JWT, not from a pin).

Response:

```
{ "id", "name", "code", "payroll_enabled" }
```

### PATCH /tenants  (admin only)

Updates the caller's company config. `require_admin` gates it. Body (all optional,
at least one required):

```
{ "name", "payroll_enabled" }
```

Behaviour:

- `name`, when given, has a minimum length of 1.
- `payroll_enabled`, when given, is a boolean.
- `code` is **not** patchable (it is a permanent internal id).
- Always scoped to `self.tenant_id`, so an admin can only ever edit their own
  company. Returns the updated object (200) in the GET shape.

### ScopedRepo additions

`get_tenant()` and `update_tenant(fields)`, both filtered by `self.tenant_id`
(tenant-scoped, like the catalog list).

### Tests (api/tests/test_tenants.py)

Any user reads their own company (admin, manager, rep, and an unpinned user all
get a 200 with their company); company isolation (the returned object is always
the caller's tenant, never another); admin-only PATCH (manager/rep -> 403);
`payroll_enabled` round-trips (set true/false and read it back); `name` round-trips
and rejects empty (-> 422); `code` cannot be changed (ignored or rejected);
patching with no fields -> 422; an unpinned admin can still read and patch (this is
company config, not branch data).

---

## Screen layout (frontend)

New folder `apps/admin/src/pages/Settings/`:

- `Settings.tsx` - the page: topbar (title, "Save changes" button that enables when
  something changed), a left section nav, and the active panel. Tracks unsaved
  edits and PATCHes only the changed fields on Save.
- `useSettings.ts` - TypeScript types + the data hook (GET /tenants) + the patch
  mutation (via `apiSend`) + a small "is dirty" helper, unit-tested.
- `CompanyPanel.tsx` - editable company name, read-only company code.
- `PayrollPanel.tsx` - the on/off switch (real) with an explanation of what it
  controls, plus a greyed "pay-period defaults, coming soon" sub-card.
- `ComingSoonPanel.tsx` - a reusable placeholder panel (icon, title, description,
  "coming soon" chip), used for Work model, Store logos, Audit log, and Data &
  security sections.
- `*.module.css` + tests.

Section nav order: Company, Payroll, then a divider, then the four "soon" sections
(Work model, Store logos, Audit log, Data & security), each with a "soon" tag.

On Save: PATCH /tenants with only the changed fields, invalidate the tenants query,
show a "Settings saved" toast. On success the screen also updates the session's
stored `company_name` so the sidebar reflects a rename without requiring re-login.

---

## Role rules (frontend gating; backend is the real guard)

| Action | admin | manager | rep |
|---|---|---|---|
| View Settings | yes | yes | yes |
| Edit company name / payroll switch | yes | no | no |

Non-admins see the screen read-only (inputs disabled, no Save button), matching the
Catalog read-only pattern. The backend enforces the real rule (403 on PATCH for
non-admins).

---

## Interaction with the Payroll screen

Turning payroll off via this screen sets `tenants.payroll_enabled = false`. The
existing Payroll screen already handles this: its endpoints return 403 when payroll
is off, and the screen shows its "payroll not enabled" state. Turning it back on
restores the Payroll screen. This is the real, wired behaviour, not a mock.

---

## Deferred (out of scope for this screen, shown honestly as "coming soon")

- **Pay-period defaults** (length, cutoff day/time, timezone). The real payroll
  engine sets these per period; tenant-level defaults wait until "create a pay
  period" exists in the UI. No tenant columns for these yet.
- **Work model** (assigned / flexible / per-team). Reshapes the Manager and Field
  apps, so it lands with those tracks.
- **Store chain logos.** Needs image storage (arrives with shelf photos, 5-BE-c).
- **Audit log** as a unified company feed. The payroll audit already exists on the
  Payroll screen; a company-wide feed is a fast-follow.
- **Data & security** read-only summary panel (a display-only fast-follow).
