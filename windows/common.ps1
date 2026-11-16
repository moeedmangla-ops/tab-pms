# Shared helpers for the Windows scripts.
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }

# Run a command and stop if it fails (native programs do not throw on their own).
function Run($cmd) {
  Write-Host "    $cmd" -ForegroundColor DarkGray
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) { throw "This step failed: $cmd" }
}

# Folder holding psql.exe / pg_dump.exe
function Find-PgBin {
  $c = Get-Command psql -ErrorAction SilentlyContinue
  if ($c) { return (Split-Path $c.Source) }
  $d = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
       Sort-Object { [int]($_.Name -replace '\D', '') } -Descending | Select-Object -First 1
  if ($d -and (Test-Path (Join-Path $d.FullName "bin\psql.exe"))) { return (Join-Path $d.FullName "bin") }
  throw "PostgreSQL was not found. Install it first (guide, step 1), then run this again."
}

# Database address from .env, without the ?schema= part (pg_dump does not accept it)
function Get-DbUrl {
  $line = Get-Content (Join-Path $Root ".env") | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
  if (-not $line) { throw ".env has no DATABASE_URL. Run setup.bat first." }
  return (($line -replace '^DATABASE_URL=', '').Trim().Trim('"') -replace '\?schema=public', '')
}

# Backup folder: company OneDrive if present, else personal OneDrive, else .\backups
function Get-BackupDir {
  $base = $env:OneDriveCommercial
  if (-not $base) { $base = $env:OneDrive }
  $dir = if ($base) { Join-Path $base "TAB-PMS-Backups" } else { Join-Path $Root "backups" }
  New-Item -ItemType Directory -Force $dir | Out-Null
  return $dir
}
