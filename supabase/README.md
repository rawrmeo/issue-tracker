# Supabase — the database half

`index.html` runs fine on its own (demo mode). This folder is what turns it into
a **real, shared** tracker: real accounts, emailed password resets, and one
Postgres database everybody signs in to.

```
supabase/
├── migrations/
│   └── 20260922120000_init.sql   # tables, roles, triggers and Row Level Security
└── README.md                     # this file
```

The same schema is also kept in [`../supabase-schema.sql`](../supabase-schema.sql)
and embedded in `index.html` (shown in the app's **Connect Supabase** dialog).
**If you change one, change all three.**

## 1. Create the project

1. Sign up at <https://supabase.com/dashboard> (free tier is plenty).
2. **New project** → give it a name, generate a database password and save it,
   pick the region closest to you, then wait ~2 minutes.

## 2. Create the tables

Either way is fine — they run the same SQL.

**Dashboard (no tools needed)**

1. **SQL Editor → New query**.
2. Paste the whole of [`migrations/20260922120000_init.sql`](migrations/20260922120000_init.sql)
   (or `../supabase-schema.sql`).
3. Press **Run**. You should see *Success. No rows returned*.

**Supabase CLI**

```powershell
# once per machine
npm install -g supabase

# in the project root
supabase init                 # creates supabase/config.toml if missing
supabase link --project-ref <your-project-ref>
supabase db push
```

## 3. Point the app at it

1. In the dashboard go to **Project Settings → API Keys** and copy:
   - the **Project URL** — `https://<ref>.supabase.co`
   - the **public / anon** (or **publishable**) key, starting `sb_publishable_…`
2. Open `index.html` and fill the config block at the top of the `<script>`:

   ```js
   var SUPABASE_URL      = "https://<ref>.supabase.co";
   var SUPABASE_ANON_KEY = "sb_publishable_...";
   ```

3. In **Authentication → URL Configuration** set:
   - **Site URL**: your main published address — e.g.
     `https://YOUR-USERNAME.github.io/mini-issue-tracker/` (GitHub Pages) or
     `https://mini-issue-tracker.vercel.app/` (Vercel).
   - **Redirect URLs**: every address you publish to, plus `http://localhost:8000/`
     for local testing, e.g.
     ```
     https://YOUR-USERNAME.github.io/mini-issue-tracker/
     https://mini-issue-tracker.vercel.app/
     http://localhost:8000/
     ```

   See [`../PUBLISHING.md`](../PUBLISHING.md) for how to get each of those URLs.

When the yellow **Demo (local)** badge in the sidebar changes to **Connected**,
the app is talking to Supabase.

## What the schema protects

| Rule | How |
| --- | --- |
| Any signed-in user sees the whole board | `issues_select_auth` |
| You can only report an issue as yourself | `issues_insert_auth` (`auth.uid() = created_by`) |
| Only admins may change a status or any issue field | `issues_update_admin`; normal users have no update policy at all |
| Admins may edit and delete anything | `issues_update_admin`, `issues_delete_admin` |
| Only admins read all profiles / change roles | `profiles_select_admin`, `profiles_update_admin` + the `guard_profile_role` trigger |
| Only admins can delete a user | `admin_delete_user()` — a `SECURITY DEFINER` function that re-checks the admin role inside the database |
| Deleting a user keeps their issues | `issues.created_by` is `ON DELETE SET NULL`; the function also detaches the issues first |

Every rule lives in the database, so it holds even if someone edits the page in
DevTools. The `anon` key is public on purpose — RLS is what protects the data.

**Making the first admin:** the register form lets the very first account choose
the Administrator role. If you'd rather not allow that, register everyone as a
normal user and promote the first admin by hand in the SQL Editor:

```sql
update public.profiles set role = 'admin'
where email = 'you@example.com';
```

> **Never** put the `service_role` / `secret` key in `index.html`. That key
> bypasses Row Level Security entirely.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Badge still says **Demo (local)** | The two config values are empty, or the page was loaded offline so the Supabase CDN script didn't load. Re-check step 3 and hard-refresh with `Ctrl` + `F5`. |
| *Database tables are missing* | Step 2 wasn't run, or it failed. Re-run the SQL; it is safe to repeat. |
| *Only an administrator can edit issue details.* | Expected — that's the `guard_issue_update` trigger. Promote the account in step 3 above. |
| **Too many attempts** when registering | Supabase's built-in email sender allows only a few messages per hour, and every sign-up sends a confirmation email — so repeated tries make it worse. Wait ~1 hour, or turn off **Confirm email** (below) while testing. |
| *This email hasn't been confirmed yet* | The confirmation email is on. Either click the link, or turn off **Confirm email**. |
| *That email is already registered* after retrying | Your earlier attempt created the user even though the email never arrived. Sign in with it, or delete it under **Authentication → Users** and register again. |
| *Your database doesn't accept the "None" status yet* | The status list gained a third value (**None**). Re-run the SQL in step 2 — it replaces the old two-value constraint and is safe to repeat. |
| *Could not find the function public.admin_delete_user* | User deletion was added after you first set up the database. Re-run the SQL in step 2; it is safe to repeat. |
| Reset email never arrives | Supabase's built-in sender is rate-limited. Wait, check spam, or connect your own SMTP under **Authentication → Emails → SMTP Settings**. |
| Reset link opens an error page | Your site's URL isn't in **Redirect URLs** (step 3). Add it exactly, with the trailing `/`. |

> **While developing, turn off email confirmation.** In the dashboard open
> **Authentication → Sign In / Providers → Email** and switch **Confirm email**
> off. New accounts are then usable immediately and **no email is sent**, so the
> rate limit never gets in your way. Turn it back on before you go live.
