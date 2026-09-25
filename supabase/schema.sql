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

-- A message an administrator can leave for the reporter after fixing an
-- issue. Empty by default, so this is safe to add to an existing database.
alter table public.issues add column if not exists admin_note    text        not null default '';
alter table public.issues add column if not exists admin_note_at timestamptz;

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


-- ============================================================================
--  RECYCLE BIN + ADMIN MESSAGE (see sql/ for the standalone versions)
-- ============================================================================

-- ============================================================================
--  RECYCLE BIN  (deleting stops being destructive)
-- ----------------------------------------------------------------------------
--  Run once in Supabase -> SQL Editor -> New query -> Run. Safe to repeat.
--
--  * issues.deleted_at  marks a row as binned instead of removing it
--  * the "issues are readable" policy hides binned rows from every normal
--    query, so they leave the board, the dashboard and every count
--  * list_deleted_issues(), restore_issue() and empty_recycle_bin() are
--    admin-only, and the check happens inside the database
-- ============================================================================

alter table public.issues add column if not exists deleted_at timestamptz;
create index if not exists issues_deleted_at_idx on public.issues (deleted_at);

-- Binned rows disappear from every read.
drop policy if exists "issues are readable" on public.issues;
create policy "issues are readable"
  on public.issues for select
  to authenticated
  using (deleted_at is null);

-- Admin: what is in the bin.
create or replace function public.list_deleted_issues()
returns table (
  id uuid, title text, description text, priority text, status text, label text,
  author_id uuid, created_at timestamptz, updated_at timestamptz,
  completed_at timestamptz, deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can open the recycle bin'
      using errcode = '42501';
  end if;
  return query
    select i.id, i.title, i.description, i.priority, i.status, i.label,
           i.author_id, i.created_at, i.updated_at, i.completed_at, i.deleted_at
    from public.issues i
    where i.deleted_at is not null
    order by i.deleted_at desc;
end;
$$;

revoke all on function public.list_deleted_issues() from public;
grant execute on function public.list_deleted_issues() to authenticated;

-- Admin: put one back on the board.
create or replace function public.restore_issue(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can restore an issue'
      using errcode = '42501';
  end if;
  update public.issues set deleted_at = null where id = p_id;
end;
$$;

revoke all on function public.restore_issue(uuid) from public;
grant execute on function public.restore_issue(uuid) to authenticated;

-- Admin: remove everything in the bin for good.
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
-- =============================================================================
--  ADMIN MESSAGE TO THE REPORTER
--  ----------------------------------------------------------------------------
--  Adds the two columns behind the "Message to the reporter" box that an
--  administrator can fill in when editing / fixing an issue. The person who
--  reported the issue then sees the message on their own issue.
--
--  Run this once in Supabase -> SQL Editor -> New query -> Run. It is safe to
--  run more than once. The same columns are already included in
--  ../supabase/schema.sql.
-- =============================================================================

alter table public.issues add column if not exists admin_note    text        not null default '';
alter table public.issues add column if not exists admin_note_at timestamptz;


-- ============================================================================
--  AUTOMATIC BACKUPS (see sql/backups.sql)
-- ============================================================================

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


-- ============================================================================
--  PUSH NOTIFICATIONS (see sql/push_notifications.sql)
-- ============================================================================

-- ============================================================================
--  PUSH NOTIFICATIONS
-- ----------------------------------------------------------------------------
--  Lets a reporter get told on their phone — even with the app closed — when
--  an admin leaves a message, or marks their issue done.
--
--  SETUP (once):
--    1. Run this file in Supabase -> SQL Editor -> Run.
--    2. Generate a VAPID key pair:   npx web-push generate-vapid-keys
--    3. Put the PUBLIC key in supabase-config.js (vapidPublicKey).
--    4. Deploy the sender:  supabase functions deploy send-push
--       and set its secrets:
--         supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
--                           VAPID_SUBJECT=mailto:you@example.com
--    5. Point the trigger at the function (replace <ref> and pick a secret):
--         update public.app_settings
--           set push_function_url  = 'https://<ref>.supabase.co/functions/v1/send-push',
--               push_shared_secret = 'some-long-random-string';
--       and give the function the same value:
--         supabase secrets set PUSH_SHARED_SECRET=some-long-random-string
-- ============================================================================

-- pg_net lets Postgres make the HTTP call to the Edge Function.
create extension if not exists pg_net with schema extensions;

-- Where a device's subscription lives.
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null default '',
  auth       text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions"
  on public.push_subscriptions for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "admins read push subscriptions" on public.push_subscriptions;
create policy "admins read push subscriptions"
  on public.push_subscriptions for select
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.push_subscriptions to authenticated;


-- Two admin-only settings that drive the sender.
alter table public.app_settings add column if not exists push_function_url  text not null default '';
alter table public.app_settings add column if not exists push_shared_secret text not null default '';


-- Fire a notification when an admin finishes an issue or leaves a message.
create or replace function public.notify_push()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_url    text;
  v_secret text;
  v_user   uuid;
  v_title  text;
  v_body   text;
begin
  -- Who should hear about this, and what should it say?
  if new.status = 'done' and old.status is distinct from 'done' then
    v_user  := new.author_id;
    v_title := 'Your issue is marked done';
    v_body  := new.title;
  elsif coalesce(new.admin_note, '') <> '' and new.admin_note is distinct from old.admin_note then
    v_user  := new.author_id;
    v_title := 'Message from an admin';
    v_body  := new.title || ' — ' || new.admin_note;
  else
    return new;                                   -- nothing worth sending
  end if;

  select push_function_url, push_shared_secret
    into v_url, v_secret
    from public.app_settings limit 1;

  if v_url is null or v_url = '' then return new; end if;   -- not configured yet
  if v_user is null then return new; end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-push-secret', coalesce(v_secret, '')
               ),
    body    := jsonb_build_object('user_id', v_user, 'title', v_title, 'body', v_body)
  );

  return new;
