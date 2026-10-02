import { contextBridge, ipcRenderer } from 'electron';
import { createApi } from '../shared/api';
const api = createApi({
  hostMode: 'desktop', mediaUrl: path => `sfx-media://${path}`,
  call: (method, ...args) => ipcRenderer.invoke('sfx:call', method, args),
  onUiCommand: callback => { const listener = (_event: unknown, command: import('../shared/workbench').UiCommand) => callback(command); ipcRenderer.on('sfx:ui-command', listener); return () => ipcRenderer.removeListener('sfx:ui-command', listener); },
  onChanged: callback => { const listener = () => callback(); ipcRenderer.on('sfx:changed', listener); return () => ipcRenderer.removeListener('sfx:changed', listener); }
});
contextBridge.exposeInMainWorld('sfx', api);
