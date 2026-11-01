import { createHash } from 'node:crypto';
import type { AudioModelCatalog, AudioModelKind, AudioModelOption } from '../../shared/types';
import { newestModels, REVIEWED_AUDIO_MODELS, UNREVIEWED_AUDIO_MODEL_NOTE } from '../../shared/elevenlabs-models';
import { ProviderHttpError } from './errors';

// ElevenLabs has no model-list endpoint for Sound Effects or Music; /v1/models covers
// speech only. The public API schema is the official machine-readable list of the IDs
// each endpoint accepts. It is unauthenticated, so no key leaves the app for discovery.
const SCHEMA_URL = 'https://api.elevenlabs.io/openapi.json';
const ENDPOINTS: Record<AudioModelKind, string> = { effect: '/v1/sound-generation', music: '/v1/music' };
const MAX_SCHEMA_BYTES = 16 * 1024 * 1024;
const CACHE_MS = 6 * 60 * 60_000;
const FAILURE_RETRY_MS = 5 * 60_000;
const MODEL_ID = /^[a-zA-Z0-9._-]{1,120}$/;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
type ListedModel = { id: string; deprecated: boolean };

async function readText(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_SCHEMA_BYTES) throw new Error('ElevenLabs API schema exceeded the supported size.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('ElevenLabs API schema response was empty.');
  const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_SCHEMA_BYTES) throw new Error('ElevenLabs API schema exceeded the supported size.');
      chunks.push(Buffer.from(part.value));
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size).toString('utf8');
}

/** The model_id enum of one endpoint's JSON body, following local schema references. */
function endpointModels(schema: Record<string, any>, path: string): ListedModel[] | null {
  const resolve = (node: unknown): unknown => {
    for (let depth = 0; depth < 8 && record(node) && typeof node.$ref === 'string'; depth++) {
      const name = /^#\/components\/schemas\/([^/]+)$/.exec(node.$ref)?.[1];
      node = name ? schema.components?.schemas?.[name] : undefined;
    }
    return node;
  };
  const body = resolve(schema.paths?.[path]?.post?.requestBody?.content?.['application/json']?.schema);
  if (!record(body) || !record(body.properties)) return null;
  const field = resolve(body.properties.model_id);
  if (!record(field)) return null;
  const listed = Array.isArray(field.enum) ? field : (Array.isArray(field.anyOf) ? field.anyOf : []).map(resolve).find(entry => record(entry) && Array.isArray(entry.enum));
  if (!record(listed) || !Array.isArray(listed.enum)) return null;
  const notes = record(listed['x-fern-enum']) ? listed['x-fern-enum'] : {};
  const models = listed.enum.filter((id: unknown): id is string => typeof id === 'string' && MODEL_ID.test(id)).slice(0, 50);
  return models.length ? [...new Set(models)].map(id => ({ id, deprecated: record(notes[id]) && notes[id].deprecated === true })) : null;
}

/** True only for a definite provider refusal of the model itself; nothing was generated or billed. */
export function isModelAccessRejection(error: unknown): boolean {
  if (!(error instanceof ProviderHttpError) || ![400, 403, 404, 422].includes(error.status ?? 0)) return false;
  const text = `${error.details.code ?? ''} ${error.details.message ?? ''}`;
  return /model[_ -]?(?:not[_ -]?found|unavailable|access|not[_ -]?allowed)|unknown model|model\b[^.]{0,60}\b(?:not (?:found|available|allowed|supported)|unavailable|does not exist|access|permission)|(?:access|permission)\b[^.]{0,60}\bmodel/i.test(text);
}

/**
 * Sound Effects and Music model discovery. The newest listed, non-deprecated model that
 * has not been refused for the saved key is "latest"; reviewed IDs are the offline fallback.
 */
export class ElevenLabsModels {
  private schema?: { expires: number; fetchedAt: string | null; listed: Partial<Record<AudioModelKind, ListedModel[]>>; error: string | null };
  private loading?: Promise<void>;
  private refused = new Map<string, Set<string>>();
  constructor(private fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  async catalog(kind: AudioModelKind, key: string | null, refresh = false): Promise<AudioModelCatalog> {
    if (refresh || !this.schema || this.schema.expires <= Date.now()) {
      this.loading ??= this.load().finally(() => { this.loading = undefined; });
      await this.loading;
    }
    return this.peek(kind, key);
  }

  /** Cached or reviewed catalog without network access, for snapshots and labels. */
  peek(kind: AudioModelKind, key: string | null): AudioModelCatalog {
    const listed = this.schema?.listed[kind];
    const refused = key ? this.refused.get(fingerprint(key)) : undefined;
    const models: AudioModelOption[] = (listed ?? REVIEWED_AUDIO_MODELS[kind].map(m => ({ id: m.id, deprecated: !!m.deprecated }))).map(entry => {
      const reviewed = REVIEWED_AUDIO_MODELS[kind].find(m => m.id === entry.id);
      return { id: entry.id, label: reviewed?.label ?? entry.id, note: reviewed?.note ?? UNREVIEWED_AUDIO_MODEL_NOTE, deprecated: entry.deprecated || !!reviewed?.deprecated, reviewed: !!reviewed, available: !refused?.has(`${kind}:${entry.id}`) };
    });
    const latest = newestModels(models, m => !m.deprecated && m.available)[0] ?? newestModels(models)[0]!;
    return { kind, source: listed ? 'live' : 'built-in', fetchedAt: listed ? this.schema!.fetchedAt : null, error: this.schema?.error ?? null, models: newestModels(models), latestModel: latest.id };
  }

  /** Models an automatic Latest request may try, newest first. */
  async automatic(kind: AudioModelKind, key: string): Promise<string[]> {
    const catalog = await this.catalog(kind, key);
    const order = newestModels(catalog.models, m => !m.deprecated && m.available).map(m => m.id);
    return order.length ? order.slice(0, 3) : [catalog.latestModel];
  }

  markRefused(kind: AudioModelKind, id: string, key: string): void {
    const owner = fingerprint(key);
    const refused = this.refused.get(owner) ?? new Set<string>();
    refused.add(`${kind}:${id}`); this.refused.set(owner, refused);
  }

  private async load(): Promise<void> {
    try {
      const response = await this.fetcher(SCHEMA_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`ElevenLabs API schema returned HTTP ${response.status}.`);
      const parsed: unknown = JSON.parse(await readText(response));
      if (!record(parsed)) throw new Error('ElevenLabs API schema was not a JSON object.');
      const listed: Partial<Record<AudioModelKind, ListedModel[]>> = {};
      for (const kind of Object.keys(ENDPOINTS) as AudioModelKind[]) { const models = endpointModels(parsed, ENDPOINTS[kind]); if (models) listed[kind] = models; }
      if (!Object.keys(listed).length) throw new Error('ElevenLabs API schema listed no sound or music model IDs.');
      this.schema = { expires: Date.now() + CACHE_MS, fetchedAt: new Date().toISOString(), listed, error: null };
    } catch (error) {
      // Keep the last good listing; the reviewed list covers a first-run failure.
      const message = error instanceof SyntaxError ? 'ElevenLabs API schema was not valid JSON.' : error instanceof Error ? error.message.slice(0, 300) : 'ElevenLabs API schema request failed.';
      this.schema = { expires: Date.now() + FAILURE_RETRY_MS, fetchedAt: this.schema?.fetchedAt ?? null, listed: this.schema?.listed ?? {}, error: message };
    }
  }
}

function fingerprint(key: string): string { return createHash('sha256').update(key).digest('hex'); }
