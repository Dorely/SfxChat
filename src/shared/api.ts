import type { SfxApi } from './types';
import type { UiCommand } from './workbench';

/** Fixed app capabilities; transports never expose arbitrary privileged methods. */
export function createApi({ call, onChanged, onUiCommand, mediaUrl, hostMode }: {
  call(method: string, ...args: unknown[]): Promise<any>;
  onChanged(callback: () => void): () => void;
  onUiCommand(callback: (command: UiCommand) => void): () => void;
  mediaUrl(path: string): string; hostMode: 'desktop' | 'browser';
}): SfxApi {
  const api: SfxApi = {
  hostMode, mediaUrl,
  operation: (name, args) => call('operation', name, args),
  installIntegration: input => call('installIntegration', input), chooseDirectory: () => call('chooseDirectory'),
  uiReady: () => call('uiReady'), uiAcknowledge: (id, error) => call('uiAcknowledge', id, error),
  playbackReport: (sessionId, state) => call('playbackReport', sessionId, state),
  onUiCommand,
  snapshot: () => call('snapshot'), createConversation: () => call('createConversation'),
  renameConversation: (id, title) => call('renameConversation', id, title),
  createProject: name => call('createProject', name), renameProject: (id, name) => call('renameProject', id, name),
  setActiveProject: id => call('setActiveProject', id),
  chatContext: (id, draft) => call('chatContext', id, draft),
  openLogs: () => call('openLogs'),
  sendMessage: (id, text) => call('sendMessage', id, text), cancelTurn: id => call('cancelTurn', id),
  generate: (id, input) => call('generate', id, input), generateMusic: (id, input) => call('generateMusic', id, input), cancelJob: id => call('cancelJob', id),
  generateVoice: (id, input) => call('generateVoice', id, input), listVoices: input => call('listVoices', input),
  listVoiceModels: input => call('listVoiceModels', input),
  saveVoiceProvider: input => call('saveVoiceProvider', input), setActiveVoice: id => call('setActiveVoice', id),
  saveProviderKey: (id, key) => call('saveProviderKey', id, key), selectProviderKey: (id, candidateId) => call('selectProviderKey', id, candidateId),
  updateAsset: (id, patch, conversationId) => call('updateAsset', id, patch, conversationId), setPlayground: (id, ids) => call('setPlayground', id, ids),
  analyzeAudio: (id, input) => call('analyzeAudio', id, input), trimAsset: (conversationId, id, input) => call('trimAsset', conversationId, id, input),
  previewTrim: (id, input) => call('previewTrim', id, input),
  spectrogram: (id, input) => call('spectrogram', id, input),
  midiNotes: id => call('midiNotes', id), previewMidi: composition => call('previewMidi', composition),
  saveMidiEdit: (conversationId, id, composition, name) => call('saveMidiEdit', conversationId, id, composition, name),
  soundfontInfo: () => call('soundfontInfo'),
  importAudio: (id, kind) => call('importAudio', id, kind), exportAsset: (id, format) => call('exportAsset', id, format), searchAssets: query => call('searchAssets', query),
  startLogin: () => call('startLogin'), cancelLogin: () => call('cancelLogin'), logout: () => call('logout'),
  saveModel: model => call('saveModel', model),
  saveChatProvider: input => call('saveChatProvider', input), deleteChatProvider: id => call('deleteChatProvider', id),
  listChatModels: providerId => call('listChatModels', providerId),
  testChatModel: input => call('testChatModel', input),
  saveChatModel: input => call('saveChatModel', input), deleteChatModel: id => call('deleteChatModel', id),
  setActiveChat: input => call('setActiveChat', input),
  saveMusicProvider: input => call('saveMusicProvider', input), deleteMusicProvider: id => call('deleteMusicProvider', id),
  setActiveMusic: id => call('setActiveMusic', id),
  onChanged
};
  return api;
}
