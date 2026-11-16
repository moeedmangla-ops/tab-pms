# Makes TAB PMS start when you sign in to Windows, backs it up every day at 13:00,
# and stops the laptop sleeping while plugged in.
. "$PSScriptRoot\common.ps1"
$startBat = Join-Path $PSScriptRoot "start.bat"
$backup = Join-Path $PSScriptRoot "backup.ps1"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Step "Start TAB PMS when you sign in"
Register-ScheduledTask -TaskName "TAB PMS - start" -Force -Settings $settings `
  -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) `
  -Action (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$startBat`"") | Out-Null

Step "Back up every day at 13:00 (or at the next start if the laptop was off)"
Register-ScheduledTask -TaskName "TAB PMS - daily backup" -Force -Settings $settings `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 13:00) `
  -Action (New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backup`"") | Out-Null

Step "Never sleep while plugged in"
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

Write-Host ""
Write-Host "Done. TAB PMS will start each time you sign in, and back up daily to $(Get-BackupDir)" -ForegroundColor Green
Write-Host "To undo: Task Scheduler -> delete the two 'TAB PMS' tasks."
