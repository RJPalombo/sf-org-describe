const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Authentication
  startDeviceFlow: (loginUrl) => ipcRenderer.invoke('auth:startDeviceFlow', loginUrl),
  pollDeviceFlow: (deviceCode, loginUrl) => ipcRenderer.invoke('auth:pollDeviceFlow', deviceCode, loginUrl),
  disconnect: () => ipcRenderer.invoke('auth:disconnect'),
  getAuthStatus: () => ipcRenderer.invoke('auth:getStatus'),

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
