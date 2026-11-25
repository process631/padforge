const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { summarizePnp } = require('../shared/pnp.mjs');

const SONY_VID = 0x054c;
const SELFTEST = process.env.PADFORGE_SELFTEST === '1';
const SELFTEST_OUT = process.env.PADFORGE_SELFTEST_OUT || os.tmpdir();
if (SELFTEST) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'padforge-selftest-')));

const data = (...p) => path.join(app.getPath('userData'), ...p);
const LINKS = {
  hidusbf: 'https://github.com/LordOfMice/hidusbf',
  protocol: 'https://github.com/steffalon/dualsense-edge-profile-web-application',
};

/* ---------------- logging ---------------- */
const logFile = () => data('logs', 'padforge.log');
function log(level, msg) {
  try {
    const f = logFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try { if (fs.statSync(f).size > 1024 * 1024) fs.renameSync(f, f + '.1'); } catch { /* no log yet */ }
    fs.appendFileSync(f, `${new Date().toISOString()} ${String(level).toUpperCase().padEnd(5)} ${String(msg).replace(/\s+/g, ' ').slice(0, 2000)}\n`);
  } catch { /* logging must never crash the app */ }
}
const tailLog = (n = 300) => { try { return fs.readFileSync(logFile(), 'utf8').trim().split('\n').slice(-n); } catch { return []; } };
process.on('uncaughtException', e => log('error', `main: ${e.stack || e}`));

/* ---------------- window ---------------- */
const stateFile = () => data('window.json');
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

let win = null, dirty = false, forceClose = false;

function createWindow() {
  const b = SELFTEST ? {} : readJson(stateFile(), {});
  win = new BrowserWindow({
    width: b.width || 1380, height: b.height || 900, x: b.x, y: b.y, minWidth: 1180, minHeight: 760,
    backgroundColor: '#060b1d', title: 'PadForge', icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false, paintWhenInitiallyHidden: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#070d22', symbolColor: '#c9d1e6', height: 56 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      backgroundThrottling: !SELFTEST, offscreen: SELFTEST,
    },
  });
  if (app.isPackaged) Menu.setApplicationMenu(null);   // no reload / devtools shortcuts in the shipped app
  win.setMenuBarVisibility(false);

  // WebHID: only Sony controllers, picked automatically.
  const ses = win.webContents.session;
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const dev = details.deviceList.find(d => d.vendorId === SONY_VID && d.productId === 0x0df2)
      || details.deviceList.find(d => d.vendorId === SONY_VID);
    callback(dev ? dev.deviceId : '');
  });
  ses.setPermissionCheckHandler((_wc, perm) => perm === 'hid');
  ses.setDevicePermissionHandler(d => d.deviceType === 'hid' && d.device.vendorId === SONY_VID);

  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('render-process-gone', (_e, d) => log('error', `renderer gone: ${d.reason}`));

  if (!SELFTEST) {
    win.once('ready-to-show', () => { if (b.maximized) win.maximize(); win.show(); });
    win.on('close', async e => {
      try { writeJson(stateFile(), { ...win.getNormalBounds(), maximized: win.isMaximized() }); } catch { /* ignore */ }
      if (!dirty || forceClose) return;
      e.preventDefault();
      const r = await dialog.showMessageBox(win, {
        type: 'warning', title: 'PadForge', noLink: true, defaultId: 1, cancelId: 1,
        buttons: ['Discard changes', 'Keep editing'],
        message: 'You have unsaved changes',
        detail: 'Your edits have not been written to the controller. Close PadForge anyway?',
      });
      if (r.response === 0) { forceClose = true; win.close(); }
    });
  }
  win.loadFile(path.join(__dirname, 'index.html'));
  log('info', `PadForge ${app.getVersion()} started (Electron ${process.versions.electron}, ${os.type()} ${os.release()})`);
}

