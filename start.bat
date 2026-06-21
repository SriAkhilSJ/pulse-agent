@echo off
title PulseCode AI IDE
color 0A

echo.
echo  ============================================
echo    PulseCode AI IDE
echo  ============================================
echo.

cd /d "%~dp0"

echo [1/3] Starting Backend...
start "Backend" cmd /k "cd packages\backend && node dist/server.js"

echo [2/3] Starting Frontend...
start "Frontend" cmd /k "cd packages\frontend && pnpm dev"

echo [3/3] Starting Electron...
timeout /t 2 /nobreak >nul
start "Electron" cmd /k "cd packages\frontend && npx electron ."

echo.
echo  ============================================
echo    All services started!
echo  ============================================
echo.
echo  Backend:   http://localhost:3001
echo  Frontend:  http://localhost:5173
echo  Electron:  Desktop window
echo.
pause
