<#!
.SYNOPSIS
Starts a temporary phone preview using Cloudflare Quick Tunnels.

.DESCRIPTION
Starts the FastAPI backend, starts Vite with its same-origin API proxy, then
tunnels Vite. Leave the processes running while testing.
#>

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$logRoot = Join-Path $projectRoot '.phone-preview'

function Require-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "'$name' was not found. Install it or add it to PATH, then run this script again."
    }
}

function Get-TunnelUrl([string[]]$logFiles, [string]$label) {
    $deadline = (Get-Date).AddSeconds(75)
    while ((Get-Date) -lt $deadline) {
        foreach ($logFile in $logFiles) {
            if (-not (Test-Path $logFile)) { continue }
            $content = Get-Content -Raw $logFile
            if ([string]::IsNullOrWhiteSpace($content)) { continue }
            $match = [regex]::Matches($content, 'https://[a-z0-9-]+\.trycloudflare\.com') | Select-Object -Last 1
            if ($match) { return $match.Value }
        }
        Start-Sleep -Seconds 1
    }
    throw "Timed out waiting for the $label tunnel URL. Check the logs in $logRoot."
}

function Show-QrCode([string]$url) {
    Write-Host 'Scan this QR code to open the phone preview:' -ForegroundColor Cyan
    $renderer = "require('qrcode-terminal').generate(process.argv[1], { small: true })"
    & node -e $renderer $url
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Could not render the QR code. Open this URL instead: $url"
    }
}

function Wait-ForBackend {
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri 'http://127.0.0.1:8000/docs' -TimeoutSec 2 -UseBasicParsing | Out-Null
            return
        } catch { Start-Sleep -Milliseconds 500 }
    }
    throw "The backend did not start on port 8000. Check $logRoot\backend-error.log."
}

function Clear-PreviewPort([int]$port) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { return }
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    $commandLine = $processInfo.CommandLine
    if ($commandLine -notmatch 'uvicorn|vite|npm|node') {
        throw "Port $port is being used by a non-preview process (ID $($listener.OwningProcess)). It was left running for safety."
    }
    Write-Host "Stopping the previous preview on port $port..." -ForegroundColor Yellow
    Stop-Process -Id $listener.OwningProcess -Force
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 150
    }
    throw "Port $port did not close after stopping its previous preview process."
}

Require-Command 'python'
Require-Command 'node'
Require-Command 'npx.cmd'
Require-Command 'npm.cmd'
Clear-PreviewPort 8000
Clear-PreviewPort 5173
Clear-PreviewPort 5174
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$backendOut = Join-Path $logRoot 'backend.log'
$backendErr = Join-Path $logRoot 'backend-error.log'
$frontendOut = Join-Path $logRoot 'frontend.log'
$frontendErr = Join-Path $logRoot 'frontend-error.log'
$frontendTunnelOut = Join-Path $logRoot 'frontend-tunnel.log'
$frontendTunnelErr = Join-Path $logRoot 'frontend-tunnel-error.log'

Write-Host 'Starting backend...' -ForegroundColor Cyan
$null = Start-Process -FilePath 'python' -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory $backendRoot -WindowStyle Hidden -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr -PassThru
Wait-ForBackend

Write-Host 'Starting frontend...' -ForegroundColor Cyan
$null = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr -PassThru

Write-Host 'Creating frontend tunnel...' -ForegroundColor Cyan
$null = Start-Process -FilePath 'npx.cmd' -ArgumentList @('--yes', 'wrangler', 'tunnel', 'quick-start', 'http://127.0.0.1:5173') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $frontendTunnelOut -RedirectStandardError $frontendTunnelErr -PassThru
$frontendUrl = Get-TunnelUrl @($frontendTunnelOut, $frontendTunnelErr) 'frontend'

Write-Host ''
Write-Host 'Phone preview is ready:' -ForegroundColor Green
Write-Host $frontendUrl -ForegroundColor Green
Write-Host ''
Show-QrCode $frontendUrl
Write-Host ''
Write-Host 'Keep this PowerShell window open while testing. Logs are in .phone-preview.' -ForegroundColor Yellow
