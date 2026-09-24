-- =====================================================================
--  ISSUE TRACKER — SUPABASE DATABASE SCHEMA
--  ---------------------------------------------------------------------
--  This is the Supabase CLI migration. It is the same schema as
--  ../supabase-schema.sql and the SQL embedded in index.html — if you
--  change one, change all three.
--
--  CLI:      supabase link --project-ref <ref> && supabase db push
--  Or paste ../supabase-schema.sql (or this file) into the SQL Editor.
--
--  Safe to run more than once.
-- =====================================================================

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";


-- =====================================================================
--  1. PROFILES — one row per user, holds the ROLE
-- =====================================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text        not null,
  full_name  text        not null default '',
  role       text        not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now()
);

-- Extra profile fields. "add column if not exists" means this also upgrades
-- a database that was created before these columns existed.
alter table public.profiles add column if not exists avatar_url           text        not null default '';
alter table public.profiles add column if not exists notify_new_issue     boolean     not null default true;
alter table public.profiles add column if not exists notify_status_done   boolean     not null default true;
alter table public.profiles add column if not exists notify_high_priority boolean     not null default true;
alter table public.profiles add column if not exists notifications_seen_at timestamptz not null default 'epoch';


-- =====================================================================
--  2. ISSUES — the actual tracker records
-- =====================================================================
create table if not exists public.issues (
  id               uuid primary key default gen_random_uuid(),
  title            text        not null,
  description      text        not null default '',
  status           text        not null default 'none',
  priority         text        not null default 'medium' check (priority in ('low','medium','high')),
  created_by       uuid        default auth.uid() references auth.users(id) on delete set null,
  created_by_email text        not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Status values. 'none' means no status has been set yet.
-- This replaces the older two-value constraint, so it also upgrades an
-- existing database — run it even if the table is already there.
alter table public.issues drop constraint if exists issues_status_check;
alter table public.issues add constraint issues_status_check
  check (status in ('none','pending','done'));

-- New issues start with no status: a normal user reports it and an
-- administrator moves it through Pending / Done.
alter table public.issues alter column status set default 'none';

-- Deleting a user keeps their issues on the board: the reporter link is
-- cleared instead of the issues being removed. (Older databases used
-- ON DELETE CASCADE, which would have destroyed them.)
alter table public.issues alter column created_by drop not null;
alter table public.issues drop constraint if exists issues_created_by_fkey;
alter table public.issues add constraint issues_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

create index if not exists issues_status_idx     on public.issues (status);
create index if not exists issues_created_by_idx on public.issues (created_by);
create index if not exists issues_updated_at_idx on public.issues (updated_at desc);


-- =====================================================================
--  3. HELPERS
-- =====================================================================
-- Is the current user an admin?
-- SECURITY DEFINER so it can read profiles without tripping RLS
-- (which would otherwise cause infinite recursion in the policies).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Keep updated_at fresh automatically.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- A normal user may ONLY change an issue's status.
-- Admins may change anything. Enforced in the database itself, so a
-- crafted request from the browser cannot bypass it.
create or replace function public.guard_issue_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  -- Non-admins may change ONLY the status column. Editing the title,
  -- description, priority or reporter is rejected by the database.
  if new.title         is distinct from old.title
     or new.description is distinct from old.description
     or new.priority    is distinct from old.priority
     or new.created_by  is distinct from old.created_by then
    raise exception 'Only an administrator can edit issue details.';
  end if;

  return new;
end;
$$;

drop trigger if exists issues_touch_updated_at on public.issues;
create trigger issues_touch_updated_at
  before update on public.issues
  for each row execute function public.touch_updated_at();

drop trigger if exists issues_guard_update on public.issues;
create trigger issues_guard_update
  before update on public.issues
  for each row execute function public.guard_issue_update();


-- =====================================================================
--  4. AUTO-CREATE A PROFILE WHEN SOMEONE SIGNS UP
--     The role chosen on the register form arrives in user metadata.
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when new.raw_user_meta_data->>'role' = 'admin' then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =====================================================================
--  4b. ONLY ADMINISTRATORS MAY CHANGE ROLES
--      profiles_update_self lets a user touch their own row (their
--      display name). This trigger stops that being used to promote
--      themselves to admin.
-- =====================================================================
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only an administrator can change roles.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();


-- =====================================================================
--  ADMINS CAN DELETE A USER
--  Deleting the auth.users row also removes the matching profile row
--  (ON DELETE CASCADE on profiles.id) while the user's issues stay on
--  the board, because issues.created_by is now ON DELETE SET NULL.
--  SECURITY DEFINER is what lets this reach the auth schema; the admin
--  check inside is what keeps it safe to expose over the public API.
-- =====================================================================
create or replace function public.admin_delete_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can delete users.';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot delete your own account.';
  end if;
  -- Detach their issues first, so they survive even on a database that
  -- still has the older ON DELETE CASCADE constraint.
  update public.issues set created_by = null where created_by = target;
  delete from auth.users where id = target;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;


-- =====================================================================
--  5. ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.issues   enable row level security;

-- ---------- profiles ----------
drop policy if exists profiles_select_self   on public.profiles;
drop policy if exists profiles_select_admin  on public.profiles;
drop policy if exists profiles_insert_self   on public.profiles;
drop policy if exists profiles_update_self   on public.profiles;
drop policy if exists profiles_update_admin  on public.profiles;
drop policy if exists profiles_delete_admin  on public.profiles;

create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

create policy profiles_select_admin on public.profiles
  for select using (public.is_admin());

-- A user creates their own profile row (fallback if the trigger is absent).
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

-- A user may fix their own display name...
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ...but only an admin may change roles (their own or anyone's).
create policy profiles_update_admin on public.profiles
  for update using (public.is_admin());

create policy profiles_delete_admin on public.profiles
  for delete using (public.is_admin());

-- ---------- issues ----------
drop policy if exists issues_select_auth     on public.issues;
drop policy if exists issues_insert_auth     on public.issues;
drop policy if exists issues_update_admin    on public.issues;
drop policy if exists issues_update_own      on public.issues;
drop policy if exists issues_delete_admin    on public.issues;

-- Any signed-in user sees the whole board.
create policy issues_select_auth on public.issues
  for select using (auth.uid() is not null);

-- Any signed-in user can report an issue as themselves.
create policy issues_insert_auth on public.issues
  for insert with check (auth.uid() = created_by);

-- Admins can update anything.
create policy issues_update_admin on public.issues
  for update using (public.is_admin());

-- Normal users cannot update issues at all. They report them with the
-- status "None", and an administrator moves them through Pending / Done.
-- (guard_issue_update stays as a second line of defence.)

-- Only admins can delete.
create policy issues_delete_admin on public.issues
  for delete using (public.is_admin());


-- =====================================================================
--  6. OPTIONAL — make yourself the first admin
--     After you register in the app, run this with your own email:
--
--     update public.profiles set role = 'admin'
--     where email = 'you@example.com';
-- =====================================================================


-- ============================================================================
--  GRANTS
--    Supabase grants table privileges to anon / authenticated by default, so
--    the earlier sections never needed to say so. Stating them here keeps this
--    schema self-sufficient: it can be run on a plain PostgreSQL and still
--    work, which is exactly how it is tested.
-- ============================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.issues   to authenticated;


-- ============================================================================
--  AUTOMATIC BACKUPS
-- ----------------------------------------------------------------------------
--  WHY THE DATABASE DOES IT
--    A browser cannot reliably write a backup in the background. A trigger
--    can, so the snapshotting lives here, and it works with nobody watching.
--
--  WHAT IT ADDS
--    * public.backups       one row per snapshot: the whole issues table as
--                           JSON, so a restore is exact
--    * public.app_settings  a single row holding the admin on/off switch
--    * auto_snapshot()      one place that decides whether a backup is due
--    * create_backup()      admin: back up now
--    * restore_backup()     admin: put it back
--    * a trigger on issues  backs up on any change, at most once an hour
--    * an optional nightly pg_cron job for quiet days
-- ============================================================================

create table if not exists public.app_settings (
  id                  boolean primary key default true check (id),
  auto_backup_enabled boolean not null default true,
  updated_at          timestamptz not null default now()
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

-- Is a backup due? One place, so the trigger and the nightly job cannot drift.
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
    select 1 from auth.users u where u.id = (elem ->> 'created_by')::uuid
  );

  -- Guard against a silent wipe: a snapshot that names issues, but whose
  -- reporters have all been deleted, would otherwise clear the whole board
  -- and report "0 restored".
  if n_total > 0 and n_usable = 0 then
    raise exception 'This backup only references accounts that no longer exist, so restoring it would empty the board. Nothing was changed.';
  end if;

  -- Safety net: never let a restore destroy the only copy.
  perform public.snapshot_issues('auto');

  delete from public.issues;

  -- Column-agnostic on purpose: jsonb_populate_record maps the stored JSON
  -- straight back onto the table, so a snapshot restores correctly whether it
  -- was taken before or after a column was added.
  insert into public.issues
  select r2.*
  from jsonb_array_elements(
         (select payload from public.backups where id = p_id)
       ) as elem
  cross join lateral jsonb_populate_record(null::public.issues, elem) as r2
  where exists (
    select 1 from auth.users u where u.id = (elem ->> 'created_by')::uuid
  );

  get diagnostics n_restored = row_count;
  return n_restored;
end;
$$;

revoke all on function public.restore_backup(uuid) from public;
grant execute on function public.restore_backup(uuid) to authenticated;


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


-- ============================================================================
--  RECYCLE BIN  (deleting stops being destructive)
-- ----------------------------------------------------------------------------
--  Delete only stamps the row. It drops out of every list because the SELECT
--  policy stops matching it, so no query in the app had to change - and an
--  admin can put it back from the recycle bin.
-- ============================================================================
alter table public.issues add column if not exists deleted_at timestamptz;

create index if not exists issues_deleted_at_idx on public.issues (deleted_at);

drop policy if exists issues_select_auth on public.issues;
create policy issues_select_auth
  on public.issues for select
  to authenticated
  using (auth.uid() is not null and deleted_at is null);

-- Only an admin may remove a row outright; everyone else goes through the bin.
drop policy if exists issues_delete_admin on public.issues;
create policy issues_delete_admin
  on public.issues for delete
  to authenticated
  using (public.is_admin());


create or replace function public.soft_delete_issue(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select created_by into v_owner from public.issues where id = p_id;

  if not found then
    raise exception 'That issue no longer exists';
  end if;

  if v_owner is not null and v_owner is distinct from auth.uid() and not public.is_admin() then
    raise exception 'You can only delete your own issues'
      using errcode = '42501';
  end if;

  update public.issues
     set deleted_at = now()
   where id = p_id and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_issue(uuid) from public;
grant execute on function public.soft_delete_issue(uuid) to authenticated;


create or replace function public.list_deleted_issues()
returns table (
  id               uuid,
  title            text,
  description      text,
  status           text,
  priority         text,
  created_by_email text,
  created_at       timestamptz,
  deleted_at       timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can open the recycle bin'
      using errcode = '42501';
  end if;

  return query
    select i.id, i.title, i.description, i.status, i.priority,
           coalesce(nullif(i.created_by_email, ''), '(account removed)'),
           i.created_at, i.deleted_at
    from public.issues i
    where i.deleted_at is not null
    order by i.deleted_at desc;
end;
$$;

revoke all on function public.list_deleted_issues() from public;
grant execute on function public.list_deleted_issues() to authenticated;


create or replace function public.restore_issue(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can restore an issue'
      using errcode = '42501';
  end if;

  update public.issues
     set deleted_at = null
   where id = p_id and deleted_at is not null;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.restore_issue(uuid) from public;
grant execute on function public.restore_issue(uuid) to authenticated;


create or replace function public.purge_issue(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can delete an issue for good'
      using errcode = '42501';
  end if;

  delete from public.issues where id = p_id and deleted_at is not null;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_issue(uuid) from public;
grant execute on function public.purge_issue(uuid) to authenticated;


create or replace function public.empty_recycle_bin()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can empty the recycle bin'
      using errcode = '42501';
  end if;

  delete from public.issues where deleted_at is not null;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.empty_recycle_bin() from public;
grant execute on function public.empty_recycle_bin() to authenticated;


-- ============================================================================
--  OPTIONAL — A NIGHTLY BACKUP ON QUIET DAYS
--    The trigger only fires when something changes. pg_cron must be enabled
--    once in the dashboard (Database -> Extensions -> pg_cron). If it is not,
--    this block does nothing and the trigger still covers you.
-- ============================================================================
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then null;
  end;

  begin
    perform cron.unschedule('issue-tracker-auto-backup');
  exception when others then null;
  end;

  begin
    perform cron.schedule(
      'issue-tracker-auto-backup',
      '0 2 * * *',
      $job$select public.auto_snapshot()$job$
    );
  exception when others then null;
  end;
end $$;


-- ============================================================================
--  Realtime: send the whole old row on update and delete.
--  Without this an update event cannot say what the status WAS, and a delete
--  event arrives with no title. Costs a little more write-ahead log per
--  update, which is nothing at this size.
-- ============================================================================
alter table public.issues replica identity full;
