# Wine Cellar Deployment Script
# Usage: .\scripts\deploy.ps1              # Full deploy (push, wait for build, deploy to Synology)
# Usage: .\scripts\deploy.ps1 -SkipPush    # Deploy without pushing (use existing image)
# Usage: .\scripts\deploy.ps1 -UpdateConfig # Only update docker-compose and .env on Synology
# Usage: .\scripts\deploy.ps1 -Clean       # Full clean deploy (prune all unused images)
#
# SYNOLOGY SETUP (recommended for best experience):
# 1. Set up SSH key auth: Run .\scripts\setup-ssh-key.ps1
# 2. Add user to docker group via DSM: Control Panel → User & Group → docker group
# Then you won't need sudo in scripts.

param(
    [switch]$SkipPush,
    [switch]$UpdateConfig,
    [switch]$Clean
)

$ErrorActionPreference = "Continue"
$RemoteAppPath = "Apps/wine-cellar-app"

# Load credentials from .env file
$envFile = ".\.env"
$SynologyUser = "lstrydom"
$SynologyIP = "192.168.86.31"
$SynologyPassword = $null

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^SYNOLOGY_USER=(.+)$") { $SynologyUser = $matches[1] }
        if ($_ -match "^SYNOLOGY_IP=(.+)$") { $SynologyIP = $matches[1] }
        if ($_ -match "^SYNOLOGY_PASSWORD=(.+)$") { $SynologyPassword = $matches[1] }
    }
}

# Synology host key fingerprint (prevents interactive prompt with plink)
$SynologyHostKey = "SHA256:9Mgl3xbxQ934jw01mebN47bcwgDId5uMU5pROg/pecg"

# Check for SSH key auth (preferred) or password auth (fallback)
$script:UseNativeSSH = $false

# Test if native SSH with key auth works
$sshTest = ssh -o BatchMode=yes -o ConnectTimeout=5 "${SynologyUser}@${SynologyIP}" "echo OK" 2>&1
if ($sshTest -match "OK") {
    $script:UseNativeSSH = $true
}

if (-not $script:UseNativeSSH -and -not $SynologyPassword) {
    Write-Host "ERROR: SSH key auth not set up and SYNOLOGY_PASSWORD not found in .env file" -ForegroundColor Red
    Write-Host "  Run: .\scripts\setup-ssh-key.ps1 to set up SSH key auth" -ForegroundColor Yellow
    Write-Host "  Or add SYNOLOGY_PASSWORD to .env file" -ForegroundColor Yellow
    exit 1
}

# Find PuTTY tools (only needed if not using native SSH)
$PlinkPath = $null
$PsftpPath = $null

if (-not $script:UseNativeSSH) {
    $plinkInPath = Get-Command plink -ErrorAction SilentlyContinue
    $psftpInPath = Get-Command psftp -ErrorAction SilentlyContinue

    if ($plinkInPath) { $PlinkPath = $plinkInPath.Source }
    if ($psftpInPath) { $PsftpPath = $psftpInPath.Source }

    if (-not $PlinkPath) {
        $commonPaths = @(
            "C:\Program Files\PuTTY\plink.exe",
            "C:\Program Files (x86)\PuTTY\plink.exe",
            "$env:LOCALAPPDATA\Programs\PuTTY\plink.exe"
        )
        foreach ($path in $commonPaths) {
            if (Test-Path $path) { $PlinkPath = $path; break }
        }
    }

    if (-not $PsftpPath) {
        $commonPaths = @(
            "C:\Program Files\PuTTY\psftp.exe",
            "C:\Program Files (x86)\PuTTY\psftp.exe",
            "$env:LOCALAPPDATA\Programs\PuTTY\psftp.exe"
        )
        foreach ($path in $commonPaths) {
            if (Test-Path $path) { $PsftpPath = $path; break }
        }
    }
}

function Write-Status($message) {
    Write-Host "`n[$((Get-Date).ToString('HH:mm:ss'))] $message" -ForegroundColor Cyan
}

function Write-Success($message) {
    Write-Host "  OK: $message" -ForegroundColor Green
}

function Write-Warning($message) {
    Write-Host "  WARNING: $message" -ForegroundColor Yellow
}

