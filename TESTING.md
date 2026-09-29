# Testing the API

How to verify the public REST API end to end: the gateway, API-key roles, the
Archive, and outbound webhooks.

---

## 0. Before you test

Three one-time steps (see also `API.md` §6):

1. **Database** — Supabase → SQL Editor → paste `sql/api.sql` → **Run**.
2. **Gateway** — deploy the Edge Function:
   ```bash
   supabase functions deploy api
   ```
3. **A key** — in the app as admin: **API keys → create** (role **admin**), and a
   second key with role **user** for the permission tests.

Your base URL is:

```
https://<project-ref>.supabase.co/functions/v1/api
```

> Windows tip: in PowerShell, `curl` is an alias for `Invoke-WebRequest`. Use
> `curl.exe` if you want the real curl.

---

## 1. Automated smoke test (recommended)

`tools/test-api.ps1` runs the whole checklist and prints PASS/FAIL.

```powershell
# read-only
powershell -ExecutionPolicy Bypass -File tools/test-api.ps1 `
  -BaseUrl https://<ref>.supabase.co/functions/v1/api `
  -ApiKey  itk_<your admin key>

# also test create/update/delete
powershell -ExecutionPolicy Bypass -File tools/test-api.ps1 `
  -BaseUrl https://<ref>.supabase.co/functions/v1/api `
  -ApiKey  itk_<admin> -Write

# also test that a user key is refused admin actions
powershell -ExecutionPolicy Bypass -File tools/test-api.ps1 `
  -BaseUrl https://<ref>.supabase.co/functions/v1/api `
  -ApiKey  itk_<admin> -UserKey itk_<user> -Write
```

What it checks: `/health`, missing/bad keys, `/v1/me`, issue list + `meta`,
404/400 handling, `/v1/stats`, `/v1/users`, `/v1/keys`, `/v1/notifications`,
unknown route, the create → status → archive → restore flow, and (with
`-UserKey`) that a `user` key gets **403** on admin routes and on status changes.

Exit code is `0` when everything passes, `1` otherwise.

---

## 2. Manual REST tests

### Health (no key)

```powershell
Invoke-RestMethod "https://<ref>.supabase.co/functions/v1/api/health"
```

```bash
curl https://<ref>.supabase.co/functions/v1/api/health
```

### Who am I?

```powershell
$BASE = "https://<ref>.supabase.co/functions/v1/api"
$KEY  = "itk_<admin>"
Invoke-RestMethod "$BASE/v1/me" -Headers @{ 'x-api-key' = $KEY }
```

### List and filter

```powershell
Invoke-RestMethod "$BASE/v1/issues?status=pending&limit=5&sort=created_at&order=desc" `
  -Headers @{ 'x-api-key' = $KEY }
```

### Report an issue

```powershell
$body = @{ title = 'Login fails on Safari'; priority = 'high'; label = 'auth' } | ConvertTo-Json
Invoke-RestMethod "$BASE/v1/issues" -Method Post -Headers @{ 'x-api-key' = $KEY } `
  -ContentType 'application/json' -Body $body
```

### Move it to Done (admin only)

```powershell
Invoke-RestMethod "$BASE/v1/issues/<id>" -Method Patch -Headers @{ 'x-api-key' = $KEY } `
  -ContentType 'application/json' -Body (@{ status = 'done'; admin_note = 'Fixed.' } | ConvertTo-Json)
```

### Errors are structured

```powershell
try {
  Invoke-RestMethod "$BASE/v1/users" -Headers @{ 'x-api-key' = $USER_KEY }
} catch {
  $_.ErrorDetails.Message      # {"error":{"code":"forbidden","message":"Admin role required."}}
}
```

---

## 3. Authentication & authorization matrix

Run each with an **admin** key and a **user** key:

| Request | admin key | user key | no key |
|---|---|---|---|
| `GET /health` | 200 | 200 | 200 |
| `GET /v1/me` | 200 | 200 | 401 |
| `GET /v1/issues` | 200 | 200 | 401 |
| `POST /v1/issues` | 201 | 201 (pending) | 401 |
| `PATCH /v1/issues/{id}` status | 200 | **403** | 401 |
| `GET /v1/users` | 200 | **403** | 401 |
| `GET /v1/archive` | 200 | **403** | 401 |
| `GET /v1/keys` | 200 | **403** | 401 |
| revoked key, any route | — | **401** | — |

Also verify: a bad key (`itk_0000…`) → **401**, an unknown route → **404**, a
non-UUID id → **400**.

---

## 4. Rate limit

The gateway allows **120 requests/minute per key** (best-effort). To see the
`429`:

```powershell
1..130 | ForEach-Object {
  try   { Invoke-RestMethod "$BASE/v1/me" -Headers @{ 'x-api-key' = $KEY } | Out-Null; "ok $_" }
  catch { "status $($_.Exception.Response.StatusCode.value__) at $_" }
}
```

