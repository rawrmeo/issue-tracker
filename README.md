# Issue Tracker

An issue tracker with a real login, pending/fixing/done workflow, and
admin/user roles — backed by a **Supabase PostgreSQL database** so your data is
shared across every device.

Reporters file issues. Admins fix them and mark them done. That rule is
enforced by the **database**, not by the browser.

**➡️ First time here? Follow [`SETUP.md`](SETUP.md) to connect your database.**

---

## Features

- **Real accounts** — sign-in is verified server-side by Supabase Auth.
- **Roles** — `admin` (fixes issues) and `user` (reports issues).
- **Workflow: Pending → Fixing → Done** — only an admin can move an issue along.
- **Live updates** — new issues appear on everyone's screen without refreshing.
- **Filter and search** — by status, priority, and free text; sort several ways.
- **Stats bar** — total / pending / fixing / done / high-priority open.
- **Export** — admin can download every issue as JSON.
- **Automatic backups** — the database snapshots every issue by itself; admins
  can view, download or restore any snapshot from the **Backups** page.
- **Light / dark theme.**
- **No build step** — plain HTML/CSS/JS, deploys to Vercel as-is.

## Roles and permissions

| Action | Admin | User |
| --- | :-: | :-: |
| Sign in, see all issues | ✅ | ✅ |
| Report a new issue | ✅ | ✅ |
| Edit / delete own issues | ✅ | ✅ |
| Edit / delete anyone's issue | ✅ | ❌ |
| Set status to **Fixing** or **Done** | ✅ | ❌ |
| Clear done issues | ✅ | ❌ |
| Promote / demote users | ✅ | ❌ |
| Export issues | ✅ | ❌ |
| View / restore / delete backups | ✅ | ❌ |

New issues always start as **Pending**. A reporter can never change a status.
A user sees a banner explaining this, and each issue's status dropdown is
replaced with a read-only coloured dot.

**Where the rule is enforced:** Row Level Security decides *which rows* you may
update — but not *which columns*. So the headline rule lives in a `BEFORE
UPDATE` trigger called `issues_guard` in `supabase/schema.sql`. Even if somebody
edits `app.js` in their browser and crafts a raw API call, they still get:

```
Only admins can change the status of an issue
```

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure (auth + app views) |
| `styles.css` | Styling and theme |
| `app.js` | UI, Supabase client calls, permissions for the UI |
| `supabase-config.js` | **Your** project URL + anon key (you fill this in) |
| `supabase/schema.sql` | Tables, RLS policies, triggers — run once |
| `SETUP.md` | Step-by-step database setup |
| `vercel.json` | Vercel config (clean URLs, security headers) |
| `deploy.ps1` | Windows helper: commit + push in one command |
| `.github/workflows/` | *removed* — Vercel's Git integration handles deploys |

**Architecture:** the browser talks straight to Supabase using the public
`anon` key. There is no server of your own to run. The database decides what
each person may do, which is why the anon key being public is harmless.

---

## 1. Run it locally

The database must be set up first — see [`SETUP.md`](SETUP.md).

Then serve the folder over HTTP (don't just double-click `index.html`, because
`file://` origins can be blocked by CORS when calling Supabase):

```powershell
python -m http.server 8000
```

Open **http://localhost:8000**.

## 2. Put it on GitHub

```powershell
git init
git branch -M main
git add -A
git commit -m "Issue tracker backed by Supabase"
```

Create an empty repo on GitHub (no README, no .gitignore), then:

```powershell
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

After that, every change is one command:

```powershell
.\deploy.ps1
.\deploy.ps1 -Message "add priority filter"
```

> `supabase-config.js` **is** committed on purpose. The anon key is meant to be
> public. Never commit a `service_role` key.

## 3. Connect Vercel (auto-deploy)

1. Sign in at <https://vercel.com> with GitHub.
2. **Add New → Project → Import** your repository.
3. Framework Preset: **Other**. Leave build command and output directory empty.
4. **Deploy**.

Every push to `main` then redeploys automatically.

### Manual deploy with the Vercel CLI

The CLI is installed and linked to this project, so you can also deploy
without committing:

```powershell
vercel --prod      # deploy the current folder straight to production
vercel ls          # list deployments
vercel logs <url>  # tail runtime logs
```

Useful when you want to push a change live without a commit. The normal
route is still `.\deploy.ps1` → git push → Vercel rebuilds.

---

## Security

Unlike the earlier localStorage version, this is a genuine multi-user system:

- **Passwords** are hashed and verified by Supabase Auth. Your app never sees
  them.
- **Row Level Security** is on for both tables, so an unauthenticated visitor
  can read nothing.
- **Roles** cannot be self-assigned. The `handle_new_user` trigger *computes*
  the role and never trusts client-supplied data, so nobody can register
  themselves as an admin.
- **Status changes** are blocked for non-admins by the `issues_guard` trigger.
- **The anon key is safe to publish.** It only grants what RLS allows.

Things to keep in mind:

- **Whoever registers first becomes the admin.** Set up your admin account
  immediately after running the schema (see `SETUP.md` Step 6).
- Anyone who can reach the URL can **create a reporter account** and file
  issues. If that's not what you want, turn off *Allow new users to sign up* in
  **Authentication → Sign In / Providers** once your team is registered — but
  note that new people would then need an admin to add them from the dashboard.
- **Project Settings → API** also shows a `service_role` key. That one is a
  master key and bypasses all security. It must never appear in any file in
  this repo.

---

## Quick reference

| Task | Action |
| --- | --- |
| Report an issue | Fill the form → **Report issue** |
| Move to Fixing / Done | Admin: use the status dropdown on the issue |
| Edit / delete | **Edit** / **Delete** on your own issues (admin: any) |
| Find an issue | Search box, or the All / Pending / Fixing / Done buttons |
| Promote a reporter | Admin → **Users** → **Make admin** |
| See the raw data | Supabase dashboard → **Table Editor** |
| Back up | Admin → **Export**, or Supabase → Database → Backups |
| Deploy changes | `.\deploy.ps1` |
