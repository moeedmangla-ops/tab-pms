@echo off
rem Stops TAB PMS by closing its two windows.
taskkill /fi "WINDOWTITLE eq TAB PMS - web app*" /t /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq TAB PMS - reminders*" /t /f >nul 2>&1
echo TAB PMS stopped.
timeout /t 3 >nul
