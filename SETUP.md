# Setup — connecting your database

Follow this once. It takes about 10 minutes, and after that the tracker stores
everything in a real PostgreSQL database, shared across all your devices.

You do **not** need to install anything, and you do **not** need Node.js.

---

## What you'll end up with

| | |
| --- | --- |
| **Database** | Supabase Postgres (free tier is far more than enough) |
| **Login** | Real server-verified accounts (Supabase Auth) |
| **The admin rule** | Enforced by the *database*, so it cannot be bypassed from the browser |
| **Sharing** | Every device and every person sees the same issues |

---

## Step 1 — Create the Supabase project

1. Go to **https://supabase.com** and sign up (GitHub login is easiest).
2. Click **New project**.
3. Give it a name, e.g. `issue-tracker`.
4. Set a **Database Password** — this is for the database itself, *not* your
   login to the app. Save it somewhere safe, or just click to generate one.
5. Pick the region closest to you and click **Create new project**.
6. Wait ~1 minute while it provisions.

---

## Step 2 — Create the tables

1. In your project, open **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open the file **`supabase/schema.sql`** from this project, copy its
   **entire** contents, and paste it into the editor.
4. Click **Run** (or press `Ctrl+Enter`).

You should see **Success. No rows returned**. That's correct — it creates
tables, not rows.

> This file is safe to run again later; it won't duplicate anything.

---

## Step 3 — Turn off email confirmation ⚠️ important

The app identifies you by **username**, but Supabase Auth is built around
**email**. Behind the scenes each username becomes
`yourname@example.com` — a reserved domain that can never receive mail. So
confirmation emails must be **off**, or you could never sign in.

1. Go to **Authentication** → **Sign In / Providers**
   *(in some versions: Authentication → Providers)*
2. Open the **Email** provider.
3. Turn **Confirm email** → **OFF**.
4. Make sure **Allow new users to sign up** is **ON**
   *(also under Authentication → Settings in some versions)*.
5. Save.

---

## Step 4 — Copy your two keys

1. Go to **Settings** (the gear icon) → **API**.
2. Copy these two values:

| What it's called | What it is |
| --- | --- |
| **Project URL** | looks like `https://abcdefghijk.supabase.co` |
| **anon** / **public** key | a long string starting with `eyJ...` |

> 🔒 **About the anon key:** it is *designed* to be public and shipped to
> browsers. It is not a secret. Your data is protected by the database's Row
> Level Security policies, not by hiding this key.
>
> ⛔ **Never** put the **`service_role`** key in this file. That one *is*
> secret and bypasses all security.

---

## Step 5 — Paste them into `supabase-config.js`

Open **`supabase-config.js`** and fill in the two empty values:

```js
window.SUPABASE_CONFIG = {
  url: 'https://abcdefghijk.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  emailDomain: 'example.com',
};
```

Save the file, then **reload the app**. The "Connect your database" screen
should be replaced by the sign-in screen.

---

## Step 6 — Create your admin account (do this first!)

> **Do this immediately.** The **first** account created in a fresh database
> automatically becomes the **admin**. If you leave the project sitting there,
> someone else could register first and take that role.

1. Click **Create one** under the sign-in form.
2. Pick a username (3–32 characters: letters, numbers, `.`, `_`, `-`).
3. Pick a password (6+ characters).
4. Click **Create account**.

You are now signed in as the **admin**. You'll see the **Users** panel and a
status dropdown on every issue.

If someone else did get there first, promote yourself by hand: open the SQL
Editor and run

```sql
update public.profiles set role = 'admin' where username = 'yourname';
```

---

## Step 7 — Add a reporter and test the rule

1. As admin, open the **Users** panel and note you're the only account.
2. Sign out (**Sign out**, top right).
3. Click **Create one** and register a second account, e.g. `jane`.
4. As `jane`, report an issue. Notice:
   - the form has **no Status field**
   - issues show a **coloured dot**, not a dropdown
   - there is **no Users panel**
5. Sign back in as your admin. Change that issue to **Fixing**, then **Done**.

To test both at once, use a second browser or a private window.

---

## Step 8 — Deploy to Vercel

Because `supabase-config.js` now contains your real values, just push:

```powershell
.\deploy.ps1
```

Then at **https://vercel.com** → **Add New → Project → Import** your GitHub
repo → Framework Preset **Other** → **Deploy**.

The anon key is safe to commit — it's meant to be public. Everything works on
Vercel with no extra configuration, and Vercel redeploys on every push.

---

## Looking at your database

This is the nice part. In the Supabase dashboard:

**Table Editor** (left sidebar) → pick **`issues`** or **`profiles`**.

You get a spreadsheet view where you can sort, filter, edit and export. This
replaces the DevTools → localStorage poking from before.

For ad-hoc questions, use the **SQL Editor**:

```sql
-- everyone and their role
select username, role, created_at from public.profiles order by created_at;

-- every issue, newest first
select i.title, i.status, i.priority, p.username as reporter, i.created_at
from public.issues i
join public.profiles p on p.id = i.author_id
order by i.created_at desc;

-- how many of each status
select status, count(*) from public.issues group by status order by status;
```

You can also **export** from the app itself: as admin, click **Export** in the
top bar for a JSON file of every issue.

---

## Managing people

| I want to… | How |
| --- | --- |
| Add a reporter | They self-register with **Create one** on the login screen |
| Promote / demote | Admin → **Users** panel → **Make admin** / **Make user** |
| Delete an account | Supabase dashboard → **Authentication → Users** → delete |
| Reset a forgotten password | Supabase dashboard → **Authentication → Users** → user → **Reset password** (or send a recovery link) |
| Edit the database by hand | Supabase dashboard → **Table Editor** |

Deleting a user in the dashboard also deletes their issues, because the
`issues.author_id` column cascades on delete.

---

## Troubleshooting

**I still see "Connect your database".**
`supabase-config.js` is empty or has a typo. The URL must start with `https://`
and the key must be the full `eyJ...` string. Save the file and hard-reload
(`Ctrl+Shift+R`).

**"No profile found for this account. Did you run supabase/schema.sql?"**
The `handle_new_user` trigger is missing. Re-run the whole of
`supabase/schema.sql` in the SQL Editor.

**"Account created, but email confirmation is switched ON…"**
Do Step 3. (Or sign in from Supabase → Authentication → Users if you used a
real email.)

**"That username is already taken."**
Usernames are unique. Pick another.

**"You do not have permission to do that."**
Row Level Security blocked it — usually because you're a normal user trying to
do an admin-only thing. That's the system working. Check your role in
**Users**.

**The green live dot stays grey.**
Realtime isn't enabled for the table. It's cosmetic — the **Refresh** button
still works. To fix it, re-run the last section of `supabase/schema.sql`.

**It works locally but not on Vercel.**
Make sure you actually committed `supabase-config.js` (it is not in
`.gitignore` on purpose), and that you pasted the **Project URL**, not the
database connection string.

---

## What changed vs. the old localStorage version

| | Before | Now |
| --- | --- | --- |
| Storage | That one browser | Postgres, all devices |
| Login | Checked in the browser | Verified by the server |
| "Only admins can close" | A browser check that could be bypassed | A database trigger that cannot |
| Losing data | Clearing cookies wiped it | Survives anything you do to your browser |
| Seeing the data | DevTools → localStorage | Dashboard → Table Editor |
