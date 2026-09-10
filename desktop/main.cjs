const { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker, safeStorage, dialog, Tray, shell } = require('electron');
const path = require('node:path');
const { startLocalServer } = require('./iptv.cjs');
const { createVault, configurePasswordStore } = require('./vault.cjs');

let window;
let wakeLock;
let localServer;
let rendererFailed = false;
let tray, quitReady = false, quitPending = false;
const smokeTest = process.argv.includes('--smoke-test');
const startFullscreen = !smokeTest && !process.argv.includes('--windowed');
const directory = path.join(__dirname, '..', 'public', 'preview');

app.setName('FieldScreen TV');
configurePasswordStore(app.commandLine);
app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const vault = createVault(path.join(app.getPath('userData'), 'provider.enc'), safeStorage);
    const refreshBackground = () => {
      if (!window || window.isDestroyed() || smokeTest) return;
      if (wakeLock !== undefined && powerSaveBlocker.isStarted(wakeLock)) powerSaveBlocker.stop(wakeLock);
      wakeLock = window.isVisible() ? powerSaveBlocker.start('prevent-display-sleep') : localServer?.recorder.hasWork() ? powerSaveBlocker.start('prevent-app-suspension') : undefined;
      tray?.setToolTip(localServer?.recorder.count() ? 'FieldScreen TV — recording' : 'FieldScreen TV');
    };
    localServer = await startLocalServer({ directory, vault, recordings: {
      stateFile: path.join(app.getPath('userData'), 'recordings.json'),
      ffmpeg: app.isPackaged ? path.join(process.resourcesPath,'recorder','ffmpeg') : path.join(__dirname,'recorder','ffmpeg'),
      onChange: refreshBackground,
    } });
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
    ipcMain.handle('fieldscreen:recording-folder', async event => {
      if (!isMainFrame(event)) throw new Error('Main window only');
      const result = await dialog.showOpenDialog(window, { title: 'Choose a folder for recorded games', buttonLabel: 'Save recordings here', defaultPath: (await localServer.recorder.status()).folder || app.getPath('videos'), properties: ['openDirectory','createDirectory'] });
      if (result.canceled || !result.filePaths[0]) return null;
      return localServer.recorder.setFolder(result.filePaths[0]);
    });
    ipcMain.handle('fieldscreen:open-recording-folder', async event => {
      if (!isMainFrame(event)) throw new Error('Main window only');
      const folder = (await localServer.recorder.status()).folder;
      if (folder) return shell.openPath(folder);
    });
    ipcMain.handle('fieldscreen:window-state', event => {
      if (!isMainFrame(event)) throw new Error('Main window only');
      return { fullscreen: window.isFullScreen() };
    });
    ipcMain.handle('fieldscreen:toggle-fullscreen', event => {
      if (!isMainFrame(event)) throw new Error('Main window only');
      const fullscreen = !window.isFullScreen(); window.setFullScreen(fullscreen);
      return { fullscreen };
    });
    ipcMain.handle('fieldscreen:set-fullscreen', (event, fullscreen) => {
      if (!isMainFrame(event) || typeof fullscreen !== 'boolean') throw new Error('Main window only');
      window.setFullScreen(fullscreen);
      return { fullscreen: window.isFullScreen() };
    });
    for (const name of ['enter-full-screen', 'leave-full-screen']) window.on(name, () => {
      window.webContents.send('fieldscreen:window-state', { fullscreen: window.isFullScreen() });
    });
    ipcMain.on('fieldscreen:quit', event => {
      if (event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) app.quit();
    });
    if (!smokeTest) {
      tray = new Tray(path.join(__dirname,'icon.png'));
      tray.setToolTip('FieldScreen TV');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open FieldScreen TV', click: () => { window.show(); window.focus(); } },
        { label: 'Quit FieldScreen TV', click: () => app.quit() },
      ]));
      tray.on('click', () => { window.show(); window.focus(); });
      window.on('close', event => {
        if (!quitReady && localServer.recorder.hasWork()) { event.preventDefault(); window.webContents.send('fieldscreen:background'); window.hide(); }
      });
      window.on('hide', refreshBackground); window.on('show', refreshBackground);
    }
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
      }
    });
    window.loadURL(localServer.url + (process.argv.includes('--connect-iptv') ? '#connect-iptv' : ''));
    if (smokeTest) setTimeout(() => app.exit(1), 15000).unref();
  }).catch(() => { console.error('FieldScreen TV could not start its local player service.'); app.exit(1); });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitReady || !localServer?.recorder || smokeTest) return;
  event.preventDefault(); if (quitPending) return; quitPending = true;
  void (async () => {
    if (localServer.recorder.hasWork()) {
      const choice = await dialog.showMessageBox(window, { type:'question', title:'Keep your recordings running?', message:'FieldScreen has active or scheduled recordings.', detail:'Keep it running in the background to record. Quitting stops active recordings, and upcoming games cannot record until you open FieldScreen again.', buttons:['Keep running','Quit and stop recording'], defaultId:0, cancelId:0 });
      if (choice.response !== 1) { window.webContents.send('fieldscreen:background'); window.hide(); quitPending = false; return; }
    }
    await localServer.recorder.shutdown(); quitReady = true; app.quit();
  })().catch(() => { quitPending = false; });
});
app.on('will-quit', () => {
  tray?.destroy();
  localServer?.close();
  if (wakeLock !== undefined && powerSaveBlocker.isStarted(wakeLock)) powerSaveBlocker.stop(wakeLock);
});
