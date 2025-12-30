# Wine Cellar Database Sync Script
# Usage: .\scripts\sync-db.ps1 -Download    # Download from Synology to local
# Usage: .\scripts\sync-db.ps1 -Upload      # Upload from local to Synology (stops container)

param(
    [switch]$Download,
    [switch]$Upload
)

# Continue on stderr warnings (SSH post-quantum warnings are noisy but harmless)
$ErrorActionPreference = "Continue"

$LocalDB = ".\data\cellar.db"
$RemoteAppPath = "Apps/wine-cellar-app"
$TempFile = "cellar.db"

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

function Write-Status($message) {
    Write-Host "`n[$((Get-Date).ToString('HH:mm:ss'))] $message" -ForegroundColor Cyan
}

function Write-Success($message) {
    Write-Host "  OK: $message" -ForegroundColor Green
}

function Write-Warning($message) {
    Write-Host "  WARNING: $message" -ForegroundColor Yellow
}

function Invoke-SSH($command) {
    # Use plink (PuTTY) if available with password
    $plink = Get-Command plink -ErrorAction SilentlyContinue
    if ($plink -and $SynologyPassword) {
        $output = plink -batch -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" $command 2>&1 | Where-Object { $_ -notmatch "WARNING:|post-quantum|Store key" }
        return $output
    }

    # Fall back to native SSH (requires key auth or manual password)
    $output = ssh "${SynologyUser}@${SynologyIP}" $command 2>&1 | Where-Object { $_ -notmatch "WARNING:|post-quantum" }
    return $output
}

function Invoke-SFTP-Get($remotePath, $localPath) {
    # Use psftp (PuTTY SFTP) if available
    $psftp = Get-Command psftp -ErrorAction SilentlyContinue
    if ($psftp -and $SynologyPassword) {
        $batchFile = [System.IO.Path]::GetTempFileName()
        "get `"$remotePath`" `"$localPath`"" | Set-Content $batchFile
        "quit" | Add-Content $batchFile
        psftp -batch -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" -b $batchFile 2>&1 | Out-Null
        Remove-Item $batchFile
        return
    }

    # Fall back to native sftp
    @("get $remotePath $localPath", "exit") | sftp "${SynologyUser}@${SynologyIP}" 2>&1 | Out-Null
}

function Invoke-SFTP-Put($localPath, $remotePath) {
    # Use psftp (PuTTY SFTP) if available
    $psftp = Get-Command psftp -ErrorAction SilentlyContinue
    if ($psftp -and $SynologyPassword) {
        $batchFile = [System.IO.Path]::GetTempFileName()
        "put `"$localPath`" `"$remotePath`"" | Set-Content $batchFile
        "quit" | Add-Content $batchFile
        psftp -batch -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" -b $batchFile 2>&1 | Out-Null
        Remove-Item $batchFile
        return
    }

    # Fall back to native sftp
    @("put $localPath $remotePath", "exit") | sftp "${SynologyUser}@${SynologyIP}" 2>&1 | Out-Null
}

if (-not $Download -and -not $Upload) {
    Write-Host @"

Wine Cellar Database Sync
=========================
Target: ${SynologyUser}@${SynologyIP}

Usage:
  .\scripts\sync-db.ps1 -Download    Download production DB to local
  .\scripts\sync-db.ps1 -Upload      Upload local DB to production (CAUTION!)

Credentials loaded from .env file (SYNOLOGY_USER, SYNOLOGY_IP, SYNOLOGY_PASSWORD)

"@
    exit 0
}

# Check for plink/psftp
$hasPlink = Get-Command plink -ErrorAction SilentlyContinue
if (-not $hasPlink -and -not $SynologyPassword) {
    Write-Warning "plink not found and no SYNOLOGY_PASSWORD in .env. SSH key auth required."
}

if ($Download) {
    Write-Status "Downloading database from Synology Docker container..."

    # Step 0: Remove local WAL files to ensure clean state
    Write-Host "  Removing local WAL files..."
    Remove-Item ".\data\cellar.db-wal" -ErrorAction SilentlyContinue
    Remove-Item ".\data\cellar.db-shm" -ErrorAction SilentlyContinue

    # Step 1: Copy from Docker container to home directory on Synology
    # This also checkpoints the WAL since docker cp reads a consistent snapshot
    Write-Host "  Copying database from container to Synology home..."
    Invoke-SSH "bash -lc 'docker cp wine-cellar:/app/data/cellar.db ~/${TempFile}'"

    # Step 2: Download via SSH cat (more reliable than SFTP on Synology)
    Write-Host "  Downloading to local via SSH..."
    ssh "${SynologyUser}@${SynologyIP}" "cat ~/${TempFile}" 2>$null > $LocalDB

    # Step 3: Cleanup temp file on Synology
    Write-Host "  Cleaning up..."
    Invoke-SSH "rm ~/${TempFile}"

    if (Test-Path $LocalDB) {
        $fileSize = (Get-Item $LocalDB).Length
        if ($fileSize -gt 0) {
            Write-Success "Database downloaded to $LocalDB"
            Write-Host "`n  File size: $([math]::Round($fileSize / 1MB, 2)) MB"
        } else {
            Write-Host "  ERROR: Downloaded file is empty" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "  ERROR: Download failed" -ForegroundColor Red
        exit 1
    }
}

if ($Upload) {
    Write-Warning "This will OVERWRITE the production database!"
    $confirm = Read-Host "  Type 'yes' to continue"

    if ($confirm -ne 'yes') {
        Write-Host "  Cancelled." -ForegroundColor Red
        exit 1
    }

    Write-Status "Uploading database to Synology..."

    # Step 1: Stop the container
    Write-Host "  Stopping container..."
    Invoke-SSH "cd ~/${RemoteAppPath} && sudo docker compose down"

    # Step 2: Backup existing database
    Write-Host "  Creating backup..."
    $backupName = "cellar.db.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Invoke-SSH "cp ~/${RemoteAppPath}/data/cellar.db ~/${RemoteAppPath}/data/${backupName}"

    # Step 3: Upload via SFTP to home directory (Synology SFTP is chrooted)
    Write-Host "  Uploading via SFTP..."
    Invoke-SFTP-Put $LocalDB "/home/${TempFile}"

    # Step 4: Move to app data directory
    Write-Host "  Moving to app directory..."
    Invoke-SSH "mv ~/${TempFile} ~/${RemoteAppPath}/data/cellar.db"

    # Step 5: Restart container
    Write-Host "  Restarting container..."
    Invoke-SSH "cd ~/${RemoteAppPath} && sudo docker compose up -d"

    Write-Success "Database uploaded!"
    Write-Host "`n  Backup saved as: $backupName"
}

Write-Host ""
