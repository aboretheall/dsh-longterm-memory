# finish-publish.ps1 - one command to finish the release once a credential exists.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/finish-publish.ps1
#
# It uses whichever authorization is available, in this order:
#   1. GitHub CLI (gh) already logged in  -> create repo, push, create the Release
#   2. an already-working "git push" (e.g. the harness Git Forge credential helper)
#      -> push only; repo creation and the Release stay manual
# npm publish runs only when "npm whoami" succeeds.
#
# The one-time device code for step 1 comes from:
#   gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow
#
# ASCII only: Windows PowerShell 5.1 decodes a BOM-less UTF-8 .ps1 as ANSI.

[CmdletBinding()]
param(
  [string]$Owner = 'aboretheall',
  [string]$Repo = 'dsh-longterm-memory',
  [string]$Branch = 'main',
  [string]$Description = 'T1-T4 long-term project memory plugin for DeepSeek Harness',
  [switch]$SkipNpm,
  [switch]$SkipRelease,
  # Use when the remote contains an unrelated (e.g. web-uploaded, flattened) history
  # that should be replaced by this repository's real history.
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$proxy = if ($env:LTM_GIT_PROXY) { $env:LTM_GIT_PROXY } else { 'http://127.0.0.1:7897' }
if (-not $env:HTTP_PROXY) { $env:HTTP_PROXY = $proxy }
if (-not $env:HTTPS_PROXY) { $env:HTTPS_PROXY = $proxy }
if (-not $env:NO_PROXY) { $env:NO_PROXY = '127.0.0.1,localhost' }

$version = node -p "require('./package.json').version"
$tag = "v$version"
$slug = "$Owner/$Repo"
$url = "https://github.com/$slug.git"
$tgz = Join-Path $root "$Repo-$version.tgz"

# ---------------------------------------------------------------- gh availability
$gh = $null
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'dsh-tools\bin\gh.exe'),
  'gh'
)
foreach ($c in $candidates) {
  try {
    $out = & $c --version 2>$null | Select-Object -First 1
    if ($LASTEXITCODE -eq 0 -and $out) { $gh = $c; break }
  } catch { }
}

$ghReady = $false
if ($gh) {
  try {
    & $gh auth status 2>&1 | Out-Null
    $ghReady = ($LASTEXITCODE -eq 0)
  } catch { $ghReady = $false }
}

# ---------------------------------------------------------------- remote wiring
$existing = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0) { git remote add origin $url }
elseif ($existing -ne $url) { git remote set-url origin $url }

# Push that survives an already-initialized remote (e.g. the repo was created with a README):
# if the remote has commits we lack, rebase onto them first instead of force-pushing.
function Invoke-PushBranch([string]$branch) {
  $remoteRef = (git ls-remote --heads origin "refs/heads/$branch" 2>$null)
  if ($remoteRef) {
    Write-Host "[run] git fetch origin $branch"
    git fetch origin $branch 2>&1 | Out-Null
    git merge-base --is-ancestor "origin/$branch" HEAD 2>$null
    if ($LASTEXITCODE -ne 0) {
      if ($Force) {
        Write-Host "[warn] remote '$branch' has an unrelated history; -Force replaces it"
        Write-Host "[run] git push -u origin $branch --tags --force-with-lease"
        git push -u origin $branch --tags --force-with-lease
        if ($LASTEXITCODE -ne 0) { throw 'force push failed' }
        return
      }
      Write-Host "[warn] remote '$branch' has commits this clone does not have:"
      git log "origin/$branch" --oneline -5 2>$null | ForEach-Object { Write-Host "        $_" }
      Write-Host "[run] git rebase origin/$branch"
      git rebase "origin/$branch" 2>&1 | ForEach-Object { Write-Host "        $_" }
      if ($LASTEXITCODE -ne 0) {
        git rebase --abort 2>$null | Out-Null
        Write-Warning "rebase failed (likely unrelated histories / README conflict). Nothing was pushed."
        Write-Warning "If the remote content is a throwaway upload (e.g. a flattened web upload), replace it:"
        Write-Warning "  powershell -File scripts/finish-publish.ps1 -Force"
        exit 4
      }
    }
  }
  Write-Host "[run] git push -u origin $branch --tags"
  git push -u origin $branch --tags
  if ($LASTEXITCODE -ne 0) { throw "git push failed" }
}

