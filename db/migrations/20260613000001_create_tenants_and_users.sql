-- migrate:up transaction:false
-- transaction:false tells dbmate not to add its own transaction, because this
-- script manages its own (BEGIN/COMMIT below). That makes the file safe to run
-- either by dbmate or by hand with psql. Error-stop is enforced by the runner
-- (the deploy script uses psql -v ON_ERROR_STOP=1, and dbmate aborts on error);
-- a psql \set cannot live here without breaking dbmate.
begin;
set local timezone = 'UTC';

-- A tenant = one brand/company using Intelli (e.g. Lumen Beauty, Revlon).
-- EVERYTHING in the system belongs to exactly one tenant.
create table tenants (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    code        text not null unique,
    created_at  timestamptz not null default now()
);

-- A user belongs to one tenant and has one of the three fixed roles.
-- Email is unique PER TENANT (two different brands could both have a
-- "dana@..."), never globally.
create table users (
    id             uuid primary key default gen_random_uuid(),
    tenant_id      uuid not null references tenants(id),
    email          text not null,
    name           text not null,
    role           text not null check (role in ('admin', 'manager', 'rep')),
    password_hash  text not null,
    created_at     timestamptz not null default now(),
    unique (tenant_id, email)
);

commit;

-- migrate:down transaction:false
begin;
set local timezone = 'UTC';
drop table users;
drop table tenants;
commit;
