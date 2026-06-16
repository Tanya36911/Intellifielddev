-- migrate:up transaction:false
-- transaction:false: dbmate skips its own transaction so this file can manage
-- its own (BEGIN/COMMIT), making it safe under dbmate or hand-run psql.
-- Error-stop is enforced by the runner (deploy script: psql -v ON_ERROR_STOP=1).
begin;
set local timezone = 'UTC';

-- A survey is a named checklist a rep fills out in a store. The survey row is
-- the identity; its questions live in survey_versions. status is the lifecycle
-- marker (draft until first publish, then published, or archived when retired).
create table surveys (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    name        text not null,
    type        text,
    status      text not null default 'draft'
                check (status in ('draft', 'published', 'archived')),
    created_at  timestamptz not null default now()
);
create index surveys_tenant_idx on surveys (tenant_id);

-- A frozen snapshot of a survey's questions. published_at NULL = an editable
-- draft; once set, the row is immutable (enforced in the app layer). Editing a
-- published survey adds a NEW version rather than changing an old one, so past
-- results (Phase 4) are never silently rewritten.
create table survey_versions (
    id              uuid primary key default gen_random_uuid(),
    survey_id       uuid not null references surveys(id),
    version_number  int not null,
    questions       jsonb not null default '[]'::jsonb,
    published_at    timestamptz,
    created_at      timestamptz not null default now(),
    unique (survey_id, version_number)
);
create index survey_versions_survey_idx on survey_versions (survey_id);

-- Points a published version at one org node with an optional deadline. Coverage
-- ("which stores?") is computed live from the node's path, not copied, so stores
-- added later are automatically included. created_by is informational history,
-- not a permission gate (anyone whose branch covers the node can manage it).
create table survey_assignments (
    id                 uuid primary key default gen_random_uuid(),
    tenant_id          uuid not null references tenants(id),
    survey_version_id  uuid not null references survey_versions(id),
    target_node_id     uuid not null references nodes(id),
    deadline           timestamptz,
    timezone_basis     text,
    created_by         uuid references users(id),
    created_at         timestamptz not null default now()
);
create index survey_assignments_tenant_idx on survey_assignments (tenant_id);
create index survey_assignments_node_idx on survey_assignments (target_node_id);
create index survey_assignments_version_idx on survey_assignments (survey_version_id);

commit;

-- migrate:down transaction:false
begin;
set local timezone = 'UTC';
drop table survey_assignments;
drop table survey_versions;
drop table surveys;
commit;
