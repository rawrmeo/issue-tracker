# Issue Tracker

A small issue tracker with a login screen, pending/done tracking, and one-command
deploy to GitHub + Vercel.

No build step, no dependencies, no database account needed. It is plain
HTML/CSS/JavaScript and runs straight in the browser.

---

## Features

- **Login surface** — first visit creates an admin account; after that a sign-in
  screen guards the tracker. Passwords are hashed with PBKDF2-SHA256 + a random
  salt (Web Crypto).
- **Add issues manually** — title (required), description, priority, status, and
  a free-form label.
- **Pending / Done** — mark any issue done or back to pending with one click, or
  set the status while creating/editing it.
- **Edit and delete** — full control over every issue.
- **Filter and search** — by status, priority, and free text; sort by newest,
  oldest, priority, or title.
- **Stats bar** — totals for all / pending / done / high-priority open issues.
- **Export & Import** — download a JSON backup and restore or merge it later.
- **Light / dark theme** — remembers your choice.
- **Auto-deploy** — push to GitHub and Vercel rebuilds and deploys the site.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure (login + app views) |
| `styles.css` | Styling and theme |
| `app.js` | Auth, issue logic, storage, import/export |
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

The login is a **client-side gate**. The account and the issues live in your
browser's `localStorage`, and the password is stored only as a PBKDF2 hash. This
is perfectly fine for a personal tracker on your own devices, but be aware:

- It only protects the data in *that specific browser*. Anyone who opens the
  deployed URL on a new device will be asked to **create a fresh account**, and
  they will only ever see their own issues — not yours.
- It is **not** a shared multi-user login. The data does not sync between
  devices.
- Someone with developer tools could still read the issue list straight out of
  the browser's storage.

### Moving data between devices

Use **Export** on one device and **Import** on another.

### If you need real security later

You would need a server that checks the password before sending any data. That
requires a backend plus a hosted database (Vercel Postgres, Supabase, etc.), and
roughly doubles the size of the project. Ask and it can be built on top of this.

---

## Resetting

Forgot the password? On the login screen click **"Forgot password? Reset
everything"**. This wipes the account and all issues in that browser (export a
backup first if you care about the data).

---

## Quick reference

| Task | Action |
| --- | --- |
| Add issue | Fill the form → **Add issue** |
| Mark done / pending | Click the checkbox on the left of an issue, or use **Edit** |
| Find an issue | Search box, or the All / Pending / Done buttons |
| Back up | **Export** (downloads JSON) |
| Restore | **Import** (choose merge or replace) |
| Remove finished work | **Clear done** |
| Deploy changes | `.\deploy.ps1` |
