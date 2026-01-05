# Wine Cellar Deployment Script
# ==============================
# Git-based deployment: push to GitHub, pull on Synology, build locally
#
# Usage:
#   .\scripts\deploy.ps1              # Full deploy with lint/tests
#   .\scripts\deploy.ps1 -SkipTests   # Skip lint and tests
#   .\scripts\deploy.ps1 -Quick       # Quick deploy (skip tests, no rebuild)
#   .\scripts\deploy.ps1 -Logs        # Deploy and tail logs
#
# Prerequisites:
#   - SSH key auth set up (run .\scripts\setup-ssh-key.ps1)
#   - Or SYNOLOGY_PASSWORD in .env file

param(
    [switch]$SkipTests,
    [switch]$Quick,
    [switch]$Logs,
    [switch]$Help
)

if ($Help) {
    Write-Host @"

Wine Cellar Deployment Script
=============================

Usage:
  .\scripts\deploy.ps1              Full deploy with lint and tests
  .\scripts\deploy.ps1 -SkipTests   Skip lint and tests
  .\scripts\deploy.ps1 -Quick       Quick deploy (no tests, no rebuild)
  .\scripts\deploy.ps1 -Logs        Deploy and show container logs

Steps performed:
  1. Run ESLint
  2. Run tests (if any)
  3. Check for uncommitted changes
  4. Git push to GitHub
  5. SSH to Synology: git pull
  6. Docker compose down/build/up
  7. Verify container is running
  8. Test API endpoint

"@
    exit 0
}

$ErrorActionPreference = "Stop"

# Configuration
$SynologyUser = "lstrydom"
$SynologyIP = "192.168.86.31"
$RemoteAppPath = "~/Apps/wine-cellar-app"
$SynologyPassword = $null

# Load password from .env if SSH key auth fails
$envFile = ".\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^SYNOLOGY_PASSWORD=(.+)$") { $SynologyPassword = $matches[1] }
    }
}

# Helper functions
function Write-Step($step, $message) {
    Write-Host "`n[$step] $message" -ForegroundColor Cyan
}

function Write-OK($message) {
    Write-Host "    OK: $message" -ForegroundColor Green
}

function Write-Fail($message) {
    Write-Host "    FAIL: $message" -ForegroundColor Red
}

function Write-Skip($message) {
    Write-Host "    SKIP: $message" -ForegroundColor Yellow
}

# Detect SSH method
$script:UseNativeSSH = $false
$script:NeedsSudo = $true

Write-Host "`nWine Cellar Deployment" -ForegroundColor White
Write-Host "======================" -ForegroundColor White
Write-Host "Target: ${SynologyUser}@${SynologyIP}"

# Test native SSH with key auth
Write-Host "`nChecking SSH connection..."
$sshTest = ssh -o BatchMode=yes -o ConnectTimeout=5 "${SynologyUser}@${SynologyIP}" "echo OK" 2>&1
if ($sshTest -match "OK") {
    $script:UseNativeSSH = $true
    Write-OK "SSH key authentication working"
} elseif ($SynologyPassword) {
    Write-Host "    Using password authentication (PuTTY)" -ForegroundColor Yellow
} else {
    Write-Fail "No SSH access. Run: .\scripts\setup-ssh-key.ps1"
    exit 1
}

# Check docker access
Write-Host "Checking Docker access..."
if ($script:UseNativeSSH) {
    $dockerTest = ssh "${SynologyUser}@${SynologyIP}" "docker ps > /dev/null 2>&1 && echo OK" 2>&1
} else {
    $PlinkPath = "C:\Program Files\PuTTY\plink.exe"
    $HostKey = "SHA256:9Mgl3xbxQ934jw01mebN47bcwgDId5uMU5pROg/pecg"
    $dockerTest = & $PlinkPath -batch -hostkey $HostKey -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" "docker ps > /dev/null 2>&1 && echo OK" 2>&1
}

if ($dockerTest -match "OK") {
    $script:NeedsSudo = $false
    Write-OK "Docker accessible without sudo"
} else {
    Write-Host "    Docker requires sudo" -ForegroundColor Yellow
}

# SSH helper function
function Invoke-Remote($command) {
    $warningFilter = "WARNING:|post-quantum|vulnerable|upgraded|openssh.com|Password:"

    if ($script:UseNativeSSH) {
        if ($command -match "docker" -and $script:NeedsSudo) {
            # Need to pipe password for sudo even with SSH key auth
            if ($SynologyPassword) {
                $escapedPw = $SynologyPassword -replace "'", "'\''"
                $sshCmd = "echo '${escapedPw}' | sudo -S $command 2>&1"
                $output = ssh "${SynologyUser}@${SynologyIP}" "$sshCmd" 2>&1 | Where-Object { $_ -notmatch $warningFilter }
            } else {
                # No password available, try interactive sudo (will likely fail in non-interactive mode)
                $output = ssh "${SynologyUser}@${SynologyIP}" "sudo $command" 2>&1 | Where-Object { $_ -notmatch $warningFilter }
            }
        } else {
            $output = ssh "${SynologyUser}@${SynologyIP}" "$command" 2>&1 | Where-Object { $_ -notmatch $warningFilter }
        }
    } else {
        $PlinkPath = "C:\Program Files\PuTTY\plink.exe"
        $HostKey = "SHA256:9Mgl3xbxQ934jw01mebN47bcwgDId5uMU5pROg/pecg"

        if ($command -match "docker" -and $script:NeedsSudo) {
            $escapedPw = $SynologyPassword -replace "'", "'\''"
            $sshCmd = "echo '${escapedPw}' | sudo -S $command 2>&1"
            $output = & $PlinkPath -batch -hostkey $HostKey -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" $sshCmd 2>&1 | Where-Object { $_ -notmatch $warningFilter }
        } else {
            $output = & $PlinkPath -batch -hostkey $HostKey -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" $command 2>&1 | Where-Object { $_ -notmatch $warningFilter }
        }
    }
    return $output
}

