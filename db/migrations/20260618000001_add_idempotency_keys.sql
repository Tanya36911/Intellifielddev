-- migrate:up transaction:false
-- transaction:false: dbmate skips its own transaction so this file can manage
-- its own (BEGIN/COMMIT), making it safe under dbmate or hand-run psql.
-- Error-stop is enforced by the runner (deploy script: psql -v ON_ERROR_STOP=1).
begin;
set local timezone = 'UTC';

-- Phase 5-BE-a: a client-generated idempotency key (a claim ticket) so a re-sent
-- offline submission returns the original row instead of duplicating. Optional:
-- existing/web callers send none (NULL), which the partial unique index ignores,
-- so behavior is unchanged for them. Only the two rep-submit tables get it.
alter table responses add column idempotency_key uuid;
alter table time_entries add column idempotency_key uuid;

-- Dedup only real (non-null) keys, per company; unlimited NULL (unkeyed) rows.
create unique index responses_tenant_idem_idx
    on responses (tenant_id, idempotency_key) where idempotency_key is not null;
create unique index time_entries_tenant_idem_idx
    on time_entries (tenant_id, idempotency_key) where idempotency_key is not null;

commit;

-- migrate:down transaction:false
begin;
set local timezone = 'UTC';
drop index time_entries_tenant_idem_idx;
drop index responses_tenant_idem_idx;
alter table time_entries drop column idempotency_key;
alter table responses drop column idempotency_key;
commit;
