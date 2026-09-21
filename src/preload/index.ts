import { contextBridge, ipcRenderer } from 'electron';
import type { SfxApi } from '../shared/types';
const call = (method: string, ...args: unknown[]) => ipcRenderer.invoke('sfx:call', method, args);
const api: SfxApi = {
  snapshot: () => call('snapshot'), createConversation: () => call('createConversation'),
  chatContext: (id, draft) => call('chatContext', id, draft),
  openLogs: () => call('openLogs'),
  sendMessage: (id, text) => call('sendMessage', id, text), cancelTurn: id => call('cancelTurn', id),
  generate: (id, input) => call('generate', id, input), cancelJob: id => call('cancelJob', id),
  updateAsset: (id, patch, conversationId) => call('updateAsset', id, patch, conversationId), setPlayground: (id, ids) => call('setPlayground', id, ids),
  analyzeAudio: (id, input) => call('analyzeAudio', id, input), trimAsset: (conversationId, id, input) => call('trimAsset', conversationId, id, input),
  previewTrim: (id, input) => call('previewTrim', id, input),
  importAudio: id => call('importAudio', id), exportAsset: id => call('exportAsset', id), searchAssets: query => call('searchAssets', query),
  startLogin: () => call('startLogin'), cancelLogin: () => call('cancelLogin'), logout: () => call('logout'),
  saveElevenLabsKey: key => call('saveElevenLabsKey', key), saveModel: model => call('saveModel', model),
  saveChatProvider: input => call('saveChatProvider', input), deleteChatProvider: id => call('deleteChatProvider', id),
  listChatModels: providerId => call('listChatModels', providerId),
  testChatModel: input => call('testChatModel', input),
  saveChatModel: input => call('saveChatModel', input), deleteChatModel: id => call('deleteChatModel', id),
  setActiveChat: input => call('setActiveChat', input),
  onChanged: callback => { const listener = () => callback(); ipcRenderer.on('sfx:changed', listener); return () => ipcRenderer.removeListener('sfx:changed', listener); }
};
contextBridge.exposeInMainWorld('sfx', api);
