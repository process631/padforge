const { contextBridge, ipcRenderer } = require('electron');

const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  selftest: ipcRenderer.sendSync('selftest:flag'),
  version: ipcRenderer.sendSync('app:version'),
  info: invoke('app:info'),
  setDirty: v => ipcRenderer.send('app:dirty', !!v),
  log: (level, msg) => ipcRenderer.send('log:write', String(level), String(msg)),
  logTail: invoke('log:tail'),
  openDataFolder: invoke('folder:data'),
  openLink: invoke('open:link'),
  loadPresets: invoke('presets:load'),
  savePresets: invoke('presets:save'),
  exportPreset: invoke('presets:export'),
  importPreset: invoke('presets:import'),
  saveBackup: invoke('backup:save'),
  openBackup: invoke('backup:open'),
  openBackupFolder: invoke('backup:folder'),
  saveDiagnostics: invoke('diag:save'),
  pickOcTool: invoke('oc:pickTool'),
  launchOcTool: invoke('oc:launch'),
  ocStatus: invoke('oc:status'),
  conflicts: invoke('sys:conflicts'),
  selftestCapture: invoke('selftest:capture'),
  selftestDone: r => ipcRenderer.send('selftest:done', r),
});
