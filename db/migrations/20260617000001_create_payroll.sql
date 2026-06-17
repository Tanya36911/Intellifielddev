-- migrate:up transaction:false
-- transaction:false: dbmate skips its own transaction so this file can manage
-- its own (BEGIN/COMMIT), making it safe under dbmate or hand-run psql.
-- Error-stop is enforced by the runner (deploy script: psql -v ON_ERROR_STOP=1).
begin;
set local timezone = 'UTC';

-- Payroll is a per-company switch (handoff PART 6). Off by default; the seed
-- turns it on for companies that use Intelli for payroll.
alter table tenants add column payroll_enabled boolean not null default false;

-- A pay period is company-wide: a date range with a cutoff and a sealed/open
-- status. cutoff_at/timezone_basis/grace_hours/lock_behavior are the configured
-- policy; v1 seals manually (no auto-clock). sealed_at is stamped on first seal.
create table pay_periods (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id),
    name            text,
    start_date      date not null,
    end_date        date not null,
    cutoff_at       timestamptz,
    timezone_basis  text,
    grace_hours     int not null default 0,
    lock_behavior   text not null default 'manual',
    status          text not null default 'open' check (status in ('open', 'sealed')),
    sealed_at       timestamptz,
    created_at      timestamptz not null default now(),
    check (end_date >= start_date)
);
create index pay_periods_tenant_idx on pay_periods (tenant_id);

-- One row per rep per period, holding that rep's totals. The per-entry `sealed`
-- flag is the lock: sealing a period sets every entry true; reopening one rep
-- clears just that rep's flag; a re-seal sets them true again.
-- tenant_id is denormalized (derivable via period_id) so the tenant filter is a
-- direct column, matching how responses/response_items carry tenant_id.
create table time_entries (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    period_id   uuid not null references pay_periods(id),
    user_id     uuid not null references users(id),
    store_min   int not null default 0,
    reset_min   int not null default 0,
    drive_min   int not null default 0,
    -- miles driven (unbounded numeric; precision left to the app)
    miles       numeric not null default 0,
    mgr_status  text not null default 'pending'
                check (mgr_status in ('pending', 'approved', 'rejected')),
    sealed      boolean not null default false,
    created_at  timestamptz not null default now(),
    unique (period_id, user_id)
);
create index time_entries_tenant_idx on time_entries (tenant_id);
create index time_entries_period_idx on time_entries (period_id);
create index time_entries_user_idx on time_entries (user_id);

-- The permanent logbook for sensitive actions (pay_period.created / .sealed /
-- .reopened). Append-only in practice; never updated.
create table audit (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id),
    actor_user_id   uuid not null references users(id),
    action          text not null,
    target          text,
    detail          jsonb not null default '{}'::jsonb,
    at              timestamptz not null default now()
);
create index audit_tenant_at_idx on audit (tenant_id, at);

commit;

-- migrate:down transaction:false
begin;
set local timezone = 'UTC';
drop table audit;
drop table time_entries;
drop table pay_periods;
alter table tenants drop column payroll_enabled;
commit;
