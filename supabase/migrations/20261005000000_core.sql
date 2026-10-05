-- Core schema: shared services for all modules.
-- Plain PostgreSQL + pgcrypto, pg_trgm and pgvector. Works on Supabase and on any PostgreSQL 15+.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Supabase compatibility shim. On Supabase these roles/functions already exist
-- and are left untouched; on plain PostgreSQL they are created with the same
-- semantics so RLS policies behave identically everywhere.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  begin
    execute format('grant anon, authenticated to %I', current_user);
  exception when others then
    raise notice 'could not grant anon/authenticated to %: %', current_user, sqlerrm;
  end;
end
$$;

create schema if not exists auth;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'jwt'
  ) then
    execute $f$
      create function auth.jwt() returns jsonb language sql stable as $b$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
      $b$
    $f$;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $f$
      create function auth.uid() returns uuid language sql stable as $b$
        select nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub'
          ),
          ''
        )::uuid
      $b$
    $f$;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Core schema
-- ---------------------------------------------------------------------------
create schema if not exists core;
grant usage on schema core to anon, authenticated, service_role;

-- Users, roles and permissions --------------------------------------------------
create table core.users (
  id uuid primary key,
  email text not null unique,
  display_name text,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.roles (
  id text primary key,
  name text not null,
  description text,
  is_system boolean not null default true,
  sort_order int not null default 100
);

insert into core.roles (id, name, description, sort_order) values
  ('admin', 'Ylläpitäjä', 'Kaikki oikeudet, myös asetukset, palvelut ja varmuuskopiot', 10),
  ('editor', 'Toimittaja', 'Lukee, muokkaa ja vie tietoja', 20),
  ('analyst', 'Analyytikko', 'Lukee, vie ja tekee tekoälyanalyysejä', 30),
  ('reader', 'Lukija', 'Lukuoikeus', 40),
  ('public', 'Julkinen', 'Kirjautumaton käyttäjä; vain public-tason tiedot, kun julkinen näkymä avataan', 50);

create table core.permissions (
  id text primary key,
  module_id text not null,
  description text,
  created_at timestamptz not null default now()
);

create table core.role_permissions (
  role_id text not null references core.roles (id) on delete cascade,
  permission_id text not null references core.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table core.user_roles (
  user_id uuid not null references core.users (id) on delete cascade on update cascade,
  role_id text not null references core.roles (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid,
  primary key (user_id, role_id)
);

-- Allow-list in addition to the ALLOWED_EMAILS environment variable (future invites).
create table core.allowed_emails (
  email text primary key,
  added_by uuid,
  created_at timestamptz not null default now()
);

-- Settings and encrypted secrets -------------------------------------------------
create table core.settings (
  scope text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (scope, key)
);

create table core.secrets (
  scope text not null,
  key text not null,
  ciphertext text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (scope, key)
);

-- Helper functions -------------------------------------------------------------
create or replace function core.current_user_id() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function core.public_access_enabled() returns boolean
language sql stable security definer set search_path = core, pg_temp as $$
  select coalesce((select (value #>> '{}')::boolean from core.settings
                   where scope = 'core' and key = 'public_access_enabled'), false)
$$;

-- The single permission check used by RLS policies. The API uses the same
-- semantics in packages/core/src/auth/permissions.ts.
create or replace function core.has_permission(perm text) returns boolean
language sql stable security definer set search_path = core, pg_temp as $$
  select exists (
    select 1
    from core.users u
    join core.user_roles ur on ur.user_id = u.id
    left join core.role_permissions rp on rp.role_id = ur.role_id and rp.permission_id = perm
    where u.id = auth.uid()
      and u.is_active
      and (ur.role_id = 'admin' or rp.permission_id is not null)
  )
$$;

create or replace function core.is_active_user() returns boolean
language sql stable security definer set search_path = core, pg_temp as $$
  select exists (select 1 from core.users where id = auth.uid() and is_active)
$$;

create or replace function core.actor_id() returns uuid
language sql stable as $$
  select coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid)
$$;

-- Audit log ------------------------------------------------------------------
create table core.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_label text,
  action text not null check (action in ('insert', 'update', 'delete', 'soft_delete', 'restore', 'export', 'merge', 'import')),
  table_schema text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  changed_fields text[],
  context jsonb
);
create index audit_log_record_idx on core.audit_log (table_schema, table_name, record_id, at desc);
create index audit_log_at_idx on core.audit_log (at desc);

create or replace function core.audit_trigger() returns trigger
language plpgsql security definer set search_path = core, pg_temp as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_action text;
  v_id text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_action := 'insert';
    v_id := v_new ->> 'id';
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    select array_agg(key order by key) into v_changed
    from jsonb_each(v_new) n
    where n.key not in ('updated_at', 'updated_by')
      and n.value is distinct from v_old -> n.key;
    if v_changed is null then
      return new;
    end if;
    v_action := case
      when (v_old ->> 'deleted_at') is null and (v_new ->> 'deleted_at') is not null then 'soft_delete'
      when (v_old ->> 'deleted_at') is not null and (v_new ->> 'deleted_at') is null then 'restore'
      else 'update' end;
    v_id := v_new ->> 'id';
  else
    v_old := to_jsonb(old);
    v_action := 'delete';
    v_id := v_old ->> 'id';
  end if;

  insert into core.audit_log (actor_id, actor_label, action, table_schema, table_name, record_id, old_data, new_data, changed_fields)
  values (core.actor_id(), nullif(current_setting('app.actor_label', true), ''), v_action,
          tg_table_schema, tg_table_name, v_id, v_old, v_new, v_changed);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create or replace function core.touch_trigger() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, core.actor_id());
  end if;
  new.updated_at := now();
  new.updated_by := core.actor_id();
  return new;
end
$$;

-- Standard columns, triggers and RLS for every module data table.
--   read_perm  : permission needed to read rows
--   write_perm : permission needed to insert/update/delete rows
-- Public (anon) read policy is created but only takes effect when the
-- core.public_access_enabled setting is switched on.
create or replace function core.setup_table(tbl regclass, read_perm text, write_perm text)
returns void language plpgsql as $$
declare
  v_schema text;
  v_table text;
begin
  perform set_config('client_min_messages', 'warning', true);
  select n.nspname, c.relname into v_schema, v_table
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = tbl;

  execute format($s$
    alter table %1$s
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now(),
      add column if not exists created_by uuid,
      add column if not exists updated_by uuid,
      add column if not exists deleted_at timestamptz,
      add column if not exists visibility text not null default 'internal'
        check (visibility in ('public', 'internal', 'private')),
      add column if not exists source text not null default 'manual'
        check (source in ('eduskunta', 'manual', 'seed', 'other')),
      add column if not exists source_url text,
      add column if not exists fetched_at timestamptz,
      add column if not exists manual_fields text[] not null default '{}'
  $s$, tbl);

  execute format('create index if not exists %I on %s (updated_at)', v_table || '_updated_at_idx', tbl);

  execute format('drop trigger if exists touch on %s', tbl);
  execute format('create trigger touch before insert or update on %s for each row execute function core.touch_trigger()', tbl);
  execute format('drop trigger if exists audit on %s', tbl);
  execute format('create trigger audit after insert or update or delete on %s for each row execute function core.audit_trigger()', tbl);

  execute format('alter table %s enable row level security', tbl);
  execute format('revoke all on %s from anon, authenticated', tbl);
  execute format('grant select, insert, update, delete on %s to authenticated', tbl);
  execute format('grant select on %s to anon', tbl);

  execute format('drop policy if exists read on %s', tbl);
  execute format($p$create policy read on %s for select to authenticated
    using (core.has_permission(%L) and (deleted_at is null or core.has_permission('core.trash')))$p$, tbl, read_perm);
  execute format('drop policy if exists insert on %s', tbl);
  execute format('create policy insert on %s for insert to authenticated with check (core.has_permission(%L))', tbl, write_perm);
  execute format('drop policy if exists update on %s', tbl);
  execute format('create policy update on %s for update to authenticated using (core.has_permission(%L)) with check (core.has_permission(%L))', tbl, write_perm, write_perm);
  execute format('drop policy if exists delete on %s', tbl);
  execute format('create policy delete on %s for delete to authenticated using (core.has_permission(%L))', tbl, write_perm);
  -- Prepared for the future public view; inactive while public_access_enabled = false.
  execute format('drop policy if exists public_read on %s', tbl);
  execute format($p$create policy public_read on %s for select to anon
    using (core.public_access_enabled() and visibility = 'public' and deleted_at is null)$p$, tbl);
end
$$;

-- Shared external identifiers -------------------------------------------------
-- Stable internal UUIDs + any number of external ids (e.g. Eduskunta henkilonro,
-- Wikidata QID) so that future modules can attach data to the same entity.
create table core.external_ids (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  system text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (system, entity_type, value)
);
create index external_ids_entity_idx on core.external_ids (entity_type, entity_id);

-- Domain events (outbox) ---------------------------------------------------------
create table core.outbox (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  type text not null,
  version int not null default 1,
  occurred_at timestamptz not null default now(),
  source_module text not null,
  actor_id uuid,
  payload jsonb not null default '{}'
);
create index outbox_type_idx on core.outbox (type, id);

create table core.event_consumers (
  consumer text primary key,
  last_event_id bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table core.event_failures (
  id bigint generated always as identity primary key,
  consumer text not null,
  event_id bigint not null references core.outbox (id) on delete cascade,
  error text not null,
  at timestamptz not null default now(),
  resolved_at timestamptz
);

create or replace function core.publish_event(p_type text, p_source text, p_payload jsonb, p_version int default 1)
returns uuid language sql security definer set search_path = core, pg_temp as $$
  insert into core.outbox (type, version, source_module, actor_id, payload)
  values (p_type, p_version, p_source, core.actor_id(), coalesce(p_payload, '{}'))
  returning event_id
$$;

-- Job queue -----------------------------------------------------------------
create table core.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  module_id text not null default 'core',
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  runner text not null default 'auto',
  progress_done int not null default 0,
  progress_total int,
  message text,
  result jsonb,
  error text,
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_queue_idx on core.jobs (status, run_after) where status = 'queued';
create index jobs_created_idx on core.jobs (created_at desc);

-- Sync framework -------------------------------------------------------------
create table core.sync_sources (
  id text primary key,
  module_id text not null,
  name text not null,
  description text,
  enabled boolean not null default true,
  schedule text,
  config jsonb not null default '{}',
  state jsonb not null default '{}',
  last_run_id uuid,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures int not null default 0,
  updated_at timestamptz not null default now()
);

create table core.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references core.sync_sources (id) on delete cascade,
  job_id uuid references core.jobs (id) on delete set null,
  params jsonb not null default '{}',
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'partial')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_fetched int not null default 0,
  rows_inserted int not null default 0,
  rows_updated int not null default 0,
  rows_skipped int not null default 0,
  errors jsonb not null default '[]',
  log text[] not null default '{}',
  triggered_by uuid
);
create index sync_runs_source_idx on core.sync_runs (source_id, started_at desc);

