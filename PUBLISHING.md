# Publish the Issue Tracker (free hosting)

Two things are going on here:

1. **Upload** — put your code on GitHub (a remote copy of the project).
2. **Publish** — point a free host at it, which serves your `index.html` at a
   public URL anyone can visit.

This project is perfect for it: one static HTML file, no server, no database, no
build step. Both **GitHub Pages** and **Vercel** host it for free.

There are three routes:

- **Route A** — GitHub Pages, with no software installed at all.
- **Route B** — GitHub Pages, via the terminal.
- **Route C** — Vercel, which imports the same GitHub repo and redeploys on every
  push.

Start with one route. You can add Vercel on top of GitHub Pages later for a
second URL or faster deploys — the two do not conflict.

---

## Route A — No installation (easiest, do this first)

### Step 1. Create a GitHub account

Skip if you already have one: <https://github.com/signup>

### Step 2. Create a new repository

1. Go to <https://github.com/new>
2. **Repository name:** `mini-issue-tracker` (letters, numbers and dashes only)
3. **Description:** optional, e.g. `A tiny issue tracker in one HTML file`
4. **Public** — leave this selected. (Free GitHub Pages requires a public repo;
   private repos need a paid plan.)
5. **Do NOT** tick "Add a README file", "Add .gitignore", or "Choose a license".
   Leaving the repo empty avoids merge conflicts later.
6. Click **Create repository**.

### Step 3. Upload your files

1. On the new repo page, click **uploading an existing file** (or
   **Add file → Upload files**).
2. Open your project folder in File Explorer:
   `C:\Users\HP\OneDrive\Documents\Default Project`
3. Drag these into the upload area:
   - **`index.html`** — the app (the only file it actually needs)
   - `README.md`, `PUBLISHING.md`, `.nojekyll` — optional, but they make the repo
     page nicer and keep Pages from processing files
   - the `steps/` folder, if you want the tutorial stages online too
4. In **Commit changes**, type a message like `Add mini issue tracker` and click
   **Commit changes**.

> `.nojekyll` starts with a dot and Windows may hide it. If you don't see it,
> enable **View → Show → Hidden items** in File Explorer.

### Step 4. Turn on GitHub Pages (this is the "publish" part)

1. In the repo, click **Settings**.
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Under **Branch**, select **`main`** and keep the folder as **`/ (root)`**.
5. Click **Save**.

Because the file is named exactly `index.html` and sits in the root, GitHub
serves it automatically — no configuration needed.

### Step 5. Get your live URL

- Wait **1–3 minutes** the first time. Refresh the Pages settings screen; when
  it's ready it shows a green banner with your link.
- Your app lives at:

  ```
  https://YOUR-USERNAME.github.io/mini-issue-tracker/
  ```

- You can watch progress under the **Actions** tab. A yellow dot = building, a
  green tick = live. (The first run sometimes fails with *"Pages is disabled"* if
  you visit too early — re-running it succeeds.)

**Done.** Share that URL and anyone can use your issue tracker.

### Step 6. Updating the site later

Any change to `index.html` on the `main` branch republishes automatically,
usually within a minute:

1. In the repo click **index.html** → the **pencil** icon to edit, or
   **Add file → Upload files** to replace it.
2. Commit the change.
3. Wait ~1 minute, then hard-refresh the live URL (`Ctrl` + `F5`).

---

## Route B — Terminal (better once you're changing code often)

Install **Git for Windows** from <https://git-scm.com/download/win>. This also
installs **Git Credential Manager**, so the first push opens a browser window to
sign in — you never type a password.