# Check if user has docker access without sudo
$script:NeedsSudo = $true

function Test-DockerAccess {
    # Use bash -l to get login shell with proper PATH (includes /usr/local/bin)
    $warningFilter = "WARNING:|post-quantum|vulnerable|upgraded|openssh.com"
    if ($script:UseNativeSSH) {
        $result = ssh "${SynologyUser}@${SynologyIP}" "bash -lc 'docker ps > /dev/null 2>&1 && echo OK'" 2>&1 | Where-Object { $_ -notmatch $warningFilter }
    } elseif ($PlinkPath) {
        $result = & $PlinkPath -batch -hostkey $SynologyHostKey -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" "bash -lc 'docker ps > /dev/null 2>&1 && echo OK'" 2>&1 | Where-Object { $_ -notmatch $warningFilter }
    } else {
        return $false
    }
    if ($result -match "OK") {
        $script:NeedsSudo = $false
        return $true
    }
    return $false
}

function Invoke-SSH($command) {
    # Always use bash -l to get login shell with proper PATH (includes /usr/local/bin for docker)
    # Filter out SSH post-quantum warnings that are harmless but noisy
    $warningFilter = "WARNING:|post-quantum|vulnerable|upgraded|openssh.com"

    if ($script:UseNativeSSH) {
        # Use native SSH with key auth (preferred)
        if ($command -match "docker" -and $script:NeedsSudo) {
            # Need sudo - user must enter password interactively or be in docker group
            $output = ssh "${SynologyUser}@${SynologyIP}" "sudo bash -lc '$command'" 2>&1 | Where-Object { $_ -notmatch $warningFilter }
        } else {
            $output = ssh "${SynologyUser}@${SynologyIP}" "bash -lc '$command'" 2>&1 | Where-Object { $_ -notmatch $warningFilter }
        }
        return $output
    }

    # Fallback to plink with password
    if ($command -match "docker" -and $script:NeedsSudo) {
        # Need sudo for docker commands - use heredoc approach for complex commands
        # Write password to sudo's stdin, use bash -l for PATH
        $escapedPw = $SynologyPassword -replace "'", "'\''"
        $escapedCmd = $command -replace "'", "'\''"
        $sshCmd = "echo '${escapedPw}' | sudo -S bash -lc '${escapedCmd}' 2>&1"
        $output = & $PlinkPath -batch -hostkey $SynologyHostKey -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" $sshCmd 2>&1 | Where-Object { $_ -notmatch "$warningFilter|Store key|\[sudo\]|Password:" }
    } else {
        $output = & $PlinkPath -batch -hostkey $SynologyHostKey -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" "bash -lc '$command'" 2>&1 | Where-Object { $_ -notmatch "$warningFilter|Store key" }
    }
    return $output
}

function Invoke-SFTP($localFile, $remotePath) {
    if ($script:UseNativeSSH) {
        # Use native sftp with key auth
        @("put $localFile $remotePath", "exit") | sftp "${SynologyUser}@${SynologyIP}" 2>&1 | Out-Null
        return
    }
    if ($PsftpPath) {
        $batchFile = [System.IO.Path]::GetTempFileName()
        "put `"$localFile`" `"$remotePath`"" | Set-Content $batchFile
        "quit" | Add-Content $batchFile
        & $PsftpPath -batch -hostkey $SynologyHostKey -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" -b $batchFile 2>&1 | Out-Null
        Remove-Item $batchFile
        return
    }
    @("put $localFile $remotePath", "exit") | sftp "${SynologyUser}@${SynologyIP}" 2>&1 | Out-Null
}

Write-Host @"

Wine Cellar Deployment
======================
Target: ${SynologyUser}@${SynologyIP}

"@

