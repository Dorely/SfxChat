import { Store } from './store';
import { MediaLibrary, generatedFields } from './media';
import { analysisSchema, generationSchema, patchSchema, trimSchema } from './validation';
import { instructions, tools, toolSchemas } from './assistant';
import type { AssetPatch, AudioAnalysisInput, GenerationInput, SettingsStatus, Snapshot, TrimInput } from '../shared/types';
import type { DiagnosticLog } from './diagnostics';
import { diagnosticError } from './providers/errors';
import { unlink } from 'node:fs/promises';
import { ContextTokenCounter } from './chat-context';
import { CHAT_MODELS, resolveChatModel } from '../shared/chat-models';

export interface ChatResult { output: unknown[]; calls: { id: string; name: string; arguments: string }[]; usage?: unknown; requestId?: string | null }
export interface ServicePorts {
  settings(): Promise<SettingsStatus>;
  chat(options: { model: string; input: unknown[]; instructions: string; tools: unknown[]; signal: AbortSignal; onText: (text: string) => void }): Promise<ChatResult>;
  generate(input: GenerationInput, signal: AbortSignal): Promise<{ bytes: Buffer; requestId: string | null; usage: string | null; model: string }>;
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
    return { conversations: this.store.conversations(), messages: this.store.messages(), assets: this.store.assets(), jobs: this.store.jobs(), playground: this.store.playground(), settings: await this.ports.settings(), activeTurns: [...this.turns.keys()] };
  }
  private chatInstructions(conversationId: string) {
    return instructions + `\nCurrent comparison board: ${JSON.stringify(this.store.playground()[conversationId] ?? [])}\nCurrent generation jobs: ${JSON.stringify(this.store.jobs().filter(j => j.conversationId === conversationId).map(j => ({ id: j.id, status: j.status, assetId: j.assetId })))}`;
  }
  async chatContext(conversationId: string, draft = '') {
    this.requireOpen();
    this.store.requireConversation(conversationId);
    const model = resolveChatModel((await this.ports.settings()).model);
    this.requireOpen();
    const live = this.liveContext.get(conversationId);
    const input = live?.input ?? this.store.repairToolHistory(conversationId, JSON.parse(this.store.setting(`history/${conversationId}`, '[]'))).input;
    return {
      model, limit: CHAT_MODELS.find(entry => entry.id === model)?.contextLimit ?? null,
      ...this.contextCounter.count({ instructions: this.chatInstructions(conversationId), tools, input, draft, streamingText: live?.text })
    };
  }
  async generate(conversationId: string, raw: GenerationInput, callId?: string) {
    this.requireOpen();
    const input = generationSchema.parse(raw);
    if (input.parentId) this.store.asset(input.parentId);
    const settings = await this.ports.settings();
    this.requireOpen();
    if (!settings.elevenLabsReady) throw new Error('Add your ElevenLabs API key in Settings first.');
    const jobs: ReturnType<Store['createJobs']> = [];
    const requested = input.count ?? 1;
    if (requested > 128) this.store.addMessage(conversationId, 'tool', `Preparing ${requested} requested candidates. If the app closes during preparation, only already queued candidates will run.`);
    for (let remaining = requested; remaining > 0;) {
      this.requireOpen();
      const count = Math.min(128, remaining);
      jobs.push(...this.store.createJobs(conversationId, { ...input, count }, callId));
      remaining -= count;
      // Yield between transactions so even large explicit requests leave the UI
      // and shutdown responsive. This is an admission chunk, not a count limit.
      if (remaining) await new Promise<void>(resolve => setImmediate(resolve));
    }
    this.store.addMessage(conversationId, 'tool', `Queued ${jobs.length} sound${jobs.length === 1 ? '' : 's'}: ${input.prompt}`);
    this.pump(); return { jobIds: jobs.map(j => j.id) };
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
      this.diagnostics?.record('generation.started', { conversationId: job.conversationId, jobId: job.id, provider: 'ElevenLabs' });
      try {
        const result = await this.ports.generate(job.input, controller.signal);
        const asset = await this.media.save(result.bytes, 'mp3', { ...generatedFields(job.input), provider: 'ElevenLabs', model: result.model, requestId: result.requestId, usage: result.usage });
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
        this.diagnostics?.record('generation.completed', { conversationId: job.conversationId, jobId: job.id, assetId: asset.id, requestId: result.requestId, bytes: asset.bytes, hash: asset.hash });
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
    if (conversationId) this.store.requireConversation(conversationId);
    this.store.updateAsset(id, patch, conversationId);
  }
  async importFiles(conversationId: string, paths: string[]) {
    this.requireOpen();
    this.store.requireConversation(conversationId);
    for (const path of paths) {
      const asset = await this.media.import(path); this.requireOpen(); this.store.insertAsset(asset); this.store.addToPlayground(conversationId, [asset.id]);
      this.store.addMessage(conversationId, 'tool', `Imported “${asset.name}”.`);
    }
  }
  analyzeAudio(id: string, raw: AudioAnalysisInput) {
    this.requireOpen();
    return this.media.analyze(this.store.asset(id), analysisSchema.parse(raw));
  }
  async previewTrim(id: string, raw: TrimInput) {
    this.requireOpen();
    return new Uint8Array((await this.media.renderTrim(this.store.asset(id), trimSchema.parse(raw))).bytes);
  }
  trimAsset(conversationId: string, id: string, raw: TrimInput, callId?: string, signal?: AbortSignal) {
    this.requireOpen();
    const input = trimSchema.parse(raw), source = this.store.asset(id);
    this.store.requireConversation(conversationId);
    const pending = (async () => {
      const rendered = await this.media.renderTrim(source, input);
      this.requireOpen();
      signal?.throwIfAborted();
      const asset = await this.media.save(rendered.bytes, 'wav', {
        source: 'edited', name: input.name ?? `${source.name} (trim)`, description: source.description,
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
          this.store.addMessage(conversationId, 'tool', `Trimmed “${source.name}” to ${rendered.edit.startFrame / rendered.edit.sampleRate}–${rendered.edit.endFrame / rendered.edit.sampleRate}s as “${asset.name}”. Original preserved.`);
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
        const response = await this.ports.chat({ model: resolveChatModel(settings.model), input, instructions: this.chatInstructions(conversationId), tools, signal: controller.signal, onText: text => { live.text += text; message.text += text; this.store.updateMessage(message); } });
        this.diagnostics?.record('chat.request_completed', { conversationId, messageId: message.id, round, requestId: response.requestId, callIds: response.calls.map(call => call.id), output: inputSummary(response.output) });
        message.status = 'completed'; this.store.updateMessage(message);
        input.push(...response.output);
        live.text = '';
        for (const call of response.calls) {
          let result: string;
          try {
            result = controller.signal.aborted ? JSON.stringify({ error: 'Turn cancelled before tool dispatch.' }) : await this.executeTool(conversationId, call, controller.signal);
          } catch (error) { result = JSON.stringify({ error: this.ports.safeError(error) }); }
          input.push({ type: 'function_call_output', call_id: call.id, output: result });
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
  async executeTool(conversationId: string, call: { id: string; name: string; arguments: string }, signal?: AbortSignal): Promise<string> {
    this.requireOpen();
    const recorded = this.store.beginTool(call.id, conversationId, call.name, call.arguments);
    if (!recorded.fresh) { this.diagnostics?.record('tool.restored', { conversationId, callId: call.id, name: call.name }); return recorded.result ?? JSON.stringify({ error: 'Tool outcome is uncertain; not replayed.' }); }
    this.diagnostics?.record('tool.started', { conversationId, callId: call.id, name: call.name });
    try {
      const schema = toolSchemas[call.name as keyof typeof toolSchemas];
      if (!schema) throw new Error('Unknown assistant tool.');
      const args = schema.parse(JSON.parse(call.arguments));
      let result: unknown;
      switch (call.name) {
        case 'generate_sounds': {
          const queued = await this.generate(conversationId, args as GenerationInput, call.id);
          while (!signal?.aborted && !this.stopped && queued.jobIds.some(id => ['queued', 'running'].includes(this.store.job(id).status))) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          const jobs = queued.jobIds.map(id => this.store.job(id));
          result = { ...queued, jobs, assets: jobs.flatMap(job => job.assetId ? [this.store.asset(job.assetId)] : []) };
          break;
        }
        case 'search_assets': result = this.store.search((args as { query: string }).query); break;
        case 'inspect_asset': result = this.store.asset((args as { id: string }).id); break;
        case 'analyze_audio': { const { id, ...input } = args as AudioAnalysisInput & { id: string }; result = await this.analyzeAudio(id, input); break; }
        case 'trim_asset': { const { id, ...input } = args as TrimInput & { id: string }; result = await this.trimAsset(conversationId, id, input, call.id, signal); break; }
        case 'update_asset': { const { id, patch } = args as { id: string; patch: AssetPatch }; result = this.store.updateAsset(id, patch, conversationId); break; }
        case 'set_playground': this.store.setPlayground(conversationId, (args as { assetIds: string[] }).assetIds); this.store.addMessage(conversationId, 'tool', 'Updated the comparison playground.'); result = { updated: true }; break;
        case 'inspect_jobs': result = this.store.jobs().filter(j => j.conversationId === conversationId); break;
      }
      const output = JSON.stringify(result); this.store.finishTool(call.id, output);
      this.diagnostics?.record('tool.completed', { conversationId, callId: call.id, name: call.name }); return output;
    } catch (error) {
      this.diagnostics?.record('tool.failed', { conversationId, callId: call.id, name: call.name, error: diagnosticError(error) });
      const output = JSON.stringify({ error: this.ports.safeError(error) }); this.store.finishTool(call.id, output);
      this.store.addMessage(conversationId, 'tool', `Could not ${call.name.replaceAll('_', ' ')}: ${this.ports.safeError(error)}`, 'failed'); return output;
    }
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

function inputSummary(input: unknown[]) {
  return { count: input.length, items: input.slice(-200).map(item => {
    if (!item || typeof item !== 'object') return { type: 'invalid' };
    const value = item as Record<string, unknown>;
    return { type: value.type, role: value.role, callId: value.call_id };
  }) };
}
