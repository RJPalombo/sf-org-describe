@echo off
REM Start SF Org Describe in development mode
REM This script ensures ELECTRON_RUN_AS_NODE is unset to prevent conflicts
REM when running from Electron-based IDEs like VS Code

cd /d "%~dp0"

REM Unset the environment variable that causes Electron to run as Node
set ELECTRON_RUN_AS_NODE=

REM Run the application
npx electron .
