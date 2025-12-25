# Wine Cellar Database Sync Script
# Usage: .\scripts\sync-db.ps1 -Download    # Download from Synology to local
# Usage: .\scripts\sync-db.ps1 -Upload      # Upload from local to Synology (stops container)

param(
    [switch]$Download,
    [switch]$Upload,
    [string]$SynologyIP = "192.168.86.31",
    [string]$SynologyUser = "lstrydom"
)

# Continue on stderr warnings (SSH post-quantum warnings are noisy but harmless)
$ErrorActionPreference = "Continue"

$LocalDB = ".\data\cellar.db"
$RemoteAppPath = "Apps/wine-cellar-app"
$TempFile = "cellar.db"

function Write-Status($message) {
    Write-Host "`n[$((Get-Date).ToString('HH:mm:ss'))] $message" -ForegroundColor Cyan
}

function Write-Success($message) {
    Write-Host "  OK: $message" -ForegroundColor Green
}

function Write-Warning($message) {
    Write-Host "  WARNING: $message" -ForegroundColor Yellow
}

if (-not $Download -and -not $Upload) {
    Write-Host @"

Wine Cellar Database Sync
=========================

Usage:
  .\scripts\sync-db.ps1 -Download    Download production DB to local
  .\scripts\sync-db.ps1 -Upload      Upload local DB to production (CAUTION!)

Options:
  -SynologyIP <ip>      Synology IP address (default: 192.168.86.31)
  -SynologyUser <user>  SSH username (default: lstrydom)

"@
    exit 0
}

if ($Download) {
    Write-Status "Downloading database from Synology..."

    # Step 0: Remove local WAL files to ensure clean state
    Write-Host "  Removing local WAL files..."
    Remove-Item ".\data\cellar.db-wal" -ErrorAction SilentlyContinue
    Remove-Item ".\data\cellar.db-shm" -ErrorAction SilentlyContinue

    # Step 1: Checkpoint WAL on Synology to ensure all data is in main DB file
    Write-Host "  Checkpointing remote database..."
    ssh "${SynologyUser}@${SynologyIP}" "sqlite3 ~/${RemoteAppPath}/data/cellar.db 'PRAGMA wal_checkpoint(TRUNCATE);'" 2>&1 | Out-Null

    # Step 2: Copy to home directory on Synology (avoids SFTP path issues)
    Write-Host "  Copying database to Synology home directory..."
    ssh "${SynologyUser}@${SynologyIP}" "cp ~/${RemoteAppPath}/data/cellar.db ~/${TempFile}"

    # Step 3: Download via SFTP (Synology SFTP is chrooted, so path is /home/)
    Write-Host "  Downloading to local via SFTP..."
    # Use Write-Output to pipe commands to sftp (preserves SSH agent)
    @("get /home/${TempFile} ${LocalDB}", "exit") | sftp "${SynologyUser}@${SynologyIP}" 2>&1 | Out-Null

    # Step 4: Cleanup temp file on Synology
    Write-Host "  Cleaning up..."
    ssh "${SynologyUser}@${SynologyIP}" "rm ~/${TempFile}" 2>&1 | Out-Null

    if (Test-Path $LocalDB) {
        Write-Success "Database downloaded to $LocalDB"
        Write-Host "`n  File size: $([math]::Round((Get-Item $LocalDB).Length / 1MB, 2)) MB"
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
    ssh "${SynologyUser}@${SynologyIP}" "cd ~/${RemoteAppPath} && sudo docker compose down" 2>&1 | Out-Null

    # Step 2: Backup existing database
    Write-Host "  Creating backup..."
    $backupName = "cellar.db.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    ssh "${SynologyUser}@${SynologyIP}" "cp ~/${RemoteAppPath}/data/cellar.db ~/${RemoteAppPath}/data/${backupName}" 2>&1 | Out-Null

    # Step 3: Upload via SFTP to home directory (Synology SFTP is chrooted)
    Write-Host "  Uploading via SFTP..."
    # Use Write-Output to pipe commands to sftp (preserves SSH agent)
    @("put ${LocalDB} /home/${TempFile}", "exit") | sftp "${SynologyUser}@${SynologyIP}" 2>&1 | Out-Null

    # Step 4: Move to app data directory
    Write-Host "  Moving to app directory..."
    ssh "${SynologyUser}@${SynologyIP}" "mv ~/${TempFile} ~/${RemoteAppPath}/data/cellar.db" 2>&1 | Out-Null

    # Step 5: Restart container
    Write-Host "  Restarting container..."
    ssh "${SynologyUser}@${SynologyIP}" "cd ~/${RemoteAppPath} && sudo docker compose up -d" 2>&1 | Out-Null

    Write-Success "Database uploaded!"
    Write-Host "`n  Backup saved as: $backupName"
}

Write-Host ""
