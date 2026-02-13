# Start SF Org Describe in development mode
# This script ensures ELECTRON_RUN_AS_NODE is unset to prevent conflicts
# when running from Electron-based IDEs like VS Code

Set-Location $PSScriptRoot

# Unset the environment variable that causes Electron to run as Node
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# Run the application
npx electron .
