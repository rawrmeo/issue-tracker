# Handover & Architecture Guide

> **Read this first.** Everything a new maintainer needs to understand, run and
> extend this project. Diagrams are [Mermaid](https://mermaid.js.org/) and render
> on GitHub.

---

## 0. Abstract

**What it is.** A **multiuser issue tracker** that runs entirely in the browser.
There is no server of your own: the pages are static files hosted on Vercel, and
all data, login and access rules live in **Supabase** (hosted Postgres + Auth).

**Who uses it.**

| Role | Can do |
|---|---|
| **User** (reporter) | Sign in, report issues, search the board, edit/delete their **own** issues, change their password |
| **Admin** | Everything above, plus set **status** (pending → fixing → done), manage users, use bulk actions, restore from the **recycle bin**, and run **backups** |

**The one rule that shapes everything:** only an **admin** may move an issue
through its statuses. That rule is enforced **in the database** (Row Level
Security + a trigger), not just hidden in the UI — so a hand-crafted API call
cannot bypass it.

**In one picture:**

```mermaid
flowchart LR
  U["👤 Reporter / Admin"] --> B["Browser"]
  B -->|"HTML · CSS · JS"| V["▲ Vercel (static)"]
  B -->|"login + data + realtime"| S["🐘 Supabase<br/>Auth · Postgres · RLS"]
```

**Why it is built this way.** A single static front end means no server to run or
patch. Putting the rules in Postgres means the security travels with the data.

---

## 1. Technology

| Layer | Choice | Why |
|---|---|---|
| Markup / style | Plain HTML, CSS, vanilla JS | No build step — open a file and it runs |
| Hosting | **Vercel** (static) | Free, HTTPS, instant deploys |
| Database | **Supabase Postgres** | Relational data + one place for rules |
| Auth | **Supabase Auth** | Password login, JWT sessions |
| API | **PostgREST** (auto) | `sb.from('issues')…` talks to tables directly |
| Live updates | **Supabase Realtime** | WebSocket; boards update without refresh |
| Offline / install | **Service worker + manifest** | Home-screen app on a phone |
| Charts | Chart.js (CDN) | Dashboard graph |

```mermaid
flowchart TB
  subgraph Front["Front end (Vercel, static)"]
    P["HTML pages"] --- J["js/*.js modules"] --- C["styles.css + css/*"]
  end
  subgraph Back["Back end (Supabase)"]
    AU["Auth"] --- PG["Postgres"] --- RL["RLS · triggers · RPC"]
  end
  Front -->|"https + wss"| Back
```

---

## 2. Repository map

Every file, and what it is for. **This is the map to read when you take over.**

### Root

| File | Purpose |
|---|---|
| `index.html` | **Entry point** — sign in / create account. Redirects into `pages/` once signed in. |
| `app.html` | Legacy single-page shell, not part of the current flow |
| `styles.css` | Global design tokens (`--accent`, dark theme) and base components |
| `enhancements.css` / `enhancements.js` | Extra polish (date filter bar etc.) loaded on the Issues page |
| `supabase-config.js` | **Your** Supabase URL + anon key (public by design) |
| `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | Make it installable (`js/install.js` uses them) |
| `vercel.json` | Clean URLs + security headers |
| `.vercelignore` | Keeps `.env*` and other local files out of deploys |
| `deploy.ps1` | Windows helper: commit + push in one command |
| `README.md`, `SETUP.md`, `ARCHITECTURE.md`, `HANDOVER.md` | Docs |
| `supabase/schema.sql` | **The whole database** — tables, policies, triggers, functions |
| `sql/*.sql` | Focused migrations: `admin_note`, `recycle_bin`, `backups`, `demo_data` |

### `pages/` — the app screens

| Page | Purpose | Script |
|---|---|---|
| `dashboard.html` | Overview: stats, chart, repeated issues, activity | `page-dashboard.js` |
| `issues.html` | The board (report, filter, edit, bulk) | `page-issues.js` |
| `users.html`, `admin-users.html` | Manage accounts | `page-users.js` |
| `profile.html` | Own details + password | `page-profile.js` |
| `settings.html` | Appearance, filters, backups | `page-settings.js` |
| `recycle-bin.html` | Restore / empty deleted issues | `page-bin.js` |
| `admin-all.html` | All issues (admin view) | `page-issues.js` + `page-admin.js` |
| `admin-reported.html` | Reported (status filter = pending) | `page-issues.js` + `page-admin.js` |
| `admin-pending.html` | Pending | `page-issues.js` + `page-admin.js` |
| `admin-fixing.html` | Fixing | `page-issues.js` + `page-admin.js` |
| `admin-done.html` | Done | `page-issues.js` + `page-admin.js` |

### `js/` — the code

| Module | Loaded by | Responsibility |
|---|---|---|
| `supabase.js` | every page | Creates the **one** client, plus helpers (`escapeHtml`, `formatDate`, `timeAgo`, `friendlyError`) and constants (`STATUSES`, `PRIORITY_RANK`, `ADMIN`) |
| `auth.js` | every page | `initLoginPage()`, `guard()`, `isAdmin()`, `logout()`, `user` |
| `layout.js` | app pages | Builds the **sidebar**, **topbar**, theme control and **mobile bottom nav**; exposes `ET.layout.render()` |
| `sidebar.js` | app pages | Adds the **admin-only** links (Reported…Recycle bin) to the sidebar |
| `toast.js` | every page | `ET.toast(msg)` |
| `modal.js` | every page | `ET.confirm()` promise-based dialog |
| `install.js` | every page | **Install app** button (`beforeinstallprompt` / iOS hint) |
| `page-dashboard.js` | dashboard | Stats, chart, repeated issues, activity |
| `page-issues.js` | issues + admin-* | The whole board: list, filters, create/edit, status, delete, bulk actions, shortcuts, realtime |
| `page-admin.js` | admin-* | Applies the page's status filter and adds a confirm before Done |
| `page-users.js` | users pages | List accounts, promote/demote |
| `page-profile.js` | profile | Read-only details + change password |
| `page-settings.js` | settings | Appearance, clear filters, logout, backups |
| `page-bin.js` | recycle-bin | List / restore / empty the bin |

### `css/`

| File | Purpose |
|---|---|
| `css/app.css` | Shell: sidebar + topbar + content grid, plus the mobile drawer |
| `css/pages.css` | Per-page pieces (stats, cards, issue list) |
| `css/sidebar.css` | The admin sidebar section and role badge |
| `css/mobile-nav.css` | The mobile bottom navigation bar |
| `css/features.css` | Stale badge, bulk bar, admin message, repeated list, shortcuts, backups |

---

## 3. Data model

```mermaid
erDiagram
  profiles ||--o{ issues : "author_id"
  profiles {
    uuid id PK
    text username
    text role "admin | user"
    timestamptz created_at
  }
  issues {
    uuid id PK
    text title
    text description
    text priority "low | medium | high"
    text status "pending | fixing | done"
    text label
    uuid author_id FK
    timestamptz created_at
    timestamptz updated_at
    timestamptz completed_at
    timestamptz deleted_at "recycle bin"
    text admin_note
    timestamptz admin_note_at
  }
  backups {
    uuid id PK
    timestamptz created_at
    text kind "auto | manual"
    int issue_count
    jsonb payload
  }
  app_settings {
    bool id PK
    bool auto_backup_enabled
  }
```

**Users live in two places, on purpose:** Supabase's built-in `auth.users`
(credentials) and `public.profiles` (username + role). A trigger copies a row
across when someone signs up — see §4.

---

## 4. Security model

Two independent layers:

```mermaid
flowchart TB
  R["Request from the browser (JWT)"] --> RLS{"Row Level Security<br/>which ROWS?"}
  RLS -->|select| P1["issues are readable<br/>and deleted_at is null"]
  RLS -->|insert| P2["create issues<br/>author_id = auth.uid()"]
  RLS -->|update| P3["update own issue or admin"]
  RLS -->|delete| P4["delete own issue or admin"]
  RLS -->|"profiles"| P5["own row, or admin"]

  P2 --> G["Trigger: guard_issue_changes()"]
  P3 --> G
  G -->|"non-admin changes status"| X["❌ rejected in the DB"]
  G -->|ok| OK["✅ saved (updated_at / completed_at set here)"]
```

- **`is_admin()`** is `SECURITY DEFINER`, so a policy can look up the caller's
  role without tripping over RLS itself.
- **`handle_new_user()`** runs on sign-up and **computes** the role — it never
  trusts what the browser sends.
- **Admin-only actions** (recycle bin, backups) go through `SECURITY DEFINER`
  functions that re-check `is_admin()` **inside the database**.

> The `anon` key in `supabase-config.js` is meant to be public. It grants nothing
> that RLS does not allow.

---

## 5. The left panel, one by one

The sidebar is built by `js/layout.js` (main links) and `js/sidebar.js` (admin
links). On a phone the same main links appear as a **bottom bar**, and the
hamburger opens the sidebar as a drawer.

```
┌──────────────────────────┐
│  ✓ Issue Tracker         │
│                          │
│  🏠 Dashboard            │  main nav (everyone)
│  📋 Issues               │
│  👥 Users        (admin) │
│  👤 Profile              │
│  ⚙️  Settings             │
│                          │
│  Admin           (admin) │
│  📥 Reported             │
│  ⏳ Pending               │
│  🔧 Fixing                │
│  ✅ Done                  │
│  👥 Users                 │
│  🗑️  Recycle bin           │
│  ─────────────────────   │
│  🏠 All issues            │
│                          │
│  [ you · role ]          │
│  [ Install app ] (maybe) │
│  [ Logout ]              │
└──────────────────────────┘
```

Every page begins the same way:

```mermaid
flowchart TD
  A["Page opens"] --> B["layout.js: apply saved theme"]
  B --> C["auth.guard()"]
  C -->|"no session"| Z["→ index.html"]
  C -->|"session"| D["build sidebar + topbar + bottom nav"]
  D --> E{"requireAdmin page?"}
  E -->|"yes, not admin"| Y["→ dashboard.html"]
  E -->|"ok"| F["page script loads its data"]
```

### 5.1 🏠 Dashboard

**What it is for:** a one-glance overview of the whole board.

```mermaid
flowchart TD
  A["Open Dashboard"] --> B["guard + layout"]
  B --> C["load issues + profiles"]
  C --> D["Stat cards<br/>Total · Pending · Fixing · Done · High"]
  C --> E["Chart.js — issues per month, 12 months"]
  C --> F["Recent activity — last 10 events<br/>(derived from created/updated/completed)"]
  C --> G["Most repeated issues<br/>titles that appear more than once"]
  G --> H["click-through only; read-only view"]
```

- Source: `js/page-dashboard.js`. It reads **all** issues (RLS lets any signed-in
  user read the board).
- "Most repeated" matches titles ignoring case, spacing and punctuation
  (`Login fails!` = `login-fails`).

### 5.2 📋 Issues — the board

**What it is for:** everything that happens to an issue, all in one screen.

```mermaid
flowchart TD
  A["Open Issues"] --> B["guard + layout"]
  B --> C{"Admin?"}
  C -->|"yes"| D["show status dropdown, bulk tick-boxes, Export, Clear done"]
  C -->|"no"| E["hide them; own issues only for edit/delete"]
  B --> F["load issues + profiles → render cards"]
  F --> G{"What does the user do?"}

  G -->|"Report an issue"| H["insert issues row<br/>status = pending, author = me"]
  G -->|"Edit"| I["update row<br/>(title/description/priority + admin message)"]
  G -->|"Change status"| J["update status<br/>admins only"]
  G -->|"Tick rows → bulk bar"| K["update many / soft-delete many"]
  G -->|"Delete"| L["soft delete → Recycle bin"]
  G -->|"Search / filter / sort"| M["client-side, no round trip"]
  G -->|"Keyboard"| N["/ search · N new · ? help · Esc close"]

  H --> O["refresh() + Realtime updates every open tab"]
  I --> O
  J --> O
  K --> O
  L --> O
```

Key behaviours:

- **Sort** (newest / oldest / priority / title) and all filters run **in the
  browser** on the loaded list.
- **Admins cannot rewrite someone else's report** — the title and description are
  read-only for other people's issues; they set status/priority and can leave a
  **message to the reporter**.
- **Deleting is not destructive** — it sets `deleted_at` (see §5.7).
- **Stale badge**: an issue open > 7 days shows `Open Nd`.

### 5.3 👥 Users (admin)

**What it is for:** manage who is an admin.

```mermaid
flowchart TD
  A["Open Users"] --> B["layout.render(requireAdmin)"]
  B -->|"not admin"| Z["→ dashboard"]
  B --> C["select profiles"]
  C --> D["list users + role + joined date"]
  D --> E{"Make admin / Make user"}
  E --> F["update profiles.role"]
  F --> G["RLS + guard: admins only"]
  G --> H["reload list"]
```

Guards built into the UI **and** the database: you cannot change your **own**
role, and the **last admin** cannot be demoted.

### 5.4 👤 Profile

**What it is for:** your own account, read-only, plus a password change.

```mermaid
flowchart TD
  A["Open Profile"] --> B["guard + layout"]
  B --> C["show username, role, masked email, joined, id"]
  C --> D["Change password form"]
  D --> E["signInWithPassword(current) to verify"]
  E -->|bad| F["'current password is incorrect'"]
  E -->|ok| G["auth.updateUser({ password })"]
  G --> H["success toast"]
```

The email is **derived** (`username@domain`) and shown masked.

### 5.5 ⚙️ Settings

**What it is for:** device preferences, and (for admins) backups.

```mermaid
flowchart TD
  A["Open Settings"] --> B["guard + layout"]
  B --> C["Appearance: Auto / Light / Night<br/>→ localStorage it.theme"]
  B --> D["Clear all filters (localStorage)"]
  B --> E["Logout"]
  B --> F{"Admin?"}
  F -->|"no"| G["done"]
  F -->|"yes"| H["Automatic backups card"]
  H --> I["toggle auto_backup_enabled"]
  H --> J["Back up now → rpc create_backup()"]
  H --> K["snapshot list → Restore → rpc restore_backup(id)"]
```

### 5.6 Admin status pages (Reported · Pending · Fixing · Done · All issues)

**What they are for:** the same board, pre-filtered to one status.

```mermaid
flowchart TD
  A["Open admin-pending.html"] --> B["page-issues.js renders the board"]
  A --> C["page-admin.js"]
  C --> D["guardAdmin: non-admins → issues.html"]
  C --> E["set the page title from body[data-admin-status]"]
  C --> F["click the matching status button<br/>(reuses page-issues.js filtering)"]
  C --> G["wrap 'Done' changes in a confirm dialog"]
  F --> H["list shown = that status only"]
```

> These pages do **not** duplicate logic — `page-admin.js` only *drives* the
> board that `page-issues.js` already rendered. Add a feature once, in
> `page-issues.js`, and every admin page gets it.

| Page | Filter applied |
|---|---|
| `admin-reported.html` | `pending` ⚠️ (same as Pending — see Gotchas) |
| `admin-pending.html` | `pending` |
| `admin-fixing.html` | `fixing` |
| `admin-done.html` | `done` |
| `admin-all.html` | none (all) |

### 5.7 🗑️ Recycle bin (admin)

**What it is for:** undoing a delete.

```mermaid
sequenceDiagram
  actor A as Admin or reporter
  participant App as Issues page
  participant DB as Postgres
  A->>App: Delete an issue
  App->>DB: update issues set deleted_at = now()
  Note over DB: the "readable" policy hides it everywhere
  A->>App: open Recycle bin
  App->>DB: rpc list_deleted_issues()
  DB-->>App: binned rows
  A->>App: Restore → rpc restore_issue(id)
  A->>App: Empty → rpc empty_recycle_bin()
```

`List`, the dashboard, the chart and the counts all stop seeing a binned issue
because they read through the same policy.

---

## 6. Cross-cutting behaviour

### Live updates
```mermaid
flowchart LR
  T["Any change to issues/profiles"] --> RT["Supabase Realtime (WSS)"]
  RT --> P["every open tab calls refresh({silent:true})"]
  P --> R["list re-renders — no page reload"]
```

### Appearance (Auto / Light / Night)
```mermaid
flowchart LR
  L["layout.js"] --> K{"localStorage it.theme"}
  K -->|"dark / light"| AT["data-theme attribute set"]
  K -->|"auto (absent)"| N["attribute removed →<br/>CSS prefers-color-scheme decides"]
```

### Install as an app (PWA)
```mermaid
flowchart LR
  M["manifest.json + sw.js + icons"] --> B["beforeinstallprompt"]
  B --> BTN["Install app button (sidebar / sign-in)"]
  BTN --> P["browser install prompt"]
  SW["sw.js network-first cache"] --> OFF["opens offline"]
```

### Automatic backups
```mermaid
flowchart LR
  C["Any change to issues"] --> T["trigger issues_auto_backup"]
  T --> AS["auto_snapshot()"]
  AS -->|"due (max hourly)"| SN["snapshot_issues() → JSON row"]
  AS -->|"off, or recently done"| N["no-op"]
  AD["Admin: Back up now"] --> CB["create_backup()"] --> SN
  RT["Admin: Restore"] --> RB["restore_backup(id)"]
  RB --> S1["1. safety snapshot"] --> SN
  RB --> S2["2. replace issues from the snapshot"]
  SN --> KEEP["keep newest 30"]
```

---

## 7. One request, end to end

```mermaid
sequenceDiagram
  actor U as Admin
  participant P as issues.html + page-issues.js
  participant API as Supabase PostgREST
  participant DB as Postgres
  U->>P: set status to Done
  P->>API: update issues set status='done'
  API->>DB: apply
  DB->>DB: RLS — author or admin? ✅
  DB->>DB: guard_issue_changes() — admin? ✅ (sets completed_at)
  DB->>DB: issues_auto_backup → maybe snapshot
  DB-->>API: row
  API-->>P: 200 OK
  API-->>P: Realtime event → other tabs refresh
  P-->>U: toast "Status changed to Done"
```

---

## 8. Running, deploying and setting up (for a newcomer)

### First-time setup
1. Create a free project at **supabase.com**.
2. **SQL Editor → New query** → paste `supabase/schema.sql` → **Run**.
   (For an existing database, the focused files in `sql/` are enough.)
3. **Settings → API** → copy the **Project URL** and **anon** key into
   `supabase-config.js`.
4. Open `index.html` (or the deployed site) and register. **The first account
   should be made an admin** (see `SETUP.md`).

### Run locally
```powershell
python -m http.server 8000     # then open http://localhost:8000
```
Don't double-click the file — a `file://` origin is blocked by CORS when talking
to Supabase.

### Deploy
```mermaid
flowchart LR
  D["Edit files"] --> G["git commit + push"]
  G --> GH["GitHub: rawrmeo/issue-tracker"]
  GH --> V["Vercel builds & deploys"]
  V --> L["https://…vercel.app"]
```
`vercel.json` adds clean URLs and security headers; `.vercelignore` keeps local
secrets out. A commit also auto-pushes (git hook).

---

## 9. Common maintenance recipes

| I want to… | Do this |
|---|---|
| **Add a field to an issue** | `alter table … add column if not exists` → add it to `mapIssue()` in `page-issues.js` + `page-dashboard.js` → show it in `issueCard()` |
| **Add a new page** | Copy a `pages/*.html`, point it at the shared scripts, add `ET.layout.render({ active, title })`, then add it to `NAV` in `layout.js` (sidebar **and** bottom nav) |
| **Change who can do something** | Edit the RLS policies / `guard_issue_changes()` in `supabase/schema.sql` — **not** just the button |
| **Add an admin action** | Write a `SECURITY DEFINER` function that checks `is_admin()`, then call it with `sb.rpc(...)` |
| **Change the colours** | `styles.css` (`:root` and the dark block) |
| **Change the sidebar** | `js/layout.js` (`NAV`) for everyone; `js/sidebar.js` (`ADMIN_LINKS`) for admins |
| **Test with sample data** | Run `sql/demo_data.sql` (only fills an empty board) |

---

## 10. Gotchas & known quirks

- **Two "Users" entries** in the sidebar (main nav + admin section) — both open
  `users.html`.
- **"Reported" and "Pending"** admin pages currently apply the **same** `pending`
  filter (`admin-reported.html` has `data-admin-status="pending"`). If "Reported"
  should mean something else, change that attribute or the filter.
- **`app.html`** is a leftover from the single-page version; nothing links to it.
- **The admin-message, recycle-bin and backup features need their SQL run once.**
  Until then the app falls back to hard delete and skips the message.
- **OneDrive is not used** for this repo — keep it out of cloud-sync folders so
  `.git` is never re-synced mid-write.
- **`supabase-config.js` is public on purpose.** Never put a `service_role` key
  there.
- **Roles are chosen at sign-up** in this build; a new maintainer may want to
  lock that down and promote people from the Users page instead.

---

## 11. Quick index

| Question | Answer |
|---|---|
| Where does a request start? | `index.html` → `pages/dashboard.html` |
| Where is the app shell? | `js/layout.js` + `css/app.css` |
| Where is all data access? | `js/supabase.js` (one client) + `page-*.js` |
| Where are the rules? | `supabase/schema.sql` — RLS + `guard_issue_changes()` |
| Where are the admin RPCs? | `sql/recycle_bin.sql`, `sql/backups.sql` |
| Where is the theme? | `js/layout.js` + `styles.css` (`prefers-color-scheme`) |
| Where is the PWA? | `manifest.json`, `sw.js`, `js/install.js` |
| Where is the deployment? | `vercel.json`, `.vercelignore` |
