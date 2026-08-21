#requires -Version 7
# Copy skills/cli-delegate onto skillshare sources without nesting scripts/scripts.
# PowerShell Copy-Item -Recurse into an existing dest\scripts creates dest\scripts\scripts.
$ErrorActionPreference = "Stop"
$src = (Resolve-Path (Join-Path $PSScriptRoot "skills\cli-delegate")).Path

function Sync-SkillDir([string]$dest) {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item -Force (Join-Path $src "SKILL.md") (Join-Path $dest "SKILL.md")
  $scriptsDest = Join-Path $dest "scripts"
  if (Test-Path $scriptsDest) {
    Remove-Item -LiteralPath $scriptsDest -Recurse -Force
  }
  Copy-Item -Recurse -Force (Join-Path $src "scripts") $scriptsDest
  $nested = Join-Path $scriptsDest "scripts"
  if (Test-Path $nested) {
    throw "nested $nested after copy — abort"
  }
  $entry = Join-Path $scriptsDest "cli-delegate.mjs"
  if (-not (Test-Path $entry)) {
    throw "missing $entry"
  }
  Write-Host "synced $dest"
}

$dests = @(
  (Join-Path $env:APPDATA "skillshare\skills\cli-delegate"),
  (Join-Path $env:APPDATA "skillshare\local-src\cli-delegate")
)
foreach ($dest in $dests) {
  if ($dest) { Sync-SkillDir $dest }
}
Write-Host "Now: skillshare sync -g --force --no-tui"
