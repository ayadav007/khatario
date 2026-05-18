# PowerShell script to install mkcert on Windows
# Run this script as Administrator: Right-click PowerShell -> Run as Administrator

Write-Host "Installing mkcert for Windows..." -ForegroundColor Green

# Create a temp directory
$tempDir = "$env:TEMP\mkcert-install"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

# Download mkcert
Write-Host "Downloading mkcert..." -ForegroundColor Yellow
$mkcertUrl = "https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-windows-amd64.exe"
$mkcertPath = "$tempDir\mkcert.exe"

try {
    Invoke-WebRequest -Uri $mkcertUrl -OutFile $mkcertPath -UseBasicParsing
    Write-Host "[OK] Downloaded mkcert" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Failed to download mkcert: $_" -ForegroundColor Red
    exit 1
}

# Copy to a location in PATH (or create a local bin folder)
$binDir = "$env:USERPROFILE\bin"
if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir | Out-Null
}

$targetPath = "$binDir\mkcert.exe"
Copy-Item $mkcertPath -Destination $targetPath -Force
Write-Host "[OK] Installed mkcert to $targetPath" -ForegroundColor Green

# Add to PATH if not already there
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$binDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$binDir", "User")
    Write-Host "[OK] Added $binDir to PATH" -ForegroundColor Green
    Write-Host "  You may need to restart your terminal for PATH changes to take effect" -ForegroundColor Yellow
}

# Install the local CA
Write-Host ""
Write-Host "Installing local CA (this may require administrator privileges)..." -ForegroundColor Yellow
try {
    & $targetPath -install
    Write-Host "[OK] Local CA installed successfully!" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Failed to install local CA. You may need to run this script as Administrator." -ForegroundColor Red
    Write-Host "  Or run manually: mkcert -install" -ForegroundColor Yellow
}

# Cleanup
Remove-Item $tempDir -Recurse -Force

Write-Host ""
Write-Host "[OK] mkcert installation complete!" -ForegroundColor Green
Write-Host "  Run: npm run setup:https" -ForegroundColor Cyan
