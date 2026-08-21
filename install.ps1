#requires -Version 7
# Junction the skill folder into host skill directories that already exist.
# PowerShell 7 (pwsh) only — do not call cmd.exe. `$home` is read-only in pwsh.
$ErrorActionPreference = "Stop"
$skillSrc = (Resolve-Path (Join-Path $PSScriptRoot "skills\cli-delegate")).Path

function Remove-ReparsePoint([string]$path) {
  $item = Get-Item -LiteralPath $path -Force
  if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "refusing to delete non-link: $path"
  }
  [System.IO.Directory]::Delete($item.FullName)
}

$userHome = $env:USERPROFILE
$hostRoots = @(
  (Join-Path $userHome ".claude"),
  (Join-Path $userHome ".codex"),
  (Join-Path $userHome ".grok"),
  (Join-Path $userHome ".agents")
)

foreach ($hostRoot in $hostRoots) {
  if (-not (Test-Path $hostRoot)) {
    Write-Host "skip (no host dir): $hostRoot"
    continue
  }
  $parent = Join-Path $hostRoot "skills"
  $dest = Join-Path $parent "cli-delegate"
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
  }
  if (Test-Path $dest) {
    $item = Get-Item -LiteralPath $dest -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      Remove-ReparsePoint $dest
    } else {
      Write-Host "skip (exists, not a junction): $dest"
      continue
    }
  }
  New-Item -ItemType Junction -Path $dest -Target $skillSrc | Out-Null
  Write-Host "linked $dest -> $skillSrc"
}
