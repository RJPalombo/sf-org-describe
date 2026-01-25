#!/bin/bash

# SF Org Describe - Beta Release Script
# Creates and uploads beta releases to GitHub

rm -rf dist/

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  SF Org Describe - Beta Release${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed.${NC}"
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

# Check if logged in to GitHub
if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: Not logged in to GitHub CLI.${NC}"
    echo "Run: gh auth login"
    exit 1
fi

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
BETA_VERSION="${VERSION}-beta"

echo ""
echo -e "${YELLOW}Current version: ${VERSION}${NC}"
echo -e "${YELLOW}Beta tag: v${BETA_VERSION}${NC}"
echo ""

# Ask for confirmation
read -p "Do you want to create a beta release v${BETA_VERSION}? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo ""
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
fi

# Clean previous builds
echo ""
echo -e "${YELLOW}Cleaning previous builds...${NC}"
rm -rf dist/

# Build for all platforms
echo ""
echo -e "${YELLOW}Building for macOS (x64 and arm64)...${NC}"
npm run dist:mac

echo ""
echo -e "${YELLOW}Building for Windows (x64)...${NC}"
npm run dist:win

# List built artifacts
echo ""
echo -e "${GREEN}Built artifacts:${NC}"
ls -la dist/

# Create GitHub release
echo ""
echo -e "${YELLOW}Creating GitHub beta release...${NC}"

# Find the built files
MAC_DMG_ARM=$(find dist -name "*-arm64.dmg" | head -n 1)
MAC_DMG_X64=$(find dist -name "*-x64.dmg" -o -name "*-mac.dmg" | grep -v arm64 | head -n 1)
MAC_ZIP_ARM=$(find dist -name "*-arm64-mac.zip" -o -name "*arm64*.zip" | head -n 1)
MAC_ZIP_X64=$(find dist -name "*-x64-mac.zip" -o -name "*x64*.zip" | grep -v arm64 | head -n 1)
WIN_SETUP=$(find dist -name "*.exe" -path "*win*" | grep -i setup | head -n 1)
WIN_PORTABLE=$(find dist -name "*.exe" -path "*win*" | grep -iv setup | head -n 1)

# Create release notes
RELEASE_NOTES="## SF Org Describe v${BETA_VERSION} (Beta)

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
3. Set your Client ID in a \`.env\` file or environment variable
4. See README for detailed instructions

### Feedback
Please report issues at: https://github.com/RJPalombo/sf-org-describe/issues
"

# Build array of files to upload
RELEASE_FILES=()

if [ -n "$MAC_DMG_ARM" ] && [ -f "$MAC_DMG_ARM" ]; then
    RELEASE_FILES+=("$MAC_DMG_ARM")
fi
if [ -n "$MAC_DMG_X64" ] && [ -f "$MAC_DMG_X64" ]; then
    RELEASE_FILES+=("$MAC_DMG_X64")
fi
if [ -n "$MAC_ZIP_ARM" ] && [ -f "$MAC_ZIP_ARM" ]; then
    RELEASE_FILES+=("$MAC_ZIP_ARM")
fi
if [ -n "$MAC_ZIP_X64" ] && [ -f "$MAC_ZIP_X64" ]; then
    RELEASE_FILES+=("$MAC_ZIP_X64")
fi
if [ -n "$WIN_SETUP" ] && [ -f "$WIN_SETUP" ]; then
    RELEASE_FILES+=("$WIN_SETUP")
fi
if [ -n "$WIN_PORTABLE" ] && [ -f "$WIN_PORTABLE" ]; then
    RELEASE_FILES+=("$WIN_PORTABLE")
fi

echo ""
echo -e "${YELLOW}Files to upload:${NC}"
printf '%s\n' "${RELEASE_FILES[@]}"

# Create the release
echo ""
echo -e "${YELLOW}Creating release on GitHub...${NC}"

gh release create "v${BETA_VERSION}" \
    --title "v${BETA_VERSION} (Beta)" \
    --notes "$RELEASE_NOTES" \
    --prerelease \
    "${RELEASE_FILES[@]}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Beta release v${BETA_VERSION} created!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "View at: https://github.com/RJPalombo/sf-org-describe/releases/tag/v${BETA_VERSION}"