/* ---------------- IPC ---------------- */
ipcMain.on('app:version', e => { e.returnValue = app.getVersion(); });
ipcMain.on('selftest:flag', e => { e.returnValue = SELFTEST; });
ipcMain.on('app:dirty', (_e, v) => { dirty = !!v; });
ipcMain.on('log:write', (_e, level, msg) => log(level, msg));
ipcMain.handle('log:tail', () => tailLog());
ipcMain.handle('app:info', () => ({
  version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
  node: process.versions.node, os: `${os.type()} ${os.release()} (${process.arch})`, dataDir: app.getPath('userData'),
}));
ipcMain.handle('folder:data', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('open:link', (_e, key) => LINKS[key] && shell.openExternal(LINKS[key]));

// Presets saved on this PC (migrates the 1.0 file name)
ipcMain.handle('presets:load', () => readJson(data('presets.json'), null) ?? readJson(data('profiles.json'), []));
ipcMain.handle('presets:save', (_e, list) => { writeJson(data('presets.json'), list); return true; });
ipcMain.handle('presets:export', async (_e, profile) => {
  const name = String(profile?.label || 'profile').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 60) || 'profile';
  const r = await dialog.showSaveDialog(win, {
    title: 'Export preset', defaultPath: path.join(app.getPath('documents'), `${name}.padforge.json`),
    filters: [{ name: 'PadForge preset', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  writeJson(r.filePath, { format: 'padforge-preset', version: 1, profile });
  log('info', `Exported preset to ${r.filePath}`);
  return r.filePath;
});
ipcMain.handle('presets:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Import preset', properties: ['openFile'], filters: [{ name: 'PadForge preset', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    if (fs.statSync(r.filePaths[0]).size > 256 * 1024) return { error: 'File is too large to be a preset.' };
    return { data: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) };
  } catch (e) { return { error: `Couldn't read the file: ${e.message}` }; }
});

// Backups
ipcMain.handle('backup:save', (_e, payload) => {
  const f = data('edge-backups', `edge-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeJson(f, payload);
  return f;
});
ipcMain.handle('backup:open', async () => {
  fs.mkdirSync(data('edge-backups'), { recursive: true });
  const r = await dialog.showOpenDialog(win, { title: 'Restore backup', defaultPath: data('edge-backups'), properties: ['openFile'], filters: [{ name: 'PadForge backup', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return readJson(r.filePaths[0], { error: 'not-json' });
});
ipcMain.handle('backup:folder', () => { fs.mkdirSync(data('edge-backups'), { recursive: true }); return shell.openPath(data('edge-backups')); });

// Diagnostics
ipcMain.handle('diag:save', async (_e, payload) => {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const r = await dialog.showSaveDialog(win, {
    title: 'Export diagnostics', defaultPath: path.join(app.getPath('documents'), `padforge-diagnostics-${stamp}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  writeJson(r.filePath, { ...payload, log: tailLog() });
  return r.filePath;
});

// Overclock helper (hidusbf is downloaded and run by the user; PadForge never installs drivers itself)
ipcMain.handle('oc:pickTool', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Locate hidusbf Setup.exe', properties: ['openFile'], filters: [{ name: 'Program', extensions: ['exe'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('oc:launch', (_e, exe) => {
  if (typeof exe !== 'string' || !/\.exe$/i.test(exe) || !fs.existsSync(exe)) return 'The overclock tool was not found. Locate Setup.exe again.';
  log('info', `Opening overclock tool ${exe}`);
  return shell.openPath(exe);
});
ipcMain.handle('oc:status', () => new Promise(resolve => {
  execFile('sc.exe', ['query', 'hidusbf'], { windowsHide: true }, (err, stdout) => {
    if (err || !/STATE/.test(stdout)) return resolve('not-installed');
    resolve(/RUNNING/.test(stdout) ? 'running' : 'installed');
  });
}));

// Things on this PC that can interfere with the controller or leave an old overclock behind (read-only checks).
const CONFLICT_APPS = [
  { exe: ['dsx.exe', 'dualsensex.exe'], name: 'DSX (DualSenseX)' },
  { exe: ['ds4windows.exe'], name: 'DS4Windows' },
  { exe: ['rewasd.exe', 'rewasdengine.exe', 'rewasdtray.exe'], name: 'reWASD' },
  { exe: ['steam.exe'], name: 'Steam' },
  { exe: ['x360ce.exe'], name: 'x360ce' },
];
const run = (cmd, args) => new Promise(resolve => execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, out) => resolve(err ? '' : String(out))));
const serviceState = async name => {
  const out = await run('sc.exe', ['query', name]);
  return !/STATE/.test(out) ? 'not-installed' : /RUNNING/.test(out) ? 'running' : 'installed';
};
ipcMain.handle('sys:conflicts', async () => {
  if (SELFTEST) {
    return { apps: [{ name: 'DS4Windows' }], services: { hidusbf: 'running', HidHide: 'not-installed', ViGEmBus: 'installed' } };
  }
  const tasks = (await run('tasklist.exe', ['/fo', 'csv', '/nh'])).toLowerCase();
  const running = new Set([...tasks.matchAll(/^"([^"]+)"/gm)].map(m => m[1]));
  const apps = CONFLICT_APPS.filter(a => a.exe.some(e => running.has(e))).map(a => ({ name: a.name }));
  const [hidusbf, HidHide, ViGEmBus] = await Promise.all(['hidusbf', 'HidHide', 'ViGEmBus'].map(serviceState));
  return { apps, services: { hidusbf, HidHide, ViGEmBus } };
});

// What Windows itself sees (HID entries for Sony devices and game controllers). Read-only.
ipcMain.handle('sys:usbScan', async () => {
  if (SELFTEST) return summarizePnp([{ InstanceId: 'HID\\VID_054C&PID_0DF2&MI_03\\7&TEST&0&0000', Status: 'OK' }]);
  const ps = "Get-PnpDevice -PresentOnly -Class HIDClass | Where-Object { $_.InstanceId -match '054C' -or $_.FriendlyName -match 'game controller' } | Select-Object Status, InstanceId | ConvertTo-Json -Compress";
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  try { return summarizePnp(JSON.parse(out || '[]')); } catch { return []; }
});

/* ---------------- self-test (PADFORGE_SELFTEST=1) ---------------- */
const consoleLog = [];
ipcMain.handle('selftest:capture', async (_e, name) => {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(SELFTEST_OUT, `${String(name).replace(/[^\w-]/g, '')}.png`), img.toPNG());
  return true;
});
ipcMain.on('selftest:done', (_e, result) => {
  fs.writeFileSync(path.join(SELFTEST_OUT, 'selftest.json'), JSON.stringify({ result, console: consoleLog, log: tailLog() }, null, 2));
  try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch { /* temp dir */ }
  app.exit(result.ok ? 0 : 1);
});

/* ---------------- lifecycle ---------------- */
if (!SELFTEST && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.setAppUserModelId('local.padforge');
  app.whenReady().then(() => {
    createWindow();
    if (SELFTEST) {
      win.webContents.on('console-message', (e, ...a) => consoleLog.push(`[${e.level ?? a[0]}] ${e.message ?? a[1]}`));
      setTimeout(() => { consoleLog.push('TIMEOUT'); app.exit(2); }, 60000);
    }
  });
  app.on('window-all-closed', () => app.quit());
}
