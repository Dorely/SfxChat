import { contextBridge, ipcRenderer } from 'electron';
import type { SfxApi } from '../shared/types';
const call = (method: string, ...args: unknown[]) => ipcRenderer.invoke('sfx:call', method, args);
const api: SfxApi = {
  operation: (name, args) => call('operation', name, args),
  installIntegration: input => call('installIntegration', input), chooseDirectory: () => call('chooseDirectory'),
  uiReady: () => call('uiReady'), uiAcknowledge: (id, error) => call('uiAcknowledge', id, error),
  playbackReport: (sessionId, state) => call('playbackReport', sessionId, state),
  onUiCommand: callback => { const listener = (_event: unknown, command: import('../shared/workbench').UiCommand) => callback(command); ipcRenderer.on('sfx:ui-command', listener); return () => ipcRenderer.removeListener('sfx:ui-command', listener); },
  snapshot: () => call('snapshot'), createConversation: () => call('createConversation'),
  renameConversation: (id, title) => call('renameConversation', id, title),
  createProject: name => call('createProject', name), renameProject: (id, name) => call('renameProject', id, name),
  setActiveProject: id => call('setActiveProject', id),
  chatContext: (id, draft) => call('chatContext', id, draft),
  openLogs: () => call('openLogs'),
  sendMessage: (id, text) => call('sendMessage', id, text), cancelTurn: id => call('cancelTurn', id),
  generate: (id, input) => call('generate', id, input), generateMusic: (id, input) => call('generateMusic', id, input), cancelJob: id => call('cancelJob', id),
  updateAsset: (id, patch, conversationId) => call('updateAsset', id, patch, conversationId), setPlayground: (id, ids) => call('setPlayground', id, ids),
  analyzeAudio: (id, input) => call('analyzeAudio', id, input), trimAsset: (conversationId, id, input) => call('trimAsset', conversationId, id, input),
  previewTrim: (id, input) => call('previewTrim', id, input),
  spectrogram: (id, input) => call('spectrogram', id, input),
  importAudio: (id, kind) => call('importAudio', id, kind), exportAsset: (id, format) => call('exportAsset', id, format), searchAssets: query => call('searchAssets', query),
  startLogin: () => call('startLogin'), cancelLogin: () => call('cancelLogin'), logout: () => call('logout'),
  saveElevenLabsKey: key => call('saveElevenLabsKey', key), saveModel: model => call('saveModel', model),
  saveChatProvider: input => call('saveChatProvider', input), deleteChatProvider: id => call('deleteChatProvider', id),
  listChatModels: providerId => call('listChatModels', providerId),
  testChatModel: input => call('testChatModel', input),
  saveChatModel: input => call('saveChatModel', input), deleteChatModel: id => call('deleteChatModel', id),
  setActiveChat: input => call('setActiveChat', input),
  saveMusicProvider: input => call('saveMusicProvider', input), deleteMusicProvider: id => call('deleteMusicProvider', id),
  setActiveMusic: id => call('setActiveMusic', id),
  onChanged: callback => { const listener = () => callback(); ipcRenderer.on('sfx:changed', listener); return () => ipcRenderer.removeListener('sfx:changed', listener); }
};
contextBridge.exposeInMainWorld('sfx', api);
