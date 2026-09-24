# Issue Tracker

A role-based issue tracking system. Two kinds of account:

| Role | Can do |
| --- | --- |
| **Administrator** | Everything: report, **edit**, **delete**, search, change status, and manage users (promote/demote). |
| **Normal user** | Report issues — each one starts as **None** — and search. Cannot change a status, edit details, or delete. |

The rules are enforced in **both** places: the interface hides what a role
cannot do, and the database (Row Level Security + triggers) rejects it anyway.

---

## What's in this folder

| File | What it is |
| --- | --- |
| `index.html` | The whole app — login, dashboard, issues, users. Open it in a browser. |
| `supabase-schema.sql` | The database: tables, triggers and security policies. Paste it into Supabase. |
| `supabase/` | The same schema as a migration, plus a Supabase setup guide. |
| `PUBLISHING.md` | How to put it online for free — GitHub Pages or Vercel. |
| `vercel.json` | Ready-made Vercel config (static site, no build step). |
| `steps/` | Older tutorial versions of the tracker, kept for reference. |

`index.html` is also its own setup guide: the **Connect Supabase** button
(banner or setup panel) shows the same SQL with a copy button.

---

## Running it in 30 seconds (no setup)

Just open `index.html` in a browser.

Because no database is connected yet, it runs in **demo mode** and keeps
everything in that browser's local storage. Two accounts are ready:

| Email | Password | Role |
| --- | --- | --- |
| `admin@demo.com` | `admin123` | Administrator |
| `user@demo.com` | `user123` | Normal user |

Log in as each one to see how the permissions differ. Anything you create in
demo mode stays on that one browser — it is not shared with anyone else.

---

## Connecting a real Supabase database

Do this when you want real accounts and one shared board for everyone.

1. **Create the project.** Sign up at [supabase.com](https://supabase.com)
   and create a free project.

2. **Create the tables.** In the project, open **SQL Editor → New query**,
   paste the whole of `supabase-schema.sql`, and press **Run**. You should see
   *Success. No rows returned*. The file is safe to run more than once.

3. **Copy your keys.** Open **Project Settings → API** and copy:
   - the **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **anon public** key

4. **Paste them into the app.** Open `index.html` and fill in the two
   variables near the top of the `<script>` block:

   ```js
   var SUPABASE_URL      = "https://abcdefgh.supabase.co";
   var SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```

5. **Reload the page.** The demo banner disappears and you can register.
   Creating an account now works across every browser, and your issues are
   shared.

### About the anon key

It is designed to be public and is safe in this file. Supabase protects your
data with Row Level Security, not by hiding the key.

### Make yourself an admin

If you already registered as a normal user, open the SQL Editor and run:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

You can also register as an Administrator from the start — the register form
has a role picker. Note that letting anyone self-register as an admin is fine
for a class project, but in production you would lock that down and promote
people from the Users screen instead.

---

## Putting it online

The app is one static file, so hosting is free and quick.
[`PUBLISHING.md`](PUBLISHING.md) walks through both hosts step by step:

- **GitHub Pages** — simplest; gives you a URL like
  `https://YOUR-USERNAME.github.io/mini-issue-tracker/`.
- **Vercel** — imports the same GitHub repo, redeploys on every push, and gives
  each change its own preview URL. The included `vercel.json` needs no editing.

Either way, if you are using Supabase, add the live URL to Supabase's
**Authentication → URL Configuration** so password-reset links return to it.

---

## Using the app

**The avatar menu (top right)** is where personal things live:

| Menu item | What it does |
| --- | --- |
| **My Profile** | Your name and picture (both editable), plus your email and role. |
| **My Issues** | The issues you reported. |
| **Notifications** | Activity feed, with unread highlighting. The bell shows the count. |
| **Settings** | Notification preferences — what you want to be told about. |
| **Sign Out** | Logs you out. |

- **Dashboard** — every issue, with counts for Total / Pending / Done / None /
  High priority.
- **My reports** — only the issues you reported.
- **Statistics** *(everyone)* — totals, completion rate, breakdowns by status and
  priority, top reporters, and a 14-day activity chart. Read-only.
- **Reports** *(admins only)* — filter by date range and status, then
  **Print / Save as PDF** or **Download CSV**.
- **Users** *(admins only)* — change a role inline, **edit** a user (name and
  role), or **delete** them. You cannot change your own role or delete your own
  account, so you cannot lock yourself out. Deleting a user keeps their issues
  on the board.
- **Settings** *(admins only)* — download a **JSON backup** (restorable) or a
  **CSV** for Excel, restore from a JSON backup (add or replace), delete all
  issues, and see system status.
- **Search** — matches the title, description and reporter. The priority
  dropdown narrows the list further.
- **Status** — pick **Pending**, **Done** or **None** from the dropdown.
  **Admins only**: a normal user reports an issue (it starts as **None**) and
  cannot change it afterwards.
- **Edit / delete** — the two icons on the right of a row, admins only.
- **Log out** — the button in the sidebar, under your name.

---

## Notifications

There's no separate notifications table — the feed is **derived from the issues**
you can already see, using three rules you control in **Settings**:

| Preference | Notifies you about |
| --- | --- |
| New issues reported by others | Issues created by someone else |
| Issues marked as done | Anything that has reached Done |
| Open high-priority issues | Anything still open and marked High |

The bell shows how many entries are newer than the last time you marked them
read. **Mark all as read** stores that timestamp on your profile, so the count
follows you between devices.

Because the feed is derived rather than event-logged, it reflects the *current*
state of the board — an issue that was reopened no longer appears under "marked
as done". A true event log would need its own table.

## Backup and restore

The **Settings** page (admins only) handles day-to-day backup:

- **Export** writes every issue to a JSON file (the one you restore from) plus
  a CSV for spreadsheets.
- **Restore** reads that JSON and either **adds** the issues or **replaces**
  the whole board.
- Restored issues keep their original reporter in the *Reported by* column, but
  the row is owned by the admin who imported it — the database requires the
  inserting user to be the owner.

Backups cover **issues only**, not user accounts (those live in Supabase's
`auth.users`). For a complete database backup use Supabase →
**Database → Backups** in the dashboard.

## How the security works

- Each user gets a row in `profiles` holding their **role**, created
  automatically when they sign up (the role they chose is passed through in
  the sign-up metadata).
- `issues` are readable by any signed-in user, but:
  - inserting stamps the issue with your own user id,
  - a normal user may only update a row they reported, and a trigger
    (`guard_issue_update`) refuses any change other than the status,
  - deleting is admin-only,
  - changing a **role** is admin-only (`guard_profile_role`).
- **Deleting a user** is the one thing a browser cannot do directly — it needs
  the service key, which must never be in a web page. Instead the SQL defines
  `admin_delete_user()`, a `SECURITY DEFINER` function that checks you are an
  admin *inside the database* and then removes the auth user. Their issues stay,
  with the reporter link cleared.
- Those triggers mean a hand-crafted request from the browser can't do more
  than the buttons allow.
