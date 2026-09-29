// ============================================================================
//  api — the public REST API for the Issue Tracker
// ----------------------------------------------------------------------------
//  One Edge Function that authenticates an API key, enforces its role
//  (user | admin) and serves JSON over /functions/v1/api/v1/...
//
//  Deploy:
//    supabase functions deploy api
//
//  Auth:
//    x-api-key: itk_<48 hex>          (or  Authorization: Bearer itk_...)
//
//  Keys live in public.api_keys as a SHA-256 hash (see sql/api.sql). Only this
//  function holds the service role; every rule the app enforces is re-checked
//  here because the service role bypasses Row Level Security.
//
//  Docs + endpoint catalog: API.md  ·  machine spec: openapi.yaml
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const API_VERSION = 'v1';
const RATE_LIMIT_PER_MIN = 120;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

type Role = 'admin' | 'user';
type Ctx = { keyId: string; role: Role; profileId: string };
type Row = Record<string, unknown>;

/* ------------------------------- utilities ------------------------------- */

function send(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}

function fail(code: string, message: string, status = 400): Response {
  return send({ error: { code, message } }, status);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function db() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function readJson(req: Request): Promise<Row> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body as Row : {};
  } catch {
    return {};
  }
}

function str(value: unknown, max: number): string {
  return String(value ?? '').slice(0, max);
}

function int(value: string | null, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), max);
}

const STATUSES = ['pending', 'fixing', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------ rate limiting ---------------------------- */
// Best-effort, per warm isolate. Enough to stop a runaway script; for hard
// guarantees put a gateway/Cloudflare in front or move the counter to a table.
const buckets = new Map<string, { n: number; reset: number }>();
function rateLimited(id: string): boolean {
  const now = Date.now();
  const b = buckets.get(id);
  if (!b || now > b.reset) {
    buckets.set(id, { n: 1, reset: now + 60_000 });
    return false;
  }
  b.n += 1;
  return b.n > RATE_LIMIT_PER_MIN;
}

/* ---------------------------------- boot --------------------------------- */

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/api(?=\/|$)/, '') || '/';
  let seg = path.split('/').filter(Boolean);
  if (seg[0] === API_VERSION) seg = seg.slice(1);   // accept /v1/... (and bare /...)
  const method = req.method.toUpperCase();
  const q = url.searchParams;

  // Health is public so an uptime monitor can reach it.
  if (seg[0] === 'health' && seg.length === 1 && method === 'GET') {
    return send({ status: 'ok', service: 'issue-tracker-api', version: API_VERSION, time: new Date().toISOString() });
  }

  const rawKey = req.headers.get('x-api-key') ?? bearer(req.headers.get('authorization'));
  if (!rawKey) {
    return fail('unauthorized', 'Missing API key. Send it in the x-api-key header.', 401);
  }

  const sb = db();
  const hash = await sha256(rawKey);
  const { data: keyRow, error: keyErr } = await sb
    .from('api_keys')
    .select('id, role, profile_id, revoked_at')
    .eq('key_hash', hash)
    .maybeSingle();

  if (keyErr) return fail('server_error', keyErr.message, 500);
  if (!keyRow || keyRow.revoked_at) return fail('invalid_key', 'Invalid or revoked API key.', 401);

  const ctx: Ctx = { keyId: keyRow.id, role: keyRow.role as Role, profileId: keyRow.profile_id };

  if (rateLimited(ctx.keyId)) {
    return new Response(JSON.stringify({ error: { code: 'rate_limited', message: `More than ${RATE_LIMIT_PER_MIN} requests/minute.` } }), {
      status: 429,
      headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '60', ...CORS },
    });
  }

  // Fire-and-forget usage stamp.
  sb.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', ctx.keyId).then(() => {}, () => {});

  try {
    return await route(sb, ctx, method, seg, q, req);
  } catch (e) {
    console.error('api error', e);
    return fail('server_error', (e as Error)?.message ?? String(e), 500);
  }
});

