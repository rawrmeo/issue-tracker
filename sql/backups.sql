-- ============================================================================
--  AUTOMATIC BACKUPS
-- ----------------------------------------------------------------------------
--  Run once in Supabase -> SQL Editor -> New query -> Run. Safe to repeat.
--
--  A browser cannot reliably write a backup in the background, so the
--  snapshotting lives in the database and works with nobody watching:
--
--    * public.backups       one row per snapshot — the whole issues table as
--                           JSON, so a restore is exact
--    * public.app_settings  a single row holding the admin on/off switch
--    * snapshot_issues()    take one now (internal)
--    * auto_snapshot()      decides whether a backup is due (at most hourly)
--    * create_backup()      admin: back up now
--    * restore_backup()     admin: put it back
--    * a trigger on issues  backs up on any change
-- ============================================================================

create table if not exists public.app_settings (
  id                  boolean primary key default true,
  auto_backup_enabled boolean not null default true,
  constraint app_settings_single_row check (id)
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "admins read settings" on public.app_settings;
create policy "admins read settings"
  on public.app_settings for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins change settings" on public.app_settings;
create policy "admins change settings"
  on public.app_settings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, update on public.app_settings to authenticated;


create table if not exists public.backups (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null default 'auto' check (kind in ('auto','manual')),
  issue_count integer not null default 0,
  payload     jsonb not null default '[]'::jsonb
);

create index if not exists backups_created_at_idx on public.backups (created_at desc);

alter table public.backups enable row level security;

drop policy if exists "admins read backups" on public.backups;
create policy "admins read backups"
  on public.backups for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins delete backups" on public.backups;
create policy "admins delete backups"
  on public.backups for delete
  to authenticated
  using (public.is_admin());

grant select, delete on public.backups to authenticated;


-- Take a snapshot. Internal: the browser must never reach this directly, or a
-- reporter could fill the table.
create or replace function public.snapshot_issues(p_kind text default 'auto')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  n_keep integer := 30;      -- how many snapshots to keep
begin
  insert into public.backups (kind, issue_count, payload)
  select
    case when p_kind = 'manual' then 'manual' else 'auto' end,
    count(*),
    coalesce(jsonb_agg(to_jsonb(i) order by i.created_at), '[]'::jsonb)
  from public.issues i
  returning id into new_id;

  -- Retention: drop everything past the newest n_keep.
  delete from public.backups
  where id in (
    select id from public.backups order by created_at desc offset n_keep
  );

  return new_id;
end;
$$;

revoke all on function public.snapshot_issues(text) from public;


-- Is a backup due? One place, so the trigger and any caller cannot drift.
create or replace function public.auto_snapshot()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select auto_backup_enabled from public.app_settings limit 1), true) then
    return null;                       -- switched off by an admin
  end if;

  if exists (
    select 1 from public.backups
    where kind = 'auto' and created_at > now() - interval '1 hour'
  ) then
    return null;                       -- already took one this hour
  end if;

  return public.snapshot_issues('auto');
end;
$$;

revoke all on function public.auto_snapshot() from public;


create or replace function public.auto_backup_on_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.auto_snapshot();
  return null;
end;
$$;

drop trigger if exists issues_auto_backup on public.issues;
create trigger issues_auto_backup
  after insert or update or delete on public.issues
  for each statement execute function public.auto_backup_on_change();


-- "Back up now"
create or replace function public.create_backup()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can create a backup'
      using errcode = '42501';
  end if;
  return public.snapshot_issues('manual');
end;
$$;

revoke all on function public.create_backup() from public;
grant execute on function public.create_backup() to authenticated;


-- "Put it back": replaces the issues with the snapshot.
-- Takes a safety snapshot first, so a restore can itself be undone.
create or replace function public.restore_backup(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n_restored integer := 0;
  n_total    integer := 0;
  n_usable   integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can restore a backup'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.backups where id = p_id) then
    raise exception 'That backup no longer exists';
  end if;

  select jsonb_array_length(payload) into n_total
  from public.backups where id = p_id;

  select count(*) into n_usable
  from jsonb_array_elements((select payload from public.backups where id = p_id)) as elem
  where exists (
    select 1 from auth.users u where u.id = (elem ->> 'author_id')::uuid
  );

  -- Guard against a silent wipe: a snapshot that names issues, but whose
  -- reporters have all been deleted, would otherwise clear the whole board.
  if n_total > 0 and n_usable = 0 then
    raise exception 'This backup only references accounts that no longer exist, so restoring it would empty the board. Nothing was changed.';
  end if;

  -- Safety net: never let a restore destroy the only copy.
  perform public.snapshot_issues('auto');

  delete from public.issues;

  -- Column-agnostic on purpose: jsonb_populate_record maps the stored JSON
  -- straight back onto the table.
  insert into public.issues
  select r2.*
  from jsonb_array_elements(
         (select payload from public.backups where id = p_id)
       ) as elem
  cross join lateral jsonb_populate_record(null::public.issues, elem) as r2
  where exists (
    select 1 from auth.users u where u.id = (elem ->> 'author_id')::uuid
  );

  get diagnostics n_restored = row_count;
  return n_restored;
end;
$$;

revoke all on function public.restore_backup(uuid) from public;
grant execute on function public.restore_backup(uuid) to authenticated;
