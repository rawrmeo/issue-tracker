-- ============================================================================
--  sql/webhooks.sql
-- ----------------------------------------------------------------------------
--  Backend for the outbound "Web API": POST an issue event to a URL whenever
--  an issue changes. There is NO page for this in the app; manage endpoints
--  from the Supabase SQL Editor.
--
--  Run once in Supabase -> SQL Editor -> Run. Safe to repeat.
--
--  Register:   insert into public.webhook_endpoints (name, url, secret)
--              values ('for Ana', 'https://her-server/hooks/issues', 'shared-secret');
--  List:       select name, url, events, active, created_at
--              from public.webhook_endpoints order by created_at desc;
--  Pause:      update public.webhook_endpoints set active = false where id = '...';
--  Delete:     delete from public.webhook_endpoints where id = '...';
--  Recent:     select event, endpoint_id, created_at
--              from public.webhook_deliveries order by created_at desc limit 20;
--
--  Events: issue.created, issue.updated, issue.status_changed, issue.done,
--          issue.deleted. An endpoint with events = '{*}' gets them all.
--  Each request carries:  x-webhook-event  and  x-webhook-secret
-- ============================================================================

create extension if not exists pg_net with schema extensions;


-- ============================================================================
--  1. ENDPOINTS + DELIVERY LOG
-- ============================================================================

create table if not exists public.webhook_endpoints (
  id             uuid primary key default gen_random_uuid(),
  name           text not null default '',
  url            text not null,
  secret         text not null default '',
  events         text[] not null default array['*'],
  active         boolean not null default true,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  last_status    integer,
  last_called_at timestamptz
);

create table if not exists public.webhook_deliveries (
  id          uuid primary key default gen_random_uuid(),
  endpoint_id uuid references public.webhook_endpoints(id) on delete cascade,
  event       text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists webhook_deliveries_endpoint_idx
  on public.webhook_deliveries (endpoint_id, created_at desc);

alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;

-- Safety net only (no UI): admins may read them.
drop policy if exists "admins read webhooks" on public.webhook_endpoints;
create policy "admins read webhooks" on public.webhook_endpoints
  for select to authenticated using (public.is_admin());

drop policy if exists "admins read webhook deliveries" on public.webhook_deliveries;
create policy "admins read webhook deliveries" on public.webhook_deliveries
  for select to authenticated using (public.is_admin());

grant select on public.webhook_endpoints  to authenticated;
grant select on public.webhook_deliveries to authenticated;
grant all on public.webhook_endpoints  to service_role;
grant all on public.webhook_deliveries to service_role;


-- ============================================================================
--  2. DISPATCH - fire on every issue change
--     Honours app.silent (set during a backup restore) so a restore does not
--     spam subscribers.
-- ============================================================================

create or replace function public.api_dispatch_webhooks()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  r       record;
  v_event text;
  v_body  jsonb;
begin
  if coalesce(current_setting('app.silent', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_event := 'issue.created';
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_event := 'issue.deleted';
  elsif new.status = 'done' and old.status is distinct from 'done' then
    v_event := 'issue.done';
  elsif new.status is distinct from old.status then
    v_event := 'issue.status_changed';
  else
    v_event := 'issue.updated';
  end if;

  v_body := jsonb_build_object('event', v_event, 'at', now(), 'data', to_jsonb(new));

  for r in
    select id, url, secret, events
    from public.webhook_endpoints
    where active
  loop
    if '*' = any(r.events) or v_event = any(r.events) then
      insert into public.webhook_deliveries (endpoint_id, event, payload)
      values (r.id, v_event, v_body);

      perform net.http_post(
        url     := r.url,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'x-webhook-event', v_event,
                     'x-webhook-secret', coalesce(r.secret, '')
                   ),
        body    := v_body
      );
    end if;
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists issues_api_webhooks on public.issues;
create trigger issues_api_webhooks
  after insert or update on public.issues
  for each row execute function public.api_dispatch_webhooks();

revoke all on function public.api_dispatch_webhooks() from public;