/* --------------------------------- router -------------------------------- */

async function route(
  sb: ReturnType<typeof createClient>,
  ctx: Ctx,
  method: string,
  seg: string[],
  q: URLSearchParams,
  req: Request,
): Promise<Response> {
  const [r1, r2, r3] = seg;

  if (r1 === 'me' && !r2 && method === 'GET') {
    const { data, error } = await sb.from('profiles')
      .select('id, username, role, created_at')
      .eq('id', ctx.profileId)
      .maybeSingle();
    if (error) return fail('server_error', error.message, 500);
    if (!data) return fail('not_found', 'Profile not found', 404);
    return send({ data: { ...data, api_role: ctx.role } });
  }

  if (r1 === 'issues') return issues(sb, ctx, method, seg, q, req);
  if (r1 === 'users') return users(sb, ctx, method, seg, q, req);
  if (r1 === 'stats' && !r2 && method === 'GET') return stats(sb, ctx);
  if (r1 === 'archive') return archive(sb, ctx, method, seg);
  if (r1 === 'notifications') return notifications(sb, ctx, method, seg);
  if (r1 === 'keys') return keys(sb, ctx, method, seg, req);

  return fail('not_found', `No route for ${method} ${pathOf(seg)}`, 404);
}

function pathOf(seg: string[]): string {
  return '/v1/' + seg.join('/');
}

/* --------------------------------- issues -------------------------------- */

async function issues(
  sb: ReturnType<typeof createClient>,
  ctx: Ctx,
  method: string,
  seg: string[],
  q: URLSearchParams,
  req: Request,
): Promise<Response> {
  const id = seg[1];
  const sub = seg[2];
  const admin = ctx.role === 'admin';

  if (method === 'GET' && !id) return listIssues(sb, ctx, q);
  if (method === 'POST' && !id) return createIssue(sb, ctx, req);

  if (id && !UUID.test(id)) return fail('validation_error', 'Issue id must be a UUID', 400);

  if (method === 'GET' && id) {
    const { data, error } = await sb.from('issues').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
    if (error) return fail('server_error', error.message, 500);
    if (!data) return fail('not_found', 'Issue not found', 404);
    return send({ data });
  }

  if ((method === 'PATCH' || method === 'PUT') && id) return updateIssue(sb, ctx, id, req);
  if (method === 'DELETE' && id) return deleteIssue(sb, ctx, id);
  if (method === 'POST' && id && sub === 'restore') return restoreIssue(sb, ctx, id);

  return fail('not_found', `No issues route for ${method} ${pathOf(seg)}`, 404);
}

async function listIssues(
  sb: ReturnType<typeof createClient>,
  ctx: Ctx,
  q: URLSearchParams,
): Promise<Response> {
  const limit = int(q.get('limit'), 25, 100);
  const offset = int(q.get('offset'), 0, 100000);
  const sort = q.get('sort') ?? 'created_at';
  const order = (q.get('order') ?? 'desc').toLowerCase() === 'asc';
  const allowedSort = ['created_at', 'updated_at', 'completed_at', 'priority', 'status', 'title'];
  const sortField = allowedSort.includes(sort) ? sort : 'created_at';

  let query = sb.from('issues').select('*', { count: 'exact' }).is('deleted_at', null);

  const status = q.get('status');
  if (status && STATUSES.includes(status)) query = query.eq('status', status);
  const priority = q.get('priority');
  if (priority && PRIORITIES.includes(priority)) query = query.eq('priority', priority);
  const label = q.get('label');
  if (label) query = query.eq('label', label);

  const author = q.get('author_id') ?? (q.get('mine') === 'true' ? ctx.profileId : null);
  if (author && UUID.test(author)) query = query.eq('author_id', author);

  const from = q.get('created_from');
  if (from) query = query.gte('created_at', from);
  const to = q.get('created_to');
  if (to) query = query.lt('created_at', to);

  const search = q.get('q');
  if (search) {
    const safe = search.replace(/[%,()*]/g, ' ').trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }

  const { data, error, count } = await query
    .order(sortField, { ascending: order })
    .range(offset, offset + limit - 1);

  if (error) return fail('server_error', error.message, 500);
  return send({ data: data ?? [], meta: { limit, offset, count: count ?? (data?.length ?? 0), api_role: ctx.role } });
}