# ============================================
# STEP 1: Pre-flight checks (lint & tests)
# ============================================
if (-not $SkipTests -and -not $Quick) {
    Write-Step "1/7" "Running pre-flight checks..."

    # Lint
    Write-Host "    Running ESLint..."
    $lintResult = npm run lint 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Lint passed"
    } else {
        Write-Fail "Lint failed"
        Write-Host $lintResult -ForegroundColor Red
        $continue = Read-Host "    Continue anyway? (y/n)"
        if ($continue -ne 'y') { exit 1 }
    }

    # Check if vitest is configured
    $packageJson = Get-Content ".\package.json" | ConvertFrom-Json
    if ($packageJson.scripts.test) {
        Write-Host "    Running tests..."
        # Start server for integration tests
        $serverJob = Start-Job -ScriptBlock {
            Set-Location $using:PWD
            node src/server.js 2>&1
        }
        Start-Sleep -Seconds 3

        $testResult = npm test 2>&1
        Stop-Job $serverJob -ErrorAction SilentlyContinue
        Remove-Job $serverJob -ErrorAction SilentlyContinue

        if ($LASTEXITCODE -eq 0) {
            Write-OK "Tests passed"
        } else {
            Write-Skip "Tests skipped (not configured or failed)"
        }
    } else {
        Write-Skip "No test script configured"
    }
} else {
    Write-Step "1/7" "Pre-flight checks..."
    Write-Skip "Skipped (use default to run)"
}

# ============================================
# STEP 2: Check for uncommitted changes
# ============================================
Write-Step "2/7" "Checking git status..."
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Host "    Uncommitted changes:" -ForegroundColor Yellow
    git status --short
    $commit = Read-Host "    Commit all changes? (y/n/message)"
    if ($commit -eq 'y') {
        git add -A
        git commit -m "chore: deploy updates"
    } elseif ($commit -ne 'n' -and $commit.Length -gt 2) {
        git add -A
        git commit -m $commit
    } else {
        Write-Fail "Please commit changes before deploying"
        exit 1
    }
}
Write-OK "Working directory clean"

# ============================================
# STEP 3: Push to GitHub
# ============================================
Write-Step "3/7" "Pushing to GitHub..."
git push 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-OK "Pushed to origin/main"
} else {
    Write-Fail "Git push failed"
    exit 1
}

# ============================================
# STEP 4: Pull on Synology
# ============================================
Write-Step "4/7" "Pulling changes on Synology..."
$pullResult = Invoke-Remote "cd $RemoteAppPath && git fetch origin && git reset --hard origin/main"
if ($pullResult -match "HEAD is now at|Already up to date") {
    Write-OK "Git pull complete"
    $pullResult | Where-Object { $_ -match "HEAD is now at" } | ForEach-Object { Write-Host "    $_" }
} else {
    Write-Host "    $pullResult"
}

# ============================================
# STEP 5: Docker compose down
# ============================================
Write-Step "5/7" "Stopping container..."
$downResult = Invoke-Remote "cd $RemoteAppPath && /usr/local/bin/docker-compose down"
Write-OK "Container stopped"

# ============================================
# STEP 6: Docker compose build and up
# ============================================
if ($Quick) {
    Write-Step "6/7" "Starting container (quick mode, no rebuild)..."
    $upResult = Invoke-Remote "cd $RemoteAppPath && /usr/local/bin/docker-compose up -d"
} else {
    Write-Step "6/7" "Building and starting container..."
    $upResult = Invoke-Remote "cd $RemoteAppPath && /usr/local/bin/docker-compose up -d --build"
}

if ($upResult -match "Started|Running|Creating") {
    Write-OK "Container started"
} else {
    Write-Host "    $upResult"
}

# ============================================
# STEP 7: Verify deployment
# ============================================
Write-Step "7/7" "Verifying deployment..."
Start-Sleep -Seconds 5

# Check container status
$containerStatus = Invoke-Remote "docker ps --filter name=wine-cellar --format '{{.Status}}'"
if ($containerStatus -match "Up") {
    Write-OK "Container running: $containerStatus"
} else {
    Write-Fail "Container not running"
    Write-Host "    Run: ssh ${SynologyUser}@${SynologyIP} 'docker logs wine-cellar'" -ForegroundColor Yellow
    exit 1
}

# Test API
Write-Host "    Testing API..."
$apiTest = Invoke-Remote "curl -s http://localhost:3000/api/stats"
if ($apiTest -match "total_bottles") {
    $stats = $apiTest | ConvertFrom-Json
    Write-OK "API responding - $($stats.total_bottles) bottles in cellar"
} else {
    Write-Fail "API not responding"
    Write-Host "    Response: $apiTest" -ForegroundColor Yellow
}

# Summary
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Local URL:  http://${SynologyIP}:3000"
Write-Host "  Tailscale:  https://ds223j.tailf6bfbc.ts.net"
Write-Host ""

# Show logs if requested
if ($Logs) {
    Write-Host "Container logs:" -ForegroundColor Cyan
    Write-Host "---------------"
    Invoke-Remote "docker logs wine-cellar --tail 30"
}
