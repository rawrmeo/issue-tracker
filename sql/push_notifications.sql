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
