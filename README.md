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

## 4. Branch workflow — `develop` → `main`

Day-to-day work happens on **`develop`**. `main` is the stable, live branch
(Vercel deploys it).

```powershell
git checkout develop      # work here
# ... edit files, then ...
git add -A
git commit -m "what changed"
```

### Automatic sync (already configured)

- **VS Code** — `.vscode/settings.json` sets `git.autofetch` (checks GitHub
  every 60 seconds) and `git.postCommitCommand: "sync"` (pull + push after a
  commit made from the Source Control panel).
- **Terminal** — `.git/hooks/post-commit` and `.git/hooks/post-merge` push the
  current branch after every commit / merge, so a plain `git commit` also
  updates GitHub. If the push fails (e.g. you are offline) the commit still
  succeeds; run `git push` manually later.

`main` and `master` are deliberately **excluded** from the auto-push hook so a
production deploy can never happen by accident. To include them, remove the
`case "$branch" in ... esac` block at the top of `.git/hooks/post-commit`.

### Promote `develop` to `main`

```powershell
git checkout main
git pull
git merge develop
git push
git checkout develop      # back to your work branch
```

Or open a pull request on GitHub: `develop` → `main` → **Merge**.

> Hooks live in `.git/`, which Git does not track, so they are **not** cloned
> to other machines. Re-create them when you set up a new PC.

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

## Install it on your phone

The app is a **PWA**, so it can be installed straight from the browser and then
opens full screen with its own icon:

- **Android / Chrome:** open the site → menu **⋮ → Install app** (or *Add to
  Home screen*).
- **iPhone / Safari:** open the site → **Share → Add to Home Screen**.

A service worker caches the shell, so it also opens when the phone is offline
(showing the last loaded version).

---

## Extra features

- **Stale badges** — an issue still open after **7 days** shows an *Open Nd*
  badge on the Issues page.
- **Bulk actions (admins)** — tick issues on the Issues page, then **Apply
  status** or **Delete selected** in one go.
- **Message to the reporter** — when an admin edits an issue, the reporter's
  title and description are kept read-only; the admin can set the status and
  priority and leave a message, which the reporter sees on the issue.
- **Most repeated issues** — the Dashboard lists titles reported more than
  once (case, spacing and punctuation ignored).
- **Keyboard shortcuts** — on the Issues page: `/` search, `N` new issue,
  `?` help, `Esc` close.
- **Appearance** — Settings now offers **Auto / Light / Night**.
- **Recycle bin** — deleting an issue now bins it instead of erasing it. Admins
  open **Recycle bin** in the sidebar to restore one or empty the bin.
- **Install app** — an **Install app** button (sidebar and sign-in page) turns
  the site into a home-screen app on phones.
- **Automatic backups (admins)** — Settings → **Automatic backups**. The
  database snapshots every issue at most once an hour; admins can **Back up
  now**, see saved snapshots and **Restore** one.

> **One-time database step.** Run these in Supabase → SQL Editor → Run (or just
> run the whole `supabase/schema.sql`, which includes them):
> `sql/admin_note.sql`, `sql/recycle_bin.sql`, `sql/backups.sql`.

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
