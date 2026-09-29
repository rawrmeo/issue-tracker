# Issue Tracker — Public REST API (v1)

A JSON API other systems can consume. It is served by the Supabase Edge
Function `api` (`supabase/functions/api/index.ts`) and authenticated with an
**API key**. Every endpoint is scoped to a key role: **`user`** or **`admin`**.

- **Base URL:** `https://<project-ref>.supabase.co/functions/v1/api`
- **Version:** `v1` (paths are rooted at `/v1`)
- **Format:** JSON in, JSON out (UTF-8)
- **Machine spec:** [`openapi.yaml`](openapi.yaml)
- **Testing guide:** [`TESTING.md`](TESTING.md)
- **Database setup:** [`sql/api.sql`](sql/api.sql)
- **Gateway code:** `supabase/functions/api/index.ts`

---

## 1. Quick start

```bash
# Health (no key)
curl https://<ref>.supabase.co/functions/v1/api/health

# Who am I?
curl https://<ref>.supabase.co/functions/v1/api/v1/me \
  -H "x-api-key: itk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# List issues
curl "https://<ref>.supabase.co/functions/v1/api/v1/issues?status=pending&limit=10" \
  -H "x-api-key: itk_..."
```

---

## 2. Authentication — API keys

Send the key in **either** header:

```
x-api-key: itk_<48 hex chars>
Authorization: Bearer itk_<48 hex chars>
```

- Keys are generated as `itk_` + 24 random bytes (48 hex chars).
- Only a **SHA-256 hash** is stored (`public.api_keys.key_hash`); the plaintext
  is shown **once**, when the key is created.
- A key carries a **role**:
  - **`user`** — report and manage *your own* issues; read the board; read your
    notifications. Cannot change a status.
  - **`admin`** — everything a user can do, for anyone: set status, manage users,
    use the Archive, see global stats, manage keys.
- A key is bound to a **profile** (`profile_id`); actions are attributed to that
  account.
- Revoke a key at any time (`DELETE /v1/keys/{id}`) — revoked keys return `401`.

### Creating the first key (bootstrap)

The easiest way is the in-app **API keys** page (admins only). If you prefer SQL,
generate a key and its hash locally, then insert the hash:

```powershell
$b = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$key  = "itk_" + (($b | ForEach-Object { $_.ToString("x2") }) -join "")
$sha  = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($key))
$hash = (($sha | ForEach-Object { $_.ToString("x2") }) -join "")
"KEY  = $key"
"HASH = $hash"
```

```sql
insert into public.api_keys (name, prefix, key_hash, role, profile_id)
select 'bootstrap', left(:'key', 12), :'hash', 'admin', id
from public.profiles where role = 'admin' order by created_at limit 1;
```

---

## 3. Conventions

| Topic | Rule |
|---|---|
| Pagination | `?limit=` (default 25, max 100) and `?offset=` (default 0). Responses include `meta.count`. |
| Sorting | `?sort=created_at\|updated_at\|completed_at\|priority\|status\|title` and `?order=asc\|desc`. |
| Filtering | `status`, `priority`, `label`, `author_id`, `mine=true`, `created_from`, `created_to`, `q` (title/description search). |
| Success shape | `{ "data": … }`; lists add `{ "meta": { "limit", "offset", "count" } }`. |
| Error shape | `{ "error": { "code": "…", "message": "…" } }`. |
| Rate limit | Best-effort **120 requests / minute / key**; `429` with `Retry-After: 60`. |
| CORS | `Access-Control-Allow-Origin: *` — browser apps may call it directly. |
| Timestamps | ISO-8601 UTC (`2026-09-28T10:00:00Z`). |
| IDs | UUIDs. |

### Error codes

| Status | `code` | Meaning |
|---|---|---|
| 400 | `validation_error` | Malformed id / body |
| 401 | `unauthorized` | No key sent |
| 401 | `invalid_key` | Key unknown or revoked |
| 403 | `forbidden` | Role too low, or not your row |
| 404 | `not_found` | No such row or route |
| 409 | `conflict` | Rule prevents it (e.g. last admin) |
| 422 | `validation_error` | Field failed a rule (e.g. empty title) |
| 429 | `rate_limited` | Over the per-minute limit |
| 500 | `server_error` | Unexpected failure |

---

## 4. Endpoint catalog (the API system)

### Public

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness/version. **No key required.** |

### Identity

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/v1/me` | user | The profile and role behind the key |

### Issues — user API

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/v1/issues` | user | List issues (filters + pagination) |
| `GET` | `/v1/issues/{id}` | user | One issue |
| `POST` | `/v1/issues` | user | Report an issue (`status` forced to `pending`) |
| `PATCH` | `/v1/issues/{id}` | user | Edit **your own** issue (title/description/priority/label) |
| `DELETE` | `/v1/issues/{id}` | user | Soft-delete **your own** issue → Archive |

### Issues — admin API

| Method | Path | Role | Purpose |
|---|---|---|---|
| `POST` | `/v1/issues` | admin | Report with any status / author |
| `PATCH` | `/v1/issues/{id}` | admin | Set `status`, priority, leave `admin_note` |
| `DELETE` | `/v1/issues/{id}` | admin | Soft-delete anyone's issue |
| `POST` | `/v1/issues/{id}/restore` | admin | Bring it back from the Archive |

