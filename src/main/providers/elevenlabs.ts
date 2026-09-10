import type { GenerationInput } from '../../shared/types';
import { redactText } from '../diagnostics';
import { ProviderHttpError } from './errors';
export { ProviderHttpError } from './errors';

const ENDPOINT = 'https://api.elevenlabs.io/v1/sound-generation';
const DEFAULT_MODEL = 'eleven_text_to_sound_v2';
const DEFAULT_FORMAT = 'mp3_44100_128';
export interface ElevenLabsClientOptions { fetch?: typeof globalThis.fetch; endpoint?: string; model?: string; outputFormat?: string }
export interface GeneratedSound { bytes: Buffer; requestId: string | null; usage: string | null; model: string }

function validate(input: GenerationInput, key: string): void {
  if (!key.trim()) throw new Error('ElevenLabs API key is required.');
  if (!input || typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('A sound prompt is required.');
  if (input.count !== undefined && (!Number.isInteger(input.count) || input.count < 1)) throw new Error('Generation count must be a positive integer.');
  if (input.duration !== undefined && input.duration !== null && (typeof input.duration !== 'number' || !Number.isFinite(input.duration) || input.duration < 0.5 || input.duration > 30)) throw new Error('Duration must be between 0.5 and 30 seconds.');
  if (input.influence !== undefined && (typeof input.influence !== 'number' || !Number.isFinite(input.influence) || input.influence < 0 || input.influence > 1)) throw new Error('Influence must be between 0 and 1.');
  if (input.loop !== undefined && typeof input.loop !== 'boolean') throw new Error('Loop must be a boolean.');
}

export class ElevenLabsClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly outputFormat: string;
  constructor(options: ElevenLabsClientOptions = {}) { this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis); this.endpoint = options.endpoint ?? ENDPOINT; this.model = options.model ?? DEFAULT_MODEL; this.outputFormat = options.outputFormat ?? DEFAULT_FORMAT; }
  async generateSound(input: GenerationInput, key: string, signal?: AbortSignal): Promise<GeneratedSound> {
    try { return await this.request(input, key, signal); }
    catch (error) {
      if (error instanceof ProviderHttpError) throw error;
      throw new Error(redactText(error instanceof Error ? error.message : 'ElevenLabs request failed.', [key]));
    }
  }
  private async request(input: GenerationInput, key: string, signal?: AbortSignal): Promise<GeneratedSound> {
    validate(input, key);
    const url = new URL(this.endpoint); url.searchParams.set('output_format', this.outputFormat);
    const body: Record<string, unknown> = { text: input.prompt, model_id: this.model };
    if (input.duration !== undefined && input.duration !== null) body.duration_seconds = input.duration;
    if (input.influence !== undefined) body.prompt_influence = input.influence;
    if (input.loop !== undefined) body.loop = input.loop;
    const response = await this.fetcher(url, { method: 'POST', headers: { 'xi-api-key': key, accept: 'audio/mpeg', 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) throw await ProviderHttpError.fromResponse(response, 'ElevenLabs', [key]);
    const bytes = Buffer.from(await response.arrayBuffer());
    const requestId = response.headers.get('request-id') ?? response.headers.get('x-request-id');
    const usage = response.headers.get('character-cost') ?? response.headers.get('x-character-cost') ?? response.headers.get('x-credits-used') ?? response.headers.get('x-usage') ?? null;
    return { bytes, requestId, usage, model: this.model };
  }
}

export const generateSound = (input: GenerationInput, key: string, signal?: AbortSignal, options?: ElevenLabsClientOptions): Promise<GeneratedSound> => new ElevenLabsClient(options).generateSound(input, key, signal);
export { ENDPOINT as ELEVENLABS_ENDPOINT, DEFAULT_MODEL as ELEVENLABS_DEFAULT_MODEL };
