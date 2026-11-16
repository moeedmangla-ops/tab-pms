# Backs up the whole database to OneDrive\TAB-PMS-Backups (keeps 30 days).
. "$PSScriptRoot\common.ps1"
$pgDump = Join-Path (Find-PgBin) "pg_dump.exe"
$dir = Get-BackupDir
$file = Join-Path $dir ("tab_pms_" + (Get-Date -Format "yyyy-MM-dd_HHmm") + ".dump")
& $pgDump --format=custom --file="$file" (Get-DbUrl)
if ($LASTEXITCODE -ne 0) { throw "Backup failed. Is PostgreSQL running?" }
Get-ChildItem $dir -Filter "tab_pms_*.dump" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item
Write-Host "Backup saved: $file" -ForegroundColor Green
