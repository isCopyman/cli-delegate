# Junction the skill folder into host skill directories that already exist.
$ErrorActionPreference = "Stop"
$skillSrc = Join-Path $PSScriptRoot "skills\cli-delegate"
if (-not (Test-Path $skillSrc)) {
  throw "Missing $skillSrc"
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
    $item = Get-Item $dest -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      cmd /c rmdir "$dest" | Out-Null
    } else {
      Write-Host "skip (exists, not a junction): $dest"
      continue
    }
  }
  cmd /c mklink /J "$dest" "$skillSrc" | Out-Null
  Write-Host "linked $dest -> $skillSrc"
}
