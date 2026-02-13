# Build SF Org Describe for distribution
# Creates installers for Mac and/or Windows

param(
    [switch]$Mac,
    [switch]$Win,
    [switch]$All,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

# Unset the environment variable that causes issues with electron-builder
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

function Show-Help {
    Write-Host "Usage: .\build.ps1 [OPTIONS]"
    Write-Host ""
    Write-Host "Build SF Org Describe for distribution"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Mac        Build for macOS (DMG + ZIP)"
    Write-Host "  -Win        Build for Windows (NSIS installer + Portable)"
    Write-Host "  -All        Build for all platforms"
    Write-Host "  -Help       Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  .\build.ps1 -Mac           # Build Mac version only"
    Write-Host "  .\build.ps1 -Win           # Build Windows version only"
    Write-Host "  .\build.ps1 -All           # Build for all platforms"
    Write-Host ""
    Write-Host "Output will be in the 'dist' folder"
}

if ($Help -or (-not $Mac -and -not $Win -and -not $All)) {
    Show-Help
    exit 0
}

# Ensure dependencies are installed
Write-Host "Checking dependencies..."
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..."
    npm install
}

# Build based on arguments
if ($All -or ($Mac -and $Win)) {
    Write-Host "Building for all platforms..."
    npx electron-builder --mac --win
} elseif ($Mac) {
    Write-Host "Building for macOS..."
    npx electron-builder --mac
} elseif ($Win) {
    Write-Host "Building for Windows..."
    npx electron-builder --win
}

Write-Host ""
Write-Host "Build complete! Output files are in the 'dist' folder:"
if (Test-Path "dist") {
    Get-ChildItem dist
} else {
    Write-Host "(dist folder will be created after build)"
}
