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
