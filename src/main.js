// Load environment variables from .env file
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const salesforce = require('./salesforce');
const excelExport = require('./excel-export');
const erdGenerator = require('./erd-generator');
const orgStore = require('./org-store');
const orgAuth = require('./org-auth');

let mainWindow;

// Set app name
app.setName('SF Org Describe');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'SF Org Describe',
    icon: path.join(__dirname, 'icon.png'),
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

// The Client ID in Advanced Settings lives in the store shared with the sfod CLI
function applySharedClientId() {
  const { clientId } = orgStore.getSettings();
  salesforce.setClientId(clientId || null, orgAuth.SHARED_SETTINGS_SOURCE);
}
applySharedClientId();

// Client ID for the device flow in progress, saved with the org once it completes
let pendingLoginClientId = null;

// IPC Handlers

// Start OAuth Device Flow
ipcMain.handle('auth:startDeviceFlow', async (event, loginUrl) => {
  try {
    // Connecting to a saved org switches to that org's Client ID; new logins use the shared setting
    applySharedClientId();
    pendingLoginClientId = salesforce.getClientIdInfo().clientId;
    const result = await salesforce.startDeviceFlow(loginUrl);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Poll for OAuth completion; on success the org is saved under the alias (or username)
ipcMain.handle('auth:pollDeviceFlow', async (event, deviceCode, loginUrl, alias) => {
  try {
    const orgInfo = await salesforce.pollDeviceFlow(deviceCode, loginUrl);
    const result = orgAuth.saveLogin(alias || orgInfo.username, orgInfo, {
      loginUrl,
      clientId: pendingLoginClientId
    });
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

// Set custom Client ID (saved to the settings shared with the CLI)
ipcMain.handle('auth:setClientId', async (event, clientId) => {
  orgStore.saveSettings({ clientId: clientId || null });
  applySharedClientId();
  return { success: true };
});

// Shared settings: { clientId, customDomain }
ipcMain.handle('settings:get', async () => {
  return { ...orgStore.getSettings(), storePath: orgStore.storePath() };
});

ipcMain.handle('settings:set', async (event, changes) => {
  const settings = orgStore.saveSettings(changes);
  applySharedClientId();
  return settings;
});

// Saved orgs (shared with the CLI), without their tokens
ipcMain.handle('orgs:list', async () => {
  try {
    return { success: true, data: orgStore.listOrgs().map(orgAuth.publicOrg) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Connect to a saved org with its refresh token - no browser needed
ipcMain.handle('orgs:connect', async (event, alias) => {
  try {
    const orgInfo = await orgAuth.connect(alias);
    // A cheap call that proves the saved login still works (refreshing the token if needed)
    const conn = salesforce.getConnection();
    await conn.request(`/services/data/v${conn.version}/limits`);
    return { success: true, data: orgInfo };
  } catch (error) {
    salesforce.disconnect();
    return { success: false, error: error.message };
  }
});

ipcMain.handle('orgs:remove', async (event, alias) => {
  return { success: orgStore.removeOrg(alias) };
});

// Report which Client ID is in effect and where it came from
ipcMain.handle('auth:getClientIdInfo', async () => {
  const { clientId, source } = salesforce.getClientIdInfo();
  return { source, isDefault: clientId === 'PlatformCLI' };
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
ipcMain.handle('erd:generate', async (event, objectNames, depth, options) => {
  try {
    const erd = await erdGenerator.generateERD(salesforce, objectNames, depth, options);
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

// Export diagram to PNG, SVG, or PDF
ipcMain.handle('export:diagram', async (event, data, format, options = {}) => {
  try {
    const fs = require('fs');

    const filters = {
      png: [{ name: 'PNG Images', extensions: ['png'] }],
      svg: [{ name: 'SVG Files', extensions: ['svg'] }],
      pdf: [{ name: 'PDF Documents', extensions: ['pdf'] }]
    };

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: `Save ERD as ${format.toUpperCase()}`,
      defaultPath: `ERD_${new Date().toISOString().split('T')[0]}.${format}`,
      filters: filters[format] || filters.png
    });

    if (!filePath) {
      return { success: false, cancelled: true };
    }

    if (format === 'svg') {
      // SVG is just text
      fs.writeFileSync(filePath, data);
    } else if (format === 'png') {
      // PNG comes as base64 data URL
      const base64Data = data.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    } else if (format === 'pdf') {
      // PDF - use PDFKit to create a PDF with the image
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({
        autoFirstPage: false
      });

      // Create page sized to fit the image (with some margin)
      const imgWidth = options.width || 800;
      const imgHeight = options.height || 600;
      const margin = 40;

      doc.addPage({
        size: [imgWidth + margin * 2, imgHeight + margin * 2]
      });

      // Add the PNG image
      const base64Data = data.replace(/^data:image\/png;base64,/, '');
      const imgBuffer = Buffer.from(base64Data, 'base64');
      doc.image(imgBuffer, margin, margin, {
        width: imgWidth,
        height: imgHeight
      });

      // Write to file
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);
      doc.end();

      // Wait for stream to finish
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
    }

    return { success: true, filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
