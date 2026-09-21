import type { MusicGenerationInput } from '../../shared/types';
import { musicModel } from '../../shared/music-models';
import { redactText } from '../diagnostics';
import { ProviderHttpError } from './errors';
export { ProviderHttpError } from './errors';
import type { GeneratedMusic } from './elevenlabs-music';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const INSTRUMENTAL_LINE = 'Instrumental only, no vocals.';

export interface GeminiMusicClientOptions { fetch?: typeof globalThis.fetch; endpoint?: string }

function validate(input: MusicGenerationInput, key: string): void {
  if (!key.trim()) throw new Error('A Gemini API key is required.');
  if (!input || typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('A music prompt is required.');
  if (input.count !== undefined && (!Number.isInteger(input.count) || input.count < 1)) throw new Error('Generation count must be a positive integer.');
}

/**
 * Lyria accepts no duration or instrumentation parameters, so the app states them in
 * the prompt. The composed text is returned as providerPrompt for provenance.
 */
export function composeLyriaPrompt(input: MusicGenerationInput, model: string): string {
  const lines = [input.prompt.trim()];
  const option = musicModel('gemini-lyria', model);
  const fixed = option?.fixedDurationMs ?? null;
  if (fixed !== null && input.durationMs !== undefined && input.durationMs !== null && Math.abs(input.durationMs - fixed) > 1000) {
    throw new Error(`${option?.label ?? model} always returns a ${Math.round(fixed / 1000)}-second clip. Choose a full-song model for another length, or clear the duration.`);
  }
  if (input.instrumental && !lines[0]!.toLowerCase().includes('instrumental only')) lines.push(INSTRUMENTAL_LINE);
  if (input.durationMs !== undefined && input.durationMs !== null && fixed === null) lines.push(`Target length: about ${Math.round(input.durationMs / 1000)} seconds.`);
  return lines.join('\n');
}

interface ResponseBlocks { audio: { data: string; mimeType: string | null } | null; text: string[]; reason: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readBlocks(payload: unknown): ResponseBlocks {
  const blocks: ResponseBlocks = { audio: null, text: [], reason: null };
  if (!isRecord(payload)) return blocks;
  const reason = isRecord(payload.promptFeedback) ? payload.promptFeedback.blockReason : undefined;
  if (typeof reason === 'string') blocks.reason = reason;
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  for (const step of steps) {
    if (!isRecord(step) || step.type !== 'model_output') continue;
    if (typeof step.finishReason === 'string' && blocks.reason === null) blocks.reason = step.finishReason;
    const content = Array.isArray(step.content) ? step.content : [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'audio' && typeof block.data === 'string') blocks.audio = { data: block.data, mimeType: typeof block.mime_type === 'string' ? block.mime_type : null };
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) blocks.text.push(block.text);
    }
  }
  return blocks;
}

function failureMessage(payload: unknown, key: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') return redactText(payload.error.message, [key]).slice(0, 400);
  const blocks = readBlocks(payload);
  return blocks.reason ? `The request produced no audio (${redactText(blocks.reason, [key]).slice(0, 120)}).` : 'The response contained no audio block.';
}

export class GeminiMusicClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly endpoint: string;
  constructor(options: GeminiMusicClientOptions = {}) { this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis); this.endpoint = options.endpoint ?? ENDPOINT; }
  async compose(input: MusicGenerationInput, model: string, key: string, signal?: AbortSignal): Promise<GeneratedMusic> {
    try { return await this.request(input, model, key, signal); }
    catch (error) {
      if (error instanceof ProviderHttpError) throw error;
      throw new Error(redactText(error instanceof Error ? error.message : 'Gemini music request failed.', [key]));
    }
  }
  private async request(input: MusicGenerationInput, model: string, key: string, signal?: AbortSignal): Promise<GeneratedMusic> {
    validate(input, key);
    const providerPrompt = composeLyriaPrompt(input, model);
    // store:false keeps the interaction out of server-side retention; Lyria output is
    // a single turn, so no server state is needed or requested.
    const response = await this.fetcher(this.endpoint, { method: 'POST', headers: { 'x-goog-api-key': key, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ model, input: providerPrompt, store: false }), signal });
    if (!response.ok) throw await ProviderHttpError.fromResponse(response, 'Gemini Lyria', [key]);
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new ProviderHttpError(undefined, 'Gemini Lyria', { message: 'The response was not valid JSON.' }); }
    const blocks = readBlocks(payload);
    if (!blocks.audio) throw new ProviderHttpError(undefined, 'Gemini Lyria', { message: failureMessage(payload, key) });
    const bytes = Buffer.from(blocks.audio.data, 'base64');
    if (!bytes.length) throw new ProviderHttpError(undefined, 'Gemini Lyria', { message: 'The returned audio was empty.' });
    const record = isRecord(payload) ? payload : {};
    const lyrics = blocks.text.length ? blocks.text.join('\n\n') : undefined;
    return {
      bytes,
      requestId: typeof record.id === 'string' ? record.id : null,
      usage: null,
      model,
      providerPrompt,
      format: blocks.audio.mimeType?.includes('wav') ? 'wav' : 'mp3',
      ...(lyrics ? { lyrics } : {})
    };
  }
}

export const composeMusic = (input: MusicGenerationInput, model: string, key: string, signal?: AbortSignal, options?: GeminiMusicClientOptions): Promise<GeneratedMusic> => new GeminiMusicClient(options).compose(input, model, key, signal);
export { ENDPOINT as GEMINI_INTERACTIONS_ENDPOINT };
