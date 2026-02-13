@echo off
REM Build SF Org Describe for distribution
REM Creates installers for Mac and/or Windows

cd /d "%~dp0"

REM Unset the environment variable that causes issues with electron-builder
set ELECTRON_RUN_AS_NODE=

set BUILD_MAC=false
set BUILD_WIN=false
set BUILD_ALL=false

if "%~1"=="" goto :show_help

:parse_args
if "%~1"=="" goto :build
if /i "%~1"=="--mac" (
    set BUILD_MAC=true
    shift
    goto :parse_args
)
if /i "%~1"=="--win" (
    set BUILD_WIN=true
    shift
    goto :parse_args
)
if /i "%~1"=="--all" (
    set BUILD_ALL=true
    shift
    goto :parse_args
)
if /i "%~1"=="--help" goto :show_help
if /i "%~1"=="-h" goto :show_help
echo Unknown option: %~1
goto :show_help

:show_help
echo Usage: build.bat [OPTIONS]
echo.
echo Build SF Org Describe for distribution
echo.
echo Options:
echo   --mac       Build for macOS (DMG + ZIP)
echo   --win       Build for Windows (NSIS installer + Portable)
echo   --all       Build for all platforms
echo   --help      Show this help message
echo.
echo Examples:
echo   build.bat --mac          # Build Mac version only
echo   build.bat --win          # Build Windows version only
echo   build.bat --all          # Build for all platforms
echo.
echo Output will be in the 'dist' folder
exit /b 0

:build
REM Ensure dependencies are installed
echo Checking dependencies...
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
)

REM Build based on arguments
if "%BUILD_ALL%"=="true" (
    echo Building for all platforms...
    npx electron-builder --mac --win
) else if "%BUILD_MAC%"=="true" if "%BUILD_WIN%"=="true" (
    echo Building for Mac and Windows...
    npx electron-builder --mac --win
) else if "%BUILD_MAC%"=="true" (
    echo Building for macOS...
    npx electron-builder --mac
) else if "%BUILD_WIN%"=="true" (
    echo Building for Windows...
    npx electron-builder --win
)

echo.
echo Build complete! Output files are in the 'dist' folder:
if exist "dist" (
    dir dist
) else (
    echo (dist folder will be created after build)
)
