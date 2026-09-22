import { Store } from './store';
import { MediaLibrary, generatedFields } from './media';
import { analysisSchema, generationSchema, musicGenerationSchema, patchSchema, spectrogramSchema, trimSchema } from './validation';
import { instructions, musicInstructions, tools, toolSchemas } from './assistant';
import type { Asset, AssetKind, AssetPatch, AudioAnalysisInput, GenerationInput, MusicGenerationInput, MusicProviderKind, SettingsStatus, Snapshot, SpectrogramInput, TrimInput } from '../shared/types';
import type { DiagnosticLog } from './diagnostics';
import { diagnosticError } from './providers/errors';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ContextTokenCounter } from './chat-context';
import { CHAT_MODELS, resolveChatModel } from '../shared/chat-models';

export interface ChatResult { output: unknown[]; calls: { id: string; name: string; arguments: string }[]; usage?: unknown; requestId?: string | null }
/** Media a tool produced for the model; bytes stay out of the tool ledger. */
export interface ToolAttachment { label: string; kind: 'image' | 'audio'; mime: string; base64: string }
export interface ToolOutcome { output: string; attachments: ToolAttachment[] }
/** Provider-reported outcome of one generation, including the provider that produced it. */
export interface GenerationResult {
  bytes: Buffer;
  format: 'mp3' | 'wav';
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
  safeError(error: unknown): string;
}
export class WorkbenchService {
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
  async snapshot(): Promise<Snapshot> {
    const projectId = this.store.activeProjectId();
    const visible = new Set(this.store.conversations(projectId).map(conversation => conversation.id));
    return {
      projects: this.store.projects(), activeProjectId: projectId, conversations: this.store.conversations(projectId),
      messages: this.store.messages(projectId), assets: this.store.assets(projectId), jobs: this.store.jobs(projectId),
      playground: this.store.playground(projectId), settings: await this.ports.settings(),
      activeTurns: [...this.turns.keys()].filter(id => visible.has(id))
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
      + `\nCurrent project: "${project.name}". Session title: "${conversation.title}" (${titledBy}). This project's sessions and library are the only work visible to you; other projects are separate.`
      + `\nCurrent comparison board: ${JSON.stringify(this.store.playground()[conversationId] ?? [])}\nCurrent generation jobs: ${JSON.stringify(this.store.jobs().filter(j => j.conversationId === conversationId).map(j => ({ id: j.id, kind: j.kind, status: j.status, assetId: j.assetId })))}`;
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
    const input: MusicGenerationInput = { ...parsed, kind: 'music', providerId: parsed.providerId ?? null };
    const jobs = await this.queueCandidates(conversationId, input, 'music', callId);
    this.store.addMessage(conversationId, 'tool', `Queued ${jobs.length} track${jobs.length === 1 ? '' : 's'} on ${target.label} (${target.model}): ${input.prompt}`);
    this.pump(); return { jobIds: jobs.map(j => j.id) };
  }
  /**
   * Admits candidates in transactions of up to 128 jobs, yielding between them so
   * large explicit requests keep the UI and shutdown responsive. This is an
   * admission chunk, not a count limit.
   */
  private async queueCandidates(conversationId: string, input: GenerationInput | MusicGenerationInput, kind: AssetKind, callId?: string) {
    const jobs: ReturnType<Store['createJobs']> = [];
    const requested = input.count ?? 1;
    if (requested > 128) this.store.addMessage(conversationId, 'tool', `Preparing ${requested} requested candidates. If the app closes during preparation, only already queued candidates will run.`);
    for (let remaining = requested; remaining > 0;) {
      this.requireOpen();
      const count = Math.min(128, remaining);
      jobs.push(...this.store.createJobs(conversationId, { ...input, count }, kind, callId));
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
        const result = job.input.kind === 'music'
          ? await this.ports.generateMusic(job.input, controller.signal)
          : await this.ports.generateEffect(job.input, controller.signal);
        const asset = await this.media.save(result.bytes, result.format, {
          ...generatedFields(job.input, job.kind, this.store.conversation(job.conversationId).projectId), provider: result.provider, model: result.model,
          requestId: result.requestId, usage: result.usage,
          providerPrompt: result.providerPrompt ?? null,
          ...(result.lyrics ? { lyrics: result.lyrics } : {})
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
    for (const path of paths) {
      const asset = await this.media.import(path, projectId, kind); this.requireOpen(); this.store.insertAsset(asset); this.store.addToPlayground(conversationId, [asset.id]);
      this.store.addMessage(conversationId, 'tool', `Imported “${asset.name}”.`);
    }
  }
  analyzeAudio(id: string, raw: AudioAnalysisInput, projectId: string) {
    this.requireOpen();
    return this.media.analyze(this.store.asset(id, projectId), analysisSchema.parse(raw));
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
            ? `Looped “${source.name}” from ${rendered.edit.startFrame / rendered.edit.sampleRate}–${rendered.edit.endFrame / rendered.edit.sampleRate}s with a ${rendered.edit.loop.crossfadeFrames}-frame seam crossfade as “${asset.name}”. Original preserved.`
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
      let result: unknown;
      const attachments: ToolAttachment[] = [];
      switch (call.name) {
        case 'generate_sounds': {
          const queued = await this.generate(conversationId, args as GenerationInput, call.id);
          const jobs = await this.waitForJobs(queued.jobIds, signal);
          result = { ...queued, jobs, assets: jobs.flatMap(job => job.assetId ? [this.store.asset(job.assetId, projectId)] : []) };
          break;
        }
        case 'generate_music': {
          const queued = await this.generateMusic(conversationId, args as MusicGenerationInput, call.id);
          const jobs = await this.waitForJobs(queued.jobIds, signal);
          result = { ...queued, jobs, assets: jobs.flatMap(job => job.assetId ? [this.store.asset(job.assetId, projectId)] : []) };
          break;
        }
        case 'search_assets': result = this.store.search((args as { query: string }).query, projectId); break;
        case 'inspect_asset': result = this.store.asset((args as { id: string }).id, projectId); break;
        case 'analyze_audio': { const { id, ...input } = args as AudioAnalysisInput & { id: string }; result = await this.analyzeAudio(id, input, projectId); break; }
        case 'trim_asset': { const { id, ...input } = args as TrimInput & { id: string }; result = await this.trimAsset(conversationId, id, input, call.id, signal); break; }
        case 'spectrogram_view': {
          const { id, ...input } = args as SpectrogramInput & { id: string };
          const asset = this.store.asset(id, projectId);
          const { png, mapping } = await this.media.spectrogram(asset, input);
          result = {
            attachmentId: randomUUID(),
            image: { mediaType: 'image/png', bytes: png.length, width: mapping.width, height: mapping.height },
            mapping,
            note: `The attached PNG spans exactly ${mapping.startSeconds.toFixed(3)}–${mapping.endSeconds.toFixed(3)} decoded-source seconds across its width and ${Math.round(mapping.freqMin)}–${Math.round(mapping.freqMax)} Hz from bottom to top (${mapping.freqScale} scale), with faint grid lines every tenth of the width. Treat the image as a secondary view; take exact cut points from analyze_audio sample frames.`
          };
          this.store.addMessage(conversationId, 'tool', `Rendered a ${mapping.freqScale}-scale spectrogram of “${asset.name}” (${mapping.startSeconds.toFixed(2)}–${mapping.endSeconds.toFixed(2)} s).`);
          attachments.push({ label: `spectrogram of “${asset.name}” (${mapping.startSeconds.toFixed(2)}–${mapping.endSeconds.toFixed(2)} s)`, kind: 'image', mime: 'image/png', base64: png.toString('base64') });
          break;
        }
        case 'audio_listen': {
          const { id, startSeconds, endSeconds } = args as { id: string; startSeconds?: number; endSeconds?: number };
          const asset = this.store.asset(id, projectId);
          const clip = await this.media.clip(asset, { ...(startSeconds === undefined ? {} : { startSeconds }), ...(endSeconds === undefined ? {} : { endSeconds }) });
          const clipStart = clip.startFrame / clip.sampleRate;
          const clipEnd = clip.endFrame / clip.sampleRate;
          result = {
            attachmentId: randomUUID(),
            clip: { startSeconds: clipStart, endSeconds: clipEnd, duration: clipEnd - clipStart, sampleRate: clip.sampleRate, channels: 1, encoding: 'wav16', bytes: clip.bytes.length },
            note: 'The attached WAV covers exactly this decoded-source window, downmixed to mono 16-bit PCM. Listening through the provider is an observation at its fidelity; the user audition decides quality.'
          };
          this.store.addMessage(conversationId, 'tool', `Attached ${(clipEnd - clipStart).toFixed(2)} s of “${asset.name}” for listening (${clipStart.toFixed(2)}–${clipEnd.toFixed(2)} s).`);
          attachments.push({ label: `audio clip of “${asset.name}” (${clipStart.toFixed(2)}–${clipEnd.toFixed(2)} s)`, kind: 'audio', mime: 'audio/wav', base64: clip.bytes.toString('base64') });
          break;
        }
        case 'update_asset': { const { id, patch } = args as { id: string; patch: AssetPatch }; result = this.store.updateAsset(id, patch, projectId, conversationId); break; }
        case 'rename_session': { const { title } = args as { title: string }; const renamed = this.store.renameConversation(conversationId, title, 'assistant'); this.store.addMessage(conversationId, 'tool', `Renamed this session to “${renamed.title}”.`); result = { title: renamed.title }; break; }
        case 'set_playground': this.store.setPlayground(conversationId, (args as { assetIds: string[] }).assetIds); this.store.addMessage(conversationId, 'tool', 'Updated the comparison playground.'); result = { updated: true }; break;
        case 'inspect_jobs': result = this.store.jobs().filter(j => j.conversationId === conversationId); break;
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
