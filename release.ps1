# SF Org Describe - Beta Release Script
# Creates and uploads beta releases to GitHub

$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

# Remove old dist
if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }

Write-Host "========================================" -ForegroundColor Green
Write-Host "  SF Org Describe - Beta Release" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# Check if gh CLI is installed
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "Error: GitHub CLI (gh) is not installed." -ForegroundColor Red
    Write-Host "Install it from: https://cli.github.com/"
    exit 1
}

# Check if logged in to GitHub
gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Not logged in to GitHub CLI." -ForegroundColor Red
    Write-Host "Run: gh auth login"
    exit 1
}

# Get version from package.json
$VERSION = node -p "require('./package.json').version"
$BETA_VERSION = "${VERSION}-beta"

Write-Host ""
Write-Host "Current version: $VERSION" -ForegroundColor Yellow
Write-Host "Beta tag: v$BETA_VERSION" -ForegroundColor Yellow
Write-Host ""

# Ask for confirmation
$confirm = Read-Host "Do you want to create a beta release v${BETA_VERSION}? (y/N)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "Aborted."
    exit 0
}

# Install dependencies if needed
if (-not (Test-Path "node_modules")) {
    Write-Host ""
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
}

# Clean previous builds
Write-Host ""
Write-Host "Cleaning previous builds..." -ForegroundColor Yellow
if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }

# Build for all platforms
Write-Host ""
Write-Host "Building for macOS (x64 and arm64)..." -ForegroundColor Yellow
npm run dist:mac

Write-Host ""
Write-Host "Building for Windows (x64)..." -ForegroundColor Yellow
npm run dist:win

# List built artifacts
Write-Host ""
Write-Host "Built artifacts:" -ForegroundColor Green
Get-ChildItem dist

# Find built files
$MAC_DMG_ARM = Get-ChildItem dist -Filter "*-arm64.dmg" -ErrorAction SilentlyContinue | Select-Object -First 1
$MAC_DMG_X64 = Get-ChildItem dist -Filter "*-x64.dmg" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $MAC_DMG_X64) {
    $MAC_DMG_X64 = Get-ChildItem dist -Filter "*-mac.dmg" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "arm64" } | Select-Object -First 1
}
$MAC_ZIP_ARM = Get-ChildItem dist -Filter "*arm64*.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
$MAC_ZIP_X64 = Get-ChildItem dist -Filter "*x64*.zip" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "arm64" } | Select-Object -First 1
$WIN_SETUP = Get-ChildItem dist -Filter "*Setup*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$WIN_PORTABLE = Get-ChildItem dist -Filter "*.exe" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "Setup" } | Select-Object -First 1

# Build list of files to upload
$releaseFiles = @()
if ($MAC_DMG_ARM) { $releaseFiles += $MAC_DMG_ARM.FullName }
if ($MAC_DMG_X64) { $releaseFiles += $MAC_DMG_X64.FullName }
if ($MAC_ZIP_ARM) { $releaseFiles += $MAC_ZIP_ARM.FullName }
if ($MAC_ZIP_X64) { $releaseFiles += $MAC_ZIP_X64.FullName }
if ($WIN_SETUP) { $releaseFiles += $WIN_SETUP.FullName }
if ($WIN_PORTABLE) { $releaseFiles += $WIN_PORTABLE.FullName }

Write-Host ""
Write-Host "Files to upload:" -ForegroundColor Yellow
$releaseFiles | ForEach-Object { Write-Host $_ }

# Create release notes
$releaseNotes = @"
## SF Org Describe v${BETA_VERSION} (Beta)

**This is a beta release for testing purposes.**

### Features
- OAuth Device Flow authentication (works with any Salesforce org)
- Excel export with full SObject metadata
- ERD generation with Mermaid diagrams
- Interactive ERD viewer with zoom, pan, and fullscreen
- Export diagrams as PNG, SVG, or PDF

### Downloads
- **macOS (Apple Silicon)**: Use the arm64 DMG or ZIP
- **macOS (Intel)**: Use the x64 DMG or ZIP
- **Windows**: Use the Setup installer or Portable exe

### Setup
1. Download the appropriate version for your platform
2. Create a Connected App in Salesforce with Device Flow enabled
3. Set your Client ID in a ``.env`` file or environment variable
4. See README for detailed instructions

### Feedback
Please report issues at: https://github.com/RJPalombo/sf-org-describe/issues
"@

# Create the release
Write-Host ""
Write-Host "Creating release on GitHub..." -ForegroundColor Yellow

$ghArgs = @(
    "release", "create", "v$BETA_VERSION",
    "--title", "v$BETA_VERSION (Beta)",
    "--notes", $releaseNotes,
    "--prerelease"
)
$ghArgs += $releaseFiles

& gh @ghArgs

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Beta release v$BETA_VERSION created!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "View at: https://github.com/RJPalombo/sf-org-describe/releases/tag/v$BETA_VERSION"
