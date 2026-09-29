# ============================================================================
#  tools/test-api.ps1
# ----------------------------------------------------------------------------
#  Smoke test for the public REST API (supabase/functions/api).
#
#  By default it is READ-ONLY. Add -Write to also create/update/delete a test
#  issue, and -UserKey to check that a `user` key is refused admin actions.
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File tools/test-api.ps1 `
#      -BaseUrl https://<ref>.supabase.co/functions/v1/api `
#      -ApiKey  itk_<your admin key>
#
#    # with a user key and the write tests:
#    powershell -ExecutionPolicy Bypass -File tools/test-api.ps1 `
#      -BaseUrl https://<ref>.supabase.co/functions/v1/api `
#      -ApiKey  itk_<admin> -UserKey itk_<user> -Write
#
#  Exit code 0 = all passed, 1 = at least one failed.
# ============================================================================

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $BaseUrl,
  [Parameter(Mandatory = $true)][string] $ApiKey,
  [string] $UserKey = '',
  [switch] $Write
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BaseUrl = $BaseUrl.TrimEnd('/')
$script:pass = 0
$script:fail = 0

function Check([string] $name, [bool] $condition, [string] $detail = '') {
  if ($condition) {
    Write-Host ("  PASS  " + $name) -ForegroundColor Green
    $script:pass++
  } else {
    Write-Host ("  FAIL  " + $name + $(if ($detail) { "  -> $detail" } else { "" })) -ForegroundColor Red
    $script:fail++
  }
}

function Invoke-Api {
  param(
    [string] $Method = 'GET',
    [string] $Path,
    [string] $Key,
    [object] $Body,
    [switch] $NoKey
  )
  $headers = @{}
  if (-not $NoKey -and $Key) { $headers['x-api-key'] = $Key }

  $params = @{ Method = $Method; Uri = ($BaseUrl + $Path); Headers = $headers; UseBasicParsing = $true }
  if ($PSBoundParameters.ContainsKey('Body') -and $null -ne $Body) {
    $params['ContentType'] = 'application/json'
    $params['Body'] = ($Body | ConvertTo-Json -Depth 8)
  }

  try {
    $r = Invoke-WebRequest @params
    $json = $null; try { $json = $r.Content | ConvertFrom-Json } catch { }
    return [pscustomobject]@{ Status = [int]$r.StatusCode; Json = $json; Raw = $r.Content }
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
    $json = $null; try { $json = $text | ConvertFrom-Json } catch { }
    return [pscustomobject]@{ Status = $status; Json = $json; Raw = $text }
  }
}

$randomId = [guid]::NewGuid().ToString()

Write-Host ""
Write-Host "Issue Tracker API smoke test" -ForegroundColor Cyan
Write-Host ("Base: " + $BaseUrl)
Write-Host ""

# --- 1. health (no key) ------------------------------------------------------
Write-Host "Health" -ForegroundColor Yellow
$h = Invoke-Api -Method GET -Path '/health' -NoKey
Check 'GET /health returns 200'            ($h.Status -eq 200) ("status=" + $h.Status)
Check 'GET /health body status = ok'       ($h.Json -and $h.Json.status -eq 'ok')

# --- 2. authentication -------------------------------------------------------
Write-Host "Authentication" -ForegroundColor Yellow
$noKey = Invoke-Api -Method GET -Path '/v1/me' -NoKey
Check 'no key  -> 401'                     ($noKey.Status -eq 401) ("status=" + $noKey.Status)

$bad = Invoke-Api -Method GET -Path '/v1/me' -Key 'itk_000000000000000000000000000000000000000000000000'
Check 'bad key -> 401'                     ($bad.Status -eq 401) ("status=" + $bad.Status)

$me = Invoke-Api -Method GET -Path '/v1/me' -Key $ApiKey
Check 'admin key -> 200'                   ($me.Status -eq 200) ("status=" + $me.Status)
Check 'admin key api_role = admin'         ($me.Json -and $me.Json.data.api_role -eq 'admin')

# --- 3. read endpoints -------------------------------------------------------
Write-Host "Read endpoints" -ForegroundColor Yellow
$list = Invoke-Api -Method GET -Path '/v1/issues?limit=2' -Key $ApiKey
Check 'GET /v1/issues -> 200'              ($list.Status -eq 200) ("status=" + $list.Status)
Check 'list has data[] and meta'           ($list.Json -and ($null -ne $list.Json.data) -and ($null -ne $list.Json.meta))

$one = Invoke-Api -Method GET -Path ('/v1/issues/' + $randomId) -Key $ApiKey
Check 'unknown issue -> 404'               ($one.Status -eq 404) ("status=" + $one.Status)

$badId = Invoke-Api -Method GET -Path '/v1/issues/not-a-uuid' -Key $ApiKey
Check 'bad uuid -> 400'                    ($badId.Status -eq 400) ("status=" + $badId.Status)

$stats = Invoke-Api -Method GET -Path '/v1/stats' -Key $ApiKey
Check 'GET /v1/stats -> 200'               ($stats.Status -eq 200) ("status=" + $stats.Status)
Check 'stats scope = all (admin)'          ($stats.Json -and $stats.Json.data.scope -eq 'all')

$users = Invoke-Api -Method GET -Path '/v1/users' -Key $ApiKey
Check 'GET /v1/users (admin) -> 200'       ($users.Status -eq 200) ("status=" + $users.Status)

