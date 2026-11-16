@echo off
rem Starts TAB PMS: the web app and the reminder worker, each in its own minimised window.
rem Closing those windows stops the system.
cd /d "%~dp0.."
start "TAB PMS - web app (keep open)" /min cmd /k npm start
start "TAB PMS - reminders (keep open)" /min cmd /k npm run worker
echo Starting TAB PMS... the browser opens in about 15 seconds.
timeout /t 15 /nobreak >nul
start "" http://localhost:3000
