# ============================================================================
#  tools/deploy-api.ps1
# ----------------------------------------------------------------------------
#  Deploy the public REST API to Supabase, using the Management API so you do
#  NOT need the Supabase CLI or the database password - only a personal
#  access token.
#
#  Get a token: https://supabase.com/dashboard/account/tokens  (starts sbp_)
#
#  It does two things:
#    1. runs sql/api.sql against the project database
#    2. deploys (or updates) the `api` Edge Function with JWT verification OFF
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File tools/deploy-api.ps1 `
#      -ProjectRef rjzssjjlcaxbdwqezdie -AccessToken sbp_xxx
#
#    # only redeploy the function, skip the SQL:
#    ... -SkipSql
#
#  Revoke the token when you are done.
# ============================================================================

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $ProjectRef,
  [string] $AccessToken = $env:SUPABASE_ACCESS_TOKEN,
  [string] $TokenFile,
  [string] $FunctionDir = 'supabase/functions/api',
  [string] $SqlFile     = 'sql/api.sql',
  [switch] $SkipSql
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# The token can come from -AccessToken, a file (-TokenFile), or the
# SUPABASE_ACCESS_TOKEN environment variable.
if (-not $AccessToken -and $TokenFile) {
  if (Test-Path -LiteralPath $TokenFile) {
    $AccessToken = ([System.IO.File]::ReadAllText($TokenFile)).Trim()
  } else {
    Write-Host ('Token file not found: ' + $TokenFile) -ForegroundColor Red
    exit 1
  }
}
if (-not $AccessToken) {
  Write-Host 'No access token. Pass -AccessToken sbp_..., or -TokenFile <path>, or set SUPABASE_ACCESS_TOKEN.' -ForegroundColor Red
  Write-Host 'Create one at https://supabase.com/dashboard/account/tokens' -ForegroundColor Yellow
  exit 1
}
if ($AccessToken -match '[^A-Za-z0-9_]') {
  Write-Host 'That token contains unexpected characters (is it masked/pasted with bullets?). Copy the full sbp_ value.' -ForegroundColor Red
  exit 1
}

function Mgmt([string] $Method, [string] $Url, [object] $Body) {
  $headers = @{ Authorization = ('Bearer ' + $AccessToken); Accept = 'application/json' }
  $params = @{ Method = $Method; Uri = $Url; Headers = $headers; UseBasicParsing = $true }
  if ($null -ne $Body) {
    $params['ContentType'] = 'application/json'
    $params['Body'] = ($Body | ConvertTo-Json -Depth 12 -Compress)
  }
  try {
    $r = Invoke-WebRequest @params
    return [pscustomobject]@{ Status = [int]$r.StatusCode; Content = $r.Content }
  } catch {
    $status = 0; $text = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $text = $_.ErrorDetails.Message }
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      if (-not $text) {
        $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $text = $sr.ReadToEnd()
      }
    }
    return [pscustomobject]@{ Status = $status; Content = $text }
  }
}

$root = Split-Path -Parent $PSScriptRoot
$api = 'https://api.supabase.com/v1/projects/' + $ProjectRef

Write-Host ''
Write-Host ('Deploying Issue Tracker API to project ' + $ProjectRef) -ForegroundColor Cyan
Write-Host ''

# --- 0. token sanity ---------------------------------------------------------
$who = Mgmt 'GET' 'https://api.supabase.com/v1/projects' $null
if ($who.Status -ne 200) {
  Write-Host ('Token check failed (HTTP ' + $who.Status + '): ' + $who.Content) -ForegroundColor Red
  Write-Host 'Check the token at https://supabase.com/dashboard/account/tokens' -ForegroundColor Yellow
  exit 1
}
Write-Host 'Token OK.' -ForegroundColor Green

# --- 1. SQL ------------------------------------------------------------------
if (-not $SkipSql) {
  $sqlPath = Join-Path $root $SqlFile
  if (-not (Test-Path -LiteralPath $sqlPath)) { Write-Host ('Missing ' + $sqlPath) -ForegroundColor Red; exit 1 }
  $sql = [System.IO.File]::ReadAllText($sqlPath, [System.Text.Encoding]::UTF8)

  Write-Host ('Applying ' + $SqlFile + ' ...') -ForegroundColor Cyan
  $res = Mgmt 'POST' ($api + '/database/query') @{ query = $sql }
  if ($res.Status -ge 200 -and $res.Status -lt 300) {
    Write-Host '  SQL applied.' -ForegroundColor Green
  } else {
    Write-Host ('  SQL failed (HTTP ' + $res.Status + '):') -ForegroundColor Red
    Write-Host $res.Content
    exit 1
  }
} else {
  Write-Host 'SQL step skipped (-SkipSql).' -ForegroundColor DarkGray
}

# --- 2. Function -------------------------------------------------------------
$entry = Join-Path $root ($FunctionDir + '/index.ts')
if (-not (Test-Path -LiteralPath $entry)) { Write-Host ('Missing ' + $entry) -ForegroundColor Red; exit 1 }
$code = [System.IO.File]::ReadAllText($entry, [System.Text.Encoding]::UTF8)

Write-Host 'Deploying the api Edge Function (JWT verification OFF) ...' -ForegroundColor Cyan

$payload = @{ slug = 'api'; name = 'api'; verify_jwt = $false; body = $code }
$created = Mgmt 'POST' ($api + '/functions') $payload

if ($created.Status -ge 200 -and $created.Status -lt 300) {
  Write-Host '  Function created.' -ForegroundColor Green
} elseif ($created.Status -eq 409 -or $created.Content -match 'already exists|duplicate') {
  Write-Host '  Function exists - updating it ...' -ForegroundColor Yellow
  $updated = Mgmt 'PATCH' ($api + '/functions/api') @{ verify_jwt = $false; body = $code }
  if ($updated.Status -ge 200 -and $updated.Status -lt 300) {
    Write-Host '  Function updated.' -ForegroundColor Green
  } else {
    Write-Host ('  Update failed (HTTP ' + $updated.Status + '):') -ForegroundColor Red
    Write-Host $updated.Content
    exit 1
  }
} else {
  Write-Host ('  Deploy failed (HTTP ' + $created.Status + '):') -ForegroundColor Red
  Write-Host $created.Content
  exit 1
}

# --- done --------------------------------------------------------------------
$base = 'https://' + $ProjectRef + '.supabase.co/functions/v1/api'
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host ('Base URL: ' + $base)
Write-Host 'Health:   ' + ($base + '/health')
Write-Host ''
Write-Host 'Next: create a key (app -> API keys, or the SQL bootstrap in API.md section 2),'
Write-Host 'then run:  powershell -ExecutionPolicy Bypass -File tools/test-api.ps1 -BaseUrl ' + $base + ' -ApiKey itk_...'
