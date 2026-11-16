# Restores the database from a backup file. EVERYTHING entered since that backup is replaced.
. "$PSScriptRoot\common.ps1"
$dir = Get-BackupDir
$files = Get-ChildItem $dir -Filter "tab_pms_*.dump" | Sort-Object LastWriteTime -Descending
if (-not $files) { throw "No backups found in $dir" }
Write-Host "Backups in $($dir):"
for ($i = 0; $i -lt [Math]::Min($files.Count, 15); $i++) { Write-Host ("  [{0}] {1}" -f $i, $files[$i].Name) }
$n = Read-Host "Number of the backup to restore"
$file = $files[[int]$n].FullName
Write-Host "Make sure stop.bat has been run first." -ForegroundColor Yellow
$ok = Read-Host "This REPLACES all current data with $($files[[int]$n].Name). Type RESTORE to continue"
if ($ok -ne "RESTORE") { Write-Host "Cancelled."; exit }
$pgRestore = Join-Path (Find-PgBin) "pg_restore.exe"
& $pgRestore --clean --if-exists --no-owner --dbname=(Get-DbUrl) "$file"
if ($LASTEXITCODE -ne 0) { Write-Host "pg_restore reported warnings; check the system after starting it." -ForegroundColor Yellow }
Write-Host "Restore finished. Start the system with start.bat" -ForegroundColor Green
