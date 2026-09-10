import { Store } from './store';
import { MediaLibrary, generatedFields } from './media';
import { generationSchema, patchSchema } from './validation';
import { instructions, tools, toolSchemas } from './assistant';
import type { AssetPatch, GenerationInput, SettingsStatus, Snapshot } from '../shared/types';

export interface ChatResult { output: unknown[]; calls: { id: string; name: string; arguments: string }[]; usage?: unknown }
export interface ServicePorts {
  settings(): Promise<SettingsStatus>;
  chat(options: { model: string; input: unknown[]; instructions: string; tools: unknown[]; signal: AbortSignal; onText: (text: string) => void }): Promise<ChatResult>;
  generate(input: GenerationInput, signal: AbortSignal): Promise<{ bytes: Buffer; requestId: string | null; usage: string | null; model: string }>;
  safeError(error: unknown): string;
}
export class WorkbenchService {
  private turns = new Map<string, AbortController>();
  private activeJob: { id: string; controller: AbortController } | null = null;
  private pumpPromise: Promise<void> | null = null;
  private turnPromises = new Set<Promise<void>>();
  private stopped = false;
  constructor(readonly store: Store, readonly media: MediaLibrary, private ports: ServicePorts, private changed: () => void) {}
  private requireOpen() { if (this.stopped) throw new Error('SfxChat is closing.'); }
  async snapshot(): Promise<Snapshot> {
    return { conversations: this.store.conversations(), messages: this.store.messages(), assets: this.store.assets(), jobs: this.store.jobs(), playground: this.store.playground(), settings: await this.ports.settings(), activeTurns: [...this.turns.keys()] };
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
      try {
        const result = await this.ports.generate(job.input, controller.signal);
        const asset = await this.media.save(result.bytes, 'mp3', { ...generatedFields(job.input), provider: 'ElevenLabs', model: result.model, requestId: result.requestId, usage: result.usage });
        if (asset.duration === null || asset.duration <= 0) {
          this.store.insertAsset(asset);
          this.store.updateJob({ ...job, status: 'failed', assetId: asset.id, error: 'Returned audio could not be validated. Original bytes were retained; no retry was made.' });
          this.store.addMessage(job.conversationId, 'tool', 'The returned audio could not be validated. Its original bytes are retained in the library.', 'failed');
          continue;
        }
        // A complete response that races cancellation is retained as a completed
        // original. Cancellation cannot unspend or unreceive a provider result.
        this.store.completeJob(job, asset);
        this.store.addMessage(job.conversationId, 'tool', `Ready: ${asset.name}${asset.duration === null ? ' (audio metadata could not be read; audition before use)' : ''}`);
      } catch (error) {
        const knownFailure = !!error && typeof error === 'object' && ('status' in error || 'statusCode' in error);
        const stopped = controller.signal.aborted;
        this.store.updateJob({ ...job, status: stopped ? 'uncertain' : knownFailure ? 'failed' : 'uncertain', error: stopped ? 'Stopped after dispatch; provider completion/billing is uncertain. No automatic retry.' : this.ports.safeError(error) });
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
    const input: unknown[] = JSON.parse(this.store.setting(historyKey, '[]'));
    input.push({ role: 'user', content: [{ type: 'input_text', text }] });
    this.store.setSetting(historyKey, JSON.stringify(input));
    let message = this.store.addMessage(conversationId, 'assistant', '', 'running');
    try {
      while (!controller.signal.aborted) {
        const settings = await this.ports.settings();
        const context = `\nCurrent comparison board: ${JSON.stringify(this.store.playground()[conversationId] ?? [])}\nCurrent generation jobs: ${JSON.stringify(this.store.jobs().filter(j => j.conversationId === conversationId).map(j => ({ id: j.id, status: j.status, assetId: j.assetId })))}`;
        const response = await this.ports.chat({ model: settings.model, input, instructions: instructions + context, tools, signal: controller.signal, onText: text => { message.text += text; this.store.updateMessage(message); } });
        message.status = 'completed'; this.store.updateMessage(message);
        input.push(...response.output);
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
      message.text += `\n${controller.signal.aborted ? 'Response stopped.' : this.ports.safeError(error)}`;
      this.store.updateMessage(message); this.store.setTurn(conversationId, message.status);
    }
  }
  async executeTool(conversationId: string, call: { id: string; name: string; arguments: string }, signal?: AbortSignal): Promise<string> {
    this.requireOpen();
    const recorded = this.store.beginTool(call.id, conversationId, call.name, call.arguments);
    if (!recorded.fresh) return recorded.result ?? JSON.stringify({ error: 'Tool outcome is uncertain; not replayed.' });
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
        case 'update_asset': { const { id, patch } = args as { id: string; patch: AssetPatch }; result = this.store.updateAsset(id, patch, conversationId); break; }
        case 'set_playground': this.store.setPlayground(conversationId, (args as { assetIds: string[] }).assetIds); this.store.addMessage(conversationId, 'tool', 'Updated the comparison playground.'); result = { updated: true }; break;
        case 'inspect_jobs': result = this.store.jobs().filter(j => j.conversationId === conversationId); break;
      }
      const output = JSON.stringify(result); this.store.finishTool(call.id, output); return output;
    } catch (error) {
      const output = JSON.stringify({ error: this.ports.safeError(error) }); this.store.finishTool(call.id, output);
      this.store.addMessage(conversationId, 'tool', `Could not ${call.name.replaceAll('_', ' ')}: ${this.ports.safeError(error)}`, 'failed'); return output;
    }
  }
  async idle() { await this.pumpPromise; await Promise.all([...this.turnPromises]); }
  async shutdown() {
    this.stopped = true; for (const controller of this.turns.values()) controller.abort(); this.activeJob?.controller.abort();
    await this.idle();
  }
}
