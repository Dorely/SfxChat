export type Review = 'unreviewed' | 'accepted' | 'rejected';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export interface Conversation { id: string; title: string; createdAt: string }
export interface Message { id: string; conversationId: string; role: 'user' | 'assistant' | 'tool'; text: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; createdAt: string }
export interface Asset {
  id: string; name: string; description: string; tags: string[]; collections: string[];
  review: Review; feedback: string; source: 'generated' | 'imported';
  format: 'mp3' | 'wav'; hash: string; bytes: number; duration: number | null;
  prompt: string; provider: string | null; model: string | null; requestId: string | null;
  request: GenerationInput | null; usage: string | null; parentId: string | null; createdAt: string;
}
export interface GenerationInput {
  prompt: string; count?: number; duration?: number | null; loop?: boolean;
  influence?: number; parentId?: string | null; name?: string;
}
export interface Job { id: string; conversationId: string; status: JobStatus; input: GenerationInput; assetId: string | null; error: string | null; createdAt: string }
export interface SettingsStatus { codexReady: boolean; elevenLabsReady: boolean; secureStorageAvailable: boolean; loginPending: boolean; model: string; error: string | null }
export interface Snapshot { conversations: Conversation[]; messages: Message[]; assets: Asset[]; jobs: Job[]; playground: Record<string, string[]>; settings: SettingsStatus; activeTurns: string[] }
export interface AssetPatch { name?: string; description?: string; tags?: string[]; collections?: string[]; review?: Review; feedback?: string }
export interface SfxApi {
  snapshot(): Promise<Snapshot>;
  createConversation(): Promise<string>;
  sendMessage(conversationId: string, text: string): Promise<void>;
  cancelTurn(conversationId: string): Promise<void>;
  generate(conversationId: string, input: GenerationInput): Promise<void>;
  cancelJob(id: string): Promise<void>;
  updateAsset(id: string, patch: AssetPatch, conversationId?: string): Promise<void>;
  setPlayground(conversationId: string, assetIds: string[]): Promise<void>;
  importAudio(conversationId: string): Promise<void>;
  exportAsset(id: string): Promise<void>;
  searchAssets(query: string): Promise<Asset[]>;
  startLogin(): Promise<void>;
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
  saveElevenLabsKey(key: string): Promise<void>;
  saveModel(model: string): Promise<void>;
  onChanged(callback: () => void): () => void;
}
declare global { interface Window { sfx: SfxApi } }