> Prefer buttons? **GitHub Desktop** (<https://desktop.github.com>) does the same
> job and maps 1:1 to the commands below.

### Step 1. Tell Git who you are (once per machine)

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Use the **same email** as your GitHub account.

### Step 2. Turn the folder into a Git repository

```powershell
cd "C:\Users\HP\OneDrive\Documents\Default Project"
git init -b main
git add .
git commit -m "Add mini issue tracker"
```

`git status` shows what will be committed before you commit it.

### Step 3. Create the empty repo on GitHub

Do **Step 2 from Route A** (<https://github.com/new>, name `mini-issue-tracker`,
Public, no README). Copy the URL it shows, e.g.
`https://github.com/YOUR-USERNAME/mini-issue-tracker.git`.

### Step 4. Connect your folder to it and push

```powershell
git remote add origin https://github.com/YOUR-USERNAME/mini-issue-tracker.git
git push -u origin main
```

A browser window asks you to authorise Git — sign in and approve. Refresh your
repo page and the files are there.

Then do **Steps 4–5 from Route A** to publish with Pages.

### Step 5. Pushing your future changes

After editing files, the whole cycle is three commands:

```powershell
git add .
git commit -m "Describe what you changed"
git push
```

`git push` with no extra arguments works because of the `-u` you used the first
time.

---

## Route C — Vercel (imports your GitHub repo)

Vercel is another free host. It connects directly to the GitHub repo you made in
Route A or B, so every `git push` deploys automatically — and every branch or
pull request gets its own preview URL, which is handy once you edit
`index.html` often.

This project already includes a **`vercel.json`** that tells Vercel it is a plain
static site — no build command, no framework — so there is nothing to configure
by hand.

### Step 1. Sign in to Vercel with GitHub

1. Go to <https://vercel.com/signup>.
2. Choose **Continue with GitHub** and authorise it. Using the same account that
   owns the repo makes step 2 a one-click pick.

### Step 2. Import the repository

1. On the Vercel dashboard click **Add New… → Project**.
2. Find `mini-issue-tracker` in the list and click **Import**.
   - If it is missing, click **Adjust GitHub App Permissions** and grant access
     to the repo.
3. On the configuration screen leave the defaults:
   - **Framework Preset:** `Other`
   - **Build Command:** *(empty)*
   - **Output Directory:** *(empty / `.`)*
   - **Install Command:** *(empty)*
4. Click **Deploy**.

### Step 3. Get your live URL

- The first deploy takes under a minute. When it finishes you get:

  ```
  https://mini-issue-tracker.vercel.app
  ```

  (Vercel appends a suffix if that name is taken, e.g.
  `mini-issue-tracker-abc123.vercel.app` — use whatever the dashboard shows.)
- You can rename it later under **Project → Settings → Domains**.

### Step 4. Updating the site later

Nothing extra to do: push to GitHub and Vercel redeploys in about a minute.

```powershell
git add .
git commit -m "What I changed"
git push
```

Prefer the terminal over the dashboard? The CLI needs [Node.js](https://nodejs.org)
installed first, then:

```powershell
npm install -g vercel
vercel          # first run links the folder; follow the prompts
vercel --prod   # publish to your production URL
```

> **No GitHub at all?** In the Vercel dashboard, **Add New… → Project → Deploy
> without Git** lets you drag the folder in. You still get a live URL, but not
> automatic redeploys on push.

---

## After publishing: point Supabase at the new URL

If you use Cloud mode, Supabase only allows reset/confirm links back to URLs you
have whitelisted. Add **every** address you published to:

1. Supabase Dashboard → **Authentication → URL Configuration**.
2. **Site URL:** your main address — either
   `https://YOUR-USERNAME.github.io/mini-issue-tracker/` or
   `https://mini-issue-tracker.vercel.app/`.
3. Under **Redirect URLs**, add each one you use:
   - GitHub Pages: `https://YOUR-USERNAME.github.io/mini-issue-tracker/`
   - Vercel: `https://mini-issue-tracker.vercel.app/`
   - Local testing: `http://localhost:8000/`
4. Save. "Forgot password?" links now return to whichever site the user is on.

---

## A few important things to know

**Your data is per-visitor, not shared.** In demo mode the tracker saves issues
in each browser's `localStorage`. So your friend opening the same URL sees *their
own, empty* list. For a **shared** list, switch on Supabase (Cloud mode) — see
[`supabase/README.md`](supabase/README.md).

**Don't commit secrets.** Never put a `service_role` key, database password or
personal access token in a public repo. (The Supabase **anon/publishable** key is
fine — it's public by design.) Once pushed, treat a value as public even if you
delete it later.

**Your folder is inside OneDrive.** That usually works, but OneDrive syncing can
occasionally lock the hidden `.git` folder and cause odd errors. If you hit
strange Git failures, move the project somewhere local like `C:\Projects\`.

**Page not updating?** Browsers cache hard. Use `Ctrl` + `F5`, or open the URL in
a private window. Also give the host a minute after each commit — GitHub Pages
and Vercel both take roughly that long to redeploy.

**Prefer a custom domain?** On GitHub Pages use **Settings → Pages → Custom
domain**. On Vercel use **Project → Settings → Domains**. Either way you add the
DNS records the host shows. Not needed to get started.

---

## Quick reference

| Task | Where |
| --- | --- |
| Create a repo | <https://github.com/new> |
| Install Git (Windows) | <https://git-scm.com/download/win> |
| GitHub Desktop (no terminal) | <https://desktop.github.com> |
| GitHub Pages settings | Repo → **Settings → Pages** |
| GitHub Pages build status | Repo → **Actions** tab |
| GitHub Pages live URL | `https://YOUR-USERNAME.github.io/REPO-NAME/` |
| Create a Vercel account | <https://vercel.com/signup> |
| Import repo to Vercel | Vercel → **Add New… → Project** |
| Vercel live URL | `https://REPO-NAME.vercel.app` |
| Vercel CLI | `npm install -g vercel`, then `vercel --prod` |

**The three commands you'll use forever:**

```powershell
git add .
git commit -m "What I changed"
git push
```
