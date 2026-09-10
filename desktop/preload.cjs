const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fieldscreenDesktop', {
  quit: () => ipcRenderer.send('fieldscreen:quit'),
  windowState: () => ipcRenderer.invoke('fieldscreen:window-state'),
  toggleFullscreen: () => ipcRenderer.invoke('fieldscreen:toggle-fullscreen'),
  onWindowState: callback => {
    const listener = (_event, state) => callback({ fullscreen: Boolean(state.fullscreen) });
    ipcRenderer.on('fieldscreen:window-state', listener);
    return () => ipcRenderer.removeListener('fieldscreen:window-state', listener);
  },
});
