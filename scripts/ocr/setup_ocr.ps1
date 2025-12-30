# Setup script for RolmOCR local PDF extraction
# Run this script to install Python dependencies

$ErrorActionPreference = "Stop"

Write-Host "=== RolmOCR Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check Python
Write-Host "Checking Python installation..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "  Found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Python not found!" -ForegroundColor Red
    Write-Host "  Please install Python 3.8+ from https://www.python.org/downloads/" -ForegroundColor Yellow
    exit 1
}

# Check pip
Write-Host "Checking pip..." -ForegroundColor Yellow
try {
    $pipVersion = python -m pip --version 2>&1
    Write-Host "  Found: $pipVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: pip not found!" -ForegroundColor Red
    exit 1
}

# Check for Poppler (required by pdf2image)
Write-Host "Checking Poppler installation..." -ForegroundColor Yellow
$popplerPath = Get-Command pdftoppm -ErrorAction SilentlyContinue
if ($popplerPath) {
    Write-Host "  Found: Poppler is installed" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Poppler not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Poppler is required for PDF to image conversion." -ForegroundColor Yellow
    Write-Host "  Install options:" -ForegroundColor Yellow
    Write-Host "    1. Using Chocolatey: choco install poppler" -ForegroundColor White
    Write-Host "    2. Manual download from: https://github.com/osborne/poppler/releases" -ForegroundColor White
    Write-Host "       Extract and add bin folder to PATH" -ForegroundColor White
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/n)"
    if ($continue -ne "y") {
        exit 1
    }
}

# Create virtual environment (optional but recommended)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPath = Join-Path $scriptDir "venv"

Write-Host ""
Write-Host "Setting up Python virtual environment..." -ForegroundColor Yellow

if (Test-Path $venvPath) {
    Write-Host "  Virtual environment already exists at: $venvPath" -ForegroundColor Green
} else {
    python -m venv $venvPath
    Write-Host "  Created virtual environment at: $venvPath" -ForegroundColor Green
}

# Activate and install dependencies
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Yellow

$activateScript = Join-Path $venvPath "Scripts\Activate.ps1"
. $activateScript

$requirementsPath = Join-Path $scriptDir "requirements.txt"
python -m pip install --upgrade pip
python -m pip install -r $requirementsPath

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "To use the OCR service:" -ForegroundColor Yellow
Write-Host "  1. Activate the virtual environment:" -ForegroundColor White
Write-Host "     . $activateScript" -ForegroundColor Gray
Write-Host "  2. Set PDF_OCR_METHOD=local in your .env file" -ForegroundColor White
Write-Host "  3. Restart the wine cellar app" -ForegroundColor White
Write-Host ""
Write-Host "Note: First run will download the RolmOCR model (~15GB)" -ForegroundColor Yellow
Write-Host "GPU with 8GB+ VRAM recommended for best performance" -ForegroundColor Yellow
