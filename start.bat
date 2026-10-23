@echo off
title RSA Gulf Server
cd /d "%~dp0"
where node >/dev/null 2>/dev/null || (echo Node.js is not installed. Install it from https://nodejs.org and try again. & pause & exit /b)
if "%ADMIN_PASSWORD%"=="" set /p ADMIN_PASSWORD=Choose a staff password, at least 8 characters, then press Enter: 
echo.
echo Starting. Open http://localhost:3000 in your browser. Staff page: http://localhost:3000/admin
echo Keep this window open. Press Ctrl+C to stop.
echo.
node server.js
pause