Expect the last few to be `429` with a `Retry-After: 60` header.

---

## 5. Webhooks (the "Web API")

Webhooks are sent **from the cloud database** to your URL, so the URL must be
reachable from the internet — `localhost` will not work unless you tunnel it.

### A. Quick check with webhook.site

1. Open <https://webhook.site> and copy your unique URL.
2. In the app: **Webhooks → Register an endpoint** → paste the URL → **all events**.
3. Change any issue (status → Fixing → Done).
4. Watch webhook.site receive a `POST` with headers `x-webhook-event` and
   `x-webhook-secret`, and a JSON body `{ "event", "at", "data" }`.
5. Back in the app, the **Recent deliveries** list shows the same events.

### B. Test event filtering

Edit the endpoint to only `issue.done`, then:
- change a status to **Fixing** → no delivery;
- change it to **Done** → a delivery arrives.

### C. Local receiver (needs a tunnel)

```powershell
# terminal 1 — a tiny receiver
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:9099/')
$listener.Start()
Write-Host 'Listening on http://localhost:9099/ ...'
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $body = (New-Object IO.StreamReader($ctx.Request.InputStream)).ReadToEnd()
  Write-Host ("`n[" + $ctx.Request.Headers['x-webhook-event'] + "] secret=" +
               $ctx.Request.Headers['x-webhook-secret'])
  Write-Host $body
  $ctx.Response.StatusCode = 200
  $ctx.Response.Close()
}
```

```powershell
# terminal 2 — expose it publicly
npx ngrok http 9099
# register the https://<id>.ngrok-free.app URL on the Webhooks page
```

### D. Inspect the log in the database

Supabase → Table Editor → `webhook_deliveries`, or SQL:

```sql
select event, endpoint_id, created_at
from public.webhook_deliveries
order by created_at desc
limit 20;
```

> Delivery is fire-and-forget (`pg_net`): the log records **what was sent**, not
> the HTTP response code. Check your receiver for that.

---

## 6. UI tests (the new admin pages)

As an **admin**, the sidebar should now show **Reports · Users · API keys ·
Webhooks · API docs · Archive**. As a **user**, none of those.

- **API keys** — create a key; the secret is revealed **once**; it appears in the
  list only as a prefix; **Revoke** disables it (then `GET /v1/me` returns 401).
- **Webhooks** — add an endpoint, pause it (toggle), delete it (confirm dialog),
  and see deliveries expand to full JSON.
- **API docs** — the base URL is filled in from `supabase-config.js`; **Copy**
  works; the OpenAPI and API.md buttons open.

---

## 7. Security regression (the headline rule)

The API must never let a `user` key change a status. Prove it two ways:

```powershell
# 1. through the API
Invoke-RestMethod "$BASE/v1/issues/<id>" -Method Patch -Headers @{ 'x-api-key' = $USER_KEY } `
  -ContentType 'application/json' -Body (@{ status = 'done' } | ConvertTo-Json)
# -> 403 {"error":{"code":"forbidden","message":"Only admins can change the status."}}
```

2. Directly against the database from the browser console as a signed-in
   **non-admin** (proves the trigger, not just the gateway):

```js
const { data, error } = await window.ET.getClient()
  .from('issues').update({ status: 'done' }).eq('id', '<SOME_ISSUE_UUID>').select();
console.log(error);   // "Only admins can change the status of an issue"
```

---

## 8. Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `404` on every `/v1/...` route | Function not deployed, or wrong base URL | `supabase functions deploy api`; check the URL ends `/functions/v1/api` |
| `500 SQLSTATE … api_keys` | `sql/api.sql` not run | Run it in the SQL Editor |
| `401 invalid_key` right after creating | Wrong key copied, or it was revoked | Create a new key; copy the full `itk_...` |
| Admin key gets `403` on status change | Key role is `user` | Create a key with role **admin** |
| Status change by the app errors after deploying | `schema.sql` re-run after `api.sql` | Re-run `sql/api.sql` (it re-defines the guard) |
| Webhook never arrives | URL not public, endpoint paused, or `pg_net` missing | Use webhook.site/ngrok; check the toggle; run `sql/api.sql` |
| No `webhook_deliveries` rows | Event filter excludes it, or trigger missing | Set "all events"; re-run `sql/api.sql` |
| `429` unexpectedly | More than 120 calls/min for that key | Wait a minute, or raise the limit in the function |
| CORS error in a browser | Preflight not reaching the function | The gateway answers `OPTIONS`; confirm the deployed version |

---

## 9. Import the spec (optional)

- **Postman**: Import → `openapi.yaml`, then set a header `x-api-key`.
- **Swagger Editor**: paste `openapi.yaml` at <https://editor.swagger.io>.
- Remember the events/webhooks are **outbound** and are not part of the OpenAPI
  document (that describes what you call, not what calls you).