end;
$$;

drop trigger if exists issues_push_notify on public.issues;
create trigger issues_push_notify
  after update on public.issues
  for each row execute function public.notify_push();


-- ============================================================================
--  NOTIFICATIONS (see sql/notifications.sql)
-- ============================================================================

-- ============================================================================
--  NOTIFICATIONS  (in-app feed + push, for both roles)
-- ----------------------------------------------------------------------------
--  WHAT PEOPLE HEAR ABOUT
--    * a new issue is reported        -> every admin
--    * an admin marks an issue done   -> the reporter
--    * an admin leaves a comment      -> the reporter
--
--  HOW
--    public.notifications        one row per person per event (the bell feed)
--    send_notification(...)      writes the row AND pushes it, if push is set
--    notify_issue_event()        the one trigger that decides who to tell
--
--  Run once in Supabase -> SQL Editor -> Run. Safe to repeat.
--  Push needs sql/push_notifications.sql's settings (see the README).
-- ============================================================================

create extension if not exists pg_net with schema extensions;

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null default 'info',
  title      text not null default '',
  body       text not null default '',
  issue_id   uuid,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "own notifications read" on public.notifications;
create policy "own notifications read"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "own notifications update" on public.notifications;
create policy "own notifications update"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, update on public.notifications to authenticated;


-- Tell one person: store it for the bell, and push it to their phone.
create or replace function public.send_notification(
  p_user  uuid,
  p_kind  text,
  p_title text,
  p_body  text,
  p_issue uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_url    text;
  v_secret text;
begin
  if p_user is null then return; end if;

  insert into public.notifications (user_id, kind, title, body, issue_id)
  values (p_user, coalesce(p_kind, 'info'), coalesce(p_title, ''),
          coalesce(p_body, ''), p_issue);

  select push_function_url, push_shared_secret
    into v_url, v_secret
    from public.app_settings limit 1;

  if v_url is not null and v_url <> '' then
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-push-secret', coalesce(v_secret, '')
                 ),
      body    := jsonb_build_object('user_id', p_user, 'title', p_title, 'body', p_body)
    );
  end if;
end;
$$;

revoke all on function public.send_notification(uuid, text, text, text, uuid) from public;


-- The one trigger: work out who should hear about an issue event.
create or replace function public.notify_issue_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if tg_op = 'INSERT' then
    -- Everyone who can act on it — except an admin reporting their own.
    for r in
      select id from public.profiles
      where role = 'admin' and id is distinct from new.author_id
    loop
      perform public.send_notification(r.id, 'new-issue', 'New issue reported', new.title, new.id);
    end loop;
    return new;
  end if;

  -- Status reached Done -> tell the reporter.
  if new.status = 'done' and old.status is distinct from 'done' then
    perform public.send_notification(
      new.author_id, 'done', 'Your issue is marked done', new.title, new.id);
  end if;

  -- A new message from an admin -> tell the reporter.
  if coalesce(new.admin_note, '') <> ''
     and new.admin_note is distinct from old.admin_note then
    perform public.send_notification(
      new.author_id, 'message', 'Message from an admin',
      new.title || ' — ' || new.admin_note, new.id);
  end if;

  return new;
end;
$$;

-- Replace the older push-only trigger with this one.
drop trigger if exists issues_push_notify on public.issues;
drop trigger if exists issues_notify on public.issues;
create trigger issues_notify
  after insert or update on public.issues
  for each row execute function public.notify_issue_event();

revoke all on function public.notify_issue_event() from public;