-- Search ---------------------------------------------------------------------
create table core.search_index (
  content_type text not null,
  ref_id text not null,
  module_id text not null,
  title text not null,
  body text,
  url_path text,
  lang text not null default 'fi' check (lang in ('fi', 'sv', 'en', 'simple')),
  visibility text not null default 'internal' check (visibility in ('public', 'internal', 'private')),
  read_permission text not null,
  meta jsonb not null default '{}',
  tsv tsvector generated always as (
    case lang
      when 'sv' then setweight(to_tsvector('swedish', coalesce(title, '')), 'A') || setweight(to_tsvector('swedish', coalesce(body, '')), 'B')
      when 'en' then setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')
      when 'simple' then setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(body, '')), 'B')
      else setweight(to_tsvector('finnish', coalesce(title, '')), 'A') || setweight(to_tsvector('finnish', coalesce(body, '')), 'B')
    end
  ) stored,
  updated_at timestamptz not null default now(),
  primary key (content_type, ref_id)
);
create index search_index_tsv_idx on core.search_index using gin (tsv);
create index search_index_title_trgm_idx on core.search_index using gin (title gin_trgm_ops);

create table core.embeddings (
  content_type text not null,
  ref_id text not null,
  chunk int not null default 0,
  model text not null,
  dims int not null,
  embedding vector not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  primary key (content_type, ref_id, chunk, model)
);
create index embeddings_model_idx on core.embeddings (model, dims);

