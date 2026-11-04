import { operationDefinitions } from './operations';
import { Store } from './store';
import { MediaLibrary, generatedFields } from './media';
import { analysisSchema, clipSchema, generationSchema, loopSearchSchema, loopSeamSchema, midiCompositionSchema, midiGenerationSchema, musicGenerationSchema, voiceGenerationSchema, patchSchema, spectrogramSchema, trimSchema } from './validation';
import { instructions, midiInstructions, musicInstructions, voiceInstructions, tools, toolSchemas } from './assistant';
import { parseMidi, writeMidi } from './midi';
import { MIDI_TICKS_PER_QUARTER, midiCompositionProblem, midiDurationSeconds, midiSummary, type MidiComposition } from '../shared/midi';
import { floatWav, renderClip, type ClipRender } from './audio';
import type { Asset, AssetKind, AssetPatch, AudioAnalysisInput, LoopSearchInput, LoopSeamInput, AnyGenerationInput, GenerationInput, MusicGenerationInput, MidiComposeInput, MusicProviderKind, SoundfontSummary, VoiceGenerationInput, VoiceListInput, VoicePage, VoiceModelListInput, VoiceModelCatalog, AudioModelListInput, AudioModelCatalog, SettingsStatus, Snapshot, SpectrogramInput, TrimInput } from '../shared/types';
import type { DiagnosticLog } from './diagnostics';
import { diagnosticError } from './providers/errors';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ContextTokenCounter } from './chat-context';
import { CHAT_MODELS, resolveChatModel } from '../shared/chat-models';
import { LATEST_MODEL } from '../shared/elevenlabs-models';
import { isMusicModel, musicModels } from '../shared/music-models';