if ($script:UseNativeSSH) {
    Write-Host "  Using: Native SSH with key authentication"
} elseif ($PlinkPath -and $PsftpPath) {
    Write-Host "  Using: PuTTY tools with password authentication"
    Write-Host "  plink: $PlinkPath"
    Write-Host "  psftp: $PsftpPath"
} else {
    Write-Warning "PuTTY tools not found and SSH key auth not set up."
    Write-Host "  Run: .\scripts\setup-ssh-key.ps1 to set up SSH key auth" -ForegroundColor Yellow
    Write-Host "  Or: winget install PuTTY.PuTTY for password auth" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# Verify SSH connection (already done during UseNativeSSH check, but verify for plink path)
if (-not $script:UseNativeSSH) {
    Write-Host "  Verifying SSH connection..."
    $testOutput = & $PlinkPath -batch -hostkey $SynologyHostKey -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" "echo connected" 2>&1
    if ($testOutput -match "connected") {
        Write-Success "SSH connection verified"
    } else {
        Write-Host "  ERROR: SSH connection failed: $testOutput" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Success "SSH key authentication verified"
}

# Check docker access
Write-Host "  Checking docker access..."
if (Test-DockerAccess) {
    Write-Success "Docker accessible without sudo"
} else {
    Write-Warning "Docker requires sudo (add user to docker group for passwordless access)"
}

# UpdateConfig mode
if ($UpdateConfig) {
    Write-Status "Updating configuration on Synology..."

    Write-Host "  Uploading docker-compose.yml..."
    Invoke-SFTP ".\docker-compose.synology.yml" "/home/${RemoteAppPath}/docker-compose.yml"

    Write-Host "  Creating .env file on Synology..."
    $envContent = @()
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^(ANTHROPIC_|GOOGLE_|BRIGHTDATA_)") { $envContent += $_ }
    }
    $tempEnv = [System.IO.Path]::GetTempFileName()
    $envContent | Set-Content $tempEnv
    Invoke-SFTP $tempEnv "/home/${RemoteAppPath}/.env"
    Remove-Item $tempEnv

    Write-Success "Configuration updated!"

    Write-Host "  Restarting container..."
    Invoke-SSH "cd ~/${RemoteAppPath} && docker compose down && docker compose up -d"

    Write-Success "Container restarted with new configuration"
    Write-Host "`n  URL: http://${SynologyIP}:3000"
    exit 0
}

# Git push (unless skipped)
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

    $maxWait = 180
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
        Write-Warning "Build taking too long. Check GitHub Actions manually."
    }
}

# Deploy to Synology
Write-Status "Deploying to Synology..."

Write-Host "  Stopping container..."
Invoke-SSH "cd ~/${RemoteAppPath} && docker compose down"

Write-Host "  Removing old image..."
Invoke-SSH "docker rmi ghcr.io/lbstrydom/wine-cellar-app:latest 2>/dev/null || true"

if ($Clean) {
    Write-Host "  Pruning unused Docker images..."
    Invoke-SSH "docker image prune -af"
    Write-Host "  Pruning unused Docker volumes..."
    Invoke-SSH "docker volume prune -f"
}

Write-Host "  Uploading docker-compose.yml..."
Invoke-SFTP ".\docker-compose.synology.yml" "/home/${RemoteAppPath}/docker-compose.yml"

Write-Host "  Syncing .env file..."
$envContent = @()
Get-Content $envFile | ForEach-Object {
    if ($_ -match "^(ANTHROPIC_|GOOGLE_|BRIGHTDATA_)") { $envContent += $_ }
}
$tempEnv = [System.IO.Path]::GetTempFileName()
$envContent | Set-Content $tempEnv
Invoke-SFTP $tempEnv "/home/${RemoteAppPath}/.env"
Remove-Item $tempEnv

Write-Host "  Pulling new image..."
Invoke-SSH "cd ~/${RemoteAppPath} && docker compose pull"

Write-Host "  Starting container..."
Invoke-SSH "cd ~/${RemoteAppPath} && docker compose up -d"

# Verify
Write-Status "Verifying deployment..."
Start-Sleep -Seconds 5

$containerStatus = Invoke-SSH "docker ps --filter name=wine-cellar --format '{{.Status}}'"

if ($containerStatus -match "Up") {
    Write-Success "Container is running!"
    Write-Host "`n  Status: $containerStatus"
    Write-Host "  URL: http://${SynologyIP}:3000"
} else {
    Write-Warning "Container may not be running correctly. Check logs:"
    Write-Host "    ssh ${SynologyUser}@${SynologyIP}"
    Write-Host "    docker logs wine-cellar"
}

Write-Host ""