### Stats

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/v1/stats` | user | Counts; `scope: mine` for a user key, `all` for admin |

### Users — admin API

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/v1/users` | admin | List accounts (+ pagination) |
| `GET` | `/v1/users/{id}` | admin | One account |
| `PATCH` | `/v1/users/{id}` | admin | Promote / demote (`{ "role": "admin" \| "user" }`) |

### Archive — admin API

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/v1/archive` | admin | Everything soft-deleted |
| `POST` | `/v1/archive/{id}/restore` | admin | Restore one |
| `DELETE` | `/v1/archive` | admin | Empty the Archive (permanent) |

### Notifications

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/v1/notifications` | user | Your newest 50 notifications |
| `POST` | `/v1/notifications/read-all` | user | Mark all read |
| `PATCH` | `/v1/notifications/{id}/read` | user | Mark one read |

### API key management — admin API

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/v1/keys` | admin | List keys (never the secret) |
| `POST` | `/v1/keys` | admin | Create a key — returns the plaintext **once** |
| `DELETE` | `/v1/keys/{id}` | admin | Revoke a key |

### Web API — outbound events (webhooks)

| Where | Purpose |
|---|---|
| `public.webhook_endpoints` | Registered consumer URLs + event filters |
| `public.webhook_deliveries` | Delivery audit log |
| trigger `issues_api_webhooks` | POSTs each event to every matching active endpoint |

Events: `issue.created`, `issue.updated`, `issue.status_changed`, `issue.done`,
`issue.deleted`. Each request carries `x-webhook-event` and
`x-webhook-secret` headers; verify the secret before trusting the body.

Configure endpoints in the app at **Webhooks** (admin), and read the live
catalog at **API docs** (admin). `webhook_deliveries` keeps a log, but delivery
is fire-and-forget (`pg_net`), so it records *what was sent*, not the HTTP
response.

---

## 5. Examples

### Report an issue (user key)

```bash
curl -X POST .../v1/issues \
  -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '{"title":"Login fails on Safari","description":"Spins forever","priority":"high","label":"auth"}'
```

```json
{ "data": { "id": "…", "title": "Login fails on Safari", "status": "pending", "priority": "high", "…": "…" } }
```

### Move it to Fixing, then Done (admin key)

```bash
curl -X PATCH .../v1/issues/<id> -H "x-api-key: $ADMIN_KEY" \
  -H "content-type: application/json" -d '{"status":"fixing"}'

curl -X PATCH .../v1/issues/<id> -H "x-api-key: $ADMIN_KEY" \
  -H "content-type: application/json" \
  -d '{"status":"done","admin_note":"Fixed in v1.4 — please retry."}'
```

A `user` key doing the same gets:

```json
{ "error": { "code": "forbidden", "message": "Only admins can change the status." } }
```

### Counts

```bash
curl .../v1/stats -H "x-api-key: $ADMIN_KEY"
```

```json
{ "data": { "scope": "all", "total": 42, "pending": 7, "fixing": 3, "done": 32, "high_open": 2 } }
```

### Create a key (admin key)

```bash
curl -X POST .../v1/keys -H "x-api-key: $ADMIN_KEY" \
  -H "content-type: application/json" -d '{"name":"CI bot","role":"user"}'
```

```json
{ "data": { "id": "…", "name": "CI bot", "prefix": "itk_9f3a2c1b", "role": "user",
            "key": "itk_…<the only time you will see this>…" } }
```

---

## 6. Deploy

**Critical:** the `api` function must be deployed with **JWT verification
disabled**, because consumers authenticate with their own API key
(`x-api-key`), not a Supabase JWT. If it stays on, the platform returns `401`
before your code ever runs. This is set in `supabase/config.toml`
(`[functions.api] verify_jwt = false`).

### Option A — one command (no CLI, no DB password)

Uses the Supabase **Management API** with a personal access token from
<https://supabase.com/dashboard/account/tokens>:

```powershell
powershell -ExecutionPolicy Bypass -File tools/deploy-api.ps1 `
  -ProjectRef <project-ref> -AccessToken sbp_xxx
```

It runs `sql/api.sql` and deploys/updates the function with JWT verification off.

### Option B — Supabase CLI

```bash
supabase functions deploy api --no-verify-jwt
```

### Option C — dashboard

1. **SQL Editor** → paste `sql/api.sql` → **Run**.
2. **Edge Functions** → create a function named `api` → paste
   `supabase/functions/api/index.ts` → **turn off “Enforce JWT verification”** → Deploy.

### Then

Create the first key: app (admin) → **API keys**, or the SQL bootstrap in
section 2. Verify with `tools/test-api.ps1`.

No extra secrets are needed — the function uses the built-in
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

> **Test locally first, against a preview:** the first key you create should be
> `user` unless you specifically need admin, and you can revoke it instantly.

---

## 7. Security notes

- The **service role key stays server-side**; it is never exposed to API
  consumers.
- The API re-implements the app's rules because the service role bypasses RLS:
  a `user` key cannot change a status (also blocked by the `guard_issue_changes`
  trigger), cannot edit someone else's issue, and cannot reach admin routes.
- Keys are stored hashed; `last_used_at` is stamped on every call so unused keys
  are easy to spot and revoke.
- Prefer one key per integration so a leak can be revoked in isolation.
- The rate limit is best-effort per warm isolate. For hard guarantees, put the
  API behind a gateway (Cloudflare, API Gateway) or move the counter into a
  table before opening it to the public internet.
- Only the public `anon` key belongs in the client; never ship a `service_role`
  key or an API key in front-end code.
