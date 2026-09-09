-- ─────────────────────────────────────────────────────────────────────
--  guards.sql — the two protections drizzle-kit cannot express
-- ─────────────────────────────────────────────────────────────────────
--  Run AFTER `drizzle-kit migrate`, via `npm -w @dcc/db run guards`.
--  Idempotent.
--
--  1. Append-only enforcement on event_log (architecture decision 01)
--  2. The non-superuser application role that RLS depends on
--     (architecture decision 03) — RLS is silently ignored for
--     superusers and BYPASSRLS roles, so the app MUST NOT be one.
-- ─────────────────────────────────────────────────────────────────────

-- 1 ── event_log is insert-only ──────────────────────────────────────
--  The one permitted mutation is the FK `on delete set null` action that
--  detaches an event from a work item being deleted: workitem_id goes
--  NULL and every other column is untouched. History (what happened,
--  when, by whom) stays immutable; only the now-dangling pointer clears.
create or replace function dcc_block_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and old.workitem_id is not null
     and new.workitem_id is null
     and new.id             is not distinct from old.id
     and new.client_id      is not distinct from old.client_id
     and new.occurred_at    is not distinct from old.occurred_at
     and new.recorded_at    is not distinct from old.recorded_at
     and new.source         is not distinct from old.source
     and new.type           is not distinct from old.type
     and new.schema_version is not distinct from old.schema_version
     and new.actor::text    is not distinct from old.actor::text
     and new.payload::text  is not distinct from old.payload::text
     and new.supersedes     is not distinct from old.supersedes
     and new.links::text    is not distinct from old.links::text
  then
    return new;
  end if;
  raise exception 'event_log is append-only: % is not allowed. Correct with a new row that sets supersedes.', tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists event_log_no_update on event_log;
create trigger event_log_no_update
  before update on event_log
  for each row execute function dcc_block_mutation();

drop trigger if exists event_log_no_delete on event_log;
create trigger event_log_no_delete
  before delete on event_log
  for each row execute function dcc_block_mutation();

-- occurred_at must not be in the future beyond a small clock-skew grace
alter table event_log drop constraint if exists event_log_occurred_not_future;
alter table event_log add constraint event_log_occurred_not_future
  check (occurred_at <= recorded_at + interval '5 minutes');

-- 2 ── the RLS-bound application role ────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dcc_app') then
    create role dcc_app login password 'dcc_app';  -- rotate in real envs
  end if;
end;
$$;

-- explicitly NOT a superuser, NOT bypassrls
alter role dcc_app nosuperuser nobypassrls nocreatedb nocreaterole;

grant usage on schema public to dcc_app;
-- Blanket DML grant. event_log's own triggers block UPDATE/DELETE on it
-- regardless, so a table-by-table list only invites "permission denied"
-- when a migration adds a table. RLS still governs which ROWS dcc_app
-- can see or write.
grant select, insert, update, delete on all tables in schema public to dcc_app;
grant usage, select on all sequences in schema public to dcc_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to dcc_app;
alter default privileges in schema public
  grant usage, select on sequences to dcc_app;