export interface ChatResult { output: unknown[]; calls: { id: string; name: string; arguments: string }[]; usage?: unknown; requestId?: string | null }
/** Media a tool produced for the model; bytes stay out of the tool ledger. */
export interface ToolAttachment { label: string; kind: 'image' | 'audio'; mime: string; base64: string }
export interface ToolOutcome { output: string; attachments: ToolAttachment[] }
/** Provider-reported outcome of one generation, including the provider that produced it. */
export interface GenerationResult {
  bytes: Buffer;
  format: 'mp3' | 'wav' | 'mid';
  provider: string;
  model: string;
  requestId: string | null;
  usage: string | null;
  /** Exact provider text when the app appended provider-specific guidance. */
  providerPrompt?: string | null;
  /** Lyrics or structure text returned by the provider, when it returns any. */
  lyrics?: string;
}
export interface ServicePorts {
  settings(): Promise<SettingsStatus>;
  chat(options: { model: string; input: unknown[]; instructions: string; tools: unknown[]; signal: AbortSignal; onText: (text: string) => void }): Promise<ChatResult>;
  generateEffect(input: GenerationInput, signal: AbortSignal): Promise<GenerationResult>;
  generateMusic(input: MusicGenerationInput, signal: AbortSignal): Promise<GenerationResult>;
  generateVoice(input: VoiceGenerationInput, signal: AbortSignal): Promise<GenerationResult>;
  listVoices(input: VoiceListInput): Promise<VoicePage>;
  listVoiceModels(input: VoiceModelListInput): Promise<VoiceModelCatalog>;
  listAudioModels(input: AudioModelListInput): Promise<AudioModelCatalog>;
  validateVoiceTarget(input: VoiceGenerationInput): Promise<void>;
  /** Renders a MIDI clip's interval through the SoundFont bank for listening. */
  renderMidi(asset: Asset, input: { startSeconds?: number; endSeconds?: number }): Promise<ClipRender>;
  /** Renders an in-editor composition to WAV bytes for the studio's preview playback. */
  renderMidiBytes(midi: Buffer, seconds: number): Promise<Buffer>;
  /** The active bank's metadata and preset list for the studio's instrument picker. */
  soundfont(): Promise<SoundfontSummary>;
  safeError(error: unknown): string;
}
export class WorkbenchService {
  operation?: (name: string, args: unknown) => Promise<unknown>;
  private contextCounter = new ContextTokenCounter();
  private liveContext = new Map<string, { input: unknown[]; text: string }>();
  private turns = new Map<string, AbortController>();
  private activeJob: { id: string; controller: AbortController } | null = null;
  private pumpPromise: Promise<void> | null = null;
  private turnPromises = new Set<Promise<void>>();
  private editPromises = new Set<Promise<unknown>>();
  private stopped = false;
  constructor(readonly store: Store, readonly media: MediaLibrary, private ports: ServicePorts, private changed: () => void, private diagnostics?: Pick<DiagnosticLog, 'record'>) {}
  private requireOpen() { if (this.stopped) throw new Error('SfxChat is closing.'); }
  deleteWorkspace(projectId: string, sessionId?: string) {
    this.requireOpen();
    // In-flight edits can still publish records after asynchronous media work.
    if (this.store.db.prepare("SELECT 1 FROM external_requests WHERE status='admitting' LIMIT 1").get() || this.store.db.prepare("SELECT 1 FROM arrangement_jobs WHERE json_extract(json,'$.status') IN ('queued','running') LIMIT 1").get() || this.editPromises.size || this.turns.size || this.store.jobs().some(job => ['queued', 'running'].includes(job.status)))
      throw new Error('Wait for active responses, generation jobs and audio edits to finish before deleting.');
    if (sessionId) this.store.deleteConversation(sessionId); else this.store.deleteProject(projectId);
    this.store.ensureConversation(this.store.activeProjectId());
  }
  settings() { return this.ports.settings(); }
  async snapshot(): Promise<Snapshot> {
    const projectId = this.store.activeProjectId();
    const visible = new Set(this.store.conversations(projectId).map(conversation => conversation.id));
    return {
      projects: this.store.projects(), activeProjectId: projectId, conversations: this.store.conversations(projectId),
      messages: this.store.messages(projectId), assets: this.store.assets(projectId), jobs: this.store.jobs(projectId),
      playground: this.store.playground(projectId), settings: await this.ports.settings(),
      activeTurns: [...this.turns.keys()].filter(id => visible.has(id)), reviews: this.store.reviews(projectId)
    };
  }
  private chatInstructions(conversationId: string, settings: SettingsStatus) {
    const conversation = this.store.conversation(conversationId);
    const project = this.store.project(conversation.projectId);
    const titledBy = conversation.titleSource === 'user' ? 'chosen by the user'
      : conversation.titleSource === 'assistant' ? 'named by you'
      : 'still auto-assigned, so name it once the goal is clear';
    return instructions
      + `\n${musicInstructions(settings.musicProviders, settings.activeMusicId)}`
      + `\n${voiceInstructions(settings.voiceProviders, settings.activeVoiceId)}`
      + `\n${midiInstructions()}`
      + `\nCurrent project: "${project.name}". Session title: "${conversation.title}" (${titledBy}). This project's sessions and library are the only work visible to you; other projects are separate.`
      + `\nCurrent comparison board: ${JSON.stringify(this.store.playground(conversation.projectId)[conversation.projectId] ?? [])}\nCurrent generation jobs: ${JSON.stringify(this.store.jobs().filter(j => j.conversationId === conversationId).map(j => ({ id: j.id, kind: j.kind, status: j.status, assetId: j.assetId })))}`;
  }
  async chatContext(conversationId: string, draft = '') {
    this.requireOpen();
    this.store.requireConversation(conversationId);
    const settings = await this.ports.settings();
    const model = resolveChatModel(settings.model);
    this.requireOpen();
    const live = this.liveContext.get(conversationId);
    const input = live?.input ?? this.store.repairToolHistory(conversationId, JSON.parse(this.store.setting(`history/${conversationId}`, '[]'))).input;
    return {
      model, limit: CHAT_MODELS.find(entry => entry.id === model)?.contextLimit ?? null,
      ...this.contextCounter.count({ instructions: this.chatInstructions(conversationId, settings), tools, input, draft, streamingText: live?.text })
    };
  }
  async generate(conversationId: string, raw: GenerationInput, callId?: string) {
    this.requireOpen();
    const input = generationSchema.parse(raw);
    if (input.parentId) this.store.asset(input.parentId, this.store.conversation(conversationId).projectId);
    const settings = await this.ports.settings();
    this.requireOpen();
    if (!settings.elevenLabsReady) throw new Error('Add your ElevenLabs API key in Settings first.');
    if (input.model && input.model !== LATEST_MODEL) await this.requireListedModel('effect', input.model);
    this.requireOpen();
    const jobs = await this.queueCandidates(conversationId, input, 'effect', callId);
    this.store.addMessage(conversationId, 'tool', `Queued ${jobs.length} sound${jobs.length === 1 ? '' : 's'}: ${input.prompt}`);
    this.pump(); return { jobIds: jobs.map(j => j.id) };
  }
  async generateMusic(conversationId: string, raw: MusicGenerationInput, callId?: string) {
    this.requireOpen();
    const parsed = musicGenerationSchema.parse(raw);
    if (parsed.parentId) this.store.asset(parsed.parentId, this.store.conversation(conversationId).projectId);
    const settings = await this.ports.settings();
    this.requireOpen();
    if (!settings.musicProviders.length) throw new Error('Configure a music provider in Settings first.');
    const requested = parsed.providerId ? settings.musicProviders.find(entry => entry.id === parsed.providerId) : undefined;
    if (parsed.providerId && !requested) throw new Error(`No configured music provider has the ID "${parsed.providerId}". Configured providers: ${settings.musicProviders.map(entry => `${entry.label} (${entry.id})`).join(', ')}. Omit providerId to use the active provider, or pick another in Settings.`);
    const target = requested ?? settings.musicProviders.find(entry => entry.id === settings.activeMusicId) ?? settings.musicProviders.find(entry => entry.ready);
    if (!target) throw new Error('Configure a music provider in Settings first.');
    if (!target.ready) throw new Error(`Add the API key for ${target.label} in Settings first.`);
    if (parsed.model) {
      if (target.kind === 'elevenlabs-music') { if (parsed.model !== LATEST_MODEL) await this.requireListedModel('music', parsed.model); }
      else if (!isMusicModel(target.kind, parsed.model)) throw new Error(`"${parsed.model}" is not a ${target.label} model. Choose one of: ${musicModels(target.kind).map(entry => entry.id).join(', ')}.`);
      this.requireOpen();
    }
    const input: MusicGenerationInput = { ...parsed, kind: 'music', providerId: target.id };
    const jobs = await this.queueCandidates(conversationId, input, 'music', callId);
    const model = parsed.model ?? target.model;
    this.store.addMessage(conversationId, 'tool', `Queued ${jobs.length} track${jobs.length === 1 ? '' : 's'} on ${target.label} (${model === LATEST_MODEL ? `latest: ${target.resolvedModel}` : model}): ${input.prompt}`);
    this.pump(); return { jobIds: jobs.map(j => j.id) };
  }
  async generateVoice(conversationId: string, raw: VoiceGenerationInput, callId?: string) {
    this.requireOpen();
    const parsed = voiceGenerationSchema.parse(raw);
    if (parsed.parentId) this.store.asset(parsed.parentId, this.store.conversation(conversationId).projectId);
    const settings = await this.ports.settings(); this.requireOpen();
    const target = settings.voiceProviders.find(p => p.id === (parsed.providerId ?? settings.activeVoiceId));
    if (!target?.ready) throw new Error('Save or resolve the shared provider key in Settings before generating voice.');
    // "latest" resolves at admission because controls and limits are model-specific.
    let model = parsed.model ?? target.model;
    if (model === LATEST_MODEL) { model = (await this.ports.listVoiceModels({ providerId: target.id })).latestModel; this.requireOpen(); }
    const input: VoiceGenerationInput = { ...parsed, kind: 'voice', providerId: target.id, model, voiceId: parsed.voiceId ?? target.voiceId };
    await this.ports.validateVoiceTarget(input); this.requireOpen();
    const jobs = await this.queueCandidates(conversationId, input, 'voice', callId);
    this.store.addMessage(conversationId, 'tool', `Queued ${jobs.length} voice clip${jobs.length === 1 ? '' : 's'} on ${target.label} (${input.model}, ${input.voiceId}): ${input.text}`);
    this.pump(); return { jobIds: jobs.map(j => j.id) };
  }
  listVoices(input: VoiceListInput) { this.requireOpen(); return this.ports.listVoices(input); }
  listVoiceModels(input: VoiceModelListInput) { this.requireOpen(); return this.ports.listVoiceModels(input); }
  listAudioModels(input: AudioModelListInput) { this.requireOpen(); return this.ports.listAudioModels(input); }
  private async requireListedModel(kind: AudioModelListInput['kind'], model: string) {
    const catalog = await this.ports.listAudioModels({ kind });
    if (!catalog.models.some(entry => entry.id === model)) throw new Error(`"${model}" is not a listed ElevenLabs ${kind === 'effect' ? 'sound-effect' : 'music'} model. Choose one of: ${catalog.models.map(entry => entry.id).join(', ')}, or omit model for the newest.`);
  }
  /** Composing MIDI is local: it writes a Standard MIDI File and needs no provider, key, or network call. */
  async generateMidi(conversationId: string, raw: MidiComposeInput, callId?: string) {
    this.requireOpen();
    const input = midiGenerationSchema.parse(raw) as MidiComposeInput;
    if (input.parentId) this.store.asset(input.parentId, this.store.conversation(conversationId).projectId);
    const jobs = await this.queueCandidates(conversationId, input, 'midi', callId);
    this.store.addMessage(conversationId, 'tool', `Composing ${jobs.length} MIDI clip${jobs.length === 1 ? '' : 's'}: ${input.prompt}`);
    this.pump(); return { jobIds: jobs.map(j => j.id) };
  }
  private composeMidi(input: MidiComposeInput): GenerationResult {
    return { bytes: writeMidi(input.composition), format: 'mid', provider: 'SfxChat', model: 'MIDI', requestId: null, usage: null };
  }
  /** Renders a MIDI clip interval for listening; audio assets stay on the decoded path. */
  midiClip(id: string, raw: { startSeconds?: number; endSeconds?: number }, projectId: string) {
    this.requireOpen();
    const { loopSeam, ...input } = clipSchema.parse(raw);
    if (loopSeam) throw new Error('Loop seams are measured on decoded audio. Render the MIDI clip or arrangement to audio first.');
    return this.ports.renderMidi(this.store.asset(id, projectId), input);
  }
  /** Parsed notes of a stored clip, loaded into the studio's roll. */
  async midiNotes(id: string, projectId: string): Promise<MidiComposition> {
    this.requireOpen();
    const asset = this.store.asset(id, projectId);
    if (asset.format !== 'mid') throw new Error('Only MIDI clips have notes to edit.');
    return parseMidi(await readFile(this.media.path(asset)));
  }
  /** Renders an unsaved composition so the studio can audition a draft before saving it. */
  async previewMidi(raw: MidiComposition) {
    this.requireOpen();
    const composition = midiCompositionSchema.parse(raw) as MidiComposition;
    const problem = midiCompositionProblem(composition);
    if (problem) throw new Error(problem);
    return new Uint8Array(await this.ports.renderMidiBytes(writeMidi(composition), midiDurationSeconds(composition)));
  }
  soundfont() { this.requireOpen(); return this.ports.soundfont(); }
  /**
   * Saves a composition from the studio. Editing an existing clip writes a derivative with its own
   * lineage, so the composed original is never modified; a new draft becomes an authored clip.
   */
  async saveMidiEdit(conversationId: string, id: string | null, raw: MidiComposition, name?: string) {
    this.requireOpen();
    const composition = midiCompositionSchema.parse(raw) as MidiComposition;
    const problem = midiCompositionProblem(composition);
    if (problem) throw new Error(problem);
    const conversation = this.store.conversation(conversationId);
    const parent = id ? this.store.asset(id, conversation.projectId) : null;
    const prompt = parent?.prompt ?? (name?.trim() || 'Authored MIDI clip');
    const asset = await this.media.save(writeMidi(composition), 'mid', {
      projectId: conversation.projectId, source: parent ? 'edited' : 'authored', kind: 'midi',
      name: name?.trim() || parent?.name || 'Untitled clip', description: parent?.description ?? '',
      tags: parent ? [...parent.tags] : [], collections: parent ? [...parent.collections] : [],
      prompt, request: { kind: 'midi', prompt, composition }, midi: midiSummary(composition),
      ...(parent ? {
        parentId: parent.id,
        midiEdit: { kind: 'midi-edit' as const, version: 1 as const, sourceHash: parent.hash, ticksPerQuarter: MIDI_TICKS_PER_QUARTER, requested: composition, outputEncoding: 'smf-1' as const }
      } : {})
    });
    this.store.requireConversation(conversationId);
    this.store.insertAsset(asset);
    this.store.addToPlayground(conversationId, [asset.id]);
    this.store.addMessage(conversationId, 'tool', parent ? `Saved note edits as “${asset.name}”. The original clip is preserved.` : `Created “${asset.name}” in the MIDI studio.`);
    return asset;
  }
  /**
   * Admits candidates in transactions of up to 128 jobs, yielding between them so
   * large explicit requests keep the UI and shutdown responsive. This is an
   * admission chunk, not a count limit.
   */
  private async queueCandidates(conversationId: string, input: AnyGenerationInput, kind: AssetKind, callId?: string) {
    const jobs: ReturnType<Store['createJobs']> = [];
    // MIDI composition carries no candidate count: one call composes one clip.
    const requested = 'count' in input ? input.count ?? 1 : 1;
    if (requested > 128) this.store.addMessage(conversationId, 'tool', `Preparing ${requested} requested candidates. If the app closes during preparation, only already queued candidates will run.`);
    for (let remaining = requested; remaining > 0;) {
      this.requireOpen();
      const count = Math.min(128, remaining);
      jobs.push(...this.store.createJobs(conversationId, 'count' in input ? { ...input, count } : input, kind, callId));
      remaining -= count;
      if (remaining) await new Promise<void>(resolve => setImmediate(resolve));
    }
    return jobs;
  }
  pump() {
    if (this.stopped || this.pumpPromise) return;
    this.pumpPromise = this.runJobs().finally(() => { this.pumpPromise = null; this.changed(); });
  }
  private async runJobs() {
    while (!this.stopped) {
      const job = this.store.jobs().find(j => j.status === 'queued'); if (!job) break;
      const controller = new AbortController(); this.activeJob = { id: job.id, controller };
      job.status = 'running'; this.store.updateJob(job);
      this.diagnostics?.record('generation.started', { conversationId: job.conversationId, jobId: job.id, kind: job.kind });
      try {
        const result = job.input.kind === 'voice'
          ? await this.ports.generateVoice(job.input, controller.signal)
          : job.input.kind === 'music'
          ? await this.ports.generateMusic(job.input, controller.signal)
          : job.input.kind === 'midi'
          ? this.composeMidi(job.input)
          : await this.ports.generateEffect(job.input, controller.signal);
        const asset = await this.media.save(result.bytes, result.format, {
          ...generatedFields(job.input, job.kind, this.store.conversation(job.conversationId).projectId), provider: result.provider, model: result.model,
          requestId: result.requestId, usage: result.usage,
          providerPrompt: result.providerPrompt ?? null,
          ...(result.lyrics ? { lyrics: result.lyrics } : {}),
          ...(job.input.kind === 'midi' ? { midi: midiSummary(job.input.composition) } : {})
        });
        if (asset.duration === null || asset.duration <= 0) {
          this.store.insertAsset(asset);
          this.store.updateJob({ ...job, status: 'failed', assetId: asset.id, error: 'Returned audio could not be validated. Original bytes were retained; no retry was made.' });
          this.store.addMessage(job.conversationId, 'tool', 'The returned audio could not be validated. Its original bytes are retained in the library.', 'failed');
          this.diagnostics?.record('generation.invalid_audio', { conversationId: job.conversationId, jobId: job.id, assetId: asset.id, requestId: result.requestId });
          continue;
        }
        // A complete response that races cancellation is retained as a completed
        // original. Cancellation cannot unspend or unreceive a provider result.
        this.store.completeJob(job, asset);
        this.diagnostics?.record('generation.completed', { conversationId: job.conversationId, jobId: job.id, assetId: asset.id, provider: result.provider, requestId: result.requestId, bytes: asset.bytes, hash: asset.hash });
        this.store.addMessage(job.conversationId, 'tool', `Ready: ${asset.name}${asset.duration === null ? ' (audio metadata could not be read; audition before use)' : ''}`);
      } catch (error) {
        const knownFailure = !!error && typeof error === 'object' && ('status' in error || 'statusCode' in error);
        const stopped = controller.signal.aborted;
        const reference = this.diagnostics?.record('generation.failed', { conversationId: job.conversationId, jobId: job.id, cancelled: stopped, error: diagnosticError(error) });
        const detail = (stopped ? 'Stopped after dispatch; provider completion/billing is uncertain. No automatic retry.' : this.ports.safeError(error)) + logReference(reference);
        this.store.updateJob({ ...job, status: stopped ? 'uncertain' : knownFailure ? 'failed' : 'uncertain', error: detail });
        this.store.addMessage(job.conversationId, 'tool', `Generation failed: ${detail}`, 'failed');
      } finally { this.activeJob = null; }
    }
  }
  cancelJob(id: string) {
    const job = this.store.job(id);
    if (job.status === 'queued') this.store.updateJob({ ...job, status: 'cancelled' });
    if (this.activeJob?.id === id) this.activeJob.controller.abort();
  }
  updateAsset(id: string, raw: AssetPatch, conversationId?: string) {
    this.requireOpen();
    const patch = patchSchema.parse(raw);
    const projectId = conversationId ? this.store.conversation(conversationId).projectId : this.store.activeProjectId();
    this.store.updateAsset(id, patch, projectId, conversationId);
  }
  async importFiles(conversationId: string, paths: string[], kind: AssetKind = 'effect') {
    this.requireOpen();
    this.store.requireConversation(conversationId);
    const projectId = this.store.conversation(conversationId).projectId;
    const imported: Asset[] = [];
    for (const path of paths) {
      const asset = await this.media.import(path, projectId, kind); this.requireOpen(); this.store.requireConversation(conversationId); this.store.insertAsset(asset); this.store.addToPlayground(conversationId, [asset.id]);
      this.store.addMessage(conversationId, 'tool', `Imported “${asset.name}”.`);
      imported.push(asset);
    }
    return imported;
  }
  analyzeAudio(id: string, raw: AudioAnalysisInput, projectId: string) {
    this.requireOpen();
    return this.media.analyze(this.store.asset(id, projectId), analysisSchema.parse(raw));
  }
  findLoopPoints(id: string, raw: LoopSearchInput, projectId: string) {
    this.requireOpen();
    return this.media.findLoops(this.store.asset(id, projectId), loopSearchSchema.parse(raw));
  }
  /** Mono listening clip across a loop's wrap, exactly as a loop render plays it. */
  async seamClip(asset: Asset, raw: LoopSeamInput) {
    this.requireOpen();
    const seam = await this.media.loopSeam(asset, loopSeamSchema.parse(raw));
    const clip = await renderClip({ channels: seam.channels, sampleRate: seam.sampleRate, decoder: 'loop seam' }, {});
    return { ...clip, seam: { startFrame: seam.startFrame, endFrame: seam.endFrame, crossfadeFrames: seam.crossfadeFrames, crossfadeSource: seam.crossfadeSource, seamAtSeconds: seam.seamFrame / seam.sampleRate, crossfadeStartSeconds: seam.crossfadeStartFrame / seam.sampleRate, duration: seam.channels[0].length / seam.sampleRate } };
  }
  async previewSeam(id: string, raw: LoopSeamInput, projectId: string) {
    this.requireOpen();
    const seam = await this.media.loopSeam(this.store.asset(id, projectId), loopSeamSchema.parse(raw));
    return new Uint8Array(floatWav(seam.channels, seam.sampleRate));
  }
  async spectrogram(id: string, raw: SpectrogramInput, projectId: string) {
    this.requireOpen();
    const rendered = await this.media.spectrogram(this.store.asset(id, projectId), spectrogramSchema.parse(raw));
    return new Uint8Array(rendered.png);
  }
  async previewTrim(id: string, raw: TrimInput, projectId: string) {
    this.requireOpen();
    return new Uint8Array((await this.media.renderTrim(this.store.asset(id, projectId), trimSchema.parse(raw))).bytes);
  }
  trimAsset(conversationId: string, id: string, raw: TrimInput, callId?: string, signal?: AbortSignal) {
    this.requireOpen();
    const input = trimSchema.parse(raw);
    this.store.requireConversation(conversationId);
    const source = this.store.asset(id, this.store.conversation(conversationId).projectId);
    const pending = (async () => {
      const rendered = await this.media.renderTrim(source, input);
      this.requireOpen();
      signal?.throwIfAborted();
      const asset = await this.media.save(rendered.bytes, 'wav', {
        projectId: source.projectId, source: 'edited', kind: source.kind, name: input.name ?? `${source.name} (trim)`, description: source.description,
        tags: [...source.tags], collections: [...source.collections], parentId: source.id, edit: rendered.edit,
        // Generation provenance remains on the immutable parent; no new provider request occurred.
        prompt: source.prompt
      });
      try {
        this.requireOpen();
        signal?.throwIfAborted();
        this.store.db.transaction(() => {
          this.store.insertAsset(asset);
          this.store.addToPlayground(conversationId, [asset.id]);
          this.store.addMessage(conversationId, 'tool', rendered.edit.loop
            ? `Looped “${source.name}” from ${rendered.edit.startFrame / rendered.edit.sampleRate}–${rendered.edit.endFrame / rendered.edit.sampleRate}s with a ${rendered.edit.loop.crossfadeFrames}-frame ${rendered.edit.loop.crossfadeShape ?? 'linear'} seam crossfade${rendered.edit.loop.levelMatchDb ? `, level ramped ${(-rendered.edit.loop.levelMatchDb).toFixed(1)} dB across the loop` : ''}${rendered.edit.loop.loopStartFrame ? `, after a ${(rendered.edit.loop.loopStartFrame / rendered.edit.sampleRate).toFixed(3)} s intro (loop points embedded as a WAV smpl chunk)` : ''} as “${asset.name}”. Original preserved.`
            : `Trimmed “${source.name}” to ${rendered.edit.startFrame / rendered.edit.sampleRate}–${rendered.edit.endFrame / rendered.edit.sampleRate}s as “${asset.name}”. Original preserved.`);
          // Registration and durable tool result commit together: replay cannot create a second derivative.
          if (callId) this.store.finishTool(callId, JSON.stringify(asset));
        })();
      } catch (error) {
        // This UUID file was created by this operation and never registered. A deliberate
        // cancellation/transaction failure should not leave an orphaned derivative.
        await unlink(this.media.path(asset)).catch(() => this.diagnostics?.record('trim.cleanup_failed', { assetId: asset.id }));
        throw error;
      }
      return asset;
    })();
    this.editPromises.add(pending);
    void pending.finally(() => this.editPromises.delete(pending)).catch(() => undefined);
    return pending;
  }
  async sendMessage(conversationId: string, text: string) {
    this.requireOpen();
    this.store.requireConversation(conversationId);
    if (this.turns.has(conversationId)) throw new Error('A response is already running in this conversation.');
    const controller = new AbortController(); this.turns.set(conversationId, controller);
    this.store.titleConversation(conversationId, text); this.store.addMessage(conversationId, 'user', text); this.store.setTurn(conversationId, 'running');
    const promise = this.runTurn(conversationId, text, controller).finally(() => { this.turns.delete(conversationId); this.turnPromises.delete(promise); this.changed(); });
    this.turnPromises.add(promise);
  }
  cancelTurn(conversationId: string) { this.turns.get(conversationId)?.abort(); }
  private async runTurn(conversationId: string, text: string, controller: AbortController) {
    const historyKey = `history/${conversationId}`;
    let message = this.store.addMessage(conversationId, 'assistant', '', 'running');
    let round = 0;
    try {
      const repaired = this.store.repairToolHistory(conversationId, JSON.parse(this.store.setting(historyKey, '[]')));
      const input = repaired.input;
      const live = { input, text: '' }; this.liveContext.set(conversationId, live);
      if (repaired.restoredCallIds.length) this.diagnostics?.record('chat.history_repaired', { conversationId, callIds: repaired.restoredCallIds });
      input.push({ role: 'user', content: [{ type: 'input_text', text }] });
      this.store.setSetting(historyKey, JSON.stringify(input));
      while (!controller.signal.aborted) {
        round++;
        const settings = await this.ports.settings();
        this.diagnostics?.record('chat.request_started', { conversationId, messageId: message.id, round, model: settings.model, input: inputSummary(input) });
        const response = await this.ports.chat({ model: resolveChatModel(settings.model), input, instructions: this.chatInstructions(conversationId, settings), tools, signal: controller.signal, onText: text => { live.text += text; message.text += text; this.store.updateMessage(message); } });
        this.diagnostics?.record('chat.request_completed', { conversationId, messageId: message.id, round, requestId: response.requestId, callIds: response.calls.map(call => call.id), output: inputSummary(response.output) });
        message.status = 'completed'; this.store.updateMessage(message);
        input.push(...response.output);
        live.text = '';
        for (const call of response.calls) {
          let outcome: ToolOutcome;
          try {
            outcome = controller.signal.aborted
              ? { output: JSON.stringify({ error: 'Turn cancelled before tool dispatch.' }), attachments: [] }
              : await this.executeTool(conversationId, call, controller.signal);
          } catch (error) { outcome = { output: JSON.stringify({ error: this.ports.safeError(error) }), attachments: [] }; }
          input.push({ type: 'function_call_output', call_id: call.id, output: outcome.output });
          if (outcome.attachments.length) {
            const parts: unknown[] = [];
            for (const attachment of outcome.attachments) {
              parts.push({ type: 'input_text', text: `Attached from tool call ${call.id} — ${attachment.label}:` });
              parts.push(attachment.kind === 'image'
                ? { type: 'input_image', image_url: `data:${attachment.mime};base64,${attachment.base64}` }
                : { type: 'input_audio', input_audio: { data: attachment.base64, format: 'wav' } });
            }
            input.push({ role: 'user', content: parts });
            evictMedia(input);
          }
        }
        this.store.setSetting(historyKey, JSON.stringify(input));
        if (!response.calls.length || controller.signal.aborted) break;
        message = this.store.addMessage(conversationId, 'assistant', '', 'running');
      }
      if (controller.signal.aborted && message.status === 'running') { message.status = 'cancelled'; this.store.updateMessage(message); }
      this.store.setTurn(conversationId, controller.signal.aborted ? 'cancelled' : 'completed');
    } catch (error) {
      message.status = controller.signal.aborted ? 'cancelled' : 'failed';
      const reference = this.diagnostics?.record(controller.signal.aborted ? 'chat.cancelled' : 'chat.failed', { conversationId, messageId: message.id, round, error: diagnosticError(error) });
      const detail = round > 1 ? 'Assistant follow-up failed. Completed sounds remain in your library; they have not been regenerated.' : 'Chat request failed.';
      message.text += `\n${controller.signal.aborted ? 'Response stopped.' : `${detail}\n${this.ports.safeError(error)}${logReference(reference)}`}`;
      this.store.updateMessage(message); this.store.setTurn(conversationId, message.status);
    } finally { this.liveContext.delete(conversationId); }
  }
  async executeTool(conversationId: string, call: { id: string; name: string; arguments: string }, signal?: AbortSignal): Promise<ToolOutcome> {
    this.requireOpen();
    const recorded = this.store.beginTool(call.id, conversationId, call.name, call.arguments);
    if (!recorded.fresh) { this.diagnostics?.record('tool.restored', { conversationId, callId: call.id, name: call.name }); return { output: recorded.result ?? JSON.stringify({ error: 'Tool outcome is uncertain; not replayed.' }), attachments: [] }; }
    this.diagnostics?.record('tool.started', { conversationId, callId: call.id, name: call.name });
    try {
      const schema = toolSchemas[call.name as keyof typeof toolSchemas];
      if (!schema) throw new Error('Unknown assistant tool.');
      const args = schema.parse(JSON.parse(call.arguments));
      const projectId = this.store.conversation(conversationId).projectId;
      const operate = (name: string, fields: Record<string, unknown>) => {
        if (!this.operation) throw new Error('Workbench operations are not ready.');
        const definition = operationDefinitions[name as keyof typeof operationDefinitions];
        const shape = definition.schema.shape;
        return this.operation(name, { ...('projectId' in shape ? { projectId } : {}), ...('sessionId' in shape ? { sessionId: conversationId } : {}), ...fields });
      };
      let result: unknown;
      const attachments: ToolAttachment[] = [];
      switch (call.name) {
        case 'generate_sounds': {
          const requestId = randomUUID();
          this.store.waitTool(call.id, { requestId, message: 'Admission began; recover this request or inspect session jobs before generating again.' });
          const queued = await operate('generate_sounds', { input: args, requestId }) as { jobIds: string[]; error?: string };
          this.store.waitTool(call.id, queued);
          if (queued.error) { result = queued; break; }
          const jobs = await this.waitForJobs(queued.jobIds, signal);
          result = { ...queued, jobs, assets: jobs.flatMap(job => job.assetId ? [this.store.asset(job.assetId, projectId)] : []) };
          break;
        }
        case 'generate_voice':
        case 'generate_music':
        case 'compose_midi': {
          const requestId = randomUUID();
          this.store.waitTool(call.id, { requestId, message: 'Admission began; recover this request or inspect session jobs before generating again.' });
          const queued = await operate(call.name, { input: args, requestId }) as { jobIds: string[]; error?: string };
          this.store.waitTool(call.id, queued);
          if (queued.error) { result = queued; break; }
          const jobs = await this.waitForJobs(queued.jobIds, signal);
          result = { ...queued, jobs, assets: jobs.flatMap(job => job.assetId ? [this.store.asset(job.assetId, projectId)] : []) };
          break;
        }
        case 'search_assets': case 'inspect_asset': result = await operate(call.name, args); break;
        case 'analyze_audio': { const { id, ...input } = args as AudioAnalysisInput & { id: string }; result = await operate(call.name, { id, input }); break; }
        case 'find_loop_points': { const { id, ...input } = args as LoopSearchInput & { id: string }; result = await operate(call.name, { id, input }); break; }
        case 'trim_asset': { const { id, ...input } = args as TrimInput & { id: string }; result = await this.trimAsset(conversationId, id, input, call.id, signal); break; }
        case 'spectrogram_view': {
          const { id, ...input } = args as SpectrogramInput & { id: string };
          const asset = this.store.asset(id, projectId);
          const { png, mapping } = await this.media.spectrogram(asset, input);
          const attachmentId = randomUUID();
          await this.media.saveChatAttachment(attachmentId, png, 'png');
          const interval = `${mapping.startSeconds.toFixed(2)}–${mapping.endSeconds.toFixed(2)} s`;
          this.store.addMessage(conversationId, 'tool', `Rendered a ${mapping.freqScale}-scale spectrogram of “${asset.name}” (${interval}).`, 'completed', [
            { id: attachmentId, kind: 'image', label: `Spectrogram of “${asset.name}” (${interval})`, mediaType: 'image/png', bytes: png.length, startSeconds: mapping.startSeconds, endSeconds: mapping.endSeconds }
          ]);
          result = {
            attachmentId,
            image: { mediaType: 'image/png', bytes: png.length, width: mapping.width, height: mapping.height },
            mapping,
            note: `The attached PNG spans exactly ${mapping.startSeconds.toFixed(3)}–${mapping.endSeconds.toFixed(3)} decoded-source seconds across its width and ${Math.round(mapping.freqMin)}–${Math.round(mapping.freqMax)} Hz from bottom to top (${mapping.freqScale} scale), with faint grid lines every tenth of the width. Treat the image as a secondary view; take exact cut points from analyze_audio sample frames.`
          };
          attachments.push({ label: `spectrogram of “${asset.name}” (${interval})`, kind: 'image', mime: 'image/png', base64: png.toString('base64') });
          break;
        }
        case 'audio_listen': {
          const { id, startSeconds, endSeconds, loopSeam } = args as { id: string; startSeconds?: number; endSeconds?: number; loopSeam?: LoopSeamInput };
          const asset = this.store.asset(id, projectId);
          if (loopSeam) {
            if (startSeconds !== undefined || endSeconds !== undefined) throw new Error('Pass either loopSeam or startSeconds/endSeconds, not both.');
            const clip = await this.seamClip(asset, loopSeam);
            const label = `Loop seam of “${asset.name}” (${loopSeam.endSeconds.toFixed(2)} s → ${loopSeam.startSeconds.toFixed(2)} s)`;
            const attachmentId = randomUUID();
            await this.media.saveChatAttachment(attachmentId, clip.bytes, 'wav');
            this.store.addMessage(conversationId, 'tool', `Attached the loop seam of “${asset.name}” for listening (end ${loopSeam.endSeconds.toFixed(2)} s wrapping to ${loopSeam.startSeconds.toFixed(2)} s).`, 'completed', [
              { id: attachmentId, kind: 'audio', label, mediaType: 'audio/wav', bytes: clip.bytes.length, duration: clip.seam.duration, sampleRate: clip.sampleRate }
            ]);
            result = {
              attachmentId,
              clip: { duration: clip.seam.duration, seamAtSeconds: clip.seam.seamAtSeconds, crossfadeStartSeconds: clip.seam.crossfadeStartSeconds, sampleRate: clip.sampleRate, channels: 1, encoding: 'wav16', bytes: clip.bytes.length },
              loop: { startFrame: clip.seam.startFrame, endFrame: clip.seam.endFrame, crossfadeFrames: clip.seam.crossfadeFrames, crossfadeSource: clip.seam.crossfadeSource },
              note: `The attached WAV is what a loop render (trim_asset loop:true with this crossfadeMs) plays across its wrap: the end of the loop, the wrap ${clip.seam.seamAtSeconds.toFixed(3)} s into the clip, then the loop's opening. The crossfade (${clip.seam.crossfadeStartSeconds.toFixed(3)} s in) blends ${clip.seam.crossfadeSource === 'after-end' ? 'the opening with the audio that follows the loop end' : 'the end into the audio that precedes the loop start'}, so the loop keeps its exact length. Downmixed to mono 16-bit PCM. Listening is an observation at the provider model's fidelity; the user audition decides.`
            };
            attachments.push({ label: `loop seam of “${asset.name}”`, kind: 'audio', mime: 'audio/wav', base64: clip.bytes.toString('base64') });
            break;
          }
          const clip = asset.format === 'mid'
            ? await this.ports.renderMidi(asset, { ...(startSeconds === undefined ? {} : { startSeconds }), ...(endSeconds === undefined ? {} : { endSeconds }) })
            : await this.media.clip(asset, { ...(startSeconds === undefined ? {} : { startSeconds }), ...(endSeconds === undefined ? {} : { endSeconds }) });
          const clipStart = clip.startFrame / clip.sampleRate;
          const clipEnd = clip.endFrame / clip.sampleRate;
          const attachmentId = randomUUID();
          await this.media.saveChatAttachment(attachmentId, clip.bytes, 'wav');
          this.store.addMessage(conversationId, 'tool', `Attached ${(clipEnd - clipStart).toFixed(2)} s of “${asset.name}” for listening (${clipStart.toFixed(2)}–${clipEnd.toFixed(2)} s).`, 'completed', [
            { id: attachmentId, kind: 'audio', label: `Audio clip of “${asset.name}” (${clipStart.toFixed(2)}–${clipEnd.toFixed(2)} s)`, mediaType: 'audio/wav', bytes: clip.bytes.length, startSeconds: clipStart, endSeconds: clipEnd, duration: clipEnd - clipStart, sampleRate: clip.sampleRate }
          ]);
          result = {
            attachmentId,
            clip: { startSeconds: clipStart, endSeconds: clipEnd, duration: clipEnd - clipStart, sampleRate: clip.sampleRate, channels: 1, encoding: 'wav16', bytes: clip.bytes.length },
            note: asset.format === 'mid'
              ? 'The attached WAV is this clip rendered through the bundled General MIDI bank, downmixed to mono 16-bit PCM. It is an observation of that render, not of a live performance; the written notes remain the primary evidence, and the user audition decides quality.'
              : 'The attached WAV covers exactly this decoded-source window, downmixed to mono 16-bit PCM. Listening through the provider is an observation at its fidelity; the user audition decides quality.'
          };
          attachments.push({ label: `audio clip of “${asset.name}” (${clipStart.toFixed(2)}–${clipEnd.toFixed(2)} s)`, kind: 'audio', mime: 'audio/wav', base64: clip.bytes.toString('base64') });
          break;
        }
        case 'update_asset': result = await operate(call.name, args); break;
        case 'rename_session': { const { title } = args as { title: string }; const renamed = this.store.renameConversation(conversationId, title, 'assistant'); this.store.addMessage(conversationId, 'tool', `Renamed this session to “${renamed.title}”.`); result = { title: renamed.title }; break; }
        case 'set_playground': this.store.setPlayground(conversationId, (args as { assetIds: string[] }).assetIds); this.store.addMessage(conversationId, 'tool', 'Updated the comparison playground.'); result = { updated: true }; break;
        case 'inspect_jobs': result = this.store.jobs().filter(j => j.conversationId === conversationId); break;
        default: result = await operate(call.name, args);
      }
      const output = JSON.stringify(result); this.store.finishTool(call.id, output);
      this.diagnostics?.record('tool.completed', { conversationId, callId: call.id, name: call.name }); return { output, attachments };
    } catch (error) {
      this.diagnostics?.record('tool.failed', { conversationId, callId: call.id, name: call.name, error: diagnosticError(error) });
      const output = JSON.stringify({ error: this.ports.safeError(error) }); this.store.finishTool(call.id, output);
      this.store.addMessage(conversationId, 'tool', `Could not ${call.name.replaceAll('_', ' ')}: ${this.ports.safeError(error)}`, 'failed'); return { output, attachments: [] };
    }
  }
  /** Waits for queued jobs to reach a terminal state, or for the turn to stop. */
  private async waitForJobs(jobIds: string[], signal?: AbortSignal) {
    while (!signal?.aborted && !this.stopped && jobIds.some(id => ['queued', 'running'].includes(this.store.job(id).status))) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return jobIds.map(id => this.store.job(id));
  }
  async idle() { await this.pumpPromise; await Promise.all([...this.turnPromises]); await Promise.allSettled([...this.editPromises]); await this.media.idle(); }
  async shutdown() {
    this.stopped = true; for (const controller of this.turns.values()) controller.abort(); this.activeJob?.controller.abort();
    await this.idle();
  }
}

