@echo off
title PulseCode AI IDE - Quick Start
color 0A

echo.
echo  ============================================
echo    PulseCode AI IDE - Quick Start
echo  ============================================
echo.

set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

REM Check if backend is already running
netstat -ano | findstr "3001" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Backend already running on port 3001
) else (
    echo [1/3] Starting backend server...
    if not exist "packages\backend\dist\server.js" (
        echo [ERROR] Backend not built. Run: pnpm --filter @pulse-ide/backend build
        pause
        exit /b 1
    )
    start "PulseCode Backend" cmd /k "cd /d %PROJECT_ROOT%\packages\backend && node dist/server.js"
    timeout /t 3 /nobreak >nul
)

REM Check if frontend dev server is already running
netstat -ano | findstr "5173" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Frontend already running on port 5173
) else (
    echo [2/3] Starting frontend dev server...
    start "PulseCode Frontend" cmd /k "cd /d %PROJECT_ROOT%\packages\frontend && pnpm dev"
    timeout /t 3 /nobreak >nul
)

REM Check if Electron is already running
tasklist | findstr "electron.exe" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Electron already running
) else (
    echo [3/3] Starting Electron desktop app...
    if not exist "packages\frontend\dist-electron\main.js" (
        echo [ERROR] Electron not built. Run: cd packages\frontend ^&^& npx tsc -p tsconfig.electron.json
        pause
        exit /b 1
    )
    start "PulseCode Electron" cmd /k "cd /d %PROJECT_ROOT%\packages\frontend && npx electron ."
)

echo.
echo  ============================================
echo    All services started!
echo  ============================================
echo.
echo  - Backend:   http://localhost:3001
echo  - Frontend:  http://localhost:5173
echo  - Electron:  Desktop window
echo.
echo  Close each window to stop.
echo.

pause
