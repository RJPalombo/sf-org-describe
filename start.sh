#!/bin/bash
# Start SF Org Describe in development mode
# This script ensures ELECTRON_RUN_AS_NODE is unset to prevent conflicts
# when running from Electron-based IDEs like VS Code

cd "$(dirname "$0")"

# Unset the environment variable that causes Electron to run as Node
unset ELECTRON_RUN_AS_NODE

# Run the application
npx electron .
