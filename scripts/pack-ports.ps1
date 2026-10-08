# pack-ports.ps1 - build the four host packages + zips for a GitHub Release.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pack-ports.ps1
#
# Output (under dist/):
#   claude-code/longterm-memory/      self-contained Claude Code plugin
#   codex/longterm-memory-codex/      config + AGENTS.md snippets + prompts
#   hermes/longterm-memory/           native Hermes plugin (plugin.yaml + bin/ltm.mjs + core/)
#   mcp/longterm-memory-mcp/          generic MCP server + core
#   longterm-memory-<host>-v<ver>.zip each package zipped for release assets
#
# ASCII only: Windows PowerShell 5.1 decodes a BOM-less UTF-8 .ps1 as ANSI.

[CmdletBinding()]
param(
  [switch]$KeepDist
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$version = node -p "require('$($root -replace '\\','/')/package.json').version"

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

function Copy-Tree([string]$from, [string]$to, [string[]]$exclude = @()) {
  New-Item -ItemType Directory -Path $to -Force | Out-Null
  $items = Get-ChildItem -LiteralPath $from -Force
  foreach ($item in $items) {
    if ($exclude -contains $item.Name) { continue }
    $target = Join-Path $to $item.Name
    if ($item.PSIsContainer) { Copy-Tree $item.FullName $target }
    else { Copy-Item -LiteralPath $item.FullName -Destination $target -Force }
  }
}

function Write-VersionFile([string]$dir, [string]$hostName) {
  $text = "longterm-memory $hostName port v$version`r`nbuilt: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`r`nrepo: https://github.com/aboretheall/dsh-longterm-memory`r`n"
  [System.IO.File]::WriteAllText((Join-Path $dir 'VERSION.txt'), $text, (New-Object System.Text.UTF8Encoding($false)))
}

# ---------------------------------------------------------------- 1. Claude Code
$ccDir = Join-Path $dist 'claude-code\longterm-memory'
Copy-Tree (Join-Path $root 'ports\claude-code') $ccDir @('mcp')     # repo shim is replaced by the real server
Copy-Tree (Join-Path $root 'ports\mcp') (Join-Path $ccDir 'mcp')
Copy-Tree (Join-Path $root 'ports\core') (Join-Path $ccDir 'core')

# Skill package has exactly one canonical source: skills/longterm-memory (the packaged build
# already carries scripts/cli + scripts/core).
$skillPkg = Join-Path $dist 'skills\longterm-memory'
if (-not (Test-Path (Join-Path $skillPkg 'SKILL.md'))) {
  Write-Host '[run] scripts/pack-skills.ps1 (skill package missing)'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'pack-skills.ps1') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'pack-skills.ps1 failed' }
}
Copy-Tree $skillPkg (Join-Path $ccDir 'skills\longterm-memory')
Write-VersionFile $ccDir 'claude-code'
Write-Host '[ok] claude-code/longterm-memory'

# ---------------------------------------------------------------- 2. Codex
$codexDir = Join-Path $dist 'codex\longterm-memory-codex'
Copy-Tree (Join-Path $root 'ports\codex') $codexDir
Copy-Tree (Join-Path $root 'ports\mcp') (Join-Path $codexDir 'mcp')
Copy-Tree (Join-Path $root 'ports\core') (Join-Path $codexDir 'core')
Write-VersionFile $codexDir 'codex'
Write-Host '[ok] codex/longterm-memory-codex'

# ---------------------------------------------------------------- 3. Hermes
$hermesDir = Join-Path $dist 'hermes\longterm-memory'
Copy-Tree (Join-Path $root 'ports\hermes') $hermesDir
New-Item -ItemType Directory -Path (Join-Path $hermesDir 'bin') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'ports\cli\ltm.mjs') -Destination (Join-Path $hermesDir 'bin\ltm.mjs') -Force
Copy-Tree (Join-Path $root 'ports\core') (Join-Path $hermesDir 'core')
# Bundle the skill with the plugin: register_skill() exposes it as longterm-memory:longterm-memory
Copy-Tree $skillPkg (Join-Path $hermesDir 'skills\longterm-memory')
Write-VersionFile $hermesDir 'hermes'
Write-Host '[ok] hermes/longterm-memory'

# ---------------------------------------------------------------- 4. generic MCP
$mcpDir = Join-Path $dist 'mcp\longterm-memory-mcp'
Copy-Tree (Join-Path $root 'ports\mcp') $mcpDir
Copy-Tree (Join-Path $root 'ports\core') (Join-Path $mcpDir 'core')
Write-VersionFile $mcpDir 'mcp'
Write-Host '[ok] mcp/longterm-memory-mcp'

# ---------------------------------------------------------------- sanity check
Write-Host '[run] node --check on shipped entry points'
foreach ($entry in @(
    (Join-Path $ccDir 'mcp\server.mjs'),
    (Join-Path $hermesDir 'bin\ltm.mjs'),
    (Join-Path $mcpDir 'server.mjs')
  )) {
  & node --check $entry
  if ($LASTEXITCODE -ne 0) { throw "syntax check failed: $entry" }
}

Write-Host '[run] smoke test on the packaged CLI'
$tmp = Join-Path $env:TEMP ("ltm-pack-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$cli = Join-Path $hermesDir 'bin\ltm.mjs'
& node $cli init $tmp | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'init failed in packaged CLI' }
$doc = (& node $cli doctor --root $tmp) -join "`n"
$status = (& node $cli status --root $tmp) -join "`n"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
# ASCII-only assertions: this .ps1 stays BOM-less, and PowerShell 5.1 would mis-decode
# non-ASCII literals here. The doctor output always contains the four layer labels.
foreach ($needle in @('T1:', 'T2:', 'T3:', 'T4:')) {
  if ($doc -notmatch [regex]::Escape($needle)) { throw "packaged CLI doctor output missing $needle" }
}
if ($status -notmatch '"layout"') { throw 'packaged CLI status output missing layout' }
Write-Host '[ok] packaged CLI works'

# ---------------------------------------------------------------- zips
$stamp = "v$version"
$zips = @(
  @{ name = 'claude-code'; path = Join-Path $dist 'claude-code\longterm-memory' },
  @{ name = 'codex'; path = Join-Path $dist 'codex\longterm-memory-codex' },
  @{ name = 'hermes'; path = Join-Path $dist 'hermes\longterm-memory' },
  @{ name = 'mcp'; path = Join-Path $dist 'mcp\longterm-memory-mcp' }
)
foreach ($z in $zips) {
  $zipPath = Join-Path $dist "longterm-memory-$($z.name)-$stamp.zip"
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Compress-Archive -Path (Join-Path $z.path '*') -DestinationPath $zipPath -CompressionLevel Optimal
  $size = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
  Write-Host "[ok] $([System.IO.Path]::GetFileName($zipPath))  ($size KB)"
}

if (-not $KeepDist) { Write-Host '[ok] keep dist/ for inspection; delete it manually when done' }
Write-Host ''
Write-Host 'Release assets (upload these four zips):'
Get-ChildItem $dist -Filter '*.zip' | ForEach-Object { Write-Host "  - $($_.Name)" }