# ---------------------------------------------------------------- 1. repo + push + release
if ($ghReady) {
  Write-Host "[ok] gh authenticated"
  & $gh repo view $slug --json name 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[run] gh repo create $slug --public"
    & $gh repo create $slug --public --description $Description
    if ($LASTEXITCODE -ne 0) { throw "gh repo create failed" }
  } else {
    Write-Host "[ok] repo already exists -> pushing into it (no create)"
  }

  Invoke-PushBranch $Branch

  if (-not $SkipRelease) {
    if (-not (Test-Path $tgz)) {
      Write-Host '[run] npm pack (tgz missing)'
      & npm.cmd pack | Out-Null
    }
    # host packages (Claude Code / Codex / Hermes / MCP / skills) ride along as release assets
    $portZips = @()
    $distDir = Join-Path $root 'dist'
    if (-not (Test-Path $distDir)) {
      Write-Host '[run] scripts/pack-ports.ps1 (dist missing)'
      & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'pack-ports.ps1') | Out-Null
    }
    if (Test-Path $distDir) { $portZips = Get-ChildItem $distDir -Filter '*.zip' | ForEach-Object { $_.FullName } }

    $assets = @($tgz) + $portZips
    & $gh release view $tag 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[run] gh release create $tag ($($assets.Count) assets)"
      & $gh release create $tag @assets --title $tag --notes "See CHANGELOG.md"
      if ($LASTEXITCODE -ne 0) { Write-Warning 'release creation failed; the repo itself is published' }
    } else {
      Write-Host "[ok] release $tag already exists; uploading assets"
      & $gh release upload $tag @assets --clobber
    }
  }
} else {
  Write-Warning 'gh is not authenticated. Falling back to a plain git push.'
  Write-Host '[run] git push -u origin --tags'
  git push -u origin $Branch --tags
  if ($LASTEXITCODE -ne 0) {
    Write-Warning @'
No usable credential: create/authorize one, then re-run this script.
  A) GitHub device flow:
       gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow
  B) harness sidebar: Git Forge tab -> authorize this project's GitHub account, then re-run.
'@
    exit 2
  }
  Write-Warning 'pushed, but repo creation and the Release still need the GitHub web UI (or an authenticated gh).'
}

# ---------------------------------------------------------------- 2. npm
if (-not $SkipNpm) {
  & npm.cmd whoami 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host '[run] npm publish --access public'
    & npm.cmd publish --access public
    if ($LASTEXITCODE -eq 0) { Write-Host '[ok] published to npm' }
    else { Write-Warning 'npm publish failed' }
  } else {
    Write-Warning 'npm is not logged in; skipping publish (GitHub release is already usable as a source).'
  }
}

# ---------------------------------------------------------------- 3. market entry
# Read the Chinese catalog entry from docs/market-entry.yml with an explicit UTF-8 read
# (embedding non-ASCII text in this BOM-less .ps1 would be mis-decoded by PowerShell 5.1).
Write-Host ''
Write-Host '=== awesome-dsh-plugin catalog entry (open as a PR) ==='
Write-Host '# https://github.com/awesome-dsh-plugin/awesome-dsh-plugin'
$entryFile = Join-Path $root 'docs\market-entry.yml'
if (Test-Path $entryFile) {
  $rawEntry = [System.IO.File]::ReadAllText($entryFile, [System.Text.Encoding]::UTF8)
  $rawEntry = $rawEntry.Replace('aboretheall/dsh-longterm-memory', $slug)
  foreach ($line in $rawEntry.Split([char]10)) { Write-Host $line }
} else {
  Write-Host "repo: https://github.com/$slug"
}
