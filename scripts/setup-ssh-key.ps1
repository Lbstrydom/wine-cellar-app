# Setup SSH Key Authentication for Synology
# This copies your local SSH public key to the Synology authorized_keys

$ErrorActionPreference = "Continue"

# Load credentials from .env file
$envFile = ".\.env"
$SynologyUser = "lstrydom"
$SynologyIP = "192.168.86.31"
$SynologyPassword = $null
$SynologyHostKey = "SHA256:9Mgl3xbxQ934jw01mebN47bcwgDId5uMU5pROg/pecg"

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^SYNOLOGY_USER=(.+)$") { $SynologyUser = $matches[1] }
        if ($_ -match "^SYNOLOGY_IP=(.+)$") { $SynologyIP = $matches[1] }
        if ($_ -match "^SYNOLOGY_PASSWORD=(.+)$") { $SynologyPassword = $matches[1] }
    }
}

# Find plink
$PlinkPath = "C:\Program Files\PuTTY\plink.exe"
$PsftpPath = "C:\Program Files\PuTTY\psftp.exe"

if (-not (Test-Path $PlinkPath)) {
    Write-Host "ERROR: plink.exe not found at $PlinkPath" -ForegroundColor Red
    exit 1
}

# Read local public key
$pubKeyPath = "$env:USERPROFILE\.ssh\id_ed25519.pub"
if (-not (Test-Path $pubKeyPath)) {
    Write-Host "ERROR: Public key not found at $pubKeyPath" -ForegroundColor Red
    Write-Host "Run: ssh-keygen -t ed25519" -ForegroundColor Yellow
    exit 1
}

$pubKey = Get-Content $pubKeyPath -Raw
$pubKey = $pubKey.Trim()

Write-Host ""
Write-Host "SSH Key Setup for Synology" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host "Target: ${SynologyUser}@${SynologyIP}"
Write-Host "Public key: $pubKeyPath"
Write-Host ""

# Step 1: Create .ssh directory
Write-Host "Creating .ssh directory on Synology..."
& $PlinkPath -batch -hostkey $SynologyHostKey -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" "mkdir -p ~/.ssh && chmod 700 ~/.ssh" 2>&1 | Out-Null

# Step 2: Upload public key via temp file and SFTP
Write-Host "Uploading public key..."
$tempFile = [System.IO.Path]::GetTempFileName()
$pubKey | Set-Content $tempFile -NoNewline

$batchFile = [System.IO.Path]::GetTempFileName()
"put `"$tempFile`" `"/home/pubkey.tmp`"" | Set-Content $batchFile
"quit" | Add-Content $batchFile
& $PsftpPath -batch -hostkey $SynologyHostKey -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" -b $batchFile 2>&1 | Out-Null
Remove-Item $batchFile
Remove-Item $tempFile

# Step 3: Append to authorized_keys
Write-Host "Adding to authorized_keys..."
& $PlinkPath -batch -hostkey $SynologyHostKey -pw $SynologyPassword "${SynologyUser}@${SynologyIP}" "cat ~/pubkey.tmp >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && rm ~/pubkey.tmp" 2>&1 | Out-Null

# Step 4: Test SSH key auth
Write-Host ""
Write-Host "Testing SSH key authentication..."
$result = ssh -o BatchMode=yes -o ConnectTimeout=5 "${SynologyUser}@${SynologyIP}" "echo SUCCESS" 2>&1
if ($result -match "SUCCESS") {
    Write-Host "  OK: SSH key authentication is working!" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now remove SYNOLOGY_PASSWORD from .env if desired." -ForegroundColor Yellow
} else {
    Write-Host "  WARNING: SSH key auth test failed. Password auth still works." -ForegroundColor Yellow
    Write-Host "  Output: $result" -ForegroundColor Gray
}

Write-Host ""
