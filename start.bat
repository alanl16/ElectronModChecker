@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org ^(the LTS button^), install it, then double-click this again.
  pause
  exit /b 1
)
if not exist node_modules\electron\dist (
  call npm install
)
call npm start
