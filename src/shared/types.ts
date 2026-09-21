export type Review = 'unreviewed' | 'accepted' | 'rejected';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export type AssetKind = 'effect' | 'music';
export interface Conversation { id: string; title: string; createdAt: string }
export interface Message { id: string; conversationId: string; role: 'user' | 'assistant' | 'tool'; text: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; createdAt: string }
export interface Asset {
  id: string; name: string; description: string; tags: string[]; collections: string[];
  review: Review; feedback: string; source: 'generated' | 'imported' | 'edited'; kind: AssetKind;
  format: 'mp3' | 'wav'; hash: string; bytes: number; duration: number | null;
  prompt: string; provider: string | null; model: string | null; requestId: string | null;
  request: GenerationInput | MusicGenerationInput | null; usage: string | null; parentId: string | null; createdAt: string;
  providerPrompt?: string | null; lyrics?: string; edit?: TrimEdit;
}
export interface TrimInput { startSeconds: number; endSeconds: number; fadeInMs?: number; fadeOutMs?: number; name?: string }
export interface TrimEdit {
  kind: 'trim'; version: 1; sourceHash: string; sampleRate: number;
  startFrame: number; endFrame: number; fadeInFrames: number; fadeOutFrames: number;
  requested: TrimInput; decoder: string; outputEncoding: 'float32-wav';
}
export interface AudioAnalysisInput { startSeconds?: number; endSeconds?: number; bins?: number }
export interface AudioAnalysis {
  version: 1; assetId: string; sourceHash: string; sampleRate: number; channels: number;
  totalFrames: number; duration: number; startFrame: number; endFrame: number;
  startSeconds: number; endSeconds: number; decoder: string;
  bins: { startFrame: number; endFrame: number; startSeconds: number; endSeconds: number; min: number; max: number; peak: number; rms: number }[];
  note: string;
}
export interface GenerationInput {
  kind?: 'effect'; prompt: string; count?: number; duration?: number | null; loop?: boolean;
  influence?: number; parentId?: string | null; name?: string;
}
export interface MusicGenerationInput {
  kind: 'music'; prompt: string; count?: number; durationMs?: number | null; instrumental?: boolean;
  /** Local provider override; null or omitted uses the active music provider. */
  providerId?: string | null; parentId?: string | null; name?: string;
}
export interface Job { id: string; conversationId: string; kind: AssetKind; status: JobStatus; input: GenerationInput | MusicGenerationInput; assetId: string | null; error: string | null; createdAt: string }
export type GenericProviderKind = 'chat-completions' | 'responses' | 'anthropic';
export interface ChatProviderEntry { id: string; label: string; baseUrl: string; kind: GenericProviderKind }
export type CapabilityFlag = true | false | 'unknown';
export interface ChatModelEntry {
  id: string; providerId: string; slug: string; efforts: string[];
  maxTokens: number | null; vision: CapabilityFlag; audio: CapabilityFlag;
  effortResults: Record<string, 'pass' | 'fail'>; lastTestedAt: string; testError?: string;
}
export interface ActiveChatSelection { modelId: string; effort: string }
export interface ChatModelOption { id: string; label: string; providerLabel: string; slug: string; efforts: string[]; builtIn: boolean }
export type MusicProviderKind = 'elevenlabs-music' | 'gemini-lyria';
export interface MusicProviderEntry { id: string; label: string; kind: MusicProviderKind; model: string; ready: boolean }
export interface SettingsStatus { codexReady: boolean; elevenLabsReady: boolean; secureStorageAvailable: boolean; loginPending: boolean; model: string; error: string | null; chatModels: ChatModelOption[]; activeChat: ActiveChatSelection; providers: ChatProviderEntry[]; musicProviders: MusicProviderEntry[]; activeMusicId: string | null }
export interface ChatContext { model: string; tokens: number; limit: number | null; includesHiddenReasoning: boolean }
export interface Snapshot { conversations: Conversation[]; messages: Message[]; assets: Asset[]; jobs: Job[]; playground: Record<string, string[]>; settings: SettingsStatus; activeTurns: string[] }
export interface AssetPatch { name?: string; description?: string; tags?: string[]; collections?: string[]; review?: Review; feedback?: string }
export interface ModelCapabilityResult {
  perEffort: Record<string, 'pass' | 'fail'>; failedEfforts: string[];
  maxTokens: number | null; vision: CapabilityFlag; audio: CapabilityFlag; error?: string;
}
export interface SfxApi {
  snapshot(): Promise<Snapshot>;
  chatContext(conversationId: string, draft: string): Promise<ChatContext>;
  openLogs(): Promise<void>;
  createConversation(): Promise<string>;
  sendMessage(conversationId: string, text: string): Promise<void>;
  cancelTurn(conversationId: string): Promise<void>;
  generate(conversationId: string, input: GenerationInput): Promise<void>;
  generateMusic(conversationId: string, input: MusicGenerationInput): Promise<void>;
  cancelJob(id: string): Promise<void>;
  updateAsset(id: string, patch: AssetPatch, conversationId?: string): Promise<void>;
  analyzeAudio(id: string, input: AudioAnalysisInput): Promise<AudioAnalysis>;
  trimAsset(conversationId: string, id: string, input: TrimInput): Promise<Asset>;
  previewTrim(id: string, input: TrimInput): Promise<Uint8Array>;
  setPlayground(conversationId: string, assetIds: string[]): Promise<void>;
  importAudio(conversationId: string, kind?: AssetKind): Promise<void>;
  exportAsset(id: string): Promise<void>;
  searchAssets(query: string): Promise<Asset[]>;
  startLogin(): Promise<void>;
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
  saveElevenLabsKey(key: string): Promise<void>;
  saveModel(model: string): Promise<void>;
  saveChatProvider(input: { id?: string; label: string; baseUrl: string; kind: GenericProviderKind; apiKey?: string }): Promise<ChatProviderEntry>;
  deleteChatProvider(id: string): Promise<void>;
  listChatModels(providerId: string): Promise<string[]>;
  testChatModel(input: { providerId: string; slug: string; efforts: string[] }): Promise<ModelCapabilityResult>;
  saveChatModel(input: { id?: string; providerId: string; slug: string; efforts: string[] }): Promise<ChatModelEntry>;
  deleteChatModel(id: string): Promise<void>;
  setActiveChat(input: { modelId: string; effort: string }): Promise<void>;
  saveMusicProvider(input: { id?: string; label: string; kind: MusicProviderKind; model: string; apiKey?: string }): Promise<MusicProviderEntry>;
  deleteMusicProvider(id: string): Promise<void>;
  setActiveMusic(providerId: string): Promise<void>;
  onChanged(callback: () => void): () => void;
}
declare global { interface Window { sfx: SfxApi } }
