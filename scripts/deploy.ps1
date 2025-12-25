# Wine Cellar Deployment Script
# Usage: .\scripts\deploy.ps1           # Full deploy (push, wait for build, deploy to Synology)
# Usage: .\scripts\deploy.ps1 -SkipPush # Deploy without pushing (use existing image)

param(
    [switch]$SkipPush,
    [string]$SynologyIP = "192.168.86.31",
    [string]$SynologyUser = "lstrydom"
)

$ErrorActionPreference = "Stop"

$RemoteAppPath = "Apps/wine-cellar-app"

function Write-Status($message) {
    Write-Host "`n[$((Get-Date).ToString('HH:mm:ss'))] $message" -ForegroundColor Cyan
}

function Write-Success($message) {
    Write-Host "  OK: $message" -ForegroundColor Green
}

Write-Host @"

Wine Cellar Deployment
======================

"@

# Step 1: Git push (unless skipped)
if (-not $SkipPush) {
    Write-Status "Checking for uncommitted changes..."
    $status = git status --porcelain
    if ($status) {
        Write-Host "  Uncommitted changes detected:" -ForegroundColor Yellow
        git status --short
        Write-Host ""
        $confirm = Read-Host "  Continue without committing? (y/n)"
        if ($confirm -ne 'y') {
            Write-Host "  Please commit your changes first." -ForegroundColor Red
            exit 1
        }
    }

    Write-Status "Pushing to GitHub..."
    git push
    Write-Success "Pushed to GitHub"

    Write-Status "Waiting for GitHub Actions build..."
    Write-Host "  Checking build status every 10 seconds..."

    $maxWait = 180  # 3 minutes max
    $waited = 0

    do {
        Start-Sleep -Seconds 10
        $waited += 10

        $runStatus = gh run list --limit 1 --json status,conclusion | ConvertFrom-Json

        if ($runStatus[0].status -eq "completed") {
            if ($runStatus[0].conclusion -eq "success") {
                Write-Success "Build completed successfully!"
                break
            } else {
                Write-Host "  Build failed! Check GitHub Actions." -ForegroundColor Red
                exit 1
            }
        }

        Write-Host "  Still building... (${waited}s)"

    } while ($waited -lt $maxWait)

    if ($waited -ge $maxWait) {
        Write-Host "  Build taking too long. Check GitHub Actions manually." -ForegroundColor Yellow
    }
}

# Step 2: Deploy to Synology
Write-Status "Deploying to Synology..."

Write-Host "  Stopping container..."
ssh "${SynologyUser}@${SynologyIP}" "cd ~/${RemoteAppPath} && sudo docker compose down"

Write-Host "  Removing old image..."
ssh "${SynologyUser}@${SynologyIP}" "sudo docker rmi ghcr.io/lbstrydom/wine-cellar-app:latest 2>/dev/null || true"

Write-Host "  Pulling new image..."
ssh "${SynologyUser}@${SynologyIP}" "cd ~/${RemoteAppPath} && sudo docker compose pull"

Write-Host "  Starting container..."
ssh "${SynologyUser}@${SynologyIP}" "cd ~/${RemoteAppPath} && sudo docker compose up -d"

# Step 3: Verify
Write-Status "Verifying deployment..."
Start-Sleep -Seconds 5

$containerStatus = ssh "${SynologyUser}@${SynologyIP}" "sudo docker ps --filter name=wine-cellar --format '{{.Status}}'"

if ($containerStatus -match "Up") {
    Write-Success "Container is running!"
    Write-Host "`n  Status: $containerStatus"
    Write-Host "  URL: http://${SynologyIP}:3000"
} else {
    Write-Host "  Container may not be running correctly. Check logs:" -ForegroundColor Yellow
    Write-Host "    ssh ${SynologyUser}@${SynologyIP}"
    Write-Host "    sudo docker logs wine-cellar"
}

Write-Host ""
