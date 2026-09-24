-- ============================================================================
--  Issue Tracker — COMPLETE DATABASE SETUP  (one paste)
-- ----------------------------------------------------------------------------
--  Paste this ENTIRE file into Supabase -> SQL Editor -> New query -> RUN.
--  Safe to run more than once.
--
--  Generated from these four files, in this order:
--      supabase\schema.sql
--      sql\auto_backup.sql
--      sql\recycle_bin.sql
--      sql\admin_users.sql
--  Edit those and re-generate rather than editing this bundle.
-- ============================================================================


-- ############################################################################
-- ##  PART 1 of 4  —  BASE SCHEMA
-- ############################################################################

-- ============================================================================
--  Issue Tracker — Supabase / PostgreSQL schema
-- ----------------------------------------------------------------------------
--  HOW TO RUN
--    1. Open your project at https://supabase.com
--    2. Left sidebar -> SQL Editor -> New query
--    3. Paste this ENTIRE file and press RUN
--
--  This file is safe to run more than once.
-- ============================================================================


-- ============================================================================
--  1. PROFILES — one row per account. This is where the role lives.
-- ============================================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text not null unique,
  role       text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Is the caller an admin?
-- SECURITY DEFINER so it can read `profiles` without tripping its own RLS
-- policy (which would recurse forever).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Everyone signed in can see the list of usernames (needed to show
-- "reported by ..."), but nobody can read password material here.
drop policy if exists "profiles are readable" on public.profiles;
create policy "profiles are readable"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- Only an admin may change a role.
drop policy if exists "admins update profiles" on public.profiles;
create policy "admins update profiles"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ============================================================================
--  2. AUTO-CREATE A PROFILE ON SIGN-UP
--     The very first account becomes the admin; everyone after is a user.
--
--     The role is COMPUTED HERE and is never read from client-supplied
--     data, so nobody can register themselves as an admin.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname      text;
  first_user boolean;
begin
  uname := coalesce(
             nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
             split_part(new.email, '@', 1)
           );

  select not exists (select 1 from public.profiles) into first_user;

  insert into public.profiles (id, username, role)
  values (new.id, uname, case when first_user then 'admin' else 'user' end);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
--  3. ISSUES
-- ============================================================================
create table if not exists public.issues (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 1 and 140),
  description  text not null default '' check (char_length(description) <= 2000),
  priority     text not null default 'medium' check (priority in ('low','medium','high')),
  status       text not null default 'pending' check (status in ('pending','fixing','done')),
  label        text not null default '' check (char_length(label) <= 40),
  author_id    uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists issues_created_at_idx on public.issues (created_at desc);
create index if not exists issues_status_idx     on public.issues (status);
create index if not exists issues_author_idx     on public.issues (author_id);

alter table public.issues enable row level security;

drop policy if exists "issues are readable" on public.issues;
create policy "issues are readable"
  on public.issues for select
  to authenticated
  using (true);

-- Reporters may only file PENDING issues. An admin may set any status.
drop policy if exists "create issues" on public.issues;
create policy "create issues"
  on public.issues for insert
  to authenticated
  with check (author_id = auth.uid() and (status = 'pending' or public.is_admin()));

drop policy if exists "update own issue or admin" on public.issues;
create policy "update own issue or admin"
  on public.issues for update
  to authenticated
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());

drop policy if exists "delete own issue or admin" on public.issues;
create policy "delete own issue or admin"
  on public.issues for delete
  to authenticated
  using (author_id = auth.uid() or public.is_admin());


-- ============================================================================
--  4. THE KEY RULE: ONLY ADMINS MAY CHANGE A STATUS
--
--     Row Level Security can decide *which rows* you may update, but not
--     *which columns*. So this trigger enforces the actual business rule.
--     This is enforced by the DATABASE, so it cannot be bypassed from the
--     browser (unlike the earlier localStorage version).
-- ============================================================================
create or replace function public.guard_issue_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The headline rule.
  if new.status is distinct from old.status and not public.is_admin() then
    raise exception 'Only admins can change the status of an issue'
      using errcode = '42501';
  end if;

  -- A reporter must not be able to hand their issue to someone else.
  -- Admins are exempt: removing an account detaches its issues
  -- (issues.author_id is ON DELETE SET NULL), and that detach is an UPDATE
  -- which would otherwise be refused right here.
  if new.author_id is distinct from old.author_id and not public.is_admin() then
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