$keys = Invoke-Api -Method GET -Path '/v1/keys' -Key $ApiKey
Check 'GET /v1/keys (admin) -> 200'        ($keys.Status -eq 200) ("status=" + $keys.Status)

$notif = Invoke-Api -Method GET -Path '/v1/notifications' -Key $ApiKey
Check 'GET /v1/notifications -> 200'       ($notif.Status -eq 200) ("status=" + $notif.Status)

$missing = Invoke-Api -Method GET -Path '/v1/does-not-exist' -Key $ApiKey
Check 'unknown route -> 404'               ($missing.Status -eq 404) ("status=" + $missing.Status)

# --- 4. write flow (opt-in) --------------------------------------------------
$createdId = $null
if ($Write) {
  Write-Host "Write flow (-Write)" -ForegroundColor Yellow

  $create = Invoke-Api -Method POST -Path '/v1/issues' -Key $ApiKey -Body @{
    title       = '[API smoke test] ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    description = 'Created by tools/test-api.ps1'
    priority    = 'low'
    label       = 'api-test'
  }
  Check 'POST /v1/issues -> 201'           ($create.Status -eq 201) ("status=" + $create.Status)
  if ($create.Json) { $createdId = $create.Json.data.id }
  Check 'created issue is pending'         ($create.Json -and $create.Json.data.status -eq 'pending')

  if ($createdId) {
    $badStatus = Invoke-Api -Method PATCH -Path ('/v1/issues/' + $createdId) -Key $ApiKey -Body @{ status = 'teleported' }
    Check 'invalid status -> 422'          ($badStatus.Status -eq 422) ("status=" + $badStatus.Status)

    $done = Invoke-Api -Method PATCH -Path ('/v1/issues/' + $createdId) -Key $ApiKey -Body @{ status = 'done'; admin_note = 'smoke test' }
    Check 'PATCH status=done -> 200'       ($done.Status -eq 200) ("status=" + $done.Status)
    Check 'completed_at is set'            ($done.Json -and $done.Json.data.completed_at)
    Check 'admin_note saved'               ($done.Json -and $done.Json.data.admin_note -eq 'smoke test')

    $del = Invoke-Api -Method DELETE -Path ('/v1/issues/' + $createdId) -Key $ApiKey
    Check 'DELETE (soft) -> 200'           ($del.Status -eq 200) ("status=" + $del.Status)

    $arch = Invoke-Api -Method GET -Path '/v1/archive' -Key $ApiKey
    $inArchive = $false
    if ($arch.Json -and $arch.Json.data) {
      $inArchive = @($arch.Json.data | Where-Object { $_.id -eq $createdId }).Count -gt 0
    }
    Check 'soft-deleted issue is in archive' $inArchive

    $restore = Invoke-Api -Method POST -Path ('/v1/archive/' + $createdId + '/restore') -Key $ApiKey
    Check 'restore -> 200'                 ($restore.Status -eq 200) ("status=" + $restore.Status)
    if ($restore.Status -eq 200) {
      Write-Host ("  note  restored test issue " + $createdId + " (delete it from the app if you like)") -ForegroundColor DarkGray
    }
  }
} else {
  Write-Host "Write flow skipped (add -Write to test create/update/delete)" -ForegroundColor DarkGray
}

# --- 5. user key must NOT be admin -------------------------------------------
if ($UserKey) {
  Write-Host "User key restrictions (-UserKey)" -ForegroundColor Yellow

  $ume = Invoke-Api -Method GET -Path '/v1/me' -Key $UserKey
  Check 'user key -> 200'                  ($ume.Status -eq 200) ("status=" + $ume.Status)
  Check 'user key api_role = user'         ($ume.Json -and $ume.Json.data.api_role -eq 'user')

  $ustats = Invoke-Api -Method GET -Path '/v1/stats' -Key $UserKey
  Check 'user stats scope = mine'          ($ustats.Json -and $ustats.Json.data.scope -eq 'mine')

  $uusers = Invoke-Api -Method GET -Path '/v1/users' -Key $UserKey
  Check 'user -> /v1/users 403'            ($uusers.Status -eq 403) ("status=" + $uusers.Status)

  # A user key cannot change a status. Use any existing issue when possible.
  $targetId = $createdId
  if (-not $targetId -and $list.Json -and $list.Json.data -and @($list.Json.data).Count -gt 0) {
    $targetId = @($list.Json.data)[0].id
  }
  if ($targetId) {
    $escalate = Invoke-Api -Method PATCH -Path ('/v1/issues/' + $targetId) -Key $UserKey -Body @{ status = 'done' }
    Check 'user changing status -> 403'    ($escalate.Status -eq 403) ("status=" + $escalate.Status)
  } else {
    Write-Host "  skip  no issue available to test status escalation" -ForegroundColor DarkGray
  }
} else {
  Write-Host "User-key tests skipped (pass -UserKey itk_... to run them)" -ForegroundColor DarkGray
}

# --- summary -----------------------------------------------------------------
Write-Host ""
$total = $script:pass + $script:fail
if ($script:fail -eq 0) {
  Write-Host ("All " + $total + " checks passed.") -ForegroundColor Green
  exit 0
} else {
  Write-Host ($script:pass.ToString() + " passed, " + $script:fail.ToString() + " failed (of " + $total.ToString() + ").") -ForegroundColor Red
  exit 1
}
