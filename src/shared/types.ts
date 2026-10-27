import type { ReviewBoard, UiCommand, PlaybackState, OperationResponse, InstallationInput } from './workbench';
import type { MidiComposition, MidiSummary } from './midi';
export type Review = 'unreviewed' | 'accepted' | 'rejected';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export type AssetKind = 'effect' | 'music' | 'voice' | 'midi';
export type AudioProviderId = 'elevenlabs' | 'gemini';
/** Who set a session title last: the app from the first message, the user, or the assistant. */
export type TitleSource = 'default' | 'user' | 'assistant';
export interface Project { id: string; name: string; createdAt: string }
export interface Conversation {
  id: string; title: string; createdAt: string; projectId: string;
  titleSource?: TitleSource;
}
/** Media a tool attached for the model, kept as an inspectable transcript record. */
export interface ChatAttachment {
  id: string; kind: 'image' | 'audio'; label: string; mediaType: string; bytes: number;
  startSeconds?: number; endSeconds?: number; duration?: number; sampleRate?: number;
}
export interface Message { id: string; conversationId: string; role: 'user' | 'assistant' | 'tool'; text: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; createdAt: string; attachments?: ChatAttachment[] }
export interface Asset {
  id: string; projectId: string; name: string; description: string; tags: string[]; collections: string[];
  review: Review; feedback: string; source: 'generated' | 'imported' | 'edited' | 'authored'; kind: AssetKind;
  format: 'mp3' | 'wav' | 'mid'; hash: string; bytes: number; duration: number | null;
  prompt: string; provider: string | null; model: string | null; requestId: string | null;
  request: AnyGenerationInput | null; usage: string | null; parentId: string | null; createdAt: string;
  providerPrompt?: string | null; lyrics?: string; edit?: TrimEdit;
  /** Present on MIDI assets: tempo, meter, per-track instrument summary, and musical length. */
  midi?: MidiSummary;
  /** Set on a MIDI clip derived from another clip by editing its notes. */
  midiEdit?: MidiEdit;
  arrangementRender?: { record: import('./arrangement').ArrangementRecord; input: import('./arrangement-operations').RenderInput; sourceHashes: Record<string, string>; seed: number; stem?: string; diagnostics: unknown };
}
export interface TrimInput {
  startSeconds: number; endSeconds: number; fadeInMs?: number; fadeOutMs?: number; name?: string;
  /** Render a wrap-crossfaded loop instead of a plain cut; fades are not allowed with it. */
  loop?: boolean; crossfadeMs?: number;
}
export interface TrimEdit {
  kind: 'trim'; version: 1; sourceHash: string; sampleRate: number;
  startFrame: number; endFrame: number; fadeInFrames: number; fadeOutFrames: number;
  requested: TrimInput; decoder: string; outputEncoding: 'float32-wav';
  loop?: { crossfadeFrames: number; outputFrames: number };
}
export interface AudioAnalysisInput { startSeconds?: number; endSeconds?: number; bins?: number; events?: boolean; seamProbe?: { startSeconds?: number; endSeconds?: number }; musical?: boolean }
export interface EventInterval {
  startFrame: number; endFrame: number; startSeconds: number; endSeconds: number;
  peak: number; rms: number;
}
export interface SeamProbe {
  startSeconds: number; endSeconds: number; startFrame: number; endFrame: number;
  windowSamples: number; discontinuity: number; rmsHead: number; rmsTail: number;
  correlation: number; suggestedOffsetFrames: number; bestCorrelation: number;
  searchFrames: number; zeroCrossAfterStart: number | null; zeroCrossBeforeEnd: number | null;
  note: string;
}
export interface AudioAnalysis {
  summary?: { peak: number; rms: number; clippedSamples: number; nearSilentFrames: number; silenceThreshold: number };
  version: 1; assetId: string; sourceHash: string; sampleRate: number; channels: number;
  totalFrames: number; duration: number; startFrame: number; endFrame: number;
  startSeconds: number; endSeconds: number; decoder: string;
  bins: { startFrame: number; endFrame: number; startSeconds: number; endSeconds: number; min: number; max: number; peak: number; rms: number }[];
  events?: EventInterval[];
  seam?: SeamProbe;
  musical?: MusicalAnalysis;
  note: string;
}
export interface MusicalAnalysis {
  version: 1;
  tempo: { bpm: number; confidence: number; steady: boolean; beatResidualMs: number } | null;
  meter: { beatsPerBar: number; assumed: true; downbeatConfidence: number };
  key: { label: string; tonic: string; mode: 'major' | 'minor'; correlation: number; confidence: number; alternatives: { label: string; correlation: number }[] } | null;
  loudness: { integratedLufs: number | null; samplePeakDbfs: number | null };
  beats: number[]; bars: { number: number; seconds: number }[]; truncated: boolean;
  note: string;
}
export interface LoopSearchInput {
  mode?: 'auto' | 'music' | 'texture';
  /** Optional search region; candidates lie entirely inside it. */
  startSeconds?: number; endSeconds?: number;
  minSeconds?: number; maxSeconds?: number;
  minBars?: number; maxBars?: number;
  /** false requires the loop to start at the beginning of the search region. */
  allowIntro?: boolean;
  count?: number;
}
export interface LoopCandidate {
  rank: number;
  startSeconds: number; endSeconds: number; startFrame: number; endFrame: number; lengthSeconds: number;
  bars: number | null; startBar: number | null; endBar: number | null;
  introSeconds: number; outroSeconds: number;
  score: number; match: 'close' | 'partial' | 'weak';
  similarity: { harmony: number | null; timbre: number; level: number; contextUnits: number };
  seam: { correlation: number; step: number; naturalStep: number; levelDeltaDb: number; alignmentShiftFrames: number };
  recommendedCrossfadeMs: number;
  summary: string;
}
export interface LoopSearchResult {
  version: 1; assetId: string; sourceHash: string; mode: 'music' | 'texture';
  sampleRate: number; duration: number;
  tempo: MusicalAnalysis['tempo']; key: string | null; beatsPerBar: number | null;
  candidates: LoopCandidate[];
  note: string;
}
export interface LoopSeamInput { startSeconds: number; endSeconds: number; crossfadeMs?: number; contextSeconds?: number }
export interface SpectrogramInput { startSeconds?: number; endSeconds?: number; width?: number; height?: number; freqScale?: 'log' | 'linear' }
export interface GenerationInput {
  kind?: 'effect'; prompt: string; count?: number; duration?: number | null; loop?: boolean;
  influence?: number; parentId?: string | null; name?: string;
}
export interface MusicGenerationInput {
  kind: 'music'; prompt: string; count?: number; durationMs?: number | null; instrumental?: boolean;
  /** Local provider override; null or omitted uses the active music provider. */
  providerId?: string | null; parentId?: string | null; name?: string;
}
export interface VoiceGenerationInput {
  kind: 'voice'; text: string; providerId?: AudioProviderId; model?: string; voiceId?: string;
  /** Optional prepared script; original text remains independently preserved. */
  providerText?: string; style?: string; stability?: number; similarity?: number; speed?: number;
  count?: number; name?: string; parentId?: string | null;
}
export interface MidiComposeInput {
  kind: 'midi';
  /** Short brief this clip responds to; kept as the asset prompt for search and regeneration context. */
  prompt: string;
  /** The notes themselves. This is the exact reproduction record; the app writes them to an SMF. */
  composition: MidiComposition;
  name?: string; parentId?: string | null;
}
export type AudioGenerationInput = GenerationInput | MusicGenerationInput | VoiceGenerationInput;
export type AnyGenerationInput = AudioGenerationInput | MidiComposeInput;
/** Note-level edit lineage for a MIDI clip derived from another clip. */
export interface MidiEdit {
  kind: 'midi-edit'; version: 1; sourceHash: string; ticksPerQuarter: number;
  requested: MidiComposition; outputEncoding: 'smf-1';
}
/** Bank metadata the studio's instrument picker needs; the local path stays in main. */
export interface SoundfontSummary { name: string; hash: string; presets: { bank: number; program: number; name: string }[] }
export interface VoiceProviderEntry { id: AudioProviderId; label: string; model: string; voiceId: string; ready: boolean }
export interface VoiceListInput { providerId: AudioProviderId; search?: string; language?: string; pageToken?: string }
export interface VoiceOption { id: string; name: string; description: string; labels: Record<string, string> }
export interface VoicePage { voices: VoiceOption[]; nextPageToken: string | null }
export interface VoiceModelListInput { providerId: AudioProviderId; refresh?: boolean }
export interface VoiceModelOption {
  id: string; label: string; note: string; maxCharacters: number | null;
  controls: { stability: boolean; similarity: boolean; speed: boolean; stabilityValues?: number[] };
  guidanceStatus: 'reviewed' | 'generic' | 'unavailable'; selectable: boolean;
  languages: { id: string; name: string }[]; description: string;
  requiresAlphaAccess: boolean | null; deprecated?: boolean; replacementModelId?: string;
}
export interface VoiceModelCatalog {
  providerId: AudioProviderId; source: 'live' | 'built-in'; fetchedAt: string | null;
  models: VoiceModelOption[]; defaultModel: string; defaultVoiceId: string;
}
export interface ProviderKeyStatus { id: AudioProviderId; ready: boolean; candidates: { id: string; label: string }[] }
export interface Job { id: string; conversationId: string; kind: AssetKind; status: JobStatus; input: AnyGenerationInput; assetId: string | null; error: string | null; createdAt: string }
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
export interface SettingsStatus { codexReady: boolean; elevenLabsReady: boolean; geminiReady: boolean; providerKeys: ProviderKeyStatus[]; voiceProviders: VoiceProviderEntry[]; activeVoiceId: AudioProviderId; secureStorageAvailable: boolean; loginPending: boolean; model: string; error: string | null; chatModels: ChatModelOption[]; activeChat: ActiveChatSelection; providers: ChatProviderEntry[]; musicProviders: MusicProviderEntry[]; activeMusicId: string | null }
export interface ChatContext { model: string; tokens: number; limit: number | null; includesHiddenReasoning: boolean; includesEstimatedMedia: boolean }
/** Every list below is scoped to `activeProjectId`; other projects' rows never reach the renderer. */
export interface Snapshot { projects: Project[]; activeProjectId: string; conversations: Conversation[]; messages: Message[]; assets: Asset[]; jobs: Job[]; playground: Record<string, string[]>; settings: SettingsStatus; activeTurns: string[]; reviews: ReviewBoard[] }
export interface AssetPatch { name?: string; description?: string; tags?: string[]; collections?: string[]; review?: Review; feedback?: string }
export interface ModelCapabilityResult {
  perEffort: Record<string, 'pass' | 'fail'>; failedEfforts: string[];
  maxTokens: number | null; vision: CapabilityFlag; audio: CapabilityFlag; error?: string;
}
export interface SfxApi {
  readonly hostMode: 'desktop' | 'browser';
  mediaUrl(path: string): string;
  operation(name: string, args: unknown): Promise<OperationResponse>;
  installIntegration(input: InstallationInput): Promise<OperationResponse>;
  chooseDirectory(): Promise<string | null>;
  uiReady(): Promise<void>;
  uiAcknowledge(id: string, error?: string): Promise<void>;
  playbackReport(sessionId: string, state: PlaybackState): Promise<void>;
  onUiCommand(callback: (command: UiCommand) => void): () => void;
  snapshot(): Promise<Snapshot>;
  chatContext(conversationId: string, draft: string): Promise<ChatContext>;
  openLogs(): Promise<void>;
  createConversation(): Promise<string>;
  renameConversation(conversationId: string, title: string): Promise<void>;
  createProject(name: string): Promise<Project>;
  renameProject(projectId: string, name: string): Promise<Project>;
  setActiveProject(projectId: string): Promise<void>;
  sendMessage(conversationId: string, text: string): Promise<void>;
  cancelTurn(conversationId: string): Promise<void>;
  generate(conversationId: string, input: GenerationInput): Promise<void>;
  generateMusic(conversationId: string, input: MusicGenerationInput): Promise<void>;
  generateVoice(conversationId: string, input: VoiceGenerationInput): Promise<void>;
  listVoices(input: VoiceListInput): Promise<VoicePage>;
  listVoiceModels(input: VoiceModelListInput): Promise<VoiceModelCatalog>;
  saveVoiceProvider(input: { id: AudioProviderId; model: string; voiceId: string }): Promise<void>;
  setActiveVoice(id: AudioProviderId): Promise<void>;
  saveProviderKey(id: AudioProviderId, key: string): Promise<void>;
  selectProviderKey(id: AudioProviderId, candidateId: string): Promise<void>;
  cancelJob(id: string): Promise<void>;
  updateAsset(id: string, patch: AssetPatch, conversationId?: string): Promise<void>;
  analyzeAudio(id: string, input: AudioAnalysisInput): Promise<AudioAnalysis>;
  trimAsset(conversationId: string, id: string, input: TrimInput): Promise<Asset>;
  previewTrim(id: string, input: TrimInput): Promise<Uint8Array>;
  previewSeam(id: string, input: LoopSeamInput): Promise<Uint8Array>;
  spectrogram(id: string, input: SpectrogramInput): Promise<Uint8Array>;
  midiNotes(id: string): Promise<MidiComposition>;
  previewMidi(composition: MidiComposition): Promise<Uint8Array>;
  saveMidiEdit(conversationId: string, id: string | null, composition: MidiComposition, name?: string): Promise<Asset>;
  soundfontInfo(): Promise<SoundfontSummary>;
  setPlayground(conversationId: string, assetIds: string[]): Promise<void>;
  importAudio(conversationId: string, kind?: AssetKind): Promise<void>;
  exportAsset(id: string, format?: 'original' | 'wav' | 'ogg'): Promise<void>;
  searchAssets(query: string): Promise<Asset[]>;
  startLogin(): Promise<void>;
  cancelLogin(): Promise<void>;
  logout(): Promise<void>;
  saveModel(model: string): Promise<void>;
  saveChatProvider(input: { id?: string; label: string; baseUrl: string; kind: GenericProviderKind; apiKey?: string }): Promise<ChatProviderEntry>;
  deleteChatProvider(id: string): Promise<void>;
  listChatModels(providerId: string): Promise<string[]>;
  testChatModel(input: { providerId: string; slug: string; efforts: string[] }): Promise<ModelCapabilityResult>;
  saveChatModel(input: { id?: string; providerId: string; slug: string; efforts: string[] }): Promise<ChatModelEntry>;
  deleteChatModel(id: string): Promise<void>;
  setActiveChat(input: { modelId: string; effort: string }): Promise<void>;
  saveMusicProvider(input: { id?: string; label: string; kind: MusicProviderKind; model: string }): Promise<MusicProviderEntry>;
  deleteMusicProvider(id: string): Promise<void>;
  setActiveMusic(providerId: string): Promise<void>;
  onChanged(callback: () => void): () => void;
}
declare global { interface Window { sfx: SfxApi } }
