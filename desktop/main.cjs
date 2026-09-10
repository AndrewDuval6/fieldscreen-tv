const { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker, safeStorage } = require('electron');
const path = require('node:path');
const { startLocalServer } = require('./iptv.cjs');
const { createVault } = require('./vault.cjs');

let window;
let wakeLock;
let localServer;
let rendererFailed = false;
const smokeTest = process.argv.includes('--smoke-test');
const startFullscreen = !smokeTest && !process.argv.includes('--windowed');
const directory = path.join(__dirname, '..', 'public', 'preview');

app.setName('FieldScreen TV');
app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const vault = createVault(path.join(app.getPath('userData'), 'provider.enc'), safeStorage);
    localServer = await startLocalServer({ directory, vault });
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({
      title: 'FieldScreen TV — Preview', width: 1600, height: 900,
      minWidth: 960, minHeight: 540, fullscreen: startFullscreen,
      backgroundColor: '#07140f', show: false, autoHideMenuBar: true,
      icon: path.join(__dirname, 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        webSecurity: true, backgroundThrottling: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'F11' || input.code === 'F11') && !input.isAutoRepeat) {
        event.preventDefault(); window.setFullScreen(!window.isFullScreen());
      }
    });
    const isMainFrame = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
    ipcMain.handle('fieldscreen:window-state', event => {
      if (!isMainFrame(event)) throw new Error('Main window only');
      return { fullscreen: window.isFullScreen() };
    });
    ipcMain.handle('fieldscreen:toggle-fullscreen', event => {
      if (!isMainFrame(event)) throw new Error('Main window only');
      const fullscreen = !window.isFullScreen(); window.setFullScreen(fullscreen);
      return { fullscreen };
    });
    for (const name of ['enter-full-screen', 'leave-full-screen']) window.on(name, () => {
      window.webContents.send('fieldscreen:window-state', { fullscreen: window.isFullScreen() });
    });
    ipcMain.on('fieldscreen:quit', event => {
      if (event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) app.quit();
    });
    window.webContents.on('did-fail-load', (_event, code, message) => {
      console.error(`FieldScreen failed to load (${code}): ${message}`);
      if (smokeTest) app.exit(1);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error(`FieldScreen renderer stopped: ${details.reason}`);
      if (smokeTest) app.exit(1);
    });
    if (smokeTest) window.webContents.on('console-message', (_event, details) => {
      if (details.level === 'error') { rendererFailed = true; console.error('FieldScreen renderer reported a script or resource error.'); }
    });
    window.once('ready-to-show', () => {
      if (smokeTest) {
        setTimeout(() => {
          console.log('FieldScreen TV renderer loaded with sandbox and local IPTV service.');
          app.exit(rendererFailed ? 1 : 0);
        }, 3000);
      } else {
        window.show();
        wakeLock = powerSaveBlocker.start('prevent-display-sleep');
      }
    });
    window.loadURL(localServer.url + (process.argv.includes('--connect-iptv') ? '#connect-iptv' : ''));
    if (smokeTest) setTimeout(() => app.exit(1), 15000).unref();
  }).catch(() => { console.error('FieldScreen TV could not start its local player service.'); app.exit(1); });
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  localServer?.close();
  if (wakeLock !== undefined && powerSaveBlocker.isStarted(wakeLock)) powerSaveBlocker.stop(wakeLock);
});
