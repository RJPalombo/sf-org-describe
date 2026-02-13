@echo off
REM SF Org Describe - Beta Release Script
REM Creates and uploads beta releases to GitHub

setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ========================================
echo   SF Org Describe - Beta Release
echo ========================================

REM Check if gh CLI is installed
where gh >nul 2>nul
if errorlevel 1 (
    echo Error: GitHub CLI (gh) is not installed.
    echo Install it from: https://cli.github.com/
    exit /b 1
)

REM Check if logged in to GitHub
gh auth status >nul 2>nul
if errorlevel 1 (
    echo Error: Not logged in to GitHub CLI.
    echo Run: gh auth login
    exit /b 1
)

REM Get version from package.json
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
set BETA_VERSION=%VERSION%-beta

echo.
echo Current version: %VERSION%
echo Beta tag: v%BETA_VERSION%
echo.

REM Ask for confirmation
set /p CONFIRM="Do you want to create a beta release v%BETA_VERSION%? (y/N) "
if /i not "%CONFIRM%"=="y" (
    echo Aborted.
    exit /b 0
)

REM Install dependencies if needed
if not exist "node_modules" (
    echo.
    echo Installing dependencies...
    npm install
)

REM Clean previous builds
echo.
echo Cleaning previous builds...
if exist "dist" rmdir /s /q dist

REM Build for all platforms
echo.
echo Building for macOS (x64 and arm64)...
call npm run dist:mac

echo.
echo Building for Windows (x64)...
call npm run dist:win

REM List built artifacts
echo.
echo Built artifacts:
dir dist

REM Create GitHub release - find built files
set RELEASE_FILES=

for /f "delims=" %%f in ('dir /b /s "dist\*-arm64.dmg" 2^>nul') do (
    if not defined MAC_DMG_ARM set MAC_DMG_ARM=%%f
)
for /f "delims=" %%f in ('dir /b /s "dist\*-x64.dmg" 2^>nul') do (
    echo %%f | findstr /i "arm64" >nul || if not defined MAC_DMG_X64 set MAC_DMG_X64=%%f
)
for /f "delims=" %%f in ('dir /b /s "dist\*arm64*.zip" 2^>nul') do (
    if not defined MAC_ZIP_ARM set MAC_ZIP_ARM=%%f
)
for /f "delims=" %%f in ('dir /b /s "dist\*x64*.zip" 2^>nul') do (
    echo %%f | findstr /i "arm64" >nul || if not defined MAC_ZIP_X64 set MAC_ZIP_X64=%%f
)
for /f "delims=" %%f in ('dir /b /s "dist\*Setup*.exe" 2^>nul') do (
    if not defined WIN_SETUP set WIN_SETUP=%%f
)
for /f "delims=" %%f in ('dir /b /s "dist\*.exe" 2^>nul') do (
    echo %%f | findstr /i "Setup" >nul || if not defined WIN_PORTABLE set WIN_PORTABLE=%%f
)

if defined MAC_DMG_ARM set RELEASE_FILES=!RELEASE_FILES! "!MAC_DMG_ARM!"
if defined MAC_DMG_X64 set RELEASE_FILES=!RELEASE_FILES! "!MAC_DMG_X64!"
if defined MAC_ZIP_ARM set RELEASE_FILES=!RELEASE_FILES! "!MAC_ZIP_ARM!"
if defined MAC_ZIP_X64 set RELEASE_FILES=!RELEASE_FILES! "!MAC_ZIP_X64!"
if defined WIN_SETUP set RELEASE_FILES=!RELEASE_FILES! "!WIN_SETUP!"
if defined WIN_PORTABLE set RELEASE_FILES=!RELEASE_FILES! "!WIN_PORTABLE!"

echo.
echo Files to upload:
echo %RELEASE_FILES%

REM Create the release
echo.
echo Creating release on GitHub...

gh release create "v%BETA_VERSION%" ^
    --title "v%BETA_VERSION% (Beta)" ^
    --notes "## SF Org Describe v%BETA_VERSION% (Beta)

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
3. Set your Client ID in a .env file or environment variable
4. See README for detailed instructions

### Feedback
Please report issues at: https://github.com/RJPalombo/sf-org-describe/issues" ^
    --prerelease ^
    %RELEASE_FILES%

echo.
echo ========================================
echo   Beta release v%BETA_VERSION% created!
echo ========================================
echo.
echo View at: https://github.com/RJPalombo/sf-org-describe/releases/tag/v%BETA_VERSION%

endlocal
