-- ============================================================================
--  sql/admin_status_policy.sql
-- ----------------------------------------------------------------------------
--  ⚠️  READ THIS FIRST — YOU DO NOT NEED TO RUN ANYTHING HERE.
--
--  The protection you asked for ("only admins can UPDATE the status column of
--  issues") is ALREADY in place, and it is enforced in a way that is stronger
--  than a Row Level Security policy can be.
--
--  See supabase/schema.sql:
--      line 158  create or replace function public.guard_issue_changes()
--      line 167    raise exception 'Only admins can change the status of an issue'
--      line 193  create trigger issues_guard
--                  before update on public.issues
--                  for each row execute function public.guard_issue_changes();
--
--  WHY A TRIGGER AND NOT A POLICY?
--      RLS decides WHICH ROWS you may update. It has no way to restrict WHICH
--      COLUMNS you may change. So a policy cannot say "you may edit your own
--      issue's title, but not its status".
--      A BEFORE UPDATE trigger can inspect OLD vs NEW, which is exactly what
--      guard_issue_changes() does. It also raises SQLSTATE 42501, so a raw
--      API call from the browser is rejected by the database itself.
--
--  This file therefore contains:
--      1. What is already protecting you
--      2. Verification queries (READ ONLY — safe to run any time)
--      3. An OPTIONAL, commented-out extra policy (belt and braces only)
-- ============================================================================


-- ============================================================================
--  1. WHAT IS ALREADY PROTECTING YOU
-- ----------------------------------------------------------------------------
--  For reference only — these already exist. Do not re-run them.
-- ============================================================================
--
--  -- Non-admins may only update their OWN issues; admins may update any.
--  create policy "update own issue or admin"
--    on public.issues for update
--    to authenticated
--    using (author_id = auth.uid() or public.is_admin())
--    with check (author_id = auth.uid() or public.is_admin());
--
--  -- ...and even when they ARE allowed to update the row, the trigger stops
--  -- them touching the status column unless they are an admin:
--  if new.status is distinct from old.status and not public.is_admin() then
--    raise exception 'Only admins can change the status of an issue'
--      using errcode = '42501';
--  end if;


-- ============================================================================
--  2. VERIFICATION (read-only)
-- ============================================================================

-- 2a. Confirm the guard function exists and what it does.
select
  p.proname        as function_name,
  p.prosecdef      as security_definer,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'guard_issue_changes';

-- 2b. Confirm the trigger is attached to public.issues.
select
  t.tgname        as trigger_name,
  c.relname       as table_name,
  t.tgenabled     as enabled,          -- 'O' = enabled (origin)
  pg_get_triggerdef(t.oid) as definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'issues'
  and not t.tgisinternal;

-- 2c. Confirm the UPDATE policy on issues.
select
  polname      as policy_name,
  polcmd       as command,             -- 'UPDATE'
  pg_get_expr(polqual, polrelid)      as using_expression,
  pg_get_expr(polwithcheck, polrelid) as with_check_expression
from pg_policy
where polrelid = 'public.issues'::regclass;


-- ============================================================================
--  3. OPTIONAL EXTRA HARDENING — belt and braces
-- ----------------------------------------------------------------------------
--  REDUNDANT. The trigger already blocks this. Only run it if you want a
--  second, independent lock at the policy layer as well.
--
--  A RESTRICTIVE policy is ANDed with the permissive ones, so it can only
--  NARROW access — it can never widen it. This one says: an UPDATE is only
--  ever permitted if you are an admin or it is your own row. That mirrors the
--  existing permissive policy, so behaviour does not change.
--
--  Uncomment the whole block to apply it.
-- ============================================================================
--
-- drop policy if exists "status: admins or own row" on public.issues;
-- create policy "status: admins or own row"
--   on public.issues
--   as restrictive
--   for update
--   to authenticated
--   using (public.is_admin() or author_id = auth.uid())
--   with check (public.is_admin() or author_id = auth.uid());


-- ============================================================================
--  4. HOW TO PROVE IT WORKS
-- ----------------------------------------------------------------------------
--  In the browser console while signed in as a NON-ADMIN reporter, try to
--  change someone's status directly. The database should refuse:
--
--    const { data, error } = await window.ET.getClient()
--      .from('issues')
--      .update({ status: 'done' })
--      .eq('id', '<SOME_ISSUE_UUID>')
--      .select();
--    console.log(error);   // -> "Only admins can change the status of an issue"
--
--  Then sign in as an admin and repeat: it should succeed.
--
--  This is the important part: even if someone edits the JavaScript in their
--  browser, or calls the REST API by hand, the DATABASE still refuses. Hiding
--  the dropdown in the UI is cosmetic; this trigger is the actual security.
-- ============================================================================