async function createIssue(
  sb: ReturnType<typeof createClient>,
  ctx: Ctx,
  req: Request,
): Promise<Response> {
  const body = await readJson(req);
  const title = str(body.title, 140).trim();
  if (!title) return fail('validation_error', 'title is required', 422);

  const admin = ctx.role === 'admin';
  const status = admin && STATUSES.includes(String(body.status)) ? String(body.status) : 'pending';
  const author = admin && typeof body.author_id === 'string' && UUID.test(body.author_id)
    ? body.author_id
    : ctx.profileId;

  const row = {
    title,
    description: str(body.description, 2000),
    priority: PRIORITIES.includes(String(body.priority)) ? String(body.priority) : 'medium',
    label: str(body.label, 40),
    status,
    author_id: author,
  };

  const { data, error } = await sb.from('issues').insert(row).select().single();
  if (error) return fail('server_error', error.message, 400);
  return send({ data }, 201);
}

async function updateIssue(
  sb: ReturnType<typeof createClient>,
  ctx: Ctx,
  id: string,
  req: Request,
): Promise<Response> {
  const body = await readJson(req);
  const admin = ctx.role === 'admin';

  const { data: current, error: loadErr } = await sb.from('issues').select('*').eq('id', id).maybeSingle();
  if (loadErr) return fail('server_error', loadErr.message, 500);
  if (!current) return fail('not_found', 'Issue not found', 404);

  const mine = current.author_id === ctx.profileId;
  if (!admin && !mine) return fail('forbidden', 'You can only change your own issues.', 403);

  const patch: Row = {};

  // Title / description / label: the reporter owns their words. An admin
  // changing someone else's issue cannot rewrite them (same rule as the app).
  if (body.title !== undefined || body.description !== undefined || body.label !== undefined) {
    if (admin && !mine) {
      // ignore the rewrite fields
    } else {
      if (body.title !== undefined) {
        const t = str(body.title, 140).trim();
        if (!t) return fail('validation_error', 'title cannot be empty', 422);
        patch.title = t;
      }
      if (body.description !== undefined) patch.description = str(body.description, 2000);
      if (body.label !== undefined) patch.label = str(body.label, 40);
    }
  }

  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(String(body.priority))) return fail('validation_error', 'priority must be low, medium or high', 422);
    patch.priority = String(body.priority);
  }

  if (body.status !== undefined) {
    if (!admin) return fail('forbidden', 'Only admins can change the status.', 403);
    if (!STATUSES.includes(String(body.status))) return fail('validation_error', 'status must be pending, fixing or done', 422);
    patch.status = String(body.status);
  }

  if (body.admin_note !== undefined) {
    if (!admin) return fail('forbidden', 'Only admins can leave a message.', 403);
    patch.admin_note = str(body.admin_note, 2000);
    patch.admin_note_at = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) return fail('validation_error', 'No supported fields to update', 422);

  const { data, error } = await sb.from('issues').update(patch).eq('id', id).select().single();
  if (error) return fail('server_error', error.message, 400);
  return send({ data });
}

