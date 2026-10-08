# pack-skills.ps1 - build the Agent Skill package (and its release zip).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pack-skills.ps1
#
# Output:
#   dist/skills/longterm-memory/                  self-contained skill (SKILL.md + references + scripts/cli + scripts/core)
#   dist/longterm-memory-skills-v<version>.zip    release asset
#
# The skill must work without the MCP server, so the shared CLI + engine are copied into
# scripts/cli and scripts/core. A smoke test runs the packaged CLI in a temp project and
# fails the build when those copies are missing - a skill that cannot call anything is
# worse than no skill at all.
#
# ASCII only on purpose: Windows PowerShell 5.1 decodes a BOM-less UTF-8 .ps1 as ANSI, so a
# Chinese comment can swallow the following lines and silently break this script.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$version = node -p "require('$($root -replace '\\','/')/package.json').version"

$skillSrc = Join-Path $root 'skills\longterm-memory'
$skillOut = Join-Path $dist 'skills\longterm-memory'

if (-not (Test-Path (Join-Path $skillSrc 'SKILL.md'))) { throw "missing SKILL.md in $skillSrc" }

function Copy-Tree([string]$from, [string]$to, [string[]]$exclude = @()) {
  [System.IO.Directory]::CreateDirectory($to) | Out-Null
  foreach ($item in Get-ChildItem -LiteralPath $from -Force) {
    if ($exclude -contains $item.Name) { continue }
    $target = Join-Path $to $item.Name
    if ($item.PSIsContainer) { Copy-Tree $item.FullName $target }
    else { Copy-Item -LiteralPath $item.FullName -Destination $target -Force }
  }
}

# ---------------------------------------------------------------- build
if (Test-Path $skillOut) { Remove-Item $skillOut -Recurse -Force }
Copy-Tree $skillSrc $skillOut @('__pycache__', 'node_modules')

# Bundle the real CLI + engine. The CLI resolves the engine at ../core/index.mjs,
# so scripts/cli + scripts/core must keep that exact relative layout.
[System.IO.Directory]::CreateDirectory((Join-Path $skillOut 'scripts\cli')) | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'ports\cli\ltm.mjs') -Destination (Join-Path $skillOut 'scripts\cli\ltm.mjs') -Force
Copy-Tree (Join-Path $root 'ports\core') (Join-Path $skillOut 'scripts\core')

$text = "longterm-memory skill v$version`r`nbuilt: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`r`nrepo: https://github.com/aboretheall/dsh-longterm-memory`r`n"
[System.IO.File]::WriteAllText((Join-Path $skillOut 'VERSION.txt'), $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[ok] $skillOut"

# ---------------------------------------------------------------- verify
Write-Host '[run] node --check on packaged scripts'
$entries = @(
  (Join-Path $skillOut 'scripts\ltm.mjs'),
  (Join-Path $skillOut 'scripts\cli\ltm.mjs'),
  (Join-Path $skillOut 'scripts\install.mjs')
)
foreach ($entry in $entries) {
  & node --check $entry
  if ($LASTEXITCODE -ne 0) { throw "syntax check failed: $entry" }
}
if (-not (Test-Path (Join-Path $skillOut 'scripts\core\engine.mjs'))) {
  throw 'scripts/core missing - the packaged skill could not run anything'
}

Write-Host '[run] smoke test: packaged CLI in a temp project'
$tmp = Join-Path $env:TEMP ("ltm-skill-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$cli = Join-Path $skillOut 'scripts\ltm.mjs'
& node $cli init $tmp | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'packaged skill CLI: init failed (scripts/cli or scripts/core missing?)' }
$doc = (& node $cli doctor --root $tmp) -join "`n"
& node $cli write --root $tmp --title 'silent-check' --category 'other' --content 'smoke test record' | Out-Null
$found = (& node $cli search 'silent-check' --root $tmp) -join "`n"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

foreach ($needle in @('T1:', 'T2:', 'T3:', 'T4:')) {
  if ($doc -notmatch [regex]::Escape($needle)) { throw "doctor output missing $needle" }
}
if ($found -notmatch 'silent-check') { throw 'search did not find the record written through the packaged skill' }
Write-Host '[ok] packaged skill works standalone'

Write-Host '[run] install.mjs --list'
& node (Join-Path $skillOut 'scripts\install.mjs') --list | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'install.mjs --list failed' }

# ---------------------------------------------------------------- zip
$zipPath = Join-Path $dist "longterm-memory-skills-v$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $skillOut '*') -DestinationPath $zipPath -CompressionLevel Optimal
$size = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host "[ok] $([System.IO.Path]::GetFileName($zipPath))  ($size KB)"
