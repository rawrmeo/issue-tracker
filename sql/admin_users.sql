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
--  2. RENAME A USER
--     The role is still changed straight from the Users page using the
--     existing policy; this is only for the username, so a clash comes back
--     as a readable message instead of a constraint violation.
-- ============================================================================
create or replace function public.admin_rename_user(p_id uuid, p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := btrim(coalesce(p_username, ''));
begin
  if not public.is_admin() then
    raise exception 'Only admins can edit users'
      using errcode = '42501';
  end if;

  if v_username = '' then
    raise exception 'A username cannot be empty';
  end if;

  if not exists (select 1 from public.profiles where id = p_id) then
    raise exception 'That account no longer exists';
  end if;

  if exists (
    select 1 from public.profiles
    where lower(username) = lower(v_username) and id <> p_id
  ) then
    raise exception 'That username is already taken';
  end if;

  update public.profiles set username = v_username where id = p_id;
end;
$$;

revoke all on function public.admin_rename_user(uuid, text) from public;
grant execute on function public.admin_rename_user(uuid, text) to authenticated;


-- ============================================================================
--  3. DELETE A USER
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
