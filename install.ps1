# Junction the skill folder into host skill directories that already exist.
$ErrorActionPreference = "Stop"
$skillSrc = Join-Path $PSScriptRoot "skills\cli-delegate"
if (-not (Test-Path $skillSrc)) {
  throw "Missing $skillSrc"
}

$home = $env:USERPROFILE
$targets = @(
  (Join-Path $home ".claude\skills\cli-delegate"),
  (Join-Path $home ".codex\skills\cli-delegate"),
  (Join-Path $home ".grok\skills\cli-delegate"),
  (Join-Path $home ".agents\skills\cli-delegate")
)

foreach ($dest in $targets) {
  $parent = Split-Path $dest -Parent
  if (-not (Test-Path $parent)) {
    Write-Host "skip (no host dir): $parent"
    continue
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
