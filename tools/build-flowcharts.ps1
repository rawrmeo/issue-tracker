# ============================================================================
#  tools/build-flowcharts.ps1
# ----------------------------------------------------------------------------
#  Regenerates flowcharts.html from the ```mermaid blocks in ARCHITECTURE.md
#  and HANDOVER.md, so the single-page viewer can never drift from the docs.
#
#  Usage (from the repo root):
#      powershell -ExecutionPolicy Bypass -File tools/build-flowcharts.ps1
#
#  The two markdown files are the single source of truth: edit a diagram there,
#  re-run this script, and the viewer updates. No Node.js, no build step.
# ============================================================================

[CmdletBinding()]
param(
  [string] $Root
)

$ErrorActionPreference = 'Stop'

# Work out the repo root: the parent of this script's folder, or the current
# directory when invoked in a way that does not set $PSScriptRoot.
if (-not $Root) {
  $scriptPath = $MyInvocation.MyCommand.Path
  if ($scriptPath) { $Root = Split-Path -Parent (Split-Path -Parent $scriptPath) }
}
if (-not $Root) { $Root = (Get-Location).Path }

$sources = @('ARCHITECTURE.md', 'HANDOVER.md')
$output  = Join-Path $Root 'flowcharts.html'

function ConvertTo-HtmlText {
  param([string] $Text)
  # Order matters: ampersand first, then the angle brackets.
  return ($Text -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;')
}

$blocks = New-Object System.Collections.Generic.List[object]

foreach ($name in $sources) {
  $path = Join-Path $Root $name
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing source file: $path"
  }

  $lines = Get-Content -LiteralPath $path -Encoding UTF8
  $heading = '(untitled)'
  $inBlock = $false
  $buffer = New-Object System.Collections.Generic.List[string]

  foreach ($line in $lines) {
    if (-not $inBlock) {
      if ($line -match '^#{1,6}\s+(.*\S)\s*$') {
        $heading = $Matches[1]
        continue
      }
      if ($line -match '^```mermaid\s*$') {
        $inBlock = $true
        $buffer.Clear()
        continue
      }
    } else {
      if ($line -match '^```\s*$') {
        $blocks.Add([pscustomobject]@{
          Title  = $heading
          Source = $name
          Code   = ($buffer -join "`n")
        })
        $inBlock = $false
      } else {
        $buffer.Add($line)
      }
    }
  }
}

