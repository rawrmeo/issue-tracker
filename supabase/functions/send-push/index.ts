// ============================================================================
//  send-push — Supabase Edge Function
// ----------------------------------------------------------------------------
//  Sends a Web Push notification to every device a user has subscribed.
//  Called by the `issues_push_notify` trigger (see sql/push_notifications.sql).
//
//  Deploy:
//    supabase functions deploy send-push
//
//  Secrets:
//    supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
//    supabase secrets set VAPID_SUBJECT=mailto:you@example.com
//    supabase secrets set PUSH_SHARED_SECRET=<same value as app_settings>
//
//  VAPID keys:  npx web-push generate-vapid-keys
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'https://esm.sh/web-push@3.6.7';

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
const SHARED_SECRET = Deno.env.get('PUSH_SHARED_SECRET') ?? '';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

interface Body {
  user_id?: string;
  title?: string;
  body?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  // Only the database trigger should be calling this.
  if (SHARED_SECRET && req.headers.get('x-push-secret') !== SHARED_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ error: 'VAPID keys are not set' }, 500);
  }

  let payload: Body;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  const { user_id, title, body } = payload;
  if (!user_id) return json({ error: 'user_id is required' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', user_id);

  if (error) return json({ error: error.message }, 500);
  if (!subs || subs.length === 0) return json({ sent: 0, removed: 0, note: 'no devices' });

  const message = JSON.stringify({
    title: title ?? 'Issue Tracker',
    body: body ?? '',
    url: './',
  });

  let sent = 0;
  let removed = 0;
  let failed = 0;

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        message,
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        // The device is gone — forget it so we stop trying.
        await supabase.from('push_subscriptions').delete().eq('id', s.id);
        removed++;
      } else {
        failed++;
      }
    }
  }));

  return json({ sent, removed, failed });
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
