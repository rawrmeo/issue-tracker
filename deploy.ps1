<#
.SYNOPSIS
  Commit everything and push to GitHub. Vercel then auto-deploys.

.EXAMPLE
  .\deploy.ps1
  .\deploy.ps1 -Message "add priority filter"

.NOTES
  First-time setup (run once):
    git init
    git branch -M main
    git remote add origin https://github.com/<you>/<repo>.git
    git add -A
    git commit -m "Initial commit"
    git push -u origin main

  After that, just run: .\deploy.ps1
  Make sure you are signed in to GitHub (git uses Git Credential Manager by default).
#>

[CmdletBinding()]
param(
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
  Write-Host "ERROR: $msg" -ForegroundColor Red
  exit 1
}

# --- Sanity checks -----------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "git is not installed or not on PATH."
}

if (-not (Test-Path ".git")) {
  Fail "This folder is not a git repository yet. Run 'git init' first (see README)."
}

$remote = (git remote 2>$null)
if (-not $remote) {
  Fail "No git remote configured. Add one with: git remote add origin https://github.com/<you>/<repo>.git"
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Branch: $branch" -ForegroundColor Cyan
Write-Host "Remote: $((git remote get-url origin).Trim())" -ForegroundColor Cyan

# --- Make sure git knows who you are -----------------------------------------
# Without this, `git commit` fails with "Please tell me who you are".
if (-not (git config user.name)) {
  git config user.name "Issue Tracker"
  Write-Host "Set a default git user.name (change it with: git config user.name \"Your Name\")" -ForegroundColor Yellow
}
if (-not (git config user.email)) {
  git config user.email "issue-tracker@users.noreply.github.com"
  Write-Host "Set a default git user.email (change it with: git config user.email \"you@example.com\")" -ForegroundColor Yellow
}

# --- Commit ------------------------------------------------------------------
git add -A

$staged = (git diff --cached --name-only)
if ($staged) {
  if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = "update: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  }
  Write-Host "Committing changes..." -ForegroundColor Cyan
  git commit -m $Message
} else {
  Write-Host "Nothing new to commit." -ForegroundColor Yellow
}

# --- Push --------------------------------------------------------------------
Write-Host "Pushing to origin/$branch ..." -ForegroundColor Cyan
git push origin $branch

if ($LASTEXITCODE -ne 0) {
  Fail "Push failed. Check your GitHub credentials and try again."
}

Write-Host ""
Write-Host "Pushed. Vercel will build and deploy automatically." -ForegroundColor Green
Write-Host "Check progress: https://vercel.com/dashboard" -ForegroundColor Green
