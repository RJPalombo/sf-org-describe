// Load environment variables from .env file
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const salesforce = require('./salesforce');
const excelExport = require('./excel-export');
const erdGenerator = require('./erd-generator');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Uncomment for debugging
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

// Start OAuth Device Flow
ipcMain.handle('auth:startDeviceFlow', async (event, loginUrl) => {
  try {
    const result = await salesforce.startDeviceFlow(loginUrl);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Poll for OAuth completion
ipcMain.handle('auth:pollDeviceFlow', async (event, deviceCode, loginUrl) => {
  try {
    const result = await salesforce.pollDeviceFlow(deviceCode, loginUrl);
    return { success: true, data: result };
  } catch (error) {
    if (error.message === 'authorization_pending') {
      return { success: false, pending: true };
    }
    return { success: false, error: error.message };
  }
});

// Disconnect from org
ipcMain.handle('auth:disconnect', async () => {
  salesforce.disconnect();
  return { success: true };
});

// Get connection status
ipcMain.handle('auth:getStatus', async () => {
  return salesforce.getConnectionStatus();
});

// Get all SObjects
ipcMain.handle('sf:getObjects', async () => {
  try {
    const objects = await salesforce.getAllObjects();
    return { success: true, data: objects };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Describe SObjects (get full metadata)
ipcMain.handle('sf:describeObjects', async (event, objectNames) => {
  try {
    const descriptions = await salesforce.describeObjects(objectNames);
    return { success: true, data: descriptions };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Export to Excel
ipcMain.handle('export:excel', async (event, objectDescriptions) => {
  try {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Excel Export',
      defaultPath: `Salesforce_Metadata_${new Date().toISOString().split('T')[0]}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });

    if (!filePath) {
      return { success: false, cancelled: true };
    }

    await excelExport.exportToExcel(objectDescriptions, filePath);
    return { success: true, filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Generate ERD
ipcMain.handle('erd:generate', async (event, objectNames, depth) => {
  try {
    const erd = await erdGenerator.generateERD(salesforce, objectNames, depth);
    return { success: true, data: erd };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Open external URL
ipcMain.handle('shell:openExternal', async (event, url) => {
  await shell.openExternal(url);
  return { success: true };
});

// Save Mermaid code to file
ipcMain.handle('export:mermaid', async (event, mermaidCode) => {
  try {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Mermaid Code',
      defaultPath: `ERD_${new Date().toISOString().split('T')[0]}.md`,
      filters: [{ name: 'Markdown Files', extensions: ['md'] }]
    });

    if (!filePath) {
      return { success: false, cancelled: true };
    }

    const fs = require('fs');
    fs.writeFileSync(filePath, '```mermaid\n' + mermaidCode + '\n```');
    return { success: true, filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
