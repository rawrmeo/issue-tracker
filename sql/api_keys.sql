-- ============================================================================
--  sql/api_keys.sql
-- ----------------------------------------------------------------------------
--  Backend for the public REST API - API keys only. There is NO admin page for
--  this in the app; create and revoke keys from the Supabase SQL Editor.
--
--  Run once in Supabase -> SQL Editor -> Run. Safe to repeat.
--
--  Create a key:   select public.create_api_key('for Ana', 'user');
--  List keys:      select name, role, prefix, last_used_at, revoked_at
--                  from public.api_keys order by created_at desc;
--  Revoke a key:   update public.api_keys set revoked_at = now()
--                  where prefix = 'itk_...';
--
--  The gateway itself is supabase/functions/api/index.ts (deploy with
--  --no-verify-jwt). See README for the deploy command.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;


-- ============================================================================
--  1. API KEYS - only the SHA-256 hash is stored
-- ============================================================================

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null default 'api key',
  prefix       text not null,
  key_hash     text not null unique,
  role         text not null default 'user' check (role in ('admin','user')),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists api_keys_hash_idx   on public.api_keys (key_hash);
create index if not exists api_keys_prefix_idx on public.api_keys (prefix);

alter table public.api_keys enable row level security;

-- Safety net only (there is no UI for this): admins may read/manage.
drop policy if exists "admins read api keys" on public.api_keys;
create policy "admins read api keys" on public.api_keys for select to authenticated using (public.is_admin());
drop policy if exists "admins manage api keys" on public.api_keys;
create policy "admins manage api keys" on public.api_keys for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.api_keys to authenticated;
grant all on public.api_keys to service_role;


-- ============================================================================
--  2. CREATE A KEY - one SQL call, returns the plaintext ONCE
-- ============================================================================

create or replace function public.create_api_key(
  p_name    text,
  p_role    text default 'user',
  p_profile uuid default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key     text;
  v_prefix  text;
  v_hash    text;
  v_profile uuid;
  v_role    text;
begin
  -- Allowed for an admin, the service role, or a direct DB call (SQL Editor /
  -- dashboard, where there is no JWT). Never for an authenticated non-admin.
  if auth.uid() is not null
     and not public.is_admin()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only admins can create API keys' using errcode = '42501';
  end if;

  v_role := case when p_role in ('admin','user') then p_role else 'user' end;

  v_profile := coalesce(p_profile, auth.uid());
  if v_profile is null then
    select id into v_profile from public.profiles where role = 'admin' order by created_at limit 1;
  end if;
  if v_profile is null then
    raise exception 'No profile to attach the key to';
  end if;

  v_key    := 'itk_' || encode(gen_random_bytes(24), 'hex');
  v_prefix := left(v_key, 12);
  v_hash   := encode(digest(v_key, 'sha256'), 'hex');

  insert into public.api_keys (name, prefix, key_hash, role, profile_id)
  values (coalesce(nullif(btrim(p_name), ''), 'api key'), v_prefix, v_hash, v_role, v_profile);

  return v_key;
end;
$$;

revoke all on function public.create_api_key(text, text, uuid) from public;
grant execute on function public.create_api_key(text, text, uuid) to authenticated, service_role;


-- ============================================================================
--  3. STATS - one round trip for the API's /v1/stats
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
--  4. LET THE TRUSTED API SET THE STATUS
--     auth.role() reads the role claim (the legacy request.jwt.claim.role
--     setting is not populated by current PostgREST). A user key is still
--     refused by the gateway before it ever reaches here.
-- ============================================================================

create or replace function public.guard_issue_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and not public.is_admin()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only admins can change the status of an issue'
      using errcode = '42501';
  end if;

  if new.author_id is distinct from old.author_id then
    raise exception 'The reporter of an issue cannot be changed'
      using errcode = '42501';
  end if;

  new.updated_at := now();

  if new.status = 'done' then
    new.completed_at := coalesce(old.completed_at, now());
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;
