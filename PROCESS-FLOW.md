# Process Flow — PDCE Framework

The Issue Tracker exists to run one loop over and over: **Plan → Do → Check →
Evaluate**. Every button in the app is a step in that loop, and every step writes
to the same `issues` row, so the evidence from one round becomes the input to the
next.

Diagrams are [Mermaid](https://mermaid.js.org/) and render on GitHub. Open
**`process-flow.html`** to see them all on one page, or regenerate it with:

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-flowcharts.ps1 `
  -Sources PROCESS-FLOW.md -Output process-flow.html
```

---

## 0. The framework at a glance

```mermaid
flowchart LR
  P["P · PLAN<br/>report and triage"] --> D["D · DO<br/>fix it"]
  D --> C["C · CHECK<br/>verify the fix"]
  C --> E["E · EVALUATE<br/>close, message, learn"]
  E -->|"not fixed, or it came back"| P
  E -->|"satisfied"| A["Evidence accumulates<br/>(Dashboard · Most repeated)"]
  A --> P
```

| Phase | Question it answers | Owner | Exit condition |
|---|---|---|---|
| **P · Plan** | What is the problem, and how bad is it? | Reporter + Admin | Issue exists, `status = pending`, priority set |
| **D · Do** | Is someone fixing it? | Admin | `status = fixing` |
| **C · Check** | Was the fix actually made? | Admin | `status = done`, `completed_at` set |
| **E · Evaluate** | Is the reporter satisfied, and did we learn? | Admin + Reporter | Message read; stays done or reopens |

---

## 1. The whole loop, end to end

A single diagram with the three actors as lanes: the **reporter**, the **admin**,
and the **database/app** that enforces the rules between them.

```mermaid
flowchart TB
  subgraph Reporter["👤 Reporter"]
    R1["Sign in"]
    R2["Report an issue<br/>title · description · priority"]
    R5["Read the admin's message<br/>(issue card · My Reports · bell)"]
    R6{"Fixed?"}
    R7["Reopen: report or reply again"]
  end

  subgraph Admin["🛠️ Admin"]
    A1["Triage the new issue<br/>(bell + Issues board)"]
    A2["Set the priority"]
    A3["Set status = Fixing"]
    A4["Work on the fix"]
    A5["Set status = Done<br/>(confirm dialog)"]
    A6["Leave a message to the reporter"]
  end

  subgraph System["🗄️ Database + app — the guard rails"]
    S1["insert issues<br/>status = pending, author_id = me"]
    S2["guard_issue_changes()<br/>only an admin may change status"]
    S3["completed_at = now()<br/>updated_at = now()"]
    S4["notify_issue_event()<br/>→ bell + optional push"]
    S5["auto_snapshot()<br/>hourly backup"]
    S6["Dashboard + Most repeated issues<br/>accumulate the evidence"]
  end

  R1 --> R2 --> S1 --> A1 --> A2 --> A3 --> S2
  A3 --> A4 --> A5 --> S2
  S2 --> S3 --> S4
  A6 --> S4
  S4 --> R5 --> R6
  R6 -->|yes| S6
  R6 -->|no| R7 --> A3
  S3 --> S5
  S6 --> A1
```

---

## 2. Phase 1 — PLAN (report and triage)

**Goal:** turn a complaint into a trackable issue with a priority.

```mermaid
flowchart TD
  P0["P · PLAN begins"] --> P1["Reporter signs in (index.html)"]
  P1 --> P2["Opens Issues → Report an issue"]
  P2 --> P3["Fills title, description, priority, label<br/>status is forced to pending"]
  P3 --> P4["insert into issues<br/>author_id = auth.uid()"]
  P4 --> P5{"Who reported it?"}
  P5 -->|"a reporter"| P6["Every admin is notified<br/>bell + optional push"]
  P5 -->|"an admin"| P7["No notification to self"]
  P6 --> P8["Admin reads it on Issues / Dashboard"]
  P7 --> P8
  P8 --> P9["Admin sets the priority<br/>and edits triage fields"]
  P9 --> P10["P · PLAN complete → DO"]
```

- The reporter **cannot choose a status**; the DB policy only accepts
  `status = pending` for a non-admin.
- Priority (`low · medium · high`) is how the admin sizes the work.

---

## 3. Phase 2 — DO (make the fix)

**Goal:** move the issue into work and actually fix it.

```mermaid
flowchart TD
  D0["D · DO begins"] --> D1["Admin sets status = pending → fixing"]
  D1 --> D2{"guard_issue_changes()<br/>is the caller an admin?"}
  D2 -->|no| DX["❌ 'Only admins can change the status'<br/>rejected in the database"]
  D2 -->|yes| D3["updated_at = now()<br/>completed_at = null"]
  D3 --> D4["Admin works on the fix"]
  D4 --> D5["Realtime updates every open tab"]
  D5 --> D6["D · DO complete → CHECK"]
```

> This is the rule that shapes the whole app: RLS decides *which rows* you may
> update, and the `guard_issue_changes()` trigger decides *which columns*. Even a
> hand-crafted API call is refused.

---

## 4. Phase 3 — CHECK (verify it is really done)

**Goal:** confirm the fix before closing, and record when it was closed.

```mermaid
flowchart TD
  C0["C · CHECK begins"] --> C1["Admin picks status = Done"]
  C1 --> C2["Confirm dialog:<br/>'Mark issue #…as done?'"]
  C2 -->|cancel| C1
  C2 -->|confirm| C3{"guard_issue_changes()<br/>is the caller an admin?"}
  C3 -->|no| CX["❌ rejected in the database"]
  C3 -->|yes| C4["completed_at = now()<br/>updated_at = now()"]
  C4 --> C5["notify_issue_event()<br/>→ reporter's bell / push"]
  C5 --> C6["auto_snapshot()<br/>maybe a backup"]
  C6 --> C7["C · CHECK complete → EVALUATE"]
```

- The confirm dialog lives on the Issues board (and the legacy `admin-*` pages)
  and cannot be bypassed by the reporter.
- `completed_at` is set **server-side**; the browser never sends it.

---

## 5. Phase 4 — EVALUATE (close the loop)

**Goal:** tell the reporter, confirm they are happy, and feed the evidence back.

```mermaid
flowchart TD
  E0["E · EVALUATE begins"] --> E1["Admin leaves a<br/>Message to the reporter"]
  E1 --> E2["admin_note + admin_note_at saved"]
  E2 --> E3["Reporter sees it on the issue card,<br/>on My Reports, and in the bell"]
  E3 --> E4{"Reporter satisfied?"}
  E4 -->|yes| E5["Stays Done"]
  E4 -->|no| E6["Reopen → status Fixing / Pending"]
  E6 --> E7["Back to DO"]
  E5 --> E8["Dashboard + Most repeated issues<br/>accumulate the evidence"]
  E8 --> E9["E · EVALUATE feeds the next PLAN"]
```

- A **repeated title** (`Login fails!` = `login-fails`) is the signal that the
  loop did not really close, and pushes the team back to PLAN.

---

## 6. The decision tree in one view

```mermaid
flowchart TD
  Start(["Issue reported"]) --> Reported["status = pending"]
  Reported --> Triage["Admin triages:<br/>priority + label"]
  Triage --> Fixing["status = fixing"]
  Fixing --> Verify{"Fix verified?"}
  Verify -->|no| Fixing
  Verify -->|yes| Done["status = done<br/>completed_at set"]
  Done --> Msg["Admin message + notification"]
  Msg --> Sat{"Reporter satisfied?"}
  Sat -->|yes| Archive["Closed — evidence on the Dashboard"]
  Sat -->|no| Fixing
  Archive --> Learn["Repeated-issue check<br/>→ improved plan"]
  Learn --> Reported
```

---

## 7. Where each phase lives

| Phase | Who | In the app | In the database |
|---|---|---|---|
| **P · Plan** | Reporter | `pages/issues.html` → report form | `insert into issues`, `status = 'pending'` |
| **D · Do** | Admin | Status dropdown → **Fixing** | `update status` — RLS + `guard_issue_changes()` allow admins only |
| **C · Check** | Admin | Confirm dialog before **Done** | `guard_issue_changes()` sets `completed_at` |
| **E · Evaluate** | Admin + Reporter | **Message to the reporter**; **My Reports**; notification bell | `admin_note`; `notify_issue_event()` tells the reporter |

---

## 8. The same PDCE cycle for the maintainer

The framework is not only for issues — it is how the codebase is maintained.

```mermaid
flowchart LR
  P["PLAN<br/>pick the next change"] --> D["DO<br/>edit files · git commit (develop)"]
  D --> GP["git push → GitHub<br/>(post-commit hook or deploy.ps1)"]
  GP --> C["CHECK<br/>Vercel preview deployment<br/>test the build"]
  C --> PR["Pull request<br/>develop → main"]
  PR --> M["Merge on GitHub"]
  M --> E["EVALUATE<br/>Vercel production deploy<br/>the live URL updates"]
  E --> P
```

---

## 9. Where GitHub is used in the system

**GitHub is not in the runtime path.** The live app never calls GitHub: the
browser loads files from **Vercel** and talks only to **Supabase** for auth and
data. GitHub matters at **delivery time** — it is the source of truth, the review
point, and the trigger that makes Vercel build and deploy.

```mermaid
flowchart TB
  subgraph Delivery["🛠️ Delivery time — GitHub lives here"]
    Dev["Developer"] --> WS["Working tree"]
    WS -->|"git commit"| Local["Local repo (.git)"]
    Local -->|"post-commit hook / deploy.ps1"| GH["🐙 GitHub<br/>source of truth"]
    GH -->|"push to main"| Build["▲ Vercel build"]
  end

  subgraph Runtime["▶ Runtime — no GitHub involved"]
    Browser["Browser / installed PWA"] -->|"GET HTML · CSS · JS"| Host["▲ Vercel static hosting"]
    Browser -->|"JWT + data + realtime"| Supabase["🐘 Supabase<br/>Auth · Postgres · RLS"]
  end

  Build -->|"deploys"| Host
```

### 9.1 The jobs GitHub does

```mermaid
flowchart LR
  G["🐙 GitHub"] --> T1["1 · Source control<br/>history of every change"]
  G --> T2["2 · Branch model<br/>develop = work · main = stable"]
  G --> T3["3 · Pull requests<br/>develop → main review"]
  G --> T4["4 · Deploy trigger<br/>Vercel watches the repo"]
  G --> T5["5 · Off-machine backup<br/>the code survives the PC"]
  G --> T6["6 · Documentation<br/>*.md + Mermaid render on GitHub"]
  G --> T7["7 · Collaboration<br/>remotes: origin · myfork · friend"]
```

### 9.2 How a change reaches production

```mermaid
flowchart LR
  C["git commit on develop"] --> H["post-commit hook<br/>auto-pushes (never main/master)"]
  H --> GD["GitHub: develop"]
  GD --> PV["Vercel: preview deployment<br/>test before shipping"]
  GD --> PR["Pull request: develop → main"]
  PR --> MG["Merge on GitHub"]
  MG --> GM["GitHub: main"]
  GM --> PD["Vercel: production deployment"]
  PD --> Live["https://issue-tracker-alpha-drab.vercel.app"]
```

### 9.3 What each piece is for

| Touchpoint | How it is used in this project |
|---|---|
| **Source control** | Every change is a commit with history; `git log` is the audit trail of the code |
| **Branches** | Work on **`develop`**; **`main`** is the stable, deployed branch |
| **Pull requests** | `develop → main` is the review/merge gate before production |
| **Deploy trigger** | Vercel's Git integration builds on push — `main` → production, other branches → previews |
| **Auto-push** | `.git/hooks/post-commit` pushes the current branch after a commit (skips `main`/`master` on purpose); `deploy.ps1` commits + pushes in one command |
| **VS Code sync** | `.vscode/settings.json` autofetches every 60s and syncs (pull + push) after a commit |
| **Backup** | GitHub is a second, off-machine copy of the code (the data lives in Supabase, not GitHub) |
| **Docs** | `README.md`, `ARCHITECTURE.md`, `HANDOVER.md`, `PROCESS-FLOW.md` and their Mermaid diagrams render on GitHub |
| **Remotes** | `origin` = your repo, `myfork` = a fork, `friend` = someone else's — the hook refuses to auto-push a branch tracking a non-origin remote |

### 9.4 Where GitHub is not used

```mermaid
flowchart LR
  U["👤 User"] --> B["Browser"]
  B -->|"files"| V["▲ Vercel"]
  B -->|"login · data · realtime · push"| S["🐘 Supabase"]
  B -.->|"❌ never"| G["🐙 GitHub"]
```

- **Authentication** — Supabase Auth, not GitHub login.
- **Data / database** — Supabase Postgres only.
- **API** — PostgREST + RPC, not GitHub.
- **Runtime secrets** — the `anon` key lives in `supabase-config.js`; GitHub is not queried at runtime.

> The `service_role` key must never be committed to GitHub. Only the public
> `anon` key belongs in the repo.

---

## 10. Golden rules of the loop

1. **One row per problem.** Every phase writes to the same `issues` row.
2. **Only an admin moves the status.** Enforced by the database, not the UI.
3. **Nothing is destroyed.** Deleting is a soft delete into the Archive.
4. **Every close is announced.** `notify_issue_event()` tells the reporter.
5. **Every loop leaves evidence.** The Dashboard and *Most repeated issues* feed
   the next PLAN.
