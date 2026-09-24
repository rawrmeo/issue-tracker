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
