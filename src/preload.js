const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Authentication
  startDeviceFlow: (loginUrl) => ipcRenderer.invoke('auth:startDeviceFlow', loginUrl),
  pollDeviceFlow: (deviceCode, loginUrl, alias) => ipcRenderer.invoke('auth:pollDeviceFlow', deviceCode, loginUrl, alias),
  disconnect: () => ipcRenderer.invoke('auth:disconnect'),
  getAuthStatus: () => ipcRenderer.invoke('auth:getStatus'),
  setClientId: (clientId) => ipcRenderer.invoke('auth:setClientId', clientId),
  getClientIdInfo: () => ipcRenderer.invoke('auth:getClientIdInfo'),

  // Saved orgs and settings (shared with the sfod CLI)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (changes) => ipcRenderer.invoke('settings:set', changes),
  listOrgs: () => ipcRenderer.invoke('orgs:list'),
  connectOrg: (alias) => ipcRenderer.invoke('orgs:connect', alias),
  removeOrg: (alias) => ipcRenderer.invoke('orgs:remove', alias),

  // Salesforce operations
  getObjects: () => ipcRenderer.invoke('sf:getObjects'),
  describeObjects: (objectNames) => ipcRenderer.invoke('sf:describeObjects', objectNames),

  // Export operations
  exportToExcel: (objectDescriptions) => ipcRenderer.invoke('export:excel', objectDescriptions),
  exportMermaid: (mermaidCode) => ipcRenderer.invoke('export:mermaid', mermaidCode),
  exportDiagram: (data, format, options) => ipcRenderer.invoke('export:diagram', data, format, options),

  // ERD generation
  generateERD: (objectNames, depth, options) => ipcRenderer.invoke('erd:generate', objectNames, depth, options),

  // Shell
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
});