function logReference(reference: string | null | undefined): string {
  return reference ? `\nDiagnostic reference: ${reference}. Open Settings → Open diagnostic logs for details.` : '';
}

const MEDIA_BUDGET: Record<'input_image' | 'input_audio', number> = { input_image: 8, input_audio: 3 };
const MEDIA_MARKER: Record<'input_image' | 'input_audio', string> = {
  input_image: '[spectrogram image removed from context to bound size; call spectrogram_view again to re-attach]',
  input_audio: '[audio clip removed from context to bound size; call audio_listen again to re-attach]'
};
/** Keeps only the newest media parts in persisted history so per-turn cost stays bounded. */
export function evictMedia(input: unknown[]): void {
  const counts = { input_image: 0, input_audio: 0 };
  const seen: { content: unknown[]; index: number; type: 'input_image' | 'input_audio' }[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (let index = 0; index < content.length; index++) {
      const part = content[index] as { type?: unknown } | null;
      if (part && (part.type === 'input_image' || part.type === 'input_audio')) {
        counts[part.type] += 1;
        seen.push({ content, index, type: part.type });
      }
    }
  }
  for (const entry of seen) {
    if (counts[entry.type] <= MEDIA_BUDGET[entry.type]) continue;
    counts[entry.type] -= 1;
    entry.content[entry.index] = { type: 'input_text', text: MEDIA_MARKER[entry.type] };
  }
}

function inputSummary(input: unknown[]) {
  return { count: input.length, items: input.slice(-200).map(item => {
    if (!item || typeof item !== 'object') return { type: 'invalid' };
    const value = item as Record<string, unknown>;
    return { type: value.type, role: value.role, callId: value.call_id };
  }) };
}
