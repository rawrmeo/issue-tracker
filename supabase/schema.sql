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