if ($blocks.Count -eq 0) {
  throw 'No ```mermaid blocks were found in the source files.'
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('<!DOCTYPE html>')
[void]$sb.AppendLine('<html lang="en">')
[void]$sb.AppendLine('<head>')
[void]$sb.AppendLine('<meta charset="UTF-8" />')
[void]$sb.AppendLine('<meta name="viewport" content="width=device-width, initial-scale=1" />')
[void]$sb.AppendLine('<title>Flowcharts - Issue Tracker</title>')
[void]$sb.AppendLine('<style>')
[void]$sb.AppendLine('  :root { --bg:#f6f7fb; --surface:#fff; --border:#e3e5ee; --text:#1b1d29; --muted:#6b7186; --accent:#1F6F9C; }')
[void]$sb.AppendLine('  * { box-sizing: border-box; }')
[void]$sb.AppendLine('  body { margin:0; background:var(--bg); color:var(--text);')
[void]$sb.AppendLine('         font:15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }')
[void]$sb.AppendLine('  header { position:sticky; top:0; z-index:5; background:rgba(255,255,255,.92); backdrop-filter:blur(10px);')
[void]$sb.AppendLine('           border-bottom:1px solid var(--border); padding:14px 22px; }')
[void]$sb.AppendLine('  header h1 { margin:0; font-size:18px; }')
[void]$sb.AppendLine('  header p { margin:3px 0 0; color:var(--muted); font-size:13px; }')
[void]$sb.AppendLine('  main { padding:22px; max-width:1200px; margin:0 auto; display:grid; gap:22px; }')
[void]$sb.AppendLine('  .card { background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px 20px;')
[void]$sb.AppendLine('          box-shadow:0 1px 2px rgba(20,22,40,.05), 0 8px 24px rgba(20,22,40,.06); }')
[void]$sb.AppendLine('  .card h2 { margin:0 0 2px; font-size:15px; }')
[void]$sb.AppendLine('  .card .src { margin:0 0 14px; color:var(--muted); font-size:12px; }')
[void]$sb.AppendLine('  .n { display:inline-grid; place-items:center; min-width:22px; height:22px; padding:0 6px; margin-right:8px;')
[void]$sb.AppendLine('       border-radius:999px; background:var(--accent); color:#fff; font-size:12px; font-weight:700; vertical-align:middle; }')
[void]$sb.AppendLine('  .mermaid { display:flex; justify-content:center; overflow:auto; }')
[void]$sb.AppendLine('  .mermaid svg { max-width:100%; height:auto; }')
[void]$sb.AppendLine('  .err { color:#dc2626; font:12px/1.5 ui-monospace, Consolas, monospace; white-space:pre-wrap;')
[void]$sb.AppendLine('         background:#fdecec; border-radius:8px; padding:10px; }')
[void]$sb.AppendLine('  @media (prefers-color-scheme: dark) {')
[void]$sb.AppendLine('    :root { --bg:#0f1117; --surface:#171a23; --border:#272b38; --text:#e7e9f0; --muted:#9aa1b5; }')
[void]$sb.AppendLine('    header { background:rgba(23,26,35,.92); }')
[void]$sb.AppendLine('  }')
[void]$sb.AppendLine('</style>')
[void]$sb.AppendLine('</head>')
[void]$sb.AppendLine('<body>')
[void]$sb.AppendLine('<header>')
[void]$sb.AppendLine('  <h1>Issue Tracker - flowcharts</h1>')
[void]$sb.AppendLine("  <p>$($blocks.Count) diagrams, generated from ARCHITECTURE.md and HANDOVER.md - run <code>tools/build-flowcharts.ps1</code> to refresh.</p>")
[void]$sb.AppendLine('</header>')
[void]$sb.AppendLine('<main>')

$i = 0
foreach ($block in $blocks) {
  $i++
  $title = ConvertTo-HtmlText $block.Title
  $src   = ConvertTo-HtmlText $block.Source
  $code  = ConvertTo-HtmlText $block.Code

  [void]$sb.AppendLine('  <section class="card">')
  [void]$sb.AppendLine("    <h2><span class=`"n`">$i</span>$title</h2>")
  [void]$sb.AppendLine("    <p class=`"src`">$src</p>")
  [void]$sb.AppendLine("    <pre class=`"mermaid`">$code</pre>")
  [void]$sb.AppendLine('  </section>')
}

[void]$sb.AppendLine('</main>')
[void]$sb.AppendLine('<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>')
[void]$sb.AppendLine('<script>')
[void]$sb.AppendLine('  mermaid.initialize({')
[void]$sb.AppendLine('    startOnLoad: true,')
[void]$sb.AppendLine('    securityLevel: ''loose'',')
[void]$sb.AppendLine('    theme: window.matchMedia && window.matchMedia(''(prefers-color-scheme: dark)'').matches ? ''dark'' : ''default'',')
[void]$sb.AppendLine('    flowchart: { useMaxWidth: true, htmlLabels: true },')
[void]$sb.AppendLine('    themeVariables: { fontFamily: ''ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial'' }')
[void]$sb.AppendLine('  });')
[void]$sb.AppendLine('  window.addEventListener(''error'', function (e) {')
[void]$sb.AppendLine('    var pre = e.target && e.target.closest && e.target.closest(''.mermaid'');')
[void]$sb.AppendLine('    if (pre && pre.parentNode) {')
[void]$sb.AppendLine('      var box = document.createElement(''div'');')
[void]$sb.AppendLine('      box.className = ''err'';')
[void]$sb.AppendLine('      box.textContent = ''This diagram failed to render: '' + (e.message || e.type);')
[void]$sb.AppendLine('      pre.parentNode.replaceChild(box, pre);')
[void]$sb.AppendLine('    }')
[void]$sb.AppendLine('  }, true);')
[void]$sb.AppendLine('</script>')
[void]$sb.AppendLine('</body>')
[void]$sb.AppendLine('</html>')

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($output, $sb.ToString(), $utf8)

Write-Host "Wrote $output with $($blocks.Count) diagrams."
