# Architecture & Process Flow

A guide to how the Issue Tracker is put together and how a request moves through
it. The diagrams are [Mermaid](https://mermaid.js.org/) and render directly on
GitHub, or open **`flowcharts.html`** to see every one on a single page.

> Taking the project over? Start with **[`HANDOVER.md`](HANDOVER.md)** — it has
> the abstract, a file-by-file repo map, and every left-panel screen walked
> through one by one.

---

## 1. System architecture (the big picture)

The app has **no server of its own**. The browser is the whole front end, and
Supabase is the whole back end.

```mermaid
flowchart TB
  subgraph Device["📱 Phone  /  💻 Desktop"]
    Browser["Browser or installed PWA"]
    SW["Service worker (sw.js)<br/>caches the shell, serves it offline"]
  end

  subgraph Vercel["▲ Vercel — static hosting (HTTPS)"]
    Static["index.html · pages/*.html<br/>styles.css · css/*<br/>js/* · manifest.json · icons"]
  end

  subgraph Supabase["🐘 Supabase"]
    Auth["Auth<br/>email + password (JWT)"]
    DB["Postgres<br/>profiles · issues · backups<br/>app_settings · notifications · push_subscriptions"]
    Guard["Row Level Security<br/>+ triggers + RPC functions"]
    Fn["Edge Function: send-push<br/>(Web Push sender)"]
  end

  Browser -->|"GET (HTML/CSS/JS)"| Static
  Browser -->|"sign in / sign up"| Auth
  Browser -->|"PostgREST + Realtime (WSS)"| DB
  DB --- Guard
  DB -->|"pg_net http_post"| Fn
  Browser -.->|"install / offline"| SW
```

| Layer | Technology | Notes |
|---|---|---|
| Front end | Plain HTML + CSS + vanilla JS | No build step |
| Hosting | Vercel | Static files, HTTPS, `vercel.json` headers |
| Database | Supabase Postgres | Reached directly from the browser |
| Auth | Supabase Auth | Password login, JWT session |
| API | PostgREST (auto-generated) | `sb.from('issues')…` |
| Live updates | Supabase Realtime | WebSocket on `issues`, `profiles`, `notifications` |
| Notifications | Triggers + `pg_net` + Edge Function | In-app bell + optional Web Push |
| Security | RLS + DB triggers + RPC | Enforced **in the database**, not the UI |

> **Why the anon key is safe:** it is published in `supabase-config.js` on
> purpose. Row Level Security decides what any request may do, so the key
> grants nothing by itself.

---

## 2. Runtime topology — one round trip

There is no application server in the middle. The browser holds a JWT and talks
straight to PostgREST; Postgres applies the policies and triggers.

```mermaid
sequenceDiagram
  participant B as Browser (js/page-*.js)
  participant P as Supabase PostgREST (HTTPS)
  participant DB as Postgres (RLS + triggers)
  participant RT as Realtime (WSS)

  B->>P: from('issues').select/insert/update (JWT)
  P->>DB: SQL as role `authenticated`
  DB->>DB: RLS policy → which rows?
  DB->>DB: BEFORE/AFTER triggers → which columns / side effects
  DB-->>P: rows or SQLSTATE error
  P-->>B: JSON or error
  DB-->>RT: change event
  RT-->>B: postgres_changes → other tabs refresh
```

---

## 3. Page and module map

Every page loads the same shared modules, then its own page script.

```mermaid
flowchart LR
  subgraph Shared["Shared (loaded by every app page)"]
    SB["js/supabase.js<br/>client, helpers, constants"]
    T["js/toast.js"]
    M["js/modal.js"]
    AU["js/auth.js<br/>guard, login, logout"]
    L["js/layout.js<br/>sidebar + topbar + theme + bottom nav"]
    S["js/sidebar.js<br/>role classes"]
    I["js/install.js<br/>Install app button"]
    PU["js/push.js<br/>Web Push subscription"]
    NO["js/notifications.js<br/>bell feed"]
  end

  IDX["index.html<br/>(sign in / sign up)"] --> SB
  IDX --> AU

  subgraph App["App pages (pages/*.html)"]
    D["dashboard.html"] --> P1["page-dashboard.js"]
    IS["issues.html"] --> P2["page-issues.js"]
    MR["my-reports.html"] --> P8["page-my-reports.js"]
    RP["reports.html"] --> P9["page-reports.js"]
    AD["admin-*.html"] --> P2
    AD --> P3["page-admin.js"]
    U["users.html · admin-users.html"] --> P4["page-users.js"]
    PR["profile.html"] --> P5["page-profile.js"]
    SE["settings.html"] --> P6["page-settings.js"]
    RB["recycle-bin.html"] --> P7["page-bin.js"]
  end

  Shared --> App
```

| Page(s) | Purpose | Page script |
|---|---|---|
| `index.html` | Sign in / create account | `auth.js` |
| `pages/dashboard.html` | Stats, chart, repeated issues, activity | `page-dashboard.js` |
| `pages/issues.html` | The board: report, filter, edit, bulk actions | `page-issues.js` |
| `pages/my-reports.html` | Your own reports + admin messages | `page-my-reports.js` |
| `pages/reports.html` | Admin: date-filtered list + CSV/JSON/print export | `page-reports.js` |
| `pages/admin-*.html` | Legacy status-focused views (URL only) | `page-issues.js` + `page-admin.js` |
| `pages/users.html`, `pages/admin-users.html` | Manage accounts | `page-users.js` |
| `pages/profile.html` | Own name / password | `page-profile.js` |
| `pages/settings.html` | Appearance, filters, push, backups | `page-settings.js` |
| `pages/recycle-bin.html` | Archive: restore or empty deleted issues | `page-bin.js` |

---

## 4. Sign-in and session flow

```mermaid
sequenceDiagram
  actor U as User
  participant P as index.html
  participant A as Supabase Auth
  participant DB as Postgres (profiles)

  U->>P: username + password
  P->>P: username → "<name>@example.com"
  P->>A: signInWithPassword
  A-->>P: session (JWT)
  P->>DB: select role from profiles
  DB-->>P: role = admin | user
  P->>P: layout.js builds sidebar/topbar from the role
  P-->>U: redirect to pages/dashboard.html
```

Every app page then calls `ET.layout.render()`, which first runs
`ET.auth.guard()`. No session → straight back to the sign-in page. Admin-only
pages (`users`, `reports`, `archive`) send non-admins to the dashboard.

---

## 5. Data model

```mermaid
erDiagram
  profiles ||--o{ issues : "author_id"
  profiles ||--o{ notifications : "user_id"
  profiles ||--o{ push_subscriptions : "user_id"

  profiles {
    uuid   id PK
    text   username
    text   role "admin | user"
    timestamptz created_at
  }

  issues {
    uuid   id PK
    text   title
    text   description
    text   priority "low | medium | high"
    text   status   "pending | fixing | done"
    text   label
    uuid   author_id FK
    timestamptz created_at
    timestamptz updated_at
    timestamptz completed_at
    timestamptz deleted_at   "archive"
    text   admin_note
    timestamptz admin_note_at
  }

  backups {
    uuid   id PK
    timestamptz created_at
    text   kind "auto | manual"
    int    issue_count
    jsonb  payload "whole issues table"
  }

  app_settings {
    bool   id PK
    bool   auto_backup_enabled
    text   push_function_url
    text   push_shared_secret
  }

  notifications {
    uuid   id PK
    uuid   user_id FK
    text   kind
    text   title
    text   body
    uuid   issue_id
    timestamptz created_at
    timestamptz read_at
  }

  push_subscriptions {
    uuid   id PK
    uuid   user_id FK
    text   endpoint
    text   p256dh
    text   auth
    timestamptz created_at
  }
```

**Users live in two places, on purpose:** Supabase's built-in `auth.users`
(credentials) and `public.profiles` (username + role). A trigger copies a row
across when someone signs up.

---

## 6. Security model (defence in depth)

Two independent layers: **Row Level Security** decides *which rows*, and
**triggers** decide *which columns* and drive side effects.

```mermaid
flowchart TB
  R["Browser request (JWT)"] --> POL{"RLS policy for the operation"}

  POL -->|select| S1["issues are readable<br/>deleted_at is null"]
  POL -->|insert| S2["create issues<br/>author_id = auth.uid()<br/>and status = 'pending'"]
  POL -->|update| S3["update own issue or admin"]
  POL -->|delete| S4["delete own issue or admin"]
  POL -->|profiles| S5["readable by all<br/>role changes: admins only"]

  S2 --> G2{"handle_new_user()<br/>computes the role<br/>never trusts the client"}
  S3 --> G{"Trigger: guard_issue_changes()"}
  G -->|"non-admin changes status"| X["❌ 'Only admins can change the status'"]
  G -->|ok| OK["✅ row saved<br/>(updated_at / completed_at set here)"]
  G -->|"after"| N["notify_issue_event()<br/>+ auto_snapshot()"]
```

- **`is_admin()`** is `SECURITY DEFINER`, so policies can check the role without
  recursing back into RLS.
- Even a hand-crafted API call from the browser cannot do more than the buttons
  allow — the database is the final authority.
- **Admin-only actions** (archive, backups) go through `SECURITY DEFINER`
  functions that re-check `is_admin()` **inside the database**.

---

## 7. Issue lifecycle

```mermaid
stateDiagram-v2
  [*] --> pending: reporter files it
  pending --> fixing: admin picks it up
  fixing --> done: admin fixes it
  done --> fixing: reopened
  fixing --> pending: back to the queue

  pending --> bin: delete (soft)
  fixing --> bin: delete (soft)
  done --> bin: delete (soft)
  bin --> pending: restore (keeps its old status)
```

Deleting never removes the row — it sets `deleted_at`. The list, the dashboard,
the counts and the realtime feed all stop seeing it.

---

## 8. Archive flow

```mermaid
sequenceDiagram
  actor A as Admin (or the reporter)
  participant App as Issues page
  participant DB as Postgres

  A->>App: Delete an issue
  App->>DB: update issues set deleted_at = now()
  Note over DB: the "readable" policy hides it from every query

  A->>App: open Archive
  App->>DB: rpc list_deleted_issues()
  DB-->>App: binned rows (admin check inside the function)
  A->>App: Restore
  App->>DB: rpc restore_issue(id)  →  deleted_at = null
  A->>App: Empty archive
  App->>DB: rpc empty_recycle_bin()  →  delete forever
```

All three functions re-check `is_admin()` **inside the database**, so the UI is
convenience, not the gate.

---

## 9. Notifications (bell + push) flow

```mermaid
flowchart LR
  EV["issue event<br/>insert / update"] --> TR["trigger notify_issue_event()"]

  TR -->|"new issue"| ADM["every admin<br/>(except the reporter if admin)"]
  TR -->|"status = done"| REP["the reporter"]
  TR -->|"admin_note changed"| REP

  ADM --> SN["send_notification()"]
  REP --> SN
  SN --> NR[("notifications row<br/>→ bell feed via Realtime")]
  SN -->|"if push configured"| PN["pg_net http_post<br/>to send-push Edge Function"]
  PN --> PS[("push_subscriptions<br/>→ device notification")]
```

The bell in the top bar reads the newest 30 rows for the signed-in user and
updates over Realtime. Push is optional: until the VAPID key and Edge Function
are configured, `send_notification()` still writes the in-app row and the bell
stays useful.

---

## 10. Automatic backups

```mermaid
flowchart LR
  C["Any change to issues"] --> T["trigger issues_auto_backup<br/>(after insert / update / delete)"]
  T --> AS["auto_snapshot()"]
  AS -->|"off, or one taken this hour"| N["do nothing"]
  AS -->|due| SN["snapshot_issues()<br/>issues → JSON"]
  SN --> BK[("backups")]

  AD["Admin: Back up now"] --> CB["create_backup()"] --> SN
  RT["Admin: Restore"] --> RB["restore_backup(id)"]
  RB -->|"1. safety snapshot"| SN
  RB -->|"2. replace issues"| ISS[("issues")]
  SN -->|keep newest 30| BK
```

A restore is itself undoable, because the first thing it does is take another
snapshot.

---

## 11. Deployment & install flow

```mermaid
flowchart LR
  Dev["Edit files in VS Code"] --> Git["git commit + push"]
  Git --> GH[("GitHub<br/>rawrmeo/issue-tracker")]
  GH --> Ver["Vercel builds & deploys"]
  Ver --> Live["https://issue-tracker-alpha-drab.vercel.app"]
  Live --> SW["sw.js caches the shell"]
  SW --> PWA["“Install app” on the phone"]
```

- The `develop` branch auto-pushes, so a commit also lands on GitHub; merging
  into `main` is what triggers the production deploy.
- `vercel.json` adds clean URLs and security headers.
- `sw.js` is network-first, so you always get the newest version, with the
  cached copy as an offline fallback.

---

## 12. One typical request, end to end

```mermaid
sequenceDiagram
  actor U as Admin
  participant Page as issues.html + page-issues.js
  participant API as Supabase PostgREST
  participant DB as Postgres (RLS + triggers)

  U->>Page: change a status to Done
  Page->>API: update issues set status='done' where id=…
  API->>DB: apply update
  DB->>DB: RLS — am I the author or an admin? ✅
  DB->>DB: guard_issue_changes() — is an admin doing this? ✅
  DB->>DB: completed_at = now(), updated_at = now()
  DB->>DB: issues_auto_backup → maybe snapshot
  DB->>DB: notify_issue_event() → notification for the reporter
  DB-->>API: updated row
  API-->>Page: 200 OK
  Page->>Page: refresh() → re-render
  API-->>Page: Realtime event → other open tabs refresh too
  Page-->>U: toast "Status changed to Done"
```

---

## 13. Process flow — the PDCE cycle

The app exists to run a **continuous improvement loop**, so its day-to-day
process is best read as **Plan → Do → Check → Evaluate**.

```mermaid
flowchart LR
  P["P · PLAN<br/>report and triage"] --> D["D · DO<br/>fix it"]
  D --> C["C · CHECK<br/>verify the fix"]
  C --> E["E · EVALUATE<br/>close and learn"]
  E -->|"not fixed, or it came back"| P
```

### 13.1 The loop, mapped onto the app

```mermaid
flowchart TD
  subgraph PLAN["P · PLAN — the reporter's turn"]
    A1["Reporter signs in"] --> A2["Files an issue<br/>status = pending"]
    A2 --> A3["Admin triages —<br/>reads it, sets the priority"]
  end

  subgraph DO["D · DO — the admin's turn"]
    B1["Admin sets status = fixing"] --> B2["Works on the fix"]
  end

  subgraph CHECK["C · CHECK — the app's guard rails"]
    C1["Admin picks Done"] --> C2["Confirm: 'Mark as done?'"]
    C2 -->|cancel| B2
    C2 -->|confirm| C3["guard_issue_changes()<br/>sets completed_at"]
  end

  subgraph EVAL["E · EVALUATE — close the loop"]
    D1["Admin leaves a<br/>Message to the reporter"] --> D2["Reporter sees it on<br/>My Reports + the bell"]
    D2 --> D3{"Satisfied?"}
    D3 -->|yes| D4["Stays done"]
    D3 -->|no| D5["Reopen → fixing / pending"]
  end

  PLAN --> DO --> CHECK --> EVAL
  D5 --> DO
  D4 --> STATS["Dashboard + repeated issues<br/>accumulate the evidence"]
  STATS --> PLAN
```

### 13.2 Where each phase actually lives

| Phase | Who | In the app | In the database |
|---|---|---|---|
| **P · Plan** | Reporter | `pages/issues.html` → report form | `insert into issues`, `status = 'pending'` |
| **D · Do** | Admin | Status dropdown → **Fixing** | `update status` — RLS + trigger allow admins only |
| **C · Check** | Admin | Confirm dialog before **Done** | `guard_issue_changes()` sets `completed_at` |
| **E · Evaluate** | Admin + Reporter | **Message to the reporter**; My Reports; repeated-issues list spots a regression | `admin_note`; `notify_issue_event()` tells the reporter |

**Why the loop is real, not just a label:** every phase writes to the same
`issues` row, and the Dashboard + *Most repeated issues* card feed the evidence
straight back into the next round of planning.

### 13.3 The same cycle for the maintainer

```mermaid
flowchart LR
  P["PLAN<br/>pick a change"] --> D["DO<br/>edit · commit · push"]
  D --> C["CHECK<br/>test the preview build"]
  C --> E["EVALUATE<br/>deploy, or open a new task"]
  E --> P
```

---

## Quick reference

| Concern | Where it lives |
|---|---|
| Entry point | `index.html` → `pages/dashboard.html` |
| Data access | `js/supabase.js` (one client for every page) |
| Permissions | `supabase/schema.sql` — RLS policies + `guard_issue_changes()` |
| Admin-only RPCs | `sql/recycle_bin.sql`, `sql/backups.sql` |
| Notifications | `sql/notifications.sql` + `js/notifications.js` + `js/push.js` |
| Push sender | `supabase/functions/send-push/index.ts` |
| Appearance | `js/layout.js` + `styles.css` (`prefers-color-scheme`) |
| Offline / install | `sw.js` + `manifest.json` + `js/install.js` |
| All diagrams | `flowcharts.html` (generated from this file + `HANDOVER.md`) |
