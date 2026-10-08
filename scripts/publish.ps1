# publish.ps1 - prepare this repository for GitHub and (optionally) npm.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/publish.ps1 -Owner <github-user>
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/publish.ps1 -Owner <user> -NpmPublish
#
# What it does:
#   1. rewrites every "aboretheall/dsh-longterm-memory" reference to "<Owner>/<Repo>"
#      (package.json, README.md, README.en.md, CHANGELOG.md, docs/, tests/manifest.test.mjs)
#   2. runs the test suite
#   3. git init (if needed), sets the local commit identity, commits, sets the remote
#   4. pushes to GitHub (skip with -NoPush)
#   5. optionally runs "npm publish --access public" (skip with -NoNpm)
#   6. prints the awesome-dsh-plugin catalog entry to open as a PR
#
# ASCII only on purpose: Windows PowerShell 5.1 decodes a BOM-less UTF-8 .ps1 as ANSI,
# so non-ASCII text in this file would be corrupted. All files it rewrites are written
# back as UTF-8 *without* BOM.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [string]$Repo = 'dsh-longterm-memory',
  [string]$Branch = 'main',
  [string]$GitUserName = '',
  [string]$GitUserEmail = '',
  [switch]$NoPush,
  [switch]$NoNpm,
  [switch]$NpmPublish,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$oldSlug = 'aboretheall/dsh-longterm-memory'
$newSlug = "$Owner/$Repo"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Text([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

# ---------------------------------------------------------------- 1. rewrite owner
$targets = @(
  'package.json',
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'docs/COMPATIBILITY.md',
  'tests/manifest.test.mjs'
)
$changed = @()
foreach ($rel in $targets) {
  $p = Join-Path $root $rel
  if (-not (Test-Path $p)) { Write-Host "[skip] $rel (missing)"; continue }
  $text = [System.IO.File]::ReadAllText($p)
  if ($text -like "*$oldSlug*") {
    $text = $text.Replace($oldSlug, $newSlug)
    Write-Text $p $text
    $changed += $rel
  }
}
if ($changed.Count -gt 0) { Write-Host "[ok] owner rewritten in: $($changed -join ', ')" }
else { Write-Host '[ok] owner already up to date' }

# ---------------------------------------------------------------- 2. tests
Write-Host '[run] node --test "tests/*.test.mjs"'
node --test "tests/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'tests failed - not publishing' }

# ---------------------------------------------------------------- 3. git commit
if (-not (Test-Path (Join-Path $root '.git'))) {
  git init -b $Branch | Out-Null
  Write-Host "[ok] git init ($Branch)"
}
$name = if ($GitUserName) { $GitUserName } else { $Owner }
$mail = if ($GitUserEmail) { $GitUserEmail } else { "$Owner@users.noreply.github.com" }
git config user.name $name
git config user.email $mail

git add -A
$status = git status --porcelain
if ($status) {
  git commit -m "release: dsh-longterm-memory $(node -p "require('./package.json').version")" | Out-Null
  Write-Host '[ok] committed'
} else {
  Write-Host '[ok] nothing to commit'
}

$version = node -p "require('./package.json').version"
git tag -f "v$version" | Out-Null
Write-Host "[ok] tag v$version"

# ---------------------------------------------------------------- 4. remote + push
$remote = "https://github.com/$newSlug.git"
$existing = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0) { git remote add origin $remote }
elseif ($existing -ne $remote) { git remote set-url origin $remote }
Write-Host "[ok] origin = $remote"

if (-not $NoPush) {
  Write-Host '[run] git push -u origin --tags'
  git push -u origin $Branch --tags
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'push failed. Authorize the GitHub account for this project in the Git Forge tab (tokens are stored there, never in chat), then re-run: git push -u origin --tags'
  }
}

# ---------------------------------------------------------------- 5. npm
if ($NpmPublish -and -not $NoNpm) {
  Write-Host '[run] npm publish --access public'
  npm publish --access public
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'npm publish failed - run "npm login" (or set NPM_TOKEN) first, then: npm publish --access public'
  }
}

# ---------------------------------------------------------------- 6. market entry
# Read the catalog entry from docs/market-entry.yml with an explicit UTF-8 read: the entry
# carries Chinese text, and this BOM-less .ps1 would be decoded as ANSI by PowerShell 5.1.
$entryPath = Join-Path $root 'docs\market-entry.yml'
Write-Host ''
Write-Host '=== awesome-dsh-plugin catalog entry (open this as a PR) ==='
if (Test-Path $entryPath) {
  [System.IO.File]::ReadAllText($entryPath, [System.Text.Encoding]::UTF8).Replace($oldSlug, $newSlug)
} else {
  "# PR for https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`n- name: $Repo`n  repo: https://github.com/$newSlug"
}
Write-Host "=== tarball for a GitHub Release: npm pack -> $Repo-$version.tgz ==="