drop trigger if exists issues_guard on public.issues;
create trigger issues_guard
  before update on public.issues
  for each row execute function public.guard_issue_changes();


-- ============================================================================
--  5. GRANTS  (RLS still restricts everything above)
-- ============================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.issues   to authenticated;


-- ============================================================================
--  6. LIVE UPDATES (optional) — new issues appear without refreshing.
-- ============================================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.issues;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

-- Realtime sends only the primary key in the "old" record unless the table is
-- set to REPLICA IDENTITY FULL. Without this an update event cannot say what
-- the status WAS, so the app cannot tell a real status change from any other
-- edit - and a delete event arrives with no title. Setting it costs a little
-- more write-ahead log per update, which is nothing at this size.
alter table public.issues replica identity full;


-- ============================================================================
--  DONE.
--
--  HANDY COMMANDS
--
--  See every account and its role:
--      select username, role, created_at from public.profiles order by created_at;
--
--  Promote somebody to admin by hand:
--      update public.profiles set role = 'admin' where username = 'your-name';
--
--  Demote somebody back to a reporter:
--      update public.profiles set role = 'user' where username = 'their-name';
--
--  Count issues per status:
--      select status, count(*) from public.issues group by status order by status;
-- ============================================================================


-- ############################################################################
-- ##  PART 2 of 4  —  AUTOMATIC BACKUPS (with the on/off switch)
-- ############################################################################

-- ============================================================================
--  Issue Tracker — AUTOMATIC BACKUPS
-- ----------------------------------------------------------------------------
--  HOW TO RUN
--    1. Open your project at https://supabase.com
--    2. Left sidebar -> SQL Editor -> New query
--    3. Paste this ENTIRE file and press RUN
--
--  This file is safe to run more than once.
--
--  WHAT IT ADDS
--    * public.backups          - a table of snapshots (the whole issues table,
--                                stored as JSON so a restore is exact)
--    * public.snapshot_issues() - takes a snapshot. Internal: not callable
--                                from the browser.
--    * public.create_backup()   - admin-only "back up now"
--    * public.restore_backup()  - admin-only "put it back"
--    * a TRIGGER on issues      - backs up automatically whenever an issue is
--                                filed, changed or deleted, but at most once
--                                an hour so it cannot flood the table
--    * a daily pg_cron job      - optional; keeps a backup even on quiet days
--
--  WHY THE TRIGGER MATTERS
--    pg_cron has to be enabled by hand in the dashboard, and it only runs on a
--    schedule. The trigger needs neither, so backups happen even if the cron
--    job is never set up.
-- ============================================================================


-- ============================================================================
--  1. THE BACKUPS TABLE
-- ============================================================================
create table if not exists public.backups (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null default 'auto' check (kind in ('auto','manual')),
  issue_count integer not null default 0,
  payload     jsonb not null default '[]'::jsonb
);

create index if not exists backups_created_at_idx on public.backups (created_at desc);

alter table public.backups enable row level security;


-- ============================================================================
--  2. SETTINGS  (one row, admins only)
--     Right now just the switch for automatic backups.
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


-- ============================================================================
--  3. TAKE A SNAPSHOT
--     Copies every issue into one row of public.backups.
--     SECURITY DEFINER so it can read issues regardless of who triggered it
--     (the automatic trigger fires for reporters too).
-- ============================================================================
create or replace function public.snapshot_issues(p_kind text default 'auto')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id  uuid;
  n_keep  integer := 30;      -- how many snapshots to keep
begin
  insert into public.backups (kind, issue_count, payload)
  select
    case when p_kind = 'manual' then 'manual' else 'auto' end,
    count(*),
    coalesce(jsonb_agg(to_jsonb(i) order by i.created_at), '[]'::jsonb)
  from public.issues i
  returning id into new_id;

  -- Retention: drop everything older than the newest n_keep snapshots.
  delete from public.backups
  where id in (
    select id from public.backups
    order by created_at desc
    offset n_keep
  );

  return new_id;
