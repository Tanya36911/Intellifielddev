-- migrate:up transaction:false
-- transaction:false: dbmate skips its own transaction so this file can manage
-- its own (BEGIN/COMMIT), making it safe under dbmate or hand-run psql.
-- Error-stop is enforced by the runner (deploy script: psql -v ON_ERROR_STOP=1).
begin;
set local timezone = 'UTC';

-- The product catalog. One row per sellable variant ("SKU"), e.g. Lumen's
-- Velvet Lip in Rosewood. Company-wide (every user in the tenant sees all of
-- its rows); never visible across tenants. Uniqueness is per tenant by UPC.
create table skus (
    id                uuid primary key default gen_random_uuid(),
    tenant_id         uuid not null references tenants(id),
    line              text not null,
    variant           text not null,
    upc               text not null,
    color             text,
    status            text not null default 'active'
                      check (status in ('active', 'discontinued')),
    reference_images  jsonb not null default '[]'::jsonb,
    created_at        timestamptz not null default now(),
    unique (tenant_id, upc)
);

create index skus_tenant_idx on skus (tenant_id);

commit;

-- migrate:down transaction:false
begin;
set local timezone = 'UTC';
drop table skus;
commit;
