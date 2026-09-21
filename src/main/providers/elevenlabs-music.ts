import type { MusicGenerationInput } from '../../shared/types';
import { MUSIC_DURATION_MAX_MS, MUSIC_DURATION_MIN_MS } from '../../shared/music-models';
import { redactText } from '../diagnostics';
import { ProviderHttpError } from './errors';
export { ProviderHttpError } from './errors';

const ENDPOINT = 'https://api.elevenlabs.io/v1/music';
const DEFAULT_FORMAT = 'auto';
const MAX_PROMPT_LENGTH = 4100;

export interface ElevenLabsMusicClientOptions { fetch?: typeof globalThis.fetch; endpoint?: string; outputFormat?: string }
export interface GeneratedMusic {
  bytes: Buffer;
  /** Container of the returned bytes, taken from the response content type. */
  format: 'mp3' | 'wav';
  requestId: string | null;
  usage: string | null;
  model: string;
  /** Exact provider text when the app appended guidance; otherwise the submitted prompt. */
  providerPrompt: string;
  lyrics?: string;
}

function validate(input: MusicGenerationInput, key: string): void {
  if (!key.trim()) throw new Error('An ElevenLabs API key is required.');
  if (!input || typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('A music prompt is required.');
  if (input.prompt.length > MAX_PROMPT_LENGTH) throw new Error(`The ElevenLabs music prompt must be ${MAX_PROMPT_LENGTH} characters or fewer; this one is ${input.prompt.length}.`);
  if (input.count !== undefined && (!Number.isInteger(input.count) || input.count < 1)) throw new Error('Generation count must be a positive integer.');
  if (input.durationMs !== undefined && input.durationMs !== null && (!Number.isInteger(input.durationMs) || input.durationMs < MUSIC_DURATION_MIN_MS || input.durationMs > MUSIC_DURATION_MAX_MS)) throw new Error('Music length must be between 3 and 600 seconds.');
  if (input.instrumental !== undefined && typeof input.instrumental !== 'boolean') throw new Error('Instrumental must be a boolean.');
}

export class ElevenLabsMusicClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly endpoint: string;
  private readonly outputFormat: string;
  constructor(options: ElevenLabsMusicClientOptions = {}) { this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis); this.endpoint = options.endpoint ?? ENDPOINT; this.outputFormat = options.outputFormat ?? DEFAULT_FORMAT; }
  async compose(input: MusicGenerationInput, model: string, key: string, signal?: AbortSignal): Promise<GeneratedMusic> {
    try { return await this.request(input, model, key, signal); }
    catch (error) {
      if (error instanceof ProviderHttpError) throw error;
      throw new Error(redactText(error instanceof Error ? error.message : 'ElevenLabs music request failed.', [key]));
    }
  }
  private async request(input: MusicGenerationInput, model: string, key: string, signal?: AbortSignal): Promise<GeneratedMusic> {
    validate(input, key);
    const url = new URL(this.endpoint); url.searchParams.set('output_format', this.outputFormat);
    const body: Record<string, unknown> = { prompt: input.prompt, model_id: model };
    if (input.durationMs !== undefined && input.durationMs !== null) body.music_length_ms = input.durationMs;
    if (input.instrumental) body.force_instrumental = true;
    const response = await this.fetcher(url, { method: 'POST', headers: { 'xi-api-key': key, accept: 'audio/mpeg', 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) throw await ProviderHttpError.fromResponse(response, 'ElevenLabs Music', [key]);
    const bytes = Buffer.from(await response.arrayBuffer());
    const requestId = response.headers.get('song-id') ?? response.headers.get('request-id') ?? response.headers.get('x-request-id');
    const contentType = response.headers.get('content-type') ?? '';
    return { bytes, format: contentType.includes('wav') ? 'wav' : 'mp3', requestId, usage: null, model, providerPrompt: input.prompt };
  }
}

export const composeMusic = (input: MusicGenerationInput, model: string, key: string, signal?: AbortSignal, options?: ElevenLabsMusicClientOptions): Promise<GeneratedMusic> => new ElevenLabsMusicClient(options).compose(input, model, key, signal);
export { ENDPOINT as ELEVENLABS_MUSIC_ENDPOINT, MAX_PROMPT_LENGTH as ELEVENLABS_MUSIC_MAX_PROMPT };
