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
