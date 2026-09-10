const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fieldscreenDesktop', {
  favoriteTeams: () => ipcRenderer.invoke('fieldscreen:favorites-read'),
  saveFavoriteTeams: teams => ipcRenderer.invoke('fieldscreen:favorites-write', teams),
  chooseRecordingFolder: () => ipcRenderer.invoke('fieldscreen:recording-folder'),
  openRecordingFolder: () => ipcRenderer.invoke('fieldscreen:open-recording-folder'),
  onBackground: callback => { const listener = () => callback(); ipcRenderer.on('fieldscreen:background',listener); return () => ipcRenderer.removeListener('fieldscreen:background',listener); },
  quit: () => ipcRenderer.send('fieldscreen:quit'),
  windowState: () => ipcRenderer.invoke('fieldscreen:window-state'),
  toggleFullscreen: () => ipcRenderer.invoke('fieldscreen:toggle-fullscreen'),
  setFullscreen: fullscreen => ipcRenderer.invoke('fieldscreen:set-fullscreen', fullscreen),
  onWindowState: callback => {
    const listener = (_event, state) => callback({ fullscreen: Boolean(state.fullscreen) });
    ipcRenderer.on('fieldscreen:window-state', listener);
    return () => ipcRenderer.removeListener('fieldscreen:window-state', listener);
  },
});
