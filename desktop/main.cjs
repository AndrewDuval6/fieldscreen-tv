const { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker } = require('electron');
const path = require('node:path');

let window;
let wakeLock;
const smokeTest = process.argv.includes('--smoke-test');
const page = path.join(__dirname, '..', 'public', 'preview', 'index.html');

app.setName('FieldScreen TV');
app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({
      title: 'FieldScreen TV — Preview', width: 1600, height: 900,
      minWidth: 960, minHeight: 540, fullscreen: !smokeTest,
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
      if (input.type === 'keyDown' && input.key === 'F11') {
        event.preventDefault(); window.setFullScreen(!window.isFullScreen());
      }
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
    window.once('ready-to-show', () => {
      if (smokeTest) {
        console.log('FieldScreen TV renderer loaded with sandbox enabled.');
        app.quit();
      } else {
        window.show();
        wakeLock = powerSaveBlocker.start('prevent-display-sleep');
      }
    });
    window.loadFile(page);
    if (smokeTest) setTimeout(() => app.exit(1), 15000).unref();
  });
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  if (wakeLock !== undefined && powerSaveBlocker.isStarted(wakeLock)) powerSaveBlocker.stop(wakeLock);
});
