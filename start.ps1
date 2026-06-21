# start.ps1 — PulseCode AI IDE Launcher
# Run with: .\start.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

Write-Host ""
Write-Host " ============================================" -ForegroundColor Cyan
Write-Host "    PulseCode AI IDE Launcher" -ForegroundColor Cyan
Write-Host " ============================================" -ForegroundColor Cyan
Write-Host ""

# Check if already running
$backendRunning = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
$frontendRunning = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue

if ($backendRunning) {
    Write-Host "[OK] Backend already running on port 3001" -ForegroundColor Green
} else {
    Write-Host "[1/3] Starting Backend..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ProjectRoot\packages\backend'; node dist/server.js"
    Start-Sleep -Seconds 3
}

if ($frontendRunning) {
    Write-Host "[OK] Frontend already running on port 5173" -ForegroundColor Green
} else {
    Write-Host "[2/3] Starting Frontend..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ProjectRoot\packages\frontend'; pnpm dev"
    Start-Sleep -Seconds 3
}

Write-Host "[3/3] Starting Electron..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ProjectRoot\packages\frontend'; npx electron ."

Write-Host ""
Write-Host " ============================================" -ForegroundColor Cyan
Write-Host "    All services started!" -ForegroundColor Green
Write-Host " ============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Backend:   http://localhost:3001"
Write-Host "  Frontend:  http://localhost:5173"
Write-Host "  Electron:  Desktop window"
Write-Host ""
Write-Host "  Close each window to stop the service."
Write-Host ""