async function deleteIssue(
  sb: ReturnType<typeof createClient>,
  ctx: Ctx,
  id: string,
): Promise<Response> {
  const { data: current, error: loadErr } = await sb.from('issues').select('id, author_id, deleted_at').eq('id', id).maybeSingle();
  if (loadErr) return fail('server_error', loadErr.message, 500);
  if (!current) return fail('not_found', 'Issue not found', 404);
  if (ctx.role !== 'admin' && current.author_id !== ctx.profileId) {
    return fail('forbidden', 'You can only delete your own issues.', 403);
  }
  // Soft delete, exactly like the app: it lands in the Archive.
  const { error } = await sb.from('issues').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) return fail('server_error', error.message, 400);
  return send({ data: { id, deleted: true, soft: true } });
}

async function restoreIssue(
  sb: ReturnType<typeof createClient>,
  ctx: Ctx,
  id: string,
): Promise<Response> {
  if (ctx.role !== 'admin') return fail('forbidden', 'Admin role required.', 403);
  const { data, error } = await sb.from('issues').update({ deleted_at: null }).eq('id', id).select().maybeSingle();
  if (error) return fail('server_error', error.message, 400);
  if (!data) return fail('not_found', 'Issue not found', 404);
  return send({ data });
}

/* ---------------------------------- users -------------------------------- */

async function users(
  sb: ReturnType<typeof createClient>,
  ctx: Ctx,
  method: string,
  seg: string[],
  q: URLSearchParams,
  req: Request,
): Promise<Response> {
  if (ctx.role !== 'admin') return fail('forbidden', 'Admin role required.', 403);
  const id = seg[1];

  if (method === 'GET' && !id) {
    const limit = int(q.get('limit'), 50, 200);
    const offset = int(q.get('offset'), 0, 100000);
    const { data, error, count } = await sb.from('profiles')
      .select('id, username, role, created_at', { count: 'exact' })
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) return fail('server_error', error.message, 500);
    return send({ data: data ?? [], meta: { limit, offset, count: count ?? 0 } });
  }

  if (id && !UUID.test(id)) return fail('validation_error', 'User id must be a UUID', 400);

  if (method === 'GET' && id) {
    const { data, error } = await sb.from('profiles').select('id, username, role, created_at').eq('id', id).maybeSingle();
    if (error) return fail('server_error', error.message, 500);
    if (!data) return fail('not_found', 'User not found', 404);
    return send({ data });
  }

  if ((method === 'PATCH' || method === 'PUT') && id) {
    const body = await readJson(req);
    const role = String(body.role);
    if (!['admin', 'user'].includes(role)) return fail('validation_error', 'role must be admin or user', 422);
    if (id === ctx.profileId) return fail('forbidden', 'You cannot change your own role.', 403);

    const { count } = await sb.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'admin');
    const { data: target } = await sb.from('profiles').select('role').eq('id', id).maybeSingle();
    if (!target) return fail('not_found', 'User not found', 404);
    if (target.role === 'admin' && role === 'user' && (count ?? 0) <= 1) {
      return fail('conflict', 'There must always be at least one admin.', 409);
    }

    const { data, error } = await sb.from('profiles').update({ role }).eq('id', id).select('id, username, role, created_at').single();
    if (error) return fail('server_error', error.message, 400);
    return send({ data });
  }

  return fail('not_found', `No users route for ${method} ${pathOf(seg)}`, 404);
}

/* ---------------------------------- stats -------------------------------- */

async function stats(sb: ReturnType<typeof createClient>, ctx: Ctx): Promise<Response> {
  const pAuthor = ctx.role === 'admin' ? null : ctx.profileId;
  const { data, error } = await sb.rpc('api_stats', { p_author: pAuthor });
  if (error) return fail('server_error', error.message, 500);
  return send({ data: { scope: ctx.role === 'admin' ? 'all' : 'mine', ...(data ?? {}) } });
}

/* --------------------------------- archive ------------------------------- */

