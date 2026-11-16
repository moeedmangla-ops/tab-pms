# Installs the latest version from GitHub. Your data is backed up first and kept.
. "$PSScriptRoot\common.ps1"
Step "Backing up first"
& (Join-Path $PSScriptRoot "backup.ps1")
Step "Stopping TAB PMS"
cmd /c "`"$PSScriptRoot\stop.bat`"" | Out-Null
Step "Downloading the latest version"
Run "git pull --ff-only"
Run "npm ci"
Run "npx prisma generate"
Run "npx prisma migrate deploy"
Run "npm run build"
Write-Host "Updated. Start it again with start.bat" -ForegroundColor Green