-- AI usage and cache ---------------------------------------------------------------
create table core.ai_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  provider text not null,
  model text not null,
  task text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  duration_ms int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  success boolean not null default true,
  cached boolean not null default false,
  error text,
  user_id uuid
);
create index ai_usage_at_idx on core.ai_usage (at desc);

create table core.ai_cache (
  key text primary key,
  provider text not null,
  model text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- Snapshots, backups, exports ------------------------------------------------------
create table core.snapshots (
  id uuid primary key default gen_random_uuid(),
  reason text not null,
  module_id text,
  scope jsonb not null default '{}',
  data jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table core.backups (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('full', 'module', 'pre_migration', 'files')),
  module_id text,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'deleted')),
  target text not null,
  location text,
  size_bytes bigint,
  sha256 text,
  encrypted boolean not null default true,
  retention_class text,
  include_reproducible boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  verified_at timestamptz,
  verify_status text,
  verify_message text,
  error text,
  created_by uuid
);
create index backups_started_idx on core.backups (started_at desc);

create table core.exports (
  id uuid primary key default gen_random_uuid(),
  module_id text not null,
  format text not null,
  title text not null,
  status text not null default 'ready',
  storage_key text,
  size_bytes bigint,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

-- Notifications and service health ---------------------------------------------
create table core.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references core.users (id) on delete cascade on update cascade,
  audience text not null default 'user' check (audience in ('user', 'admins')),
  kind text not null default 'info' check (kind in ('info', 'success', 'warning', 'error')),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on core.notifications (user_id, created_at desc);

create table core.service_status (
  service text primary key,
  provider text not null,
  status text not null default 'unknown' check (status in ('ok', 'error', 'unknown', 'disabled')),
  message text,
  last_ok_at timestamptz,
  last_checked_at timestamptz
);

-- ---------------------------------------------------------------------------
-- RLS for core tables: deny by default, explicit policies only.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'external_ids', 'users', 'roles', 'permissions', 'role_permissions', 'user_roles', 'allowed_emails',
    'settings', 'secrets', 'audit_log', 'outbox', 'event_consumers', 'event_failures', 'jobs',
    'sync_sources', 'sync_runs', 'search_index', 'embeddings', 'ai_usage', 'ai_cache', 'snapshots',
    'backups', 'exports', 'notifications', 'service_status'
  ] loop
    execute format('alter table core.%I enable row level security', t);
    execute format('revoke all on core.%I from anon, authenticated', t);
  end loop;
