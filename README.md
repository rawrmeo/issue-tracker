# Issue Tracker

A small issue tracker with a login screen, pending/done tracking, and one-command
deploy to GitHub + Vercel.

No build step, no dependencies, no database account needed. It is plain
HTML/CSS/JavaScript and runs straight in the browser.

---

## Features

- **Roles** — an **admin** (who fixes issues) and **users** (who report them).
  See [Roles and permissions](#roles-and-permissions) below.
- **Login surface** — first visit creates the admin account; every later visit
  requires sign-in. Passwords are hashed with PBKDF2-SHA256 + a random salt.
- **Report issues manually** — title (required), description, priority, and a
  free-form label.
- **Workflow: Pending → Fixing → Done** — only an admin can move an issue along.
- **User manager** — the admin can add users, promote/demote them, reset
  passwords, and remove them.
- **Filter and search** — by status, priority, and free text; sort by newest,
  oldest, priority, or title.
- **Stats bar** — totals for all / pending / fixing / done / high-priority open.
- **Export & Import** — admin-only JSON backup and restore.
- **Light / dark theme** — remembers your choice.
- **Auto-deploy** — push to GitHub and Vercel rebuilds and deploys the site.

## Roles and permissions

| Action | Admin | User |
| --- | :-: | :-: |
| Sign in | ✅ | ✅ |
| Report a new issue | ✅ | ✅ |
| See all issues | ✅ | ✅ |
| Edit / delete own issues | ✅ | ✅ |
| Edit / delete anyone's issue | ✅ | ❌ |
| Set status to **Fixing** or **Done** | ✅ | ❌ |
| Clear done issues | ✅ | ❌ |
| Export / import backups | ✅ | ❌ |
| Add / remove users, reset passwords | ✅ | ❌ |

New issues always start as **Pending**. A user can never change a status — they
report the problem, and an admin marks it **Fixing** then **Done**. Users see a
banner explaining this, and the status control on each issue is replaced with a
read-only coloured dot.

**How accounts are created:** the first account you make is the admin. After
that, the admin opens the **Users** panel and creates accounts for everyone
else. There is no public sign-up. The last remaining admin cannot be demoted or
removed, and you cannot change your own role.


## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure (login + app views) |
| `styles.css` | Styling and theme |
| `app.js` | Auth, roles &amp; permissions, issue workflow, user manager, storage |
| `vercel.json` | Vercel config (clean URLs, security headers) |
| `.github/workflows/deploy.yml` | GitHub Action that deploys to Vercel on push to `main` |
| `deploy.ps1` | Windows helper: commit + push in one command |

---

## 1. Run it locally

Just double-click **`index.html`**. That's it — the login screen appears, create
your account, and start adding issues.

> For the strongest password hashing (and to match the deployed site), serve it
> over `http://localhost` instead of `file://`. If Node is installed later:
> `npx serve .` and open the printed address.

---

## 2. Put it on GitHub

You already have git installed. In this folder:

```powershell
git init
git branch -M main
git add -A
git commit -m "Initial commit"
```

Create an empty repository on GitHub (no README, no .gitignore), then:

```powershell
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

After this, every future change is one command:

```powershell
.\deploy.ps1                          # auto commit message
.\deploy.ps1 -Message "fix login bug" # custom message
```

## 3. Connect Vercel (auto-deploy)

1. Sign in at <https://vercel.com> with your GitHub account.
2. **Add New → Project → Import** the repository you just pushed.
3. Framework Preset: **Other**. Leave build command and output directory empty
   (it is a static site).
4. Click **Deploy**.

From now on, **every push to `main` triggers a new Vercel deployment
automatically** — that is the "auto upload to GitHub and Vercel" flow.

### Optional: deploy from GitHub Actions instead

Vercel's own Git integration already covers this, so you only need the included
workflow `.github/workflows/deploy.yml` if you prefer deploying from CI (for
example, to keep Vercel's Git integration off).

To enable it, add three repository secrets
(**Repo → Settings → Secrets and variables → Actions → New repository secret**):

| Secret | Where to find it |
| --- | --- |
| `VERCEL_TOKEN` | <https://vercel.com/account/tokens> → Create Token |
| `VERCEL_ORG_ID` | Run `vercel link` locally, or copy from `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Same file as above |

Then push to `main` (or use **Actions → Deploy to Vercel → Run workflow**).

---

## How the login works (and its limits)

The login is a **client-side gate**. The accounts and the issues live in your
browser's `localStorage`, and passwords are stored only as PBKDF2 hashes. That
is fine for a tracker on your own devices, but read this carefully:

- **The roles are enforced in the browser, not on a server.** A technically
  savvy user *could* open developer tools and give themselves the admin role.
  The admin/user split is a workflow guard, **not** a security boundary. If you
  need real enforcement, you need a backend — see below.
- It only protects the data in *that specific browser*. On a brand new device,
  the app finds no accounts and offers to create a fresh admin — and that person
  sees their own empty, separate tracker, not yours.
- Data does **not** sync between devices or between users. Every browser has its
  own copy, so your admin and your users would each see their own issues.
- Someone with developer tools could read the issue list straight out of the
  browser's storage.

**In short: this is a great personal / single-machine tracker, and the admin vs
user split works well as a shared workflow — but it is not a secure multi-user
system across devices.**

### Moving data between devices

Use **Export** on one device and **Import** on another (admin only). Note that
this moves *issues* only — accounts are not exported.

### If you need real security later

You would need a server that checks the password and the role *before* sending
any data, plus a hosted database (Vercel Postgres, Supabase, etc.) so everyone
sees the same issues. Ask and it can be built on top of this.


---

## Resetting

Forgot the password? On the login screen click **"Forgot password? Reset
everything"**. This wipes the account and all issues in that browser (export a
backup first if you care about the data).

---

## Quick reference

| Task | Action |
| --- | --- |
| Report an issue | Fill the form → **Report issue** |
| Move an issue to Fixing / Done | Admin: use the status dropdown on the issue |
| Edit / delete | **Edit** or **Delete** on your own issues (admin: any issue) |
| Find an issue | Search box, or the All / Pending / Fixing / Done buttons |
| Add a person | Admin → **Users** panel → **Add user** |
| Reset a password | Admin → **Users** panel → **Reset password** |
| Back up | Admin → **Export** (downloads JSON) |
| Restore | Admin → **Import** (choose merge or replace) |
| Remove finished work | Admin → **Clear done** |
| Deploy changes | `.\deploy.ps1` |
