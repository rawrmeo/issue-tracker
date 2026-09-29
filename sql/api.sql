-- ============================================================================
--  sql/api.sql
-- ----------------------------------------------------------------------------
--  Public REST API support: API keys, the service-role bypass the API needs,
--  aggregate stats, and outbound webhooks.
--
--  Run once in Supabase -> SQL Editor -> New query -> Run. Safe to repeat.
--
--  What it adds
--    1. public.api_keys            one row per API key (only the HASH is stored)
--    2. public.api_is_service()    is the caller the service role?
--    3. guard_issue_changes()      re-defined so the trusted API can set status
--    4. public.api_stats()         fast dashboard counts for the API
--    5. public.webhook_endpoints   where to send events (the "Web API")
--    6. public.webhook_deliveries  delivery audit / retry log
--    7. api_dispatch_webhooks()    trigger that POSTs events to subscribers
--
--  The Edge Function in supabase/functions/api/ is the only caller that uses
--  the service role; it enforces the user/admin rules itself. See API.md.
-- ============================================================================


-- ============================================================================
--  1. API KEYS
--     A key looks like  itk_<48 hex chars>. We store only its SHA-256 hash and
--     a short prefix for display, so a database leak does not expose keys.
-- ============================================================================

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  prefix       text not null,                       -- e.g. itk_9f3a2c1b (shown in the UI)
  key_hash     text not null unique,                -- sha256 hex of the full key
  role         text not null default 'user' check (role in ('admin','user')),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists api_keys_hash_idx   on public.api_keys (key_hash);
create index if not exists api_keys_prefix_idx on public.api_keys (prefix);

alter table public.api_keys enable row level security;

-- Only admins may see or manage keys from the app. The Edge Function uses the
-- service role, which bypasses RLS.
drop policy if exists "admins read api keys" on public.api_keys;
create policy "admins read api keys"
  on public.api_keys for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins insert api keys" on public.api_keys;
create policy "admins insert api keys"
  on public.api_keys for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admins update api keys" on public.api_keys;
create policy "admins update api keys"
  on public.api_keys for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins delete api keys" on public.api_keys;
create policy "admins delete api keys"
  on public.api_keys for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.api_keys to authenticated;
grant all on public.api_keys to service_role;


-- ============================================================================
--  2. IS THE CALLER THE SERVICE ROLE?
--     The Edge Function authenticates with the service key, so auth.uid() is
--     null and is_admin() would be false. auth.role() reads the role claim.
-- ============================================================================

create or replace function public.api_is_service()
returns boolean
language sql
stable
as $$
  select coalesce(auth.role(), '') = 'service_role';
$$;


-- ============================================================================
--  3. LET THE TRUSTED API SET THE STATUS
--     Same rule as before, but the service role (only ever held by our Edge
--     Function) is allowed through. The Edge Function checks the API key's
--     role and refuses status changes for a `user` key, so the user-facing
--     guarantee is unchanged. `anon` and `authenticated` are still blocked.
-- ============================================================================

create or replace function public.guard_issue_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The headline rule. Non-admins (and non-service callers) cannot move status.
  -- auth.role() is the supported way to read the caller's role (it also reads
  -- the request.jwt.claims JSON); the legacy request.jwt.claim.role setting is
  -- no longer populated by current PostgREST versions.
  if new.status is distinct from old.status
     and not public.is_admin()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only admins can change the status of an issue'
      using errcode = '42501';
  end if;

  -- A reporter must not be able to hand their issue to someone else.
  if new.author_id is distinct from old.author_id then
    raise exception 'The reporter of an issue cannot be changed'
      using errcode = '42501';
  end if;

  new.updated_at := now();

  -- Keep completed_at in step with the status, server-side.
  if new.status = 'done' then
    new.completed_at := coalesce(old.completed_at, now());
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;


-- ============================================================================
--  4. API STATS
--     One round trip instead of loading every issue to count them.
-- ============================================================================

create or replace function public.api_stats(p_author uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total',     count(*),
    'pending',   count(*) filter (where status = 'pending'),
    'fixing',    count(*) filter (where status = 'fixing'),
    'done',      count(*) filter (where status = 'done'),
    'high_open', count(*) filter (where priority = 'high' and status <> 'done')
  )
  from public.issues
  where deleted_at is null
    and (p_author is null or author_id = p_author);
$$;

revoke all on function public.api_stats(uuid) from public;
grant execute on function public.api_stats(uuid) to service_role;


-- ============================================================================
--  5. WEBHOOKS — the outbound "Web API"
--     Consumers register a URL; the database POSTs issue events to it. This
--     mirrors the push-notification design (pg_net) already in schema.sql.
-- ============================================================================

create extension if not exists pg_net with schema extensions;

create table if not exists public.webhook_endpoints (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default '',
  url           text not null,
  secret        text not null default '',
  events        text[] not null default array['*'],   -- e.g. {issue.created,issue.done}
  active        boolean not null default true,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_status   integer,
  last_called_at timestamptz
);

create table if not exists public.webhook_deliveries (
  id          uuid primary key default gen_random_uuid(),
  endpoint_id uuid references public.webhook_endpoints(id) on delete cascade,
  event       text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists webhook_deliveries_endpoint_idx
  on public.webhook_deliveries (endpoint_id, created_at desc);

alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;

drop policy if exists "admins manage webhooks" on public.webhook_endpoints;
create policy "admins manage webhooks"
  on public.webhook_endpoints for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins read webhook deliveries" on public.webhook_deliveries;
create policy "admins read webhook deliveries"
  on public.webhook_deliveries for select
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.webhook_endpoints   to authenticated;
grant select on public.webhook_deliveries to authenticated;
grant all on public.webhook_endpoints   to service_role;
grant all on public.webhook_deliveries  to service_role;


-- Fire on every issue change; respect the same "silent" switch the API uses
-- when restoring a backup, so a restore does not spam subscribers.
create or replace function public.api_dispatch_webhooks()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  r       record;
  v_event text;
  v_body  jsonb;
begin
  if coalesce(current_setting('app.silent', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_event := 'issue.created';
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_event := 'issue.deleted';
  elsif new.status = 'done' and old.status is distinct from 'done' then
    v_event := 'issue.done';
  elsif new.status is distinct from old.status then
    v_event := 'issue.status_changed';
  else
    v_event := 'issue.updated';
  end if;

  v_body := jsonb_build_object('event', v_event, 'at', now(), 'data', to_jsonb(new));

  for r in
    select id, url, secret, events
    from public.webhook_endpoints
    where active
  loop
    if '*' = any(r.events) or v_event = any(r.events) then
      insert into public.webhook_deliveries (endpoint_id, event, payload)
      values (r.id, v_event, v_body);

      perform net.http_post(
        url     := r.url,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'x-webhook-event', v_event,
                     'x-webhook-secret', coalesce(r.secret, '')
                   ),
        body    := v_body
      );
    end if;
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists issues_api_webhooks on public.issues;
create trigger issues_api_webhooks
  after insert or update on public.issues
  for each row execute function public.api_dispatch_webhooks();

revoke all on function public.api_dispatch_webhooks() from public;