async function archive(
  sb: ReturnType<typeof createClient>,
  ctx: Ctx,
  method: string,
  seg: string[],
): Promise<Response> {
  if (ctx.role !== 'admin') return fail('forbidden', 'Admin role required.', 403);
  const id = seg[1];

  if (method === 'GET' && !id) {
    const { data, error } = await sb.from('issues').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
    if (error) return fail('server_error', error.message, 500);
    return send({ data: data ?? [] });
  }

  if (method === 'DELETE' && !id) {
    const { error } = await sb.from('issues').delete().not('deleted_at', 'is', null);
    if (error) return fail('server_error', error.message, 400);
    return send({ data: { emptied: true } });
  }

  if (method === 'POST' && id && seg[2] === 'restore') {
    if (!UUID.test(id)) return fail('validation_error', 'Issue id must be a UUID', 400);
    return restoreIssue(sb, ctx, id);
  }

  return fail('not_found', `No archive route for ${method} ${pathOf(seg)}`, 404);
}

/* ------------------------------ notifications ---------------------------- */

async function notifications(
  sb: ReturnType<typeof createClient>,
  ctx: Ctx,
  method: string,
  seg: string[],
): Promise<Response> {
  if (method === 'GET' && !seg[1]) {
    const { data, error } = await sb.from('notifications')
      .select('id, kind, title, body, issue_id, created_at, read_at')
      .eq('user_id', ctx.profileId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return fail('server_error', error.message, 500);
    return send({ data: data ?? [] });
  }

  if (method === 'POST' && seg[1] === 'read-all') {
    const { error } = await sb.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', ctx.profileId)
      .is('read_at', null);
    if (error) return fail('server_error', error.message, 400);
    return send({ data: { read: true } });
  }

  if ((method === 'PATCH' || method === 'PUT') && seg[1] && seg[2] === 'read') {
    if (!UUID.test(seg[1])) return fail('validation_error', 'Notification id must be a UUID', 400);
    const { error } = await sb.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', seg[1])
      .eq('user_id', ctx.profileId);
    if (error) return fail('server_error', error.message, 400);
    return send({ data: { id: seg[1], read: true } });
  }

  return fail('not_found', `No notifications route for ${method} ${pathOf(seg)}`, 404);
}

/* --------------------------------- keys ---------------------------------- */

async function keys(
  sb: ReturnType<typeof createClient>,
  ctx: Ctx,
  method: string,
  seg: string[],
  req: Request,
): Promise<Response> {
  if (ctx.role !== 'admin') return fail('forbidden', 'Admin role required.', 403);
  const id = seg[1];

  if (method === 'GET' && !id) {
    const { data, error } = await sb.from('api_keys')
      .select('id, name, prefix, role, profile_id, created_at, last_used_at, revoked_at')
      .order('created_at', { ascending: false });
    if (error) return fail('server_error', error.message, 500);
    return send({ data: data ?? [] });
  }

  if (method === 'POST' && !id) {
    const body = await readJson(req);
    const name = str(body.name, 80).trim();
    if (!name) return fail('validation_error', 'name is required', 422);
    const role: Role = String(body.role) === 'admin' ? 'admin' : 'user';
    const profileId = typeof body.profile_id === 'string' && UUID.test(body.profile_id) ? body.profile_id : ctx.profileId;

    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const raw = 'itk_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const prefix = raw.slice(0, 12);
    const hash = await sha256(raw);

    const { data, error } = await sb.from('api_keys').insert({
      name, prefix, key_hash: hash, role, profile_id: profileId,
    }).select('id, name, prefix, role, profile_id, created_at').single();
    if (error) return fail('server_error', error.message, 400);

    // The plaintext key is returned exactly once.
    return send({ data: { ...data, key: raw } }, 201);
  }

  if (id && !UUID.test(id)) return fail('validation_error', 'Key id must be a UUID', 400);

  if (method === 'DELETE' && id) {
    const { data, error } = await sb.from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, revoked_at')
      .maybeSingle();
    if (error) return fail('server_error', error.message, 400);
    if (!data) return fail('not_found', 'Key not found', 404);
    return send({ data });
  }

  return fail('not_found', `No keys route for ${method} ${pathOf(seg)}`, 404);
}
