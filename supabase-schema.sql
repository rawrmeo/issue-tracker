-- =====================================================================
--  ISSUE TRACKER — SUPABASE DATABASE SCHEMA
--  ---------------------------------------------------------------------
--  HOW TO RUN
--    1. Open your Supabase project.
--    2. Go to  SQL Editor  ->  New query.
--    3. Paste this whole file and press RUN.
--    4. You should see "Success. No rows returned".
--
--  Safe to run more than once (everything is guarded with IF NOT EXISTS
--  or DROP ... IF EXISTS below).
-- =====================================================================

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";


-- =====================================================================
--  1. PROFILES  — one row per user, holds the ROLE
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
--  2. ISSUES  — the actual tracker records
-- =====================================================================
create table if not exists public.issues (
  id               uuid primary key default gen_random_uuid(),
  title            text        not null,
  description      text        not null default '',
  status           text        not null default 'none',
  priority         text        not null default 'medium' check (priority in ('low','medium','high')),
  -- who reported it
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
--      profiles_update_self lets a user touch their own row (e.g. their
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
