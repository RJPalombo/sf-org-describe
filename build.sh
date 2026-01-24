#!/bin/bash
# Build SF Org Describe for distribution
# Creates installers for Mac and/or Windows

set -e

cd "$(dirname "$0")"

# Unset the environment variable that causes issues with electron-builder
unset ELECTRON_RUN_AS_NODE

# Parse arguments
BUILD_MAC=false
BUILD_WIN=false
BUILD_ALL=false

show_help() {
    echo "Usage: ./build.sh [OPTIONS]"
    echo ""
    echo "Build SF Org Describe for distribution"
    echo ""
    echo "Options:"
    echo "  --mac       Build for macOS (DMG + ZIP)"
    echo "  --win       Build for Windows (NSIS installer + Portable)"
    echo "  --all       Build for all platforms"
    echo "  --help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./build.sh --mac          # Build Mac version only"
    echo "  ./build.sh --win          # Build Windows version only"
    echo "  ./build.sh --all          # Build for all platforms"
    echo ""
    echo "Output will be in the 'dist' folder"
}

if [ $# -eq 0 ]; then
    show_help
    exit 0
fi

while [[ $# -gt 0 ]]; do
    case $1 in
        --mac)
            BUILD_MAC=true
            shift
            ;;
        --win)
            BUILD_WIN=true
            shift
            ;;
        --all)
            BUILD_ALL=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Ensure dependencies are installed
echo "Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build based on arguments
if [ "$BUILD_ALL" = true ]; then
    echo "Building for all platforms..."
    npx electron-builder --mac --win
elif [ "$BUILD_MAC" = true ] && [ "$BUILD_WIN" = true ]; then
    echo "Building for Mac and Windows..."
    npx electron-builder --mac --win
elif [ "$BUILD_MAC" = true ]; then
    echo "Building for macOS..."
    npx electron-builder --mac
elif [ "$BUILD_WIN" = true ]; then
    echo "Building for Windows..."
    npx electron-builder --win
fi

echo ""
echo "Build complete! Output files are in the 'dist' folder:"
ls -la dist/ 2>/dev/null || echo "(dist folder will be created after build)"
