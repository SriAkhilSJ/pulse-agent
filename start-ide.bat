@echo off
title PulseCode AI IDE Launcher
color 0A

echo.
echo  ============================================
echo    PulseCode AI IDE Launcher
echo  ============================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if pnpm is installed
pnpm --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] pnpm is not installed.
    echo Install it with: npm install -g pnpm
    pause
    exit /b 1
)

REM Get the project root (where this .bat file lives)
set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

echo [1/5] Installing dependencies...
pnpm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo [2/5] Building shared package...
pnpm --filter @pulse-ide/shared build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to build shared package.
    pause
    exit /b 1
)

echo.
echo [3/5] Building backend...
pnpm --filter @pulse-ide/backend build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to build backend.
    pause
    exit /b 1
)

echo.
echo [4/5] Building frontend...
pnpm --filter @pulse-ide/frontend build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to build frontend.
    pause
    exit /b 1
)

echo.
echo [5/5] Building Electron main process...
cd packages\frontend
npx tsc -p tsconfig.electron.json
cd /d "%PROJECT_ROOT%"
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to build Electron main process.
    pause
    exit /b 1
)

echo.
echo  ============================================
echo    Build Complete!
echo  ============================================
echo.
echo  Starting PulseCode AI IDE...
echo.
echo  Backend:  http://localhost:3001
echo  Frontend: http://localhost:5173 (dev mode)
echo  Electron: Desktop window
echo.
echo  Press Ctrl+C to stop any server
echo.

REM Start backend server in a new window
start "PulseCode Backend" cmd /k "cd /d %PROJECT_ROOT%\packages\backend && node dist/server.js"

REM Wait for backend to start
timeout /t 3 /nobreak >nul

REM Start frontend dev server in a new window
start "PulseCode Frontend" cmd /k "cd /d %PROJECT_ROOT%\packages\frontend && pnpm dev"

REM Wait for frontend to start
timeout /t 3 /nobreak >nul

REM Start Electron in a new window
start "PulseCode Electron" cmd /k "cd /d %PROJECT_ROOT%\packages\frontend && npx electron ."

echo.
echo  ============================================
echo    All services started!
echo  ============================================
echo.
echo  - Backend server:  http://localhost:3001
echo  - Frontend dev:    http://localhost:5173
echo  - Electron window: should appear shortly
echo.
echo  Close each window to stop the service.
echo.

pause
