import { createHash } from 'node:crypto';
import type { AudioProviderId, VoiceGenerationInput, VoiceListInput, VoiceModelListInput, VoiceModelCatalog, VoiceModelOption, VoiceOption, VoicePage } from '../../shared/types';
import { GEMINI_VOICES, providerLabel, validateVoiceTarget, voiceModelProfile, VOICE_MODELS, VOICE_DEFAULTS } from '../../shared/voice-models';
import { redactText } from '../diagnostics';
import { ProviderHttpError } from './errors';
import type { GenerationResult } from '../service';

const ELEVEN = 'https://api.elevenlabs.io';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Bounded reads for original audio and base64 JSON. No retries or SDK side effects. */
async function readBytes(response: Response, max = 96 * 1024 * 1024): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderHttpError(undefined, 'Voice', { message: 'Empty provider response.' });
  const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > max) throw new ProviderHttpError(undefined, 'Voice', { message: 'Voice response exceeded the supported size. No retry was made.' });
      chunks.push(Buffer.from(part.value));
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
async function readJson(response: Response, vendor: AudioProviderId, max?: number): Promise<Record<string, any>> {
  try {
    const parsed: unknown = JSON.parse((await readBytes(response, max)).toString('utf8'));
    if (!record(parsed)) throw new ProviderHttpError(undefined, providerLabel(vendor), { message: 'Voice response was not a JSON object.' }); return parsed;
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    if (error instanceof SyntaxError) throw new ProviderHttpError(undefined, providerLabel(vendor), { message: 'Voice response was not valid JSON.' });
    throw error;
  }
}
function stringLabels(value: unknown): Record<string, string> {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
}

