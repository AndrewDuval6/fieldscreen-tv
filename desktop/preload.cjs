const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fieldscreenDesktop', {
  quit: () => ipcRenderer.send('fieldscreen:quit'),
});