end
$$;

grant select on core.users, core.roles, core.permissions, core.role_permissions, core.user_roles to authenticated;
create policy users_self on core.users for select to authenticated using (id = auth.uid() or core.has_permission('core.admin'));
create policy roles_read on core.roles for select to authenticated using (core.is_active_user());
create policy permissions_read on core.permissions for select to authenticated using (core.is_active_user());
create policy role_permissions_read on core.role_permissions for select to authenticated using (core.is_active_user());
create policy user_roles_read on core.user_roles for select to authenticated using (user_id = auth.uid() or core.has_permission('core.admin'));

grant select on core.external_ids to authenticated;
create policy external_ids_read on core.external_ids for select to authenticated using (core.is_active_user());

grant select on core.settings to authenticated;
create policy settings_read on core.settings for select to authenticated using (core.has_permission('core.settings'));
-- core.secrets: no policies at all -> never readable through the authenticated role.

grant select on core.audit_log to authenticated;
create policy audit_read on core.audit_log for select to authenticated using (core.has_permission('core.audit'));

grant select on core.jobs to authenticated;
create policy jobs_read on core.jobs for select to authenticated
  using (core.is_active_user() and (created_by = auth.uid() or core.has_permission('core.jobs')));

grant select on core.sync_sources, core.sync_runs to authenticated;
create policy sync_sources_read on core.sync_sources for select to authenticated using (core.has_permission('core.sync'));
create policy sync_runs_read on core.sync_runs for select to authenticated using (core.has_permission('core.sync'));

grant select on core.search_index to authenticated;
create policy search_read on core.search_index for select to authenticated using (core.has_permission(read_permission));
grant select on core.search_index to anon;
create policy search_public_read on core.search_index for select to anon
  using (core.public_access_enabled() and visibility = 'public');

grant select on core.ai_usage to authenticated;
create policy ai_usage_read on core.ai_usage for select to authenticated using (core.has_permission('core.ai'));

grant select on core.backups, core.snapshots to authenticated;
create policy backups_read on core.backups for select to authenticated using (core.has_permission('core.backup'));
create policy snapshots_read on core.snapshots for select to authenticated using (core.has_permission('core.backup'));

grant select on core.exports to authenticated;
create policy exports_read on core.exports for select to authenticated
  using (core.is_active_user() and (created_by = auth.uid() or core.has_permission('core.admin')));

grant select, update on core.notifications to authenticated;
create policy notifications_read on core.notifications for select to authenticated
  using (core.is_active_user() and (user_id = auth.uid() or (audience = 'admins' and core.has_permission('core.admin'))));
create policy notifications_mark_read on core.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on core.service_status to authenticated;
create policy service_status_read on core.service_status for select to authenticated using (core.has_permission('core.services'));

grant execute on function core.has_permission(text), core.is_active_user(), core.public_access_enabled(),
  core.current_user_id(), core.actor_id() to anon, authenticated;
revoke execute on function core.publish_event(text, text, jsonb, int) from public;
grant execute on function core.publish_event(text, text, jsonb, int) to authenticated;

-- Realtime (Supabase): job progress and notifications without page reloads.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table core.jobs, core.notifications;
  end if;
end
$$;
