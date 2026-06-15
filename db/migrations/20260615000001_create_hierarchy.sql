-- migrate:up

-- The names of the org-chart levels for a tenant (configurable per tenant).
-- Lumen example: 0 Company, 1 Region, 2 District, 3 Store.
create table org_level_definitions (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    level_order int not null,
    name        text not null,
    locked      boolean not null default false,
    unique (tenant_id, level_order)
);

-- The org tree. One row per spot (company root, region, district, store).
-- path is a materialized trail of ids from the top down to this node, like
-- /<rootid>/<regionid>/<districtid>/ , always starting and ending with a
-- slash. The subtree under a node X is every row whose path starts with
-- X.path. The slashes stop a short id from matching a longer one.
create table nodes (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    parent_id   uuid references nodes(id),
    level_order int not null,
    name        text not null,
    code        text not null,
    path        text not null default '',
    chain       text,
    address     text,
    lat         double precision,
    lng         double precision,
    tz          text,
    created_at  timestamptz not null default now(),
    unique (tenant_id, code)
);

-- "everything under here" prefix lookups: text_pattern_ops makes the btree
-- usable for path LIKE 'prefix%'.
create index nodes_path_idx on nodes (path text_pattern_ops);
create index nodes_tenant_parent_idx on nodes (tenant_id, parent_id);

-- The pin: which user sits at which node. One per user in v1.
create table assignments (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    user_id     uuid not null references users(id),
    node_id     uuid not null references nodes(id),
    created_at  timestamptz not null default now(),
    unique (tenant_id, user_id)
);

-- migrate:down
drop table assignments;
drop table nodes;
drop table org_level_definitions;
