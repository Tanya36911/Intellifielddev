-- migrate:up transaction:false
-- transaction:false: dbmate skips its own transaction so this file can manage
-- its own (BEGIN/COMMIT), making it safe under dbmate or hand-run psql.
-- Error-stop is enforced by the runner (deploy script: psql -v ON_ERROR_STOP=1).
begin;
set local timezone = 'UTC';

-- One row per completed submission of a survey at a store (the "envelope").
-- store_path is a SNAPSHOT of the store's place in the org tree at submit time
-- (the SCD Type 2 freeze): history stays bucketed where it was collected even
-- if the store is re-parented later. online is always true in Phase 4a; it is
-- here for Phase 5 offline sync to mark records that arrived after the fact.
create table responses (
    id                 uuid primary key default gen_random_uuid(),
    tenant_id          uuid not null references tenants(id),
    survey_version_id  uuid not null references survey_versions(id),
    store_node_id      uuid not null references nodes(id),
    store_path         text not null,
    user_id            uuid not null references users(id),
    online             boolean not null default true,
    submitted_at       timestamptz not null default now(),
    created_at         timestamptz not null default now()
);
create index responses_tenant_idx on responses (tenant_id);
create index responses_store_idx on responses (store_node_id);
create index responses_version_idx on responses (survey_version_id);
create index responses_submitted_idx on responses (submitted_at);

-- The atomic answer rows: one per (response, question, product). A non-per-
-- product question makes one row with sku_id NULL; a per-product question makes
-- one row per product. value holds ONLY the raw answer (number, bool, choice,
-- list, text, or photo url). There is deliberately NO pass/fail column: the
-- verdict is always recomputed at read time from the version's rules.
-- tenant_id/store_node_id/store_path/survey_version_id/submitted_at are
-- denormalized so Phase 4b analytics is one indexed scan, no joins.
create table response_items (
    id                 uuid primary key default gen_random_uuid(),
    response_id        uuid not null references responses(id) on delete cascade,
    tenant_id          uuid not null references tenants(id),
    store_node_id      uuid not null references nodes(id),
    store_path         text not null,
    survey_version_id  uuid not null references survey_versions(id),
    submitted_at       timestamptz not null default now(),
    -- question_id is text, not a foreign key, on purpose: questions live as
    -- embedded JSON inside survey_versions.questions, not in their own table.
    question_id        text not null,
    -- sku_id references skus(id) with the default ON DELETE RESTRICT on purpose:
    -- a product with historical responses cannot be hard-deleted (PART 7,
    -- "nothing deleted"; the catalog retires products via status, never delete),
    -- so which product an answer was about is preserved for analytics forever.
    sku_id             uuid references skus(id),
    value              jsonb not null
);
create index response_items_response_idx on response_items (response_id);
create index response_items_store_idx on response_items (tenant_id, store_node_id);
create index response_items_sku_time_idx on response_items (tenant_id, sku_id, submitted_at);
create index response_items_question_idx on response_items (tenant_id, question_id);

commit;

-- migrate:down transaction:false
begin;
set local timezone = 'UTC';
drop table response_items;
drop table responses;
commit;