export class VoiceClient {
  private modelCache?: { fingerprint: string; expires: number; catalog: VoiceModelCatalog };
  constructor(private fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  private async safe<T>(key: string, action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (e) {
      if (e instanceof ProviderHttpError) throw e;
      throw new Error(redactText(e instanceof Error ? e.message : 'Voice request failed.', [key]));
    }
  }
  async models(input: VoiceModelListInput, key: string, signal: AbortSignal): Promise<VoiceModelCatalog> {
    const defaults = VOICE_DEFAULTS[input.providerId];
    if (input.providerId === 'gemini') return { providerId: 'gemini', source: 'built-in', fetchedAt: null, models: VOICE_MODELS.gemini, defaultModel: defaults.model, defaultVoiceId: defaults.voiceId };
    if (!key.trim()) throw new Error('Save the shared ElevenLabs API key in Settings to discover available models.');
    const fingerprint = createHash('sha256').update(key).digest('hex');
    if (!input.refresh && this.modelCache?.fingerprint === fingerprint && this.modelCache.expires > Date.now()) return this.modelCache.catalog;
    return this.safe(key, async () => {
      const response = await this.fetcher(`${ELEVEN}/v1/models`, { headers: { 'xi-api-key': key }, signal });
      if (!response.ok) throw await ProviderHttpError.fromResponse(response, 'ElevenLabs models', [key]);
      const payload: unknown = JSON.parse((await readBytes(response, 4 * 1024 * 1024)).toString('utf8'));
      if (!Array.isArray(payload) || payload.length > 500) throw new Error('ElevenLabs returned an invalid model catalog.');
      const models: VoiceModelOption[] = [];
      for (const item of payload) {
        if (!record(item) || item.can_do_text_to_speech !== true) continue;
        if (typeof item.model_id !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(item.model_id) || models.some(m => m.id === item.model_id)) throw new Error('ElevenLabs returned an invalid or duplicate TTS model ID.');
        const profile = voiceModelProfile('elevenlabs', item.model_id);
        const limit = Number.isSafeInteger(item.maximum_text_length_per_request) && item.maximum_text_length_per_request > 0 ? item.maximum_text_length_per_request as number : null;
        // Reviewed profiles retain conservative app bounds; unknown models get no
        // invented controls or specialized prompt syntax. Provider text is data.
        const languages = (Array.isArray(item.languages) ? item.languages : []).filter(record).flatMap(language => typeof language.language_id === 'string' ? [{ id: language.language_id.slice(0, 40), name: typeof language.name === 'string' ? language.name.slice(0, 100) : language.language_id.slice(0, 40) }] : []).slice(0, 200);
        models.push({ ...profile, label: typeof item.name === 'string' ? item.name.slice(0, 200) : profile.label, description: typeof item.description === 'string' ? item.description.slice(0, 2000) : '', maxCharacters: Math.min(limit ?? profile.maxCharacters ?? 10000, profile.maxCharacters ?? 10000), languages, requiresAlphaAccess: typeof item.requires_alpha_access === 'boolean' ? item.requires_alpha_access : null });
      }
      const catalog: VoiceModelCatalog = { providerId: 'elevenlabs', source: 'live', fetchedAt: new Date().toISOString(), models, defaultModel: defaults.model, defaultVoiceId: defaults.voiceId };
      this.modelCache = { fingerprint, expires: Date.now() + 5 * 60_000, catalog };
      return catalog;
    });
  }
  async validateTarget(input: VoiceGenerationInput, key: string, signal: AbortSignal): Promise<void> {
    if (!input.providerId || !input.model) throw new Error('Choose a voice provider and model.');
    const catalog = await this.models({ providerId: input.providerId }, key, signal);
    const model = catalog.models.find(m => m.id === input.model);
    if (!model) throw new Error(`Model "${input.model}" is not currently listed for this provider. Query list_voice_models and choose an available model; no fallback was made.`);
    validateVoiceTarget(input, model);
  }
  async generate(input: VoiceGenerationInput, key: string, signal: AbortSignal): Promise<GenerationResult> {
    if (!key.trim()) throw new Error('Save the shared provider API key in Settings.');
    await this.validateTarget(input, key, signal);
    return this.safe(key, async () => {
      const id = input.providerId!;
      const text = input.providerText ?? input.text;
      const headers = { [id === 'elevenlabs' ? 'xi-api-key' : 'x-goog-api-key']: key, 'content-type': 'application/json' };
      let endpoint: string; let body: Record<string, unknown>;
      if (id === 'elevenlabs') {
        endpoint = `${ELEVEN}/v1/text-to-speech/${encodeURIComponent(input.voiceId!)}?output_format=mp3_44100_128`;
        const settings: Record<string, number> = {};
        if (input.stability !== undefined) settings.stability = input.stability;
        if (input.similarity !== undefined) settings.similarity_boost = input.similarity;
        if (input.speed !== undefined) settings.speed = input.speed;
        body = { text, model_id: input.model, ...(Object.keys(settings).length ? { voice_settings: settings } : {}) };
      } else {
        endpoint = `${GEMINI}/interactions`;
        body = { model: input.model, store: false, input: [{ type: 'user_input', content: [{ type: 'text', text, ...(input.style ? { annotations: [{ type: 'speech_metadata', style: input.style }] } : {}) }] }], response_format: { type: 'audio', mime_type: 'audio/wav' }, generation_config: { speech_config: [{ voice: input.voiceId }] } };
      }
      const response = await this.fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal });
      if (!response.ok) throw await ProviderHttpError.fromResponse(response, `${providerLabel(id)} voice`, [key]);
      let bytes: Buffer; let requestId = response.headers.get('request-id') ?? response.headers.get('x-request-id');
      let usage = response.headers.get('character-cost') ?? response.headers.get('x-character-cost');
      if (id === 'elevenlabs') bytes = await readBytes(response, 64 * 1024 * 1024);
      else {
        const payload = await readJson(response, id);
        const blocks = (Array.isArray(payload.steps) ? payload.steps : []).filter((s: unknown) => record(s) && s.type === 'model_output').flatMap((s: Record<string, any>) => Array.isArray(s.content) ? s.content : []).filter((b: unknown) => record(b) && b.type === 'audio' && typeof b.data === 'string');
        const audio = blocks.at(-1);
        if (!audio) throw new ProviderHttpError(undefined, 'Gemini voice', { message: 'The response contained no audio. It may have been blocked or interrupted. No retry was made.' });
        if (audio.mime_type && !['audio/wav', 'audio/x-wav', 'audio/wave'].includes(audio.mime_type)) throw new ProviderHttpError(undefined, 'Gemini voice', { message: 'The response did not contain the requested WAV encoding.' });
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(audio.data) || audio.data.length % 4 === 1) throw new ProviderHttpError(undefined, 'Gemini voice', { message: 'Returned audio was not valid base64.' });
        bytes = Buffer.from(audio.data, 'base64');
        requestId = typeof payload.id === 'string' ? payload.id : requestId;
        const tokens = record(payload.usage) ? payload.usage : null;
        if (tokens) usage = JSON.stringify(Object.fromEntries(Object.entries(tokens).filter(([k, v]) => /token/.test(k) && typeof v === 'number')));
      }
      if (!bytes.length) throw new ProviderHttpError(undefined, providerLabel(id), { message: 'Returned voice audio was empty.' });
      return { bytes, format: id === 'elevenlabs' ? 'mp3' : 'wav', provider: providerLabel(id), model: input.model!, requestId, usage: usage ?? null, providerPrompt: text };
    });
  }
  async list(input: VoiceListInput, key: string, signal: AbortSignal): Promise<VoicePage> {
    return this.safe(key, async () => {
      const id = input.providerId;
      const url = new URL(id === 'elevenlabs' ? `${ELEVEN}/v2/voices` : `${GEMINI}/voices`);
      url.searchParams.set('page_size', '100');
      if (input.pageToken) url.searchParams.set(id === 'elevenlabs' ? 'next_page_token' : 'page_token', input.pageToken);
      if (input.search) url.searchParams.set('search', input.search);
      if (input.language) url.searchParams.set(id === 'elevenlabs' ? 'language' : 'language_code', input.language);
      if (id === 'gemini') url.searchParams.set('type', 'prebuilt');
      const response = await this.fetcher(url, { headers: { [id === 'elevenlabs' ? 'xi-api-key' : 'x-goog-api-key']: key }, signal });
      if (!response.ok) throw await ProviderHttpError.fromResponse(response, `${providerLabel(id)} voices`, [key]);
      const payload = await readJson(response, id, 4 * 1024 * 1024);
      if (!Array.isArray(payload.voices)) throw new ProviderHttpError(undefined, providerLabel(id), { message: 'Voice list response was invalid.' });
      const voices: VoiceOption[] = payload.voices.filter(record).flatMap((v: Record<string, any>) => {
        const voiceId = id === 'elevenlabs' ? v.voice_id : v.id;
        if (typeof voiceId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(voiceId)) return [];
        const name = id === 'elevenlabs' ? v.name : v.display_name;
        return [{ id: voiceId, name: typeof name === 'string' ? name : voiceId, description: typeof v.description === 'string' ? v.description : '', labels: id === 'elevenlabs' ? stringLabels(v.labels) : stringLabels(Object.fromEntries(['accent', 'language_code', 'region_code', 'gender', 'pitch', 'persona', 'context'].map(k => [k, v[k]]))) }];
      });
      if (id === 'gemini' && !input.pageToken && !input.language) {
        const filter = input.search?.toLowerCase() ?? '';
        for (const v of GEMINI_VOICES) if ((!filter || `${v.name} ${v.description}`.toLowerCase().includes(filter)) && !voices.some(found => found.id.toLowerCase() === v.id.toLowerCase())) voices.unshift(v);
      }
      const next = payload.next_page_token;
      return { voices, nextPageToken: typeof next === 'string' && next && (id !== 'elevenlabs' || payload.has_more === true) ? next : null };
    });
  }
}