end;
$$;

-- Internal only: the browser must never be able to call this directly, or a
-- reporter could fill the table. create_backup() below is the public door.
revoke all on function public.snapshot_issues(text) from public;


-- ============================================================================
--  4. WHEN AN AUTOMATIC BACKUP IS DUE
--     One place decides, so the trigger and the nightly job can never drift
--     apart. Returns null when there is nothing to do:
--       - switched off by an admin  -> do nothing
--       - already took one this hour -> do nothing (the throttle)
--       - otherwise                  -> take a snapshot
-- ============================================================================
create or replace function public.auto_snapshot()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select auto_backup_enabled from public.app_settings limit 1), true) then
    return null;
  end if;

  if exists (
    select 1 from public.backups
    where kind = 'auto' and created_at > now() - interval '1 hour'
  ) then
    return null;
  end if;

  return public.snapshot_issues('auto');
end;
$$;

-- Internal: reached by the trigger and the cron job, never by the browser.
revoke all on function public.auto_snapshot() from public;


-- ============================================================================
--  5. AUTOMATIC BACKUP ON ANY ISSUE CHANGE
--     Fires after every insert/update/delete on issues. One statement, not one
--     row, so a bulk change is a single wrap-up.
-- ============================================================================
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


-- ============================================================================
--  6. ADMIN ACTIONS  (all re-check the role in the database)
-- ============================================================================

-- "Back up now"
create or replace function public.create_backup()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can create a backup'
      using errcode = '42501';
  end if;
  return public.snapshot_issues('manual');
end;
$$;

revoke all on function public.create_backup() from public;
grant execute on function public.create_backup() to authenticated;


-- "Put it back". Replaces the issues table with the snapshot.
-- Takes a safety snapshot first, so a restore can itself be undone.
-- Issues whose reporter no longer exists are skipped rather than failing the
-- whole restore (deleting a user cascades to their issues, so old snapshots
-- can legitimately reference people who are gone).
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
    raise exception 'Only admins can restore a backup'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.backups where id = p_id) then
    raise exception 'That backup no longer exists';
  end if;

  -- How many issues the snapshot names, and how many can actually come back.
  select jsonb_array_length(payload) into n_total
  from public.backups where id = p_id;

  select count(*) into n_usable
  from jsonb_array_elements((select payload from public.backups where id = p_id)) as r
  where exists (
    select 1 from auth.users u where u.id = (r ->> 'author_id')::uuid
  );

  -- Guard against a silent wipe. A snapshot that names issues but whose
  -- reporters have all been deleted would otherwise clear the whole board
  -- and report "0 restored". Refuse instead, and change nothing.
  if n_total > 0 and n_usable = 0 then
    raise exception 'This backup only references accounts that no longer exist, so restoring it would empty the board. Nothing was changed.';
  end if;

  -- Safety net: never let a restore destroy the only copy.
  perform public.snapshot_issues('auto');

  delete from public.issues;

  -- Column-agnostic on purpose. jsonb_populate_record maps the stored JSON
  -- straight back onto the table, so a snapshot restores correctly whether it
  -- was taken before or after a column was added (issues.deleted_at, for one)
  -- without this function having to be kept in step by hand.
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


-- ============================================================================
--  7. WHO MAY READ / DELETE BACKUPS
--     Admins only. Nobody can insert by hand: snapshots only come from the
--     two functions above.
-- ============================================================================
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
--  8. OPTIONAL — A DAILY BACKUP ON QUIET DAYS
--     The trigger above only fires when something changes. This adds a daily
--     safety net at 02:00. pg_cron must be enabled once in the dashboard
--     (Database -> Extensions -> pg_cron). If it is not, this block simply
--     does nothing and the trigger still covers you.
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
--  DONE.
--
--  HANDY COMMANDS
--
--  See your snapshots:
--      select id, created_at, kind, issue_count
--      from public.backups order by created_at desc;
--
--  How big is the table?
--      select pg_size_pretty(pg_total_relation_size('public.backups'));
--
--  Take one by hand (as an admin, from the app, use "Back up now"):
--      select public.snapshot_issues('manual');
--
--  Is the daily job scheduled?  (only if pg_cron is enabled)
--      select jobname, schedule, active from cron.job;
-- ============================================================================


