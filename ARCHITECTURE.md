# Architecture & Process Flow

A guide to how the Issue Tracker is put together and how a request moves through
it. The diagrams are [Mermaid](https://mermaid.js.org/) and render directly on
GitHub.

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
    DB["Postgres<br/>profiles · issues · backups · app_settings"]
    Guard["Row Level Security<br/>+ triggers + RPC functions"]
  end

  Browser -->|"GET (HTML/CSS/JS)"| Static
  Browser -->|"sign in / sign up"| Auth
  Browser -->|"PostgREST + Realtime (WSS)"| DB
  DB --- Guard
  Browser -.->|"install / offline"| SW
```

| Layer | Technology | Notes |
|---|---|---|
| Front end | Plain HTML + CSS + vanilla JS | No build step |
| Hosting | Vercel | Static files, HTTPS, `vercel.json` headers |
| Database | Supabase Postgres | Reached directly from the browser |
| Auth | Supabase Auth | Password login, JWT session |
| API | PostgREST (auto-generated) | `sb.from('issues')…` |
| Live updates | Supabase Realtime | WebSocket on the `issues` table |
| Security | RLS + DB triggers + RPC | Enforced **in the database**, not the UI |

> **Why the anon key is safe:** it is published in `supabase-config.js` on
> purpose. Row Level Security decides what any request may do, so the key
> grants nothing by itself.

---

## 2. Page and module map

Every page loads the same shared modules, then its own page script.

```mermaid
flowchart LR
  subgraph Shared["Shared (loaded by every page)"]
    SB["js/supabase.js<br/>client, helpers, constants"]
    T["js/toast.js"]
    M["js/modal.js"]
    AU["js/auth.js<br/>guard, login, logout"]
    L["js/layout.js<br/>sidebar + topbar + theme + bottom nav"]
    S["js/sidebar.js<br/>admin links"]
    I["js/install.js<br/>Install app button"]
  end

  IDX["index.html<br/>(sign in / sign up)"] --> SB
  IDX --> AU

  subgraph App["App pages (pages/*.html)"]
    D["dashboard.html"] --> P1["page-dashboard.js"]
    IS["issues.html"] --> P2["page-issues.js"]
    AD["admin-*.html"] --> P3["page-admin.js"]
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
| `pages/admin-*.html` | Status-focused views (reported / pending / fixing / done / all) | `page-admin.js` |
| `pages/users.html`, `pages/admin-users.html` | Manage accounts | `page-users.js` |
| `pages/profile.html` | Own name / password | `page-profile.js` |
| `pages/settings.html` | Appearance, filters, backups | `page-settings.js` |
| `pages/recycle-bin.html` | Restore or empty deleted issues | `page-bin.js` |

---

## 3. Sign-in flow

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

Every app page then calls `ET.auth.guard()` first. No session → straight back to
the sign-in page. Admin-only pages (`users`, `recycle-bin`) send non-admins to
the dashboard.

---

## 4. Data model

```mermaid
erDiagram
  profiles ||--o{ issues : "author_id"

  profiles {
    uuid   id PK
    text   username
    text   role
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
    timestamptz deleted_at   "recycle bin"
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
    bool id PK
    bool auto_backup_enabled
  }
```

---

## 5. Security flow (defence in depth)

Two independent layers: **Row Level Security** decides *which rows*, and
**triggers** decide *which columns*.

```mermaid
flowchart TB
  R["Browser request (JWT)"] --> POL{"RLS policy for the operation"}

  POL -->|select| S1["issues are readable<br/>deleted_at is null"]
  POL -->|insert| S2["create issues<br/>author_id = auth.uid()<br/>and status = 'pending'"]
  POL -->|update| S3["update own issue or admin"]
  POL -->|delete| S4["delete own issue or admin"]

  S3 --> G{"Trigger: guard_issue_changes()"}
  S2 --> G2{"handle_new_user()<br/>computes the role<br/>never trusts the client"}
  G -->|"non-admin changes status"| X["❌ 'Only admins can change the status'"]
  G -->|ok| OK["✅ row saved"]
```

- **`is_admin()`** is `SECURITY DEFINER`, so policies can check the role without
  recursing back into RLS.
- Even a hand-crafted API call from the browser cannot do more than the buttons
  allow — the database is the final authority.

---

## 6. Issue lifecycle

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

Deleting never removes the row — it sets `deleted_at`. `List`, the dashboard,
the counts and the realtime feed all stop seeing it.

---

## 7. Recycle bin flow

```mermaid
sequenceDiagram
  actor A as Admin (or the reporter)
  participant App as Issues page
  participant DB as Postgres

  A->>App: Delete an issue
  App->>DB: update issues set deleted_at = now()
  Note over DB: the "readable" policy hides it from every query

  A->>App: open Recycle bin
  App->>DB: rpc list_deleted_issues()
  DB-->>App: binned rows (admin check inside the function)
  A->>App: Restore
  App->>DB: rpc restore_issue(id)  →  deleted_at = null
  A->>App: Empty recycle bin
  App->>DB: rpc empty_recycle_bin()  →  delete forever
```

All three functions re-check `is_admin()` **inside the database**, so the UI is
convenience, not the gate.

---

## 8. Automatic backups

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

## 9. Deployment & install flow

```mermaid
flowchart LR
  Dev["Edit files in VS Code"] --> Git["git commit + push"]
  Git --> GH[("GitHub<br/>rawrmeo/issue-tracker")]
  GH --> Ver["Vercel builds & deploys"]
  Ver --> Live["https://…vercel.app"]
  Live --> SW["sw.js caches the shell"]
  SW --> PWA["“Install app” on the phone"]
```

- The repo has an auto-push hook, so a commit also lands on GitHub.
- `vercel.json` adds clean URLs and security headers.
- `sw.js` is network-first, so you always get the newest version, with the
  cached copy as an offline fallback.

---

## 10. One typical request, end to end

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
  DB-->>API: updated row
  API-->>Page: 200 OK
  Page->>Page: refresh() → re-render
  API-->>Page: Realtime event → other open tabs refresh too
  Page-->>U: toast "Status changed to Done"
```

---

## Quick reference

| Concern | Where it lives |
|---|---|
| Entry point | `index.html` → `pages/dashboard.html` |
| Data access | `js/supabase.js` (one client for every page) |
| Permissions | `supabase/schema.sql` — RLS policies + `guard_issue_changes()` |
| Admin-only RPCs | `sql/recycle_bin.sql`, `sql/backups.sql` |
| Appearance | `js/layout.js` + `styles.css` (`prefers-color-scheme`) |
| Offline / install | `sw.js` + `manifest.json` + `js/install.js` |
