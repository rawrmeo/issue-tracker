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