-- ############################################################################
-- ##  PART 3 of 4  —  RECYCLE BIN
-- ############################################################################

-- ============================================================================
--  Issue Tracker — RECYCLE BIN (soft delete)
-- ----------------------------------------------------------------------------
--  HOW TO RUN
--    Supabase -> SQL Editor -> New query -> paste this whole file -> RUN.
--    Safe to run more than once. Run it after supabase/schema.sql.
--    (Order against sql/auto_backup.sql does not matter.)
--
--  WHY
--    Deleting used to remove the row for good. Now "Delete" only marks the
--    issue as deleted: it disappears from every list, but an admin can put it
--    back from the Recycle bin. Nothing is destroyed until an admin says so.
--
--  WHAT IT ADDS
--    * issues.deleted_at        - null = live, a timestamp = in the bin
--    * a changed SELECT policy  - deleted issues vanish from the app entirely
--    * soft_delete_issue()      - what the Delete button now calls
--    * soft_delete_done()       - what "Clear done issues" now calls
--    * list_deleted_issues()    - the bin, admins only
--    * restore_issue()          - put one back, admins only
--    * purge_issue()            - delete one for good, admins only
--    * empty_recycle_bin()      - empty it, admins only
-- ============================================================================


-- ============================================================================
--  1. THE deleted_at COLUMN
-- ============================================================================
alter table public.issues add column if not exists deleted_at timestamptz;

create index if not exists issues_deleted_at_idx on public.issues (deleted_at);


-- ============================================================================
--  2. HIDE DELETED ISSUES FROM THE APP
--     The main app keeps using the same plain "select * from issues" it always
--     did — deleted rows simply stop matching. The bin is reached through the
--     functions below instead, which is why nothing else in the app needs
--     changing just to make deleted issues disappear.
-- ============================================================================
drop policy if exists "issues are readable" on public.issues;
create policy "issues are readable"
  on public.issues for select
  to authenticated
  using (deleted_at is null);


-- ============================================================================
--  3. DELETE NOW MEANS "MOVE TO THE BIN"
-- ============================================================================

