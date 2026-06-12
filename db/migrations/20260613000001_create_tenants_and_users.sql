-- migrate:up

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

-- migrate:down
drop table users;
drop table tenants;
