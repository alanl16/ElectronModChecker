const { contextBridge, ipcRenderer: ipc, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipc.invoke('config:get'), setConfig: c => ipc.invoke('config:set', c),
  pickDir: () => ipc.invoke('dir:pick'), scan: d => ipc.invoke('mods:scan', d),
  check: (m, k, v, l) => ipc.invoke('mods:check', m, k, v, l), update: (m, d) => ipc.invoke('mods:update', m, d),
  pickFiles: f => ipc.invoke('files:pick', f), similar: (i, t, l) => ipc.invoke('mods:similar', i, t, l), launchTest: (m, r, t, l) => ipc.invoke('launch:test', m, r, t, l), testKey: k => ipc.invoke('cf:test', k), mcVersions: () => ipc.invoke('mc:versions'), defaultDir: () => ipc.invoke('dir:default'), parse: f => ipc.invoke('mods:parse', f),
  pathOf: f => webUtils.getPathForFile(f),
  open: u => ipc.invoke('open:url', u),
});