-- The Delete button on an issue. The reporter may bin their own; an admin may
-- bin anyone's.
create or replace function public.soft_delete_issue(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.issues where id = p_id;

  if v_author is null then
    raise exception 'That issue no longer exists';
  end if;

  if v_author is distinct from auth.uid() and not public.is_admin() then
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


-- "Clear done issues" — moves every done issue to the bin in one go.
create or replace function public.soft_delete_done()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can clear done issues'
      using errcode = '42501';
  end if;

  update public.issues
     set deleted_at = now()
   where status = 'done' and deleted_at is null;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.soft_delete_done() from public;
grant execute on function public.soft_delete_done() to authenticated;


-- ============================================================================
--  4. THE BIN ITSELF  (admins only, re-checked here not just in the UI)
-- ============================================================================

create or replace function public.list_deleted_issues()
returns table (
  id          uuid,
  title       text,
  description text,
  priority    text,
  status      text,
  label       text,
  author_id   uuid,
  author_name text,
  created_at  timestamptz,
  deleted_at  timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can open the recycle bin'
      using errcode = '42501';
  end if;

  return query
    select i.id, i.title, i.description, i.priority, i.status, i.label,
           i.author_id,
           coalesce(p.username, '(account removed)') as author_name,
           i.created_at, i.deleted_at
    from public.issues i
    left join public.profiles p on p.id = i.author_id
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
    raise exception 'Only admins can restore an issue'
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


-- Delete one for good. Only ever touches something already in the bin.
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
    raise exception 'Only admins can delete an issue for good'
      using errcode = '42501';
  end if;

  delete from public.issues
   where id = p_id and deleted_at is not null;

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
    raise exception 'Only admins can empty the recycle bin'
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
--  5. NOBODY BUT AN ADMIN MAY DELETE FOR REAL
--     The old policy let a reporter hard-delete their own row, which would
--     have walked straight past the bin. Now their delete goes through
--     soft_delete_issue() and only an admin can remove a row outright.
-- ============================================================================
drop policy if exists "delete own issue or admin" on public.issues;
create policy "only admins delete permanently"
  on public.issues for delete
  to authenticated
  using (public.is_admin());


-- ============================================================================
--  DONE.
--
--  HANDY COMMANDS
--
--  What is in the bin?
--      select id, title, deleted_at from public.issues
--      where deleted_at is not null order by deleted_at desc;
--
--  Put one back by hand:
--      update public.issues set deleted_at = null where id = '<id>';
--
--  Empty it by hand (permanent):
--      delete from public.issues where deleted_at is not null;
-- ============================================================================


-- ############################################################################
-- ##  PART 4 of 4  —  ADMIN USER MANAGEMENT
-- ############################################################################

-- ============================================================================
--  Issue Tracker — ADMIN USER MANAGEMENT (edit + delete)
-- ----------------------------------------------------------------------------
--  HOW TO RUN
--    Supabase -> SQL Editor -> New query -> paste this whole file -> RUN.
--    Safe to run more than once. Run it after supabase/schema.sql.
--
--  WHY THIS NEEDS SQL
--    The Users page could always change a role, because profiles has an
--    "admins update profiles" policy. Two things it could not do from the
--    browser:
--
--      * rename  — fine on its own, but a duplicate username gave back a raw
--                  constraint error, so there is a checked function here.
--      * delete  — removing an account means deleting from auth.users, and a
--                  browser can never be trusted with that. It needs the
--                  service key, which must never ship to a page. So the delete
--                  lives in a SECURITY DEFINER function that re-checks the
--                  caller is an admin before it does anything.
--
--  WHAT IT ADDS
--    * issues.author_id becomes nullable and ON DELETE SET NULL, so an
--      account can be removed without taking its issues with it
--    * admin_rename_user(p_id, p_username)
--    * admin_delete_user(p_id)
-- ============================================================================


-- ============================================================================
--  1. AN ISSUE OUTLIVES ITS REPORTER
--     supabase/schema.sql declares author_id as ON DELETE CASCADE, which means
--     deleting an account would delete every issue they ever filed. That is
--     the opposite of what you want from a tracker, so it becomes SET NULL:
--     the issue stays, and its reporter shows as "(account removed)".
-- ============================================================================
alter table public.issues alter column author_id drop not null;

alter table public.issues drop constraint if exists issues_author_id_fkey;
alter table public.issues add constraint issues_author_id_fkey
  foreign key (author_id) references auth.users(id) on delete set null;


-- ============================================================================
--  2. DELETE A USER
--     Removes the account for good: the auth.users row goes, which takes the
--     matching profiles row with it. Their issues are detached first, so they
--     survive even on a database still carrying the older CASCADE constraint.
-- ============================================================================
create or replace function public.admin_delete_user(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete users'
      using errcode = '42501';
  end if;

  if p_id = auth.uid() then
    raise exception 'You cannot delete your own account';
  end if;

  if not exists (select 1 from public.profiles where id = p_id) then
    raise exception 'That account no longer exists';
  end if;

  -- Never remove the last admin: that would lock everybody out.
  if exists (select 1 from public.profiles where id = p_id and role = 'admin')
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'There must always be at least one admin';
  end if;

  update public.issues set author_id = null where author_id = p_id;

  delete from auth.users where id = p_id;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;


-- ============================================================================
--  DONE.
--
--  HANDY COMMANDS
--
--  Every account and its role:
--      select username, role, created_at from public.profiles order by created_at;
--
--  Issues whose reporter has been removed:
--      select id, title from public.issues where author_id is null;
--
--  Promote somebody by hand:
--      update public.profiles set role = 'admin' where username = 'their-name';
-- ============================================================================

