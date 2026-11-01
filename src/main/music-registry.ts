import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import type { ProviderKeys } from './provider-keys';
import type { MusicProviderEntry, MusicProviderKind, ProviderKeyStatus } from '../shared/types';
import { defaultMusicModel, isMusicModel, MUSIC_MODELS } from '../shared/music-models';
import { LATEST_MODEL } from '../shared/elevenlabs-models';
import type { ElevenLabsModels } from './providers/elevenlabs-models';

/** Persisted provider record; readiness is resolved from secure storage on read. */
export interface MusicProviderRecord {
  id: string;
  label: string;
  kind: MusicProviderKind;
  model: string;
}

export interface ResolvedMusicTarget {
  provider: MusicProviderRecord;
  /** Exact model, or "latest" for ElevenLabs, resolved by the transport per attempt. */
  model: string;
  key: string;
}

export function isMusicProviderKind(value: unknown): value is MusicProviderKind {
  return value === 'elevenlabs-music' || value === 'gemini-lyria';
}

export function parseMusicProviders(raw: string): MusicProviderRecord[] {
  if (!raw.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved music providers are invalid.'); }
  if (!Array.isArray(parsed)) throw new Error('Saved music providers are invalid.');
  return parsed.filter((entry): entry is MusicProviderRecord => {
    const candidate = entry as Partial<MusicProviderRecord>;
    return typeof candidate.id === 'string' && typeof candidate.label === 'string' && typeof candidate.model === 'string' && isMusicProviderKind(candidate.kind);
  });
}

/** ElevenLabs accepts "latest" or a currently listed ID; Lyria uses its reviewed catalog. */
export function validateMusicModel(kind: MusicProviderKind, model: string, elevenLabsIds: string[]): void {
  const allowed = kind === 'elevenlabs-music' ? elevenLabsIds : MUSIC_MODELS[kind].map(entry => entry.id);
  if (kind === 'elevenlabs-music' ? model !== LATEST_MODEL && !allowed.includes(model) : !isMusicModel(kind, model)) throw new Error(`"${model}" is not a supported model for this provider. Choose one of: ${[...(kind === 'elevenlabs-music' ? [LATEST_MODEL] : []), ...allowed].join(', ')}.`);
}

export function validateMusicProviderFields(label: string, kind: unknown, model: string, elevenLabsIds: string[]): { label: string; kind: MusicProviderKind; model: string } {
  const name = label.trim();
  if (!name) throw new Error('A provider name is required.');
  if (name.length > 80) throw new Error('Provider name is too long.');
  if (!isMusicProviderKind(kind)) throw new Error('Music provider type must be ElevenLabs Music or Gemini Lyria.');
  const slug = model.trim();
  if (!slug) throw new Error('A model is required.');
  validateMusicModel(kind, slug, elevenLabsIds);
  return { label: name, kind, model: slug };
}

/**
 * Music entries own model choices, while credentials belong to their vendor.
 * One entry is active; a request may override it.
 */
export class MusicRegistry {
  constructor(private readonly store: Store, private readonly keys: ProviderKeys, private readonly models: ElevenLabsModels) {}

  private async elevenLabsIds(): Promise<string[]> {
    return (await this.models.catalog('music', await this.keys.get('elevenlabs').catch(() => null))).models.map(entry => entry.id);
  }

  providers(): MusicProviderRecord[] {
    return parseMusicProviders(this.store.setting('music-providers', '[]'));
  }

  private write(providers: MusicProviderRecord[]): void {
    this.store.setSetting('music-providers', JSON.stringify(providers));
  }

  activeId(): string | null {
    const providers = this.providers();
    const active = this.store.setting('music-active', '').trim();
    if (active && providers.some(entry => entry.id === active)) return active;
    return providers[0]?.id ?? null;
  }

  setActive(providerId: string): string {
    const provider = this.providers().find(entry => entry.id === providerId);
    if (!provider) throw new Error('Music provider not found. Add it in Settings first.');
    this.store.setSetting('music-active', provider.id);
    return provider.id;
  }

  async providerKey(id: string): Promise<string | null> {
    const provider = this.providers().find(p => p.id === id);
    if (!provider) return null;
    return this.keys.get(provider.kind === 'elevenlabs-music' ? 'elevenlabs' : 'gemini');
  }

  async entries(knownStatus?: ProviderKeyStatus[]): Promise<MusicProviderEntry[]> {
    const providers = this.providers();
    const entries: MusicProviderEntry[] = [];
    const status = knownStatus ?? await this.keys.status();
    const latest = providers.some(p => p.kind === 'elevenlabs-music' && p.model === LATEST_MODEL) ? this.models.peek('music', await this.keys.get('elevenlabs').catch(() => null)).latestModel : '';
    for (const provider of providers) entries.push({ ...provider, resolvedModel: provider.model === LATEST_MODEL ? latest : provider.model, ready: status.find(s => s.id === (provider.kind === 'elevenlabs-music' ? 'elevenlabs' : 'gemini'))?.ready ?? false });
    return entries;
  }

  async saveProvider(input: { id?: string; label: string; kind: MusicProviderKind; model: string }): Promise<MusicProviderEntry> {
    const fields = validateMusicProviderFields(input.label, input.kind, input.model, input.kind === 'elevenlabs-music' ? await this.elevenLabsIds() : []);
    const providers = this.providers();
    const id = input.id?.trim() || randomUUID();
    const existing = providers.findIndex(entry => entry.id === id);
    if (existing >= 0) await this.keys.get(providers[existing]!.kind === 'elevenlabs-music' ? 'elevenlabs' : 'gemini');
    const record: MusicProviderRecord = { id, ...fields };
    if (existing >= 0) providers[existing] = record;
    else providers.push(record);
    this.write(providers);
    if (!this.store.setting('music-active', '').trim()) this.store.setSetting('music-active', id);
    const status = await this.keys.status();
    return (await this.entries(status)).find(entry => entry.id === record.id)!;
  }

  async deleteProvider(id: string): Promise<void> {
    const existing = this.providers().find(p => p.id === id);
    if (existing) await this.keys.get(existing.kind === 'elevenlabs-music' ? 'elevenlabs' : 'gemini');
    this.write(this.providers().filter(entry => entry.id !== id));
    if (this.store.setting('music-active', '').trim() === id) this.store.setSetting('music-active', this.providers()[0]?.id ?? '');
  }

  /**
   * Resolves the provider for one request. An explicit override must exist; otherwise
   * the active provider is used. A request model pins that one generation. Keys resolve
   * here, inside the privileged operation.
   */
  async resolve(providerId?: string | null, model?: string): Promise<ResolvedMusicTarget> {
    const providers = this.providers();
    if (!providers.length) throw new Error('Configure a music provider in Settings first.');
    const requested = providerId?.trim();
    const provider = requested ? providers.find(entry => entry.id === requested) : undefined;
    if (requested && !provider) throw new Error(`No configured music provider has the ID "${requested}". Configured providers: ${providers.map(entry => `${entry.label} (${entry.id})`).join(', ')}. Omit providerId to use the active provider, or pick another in Settings.`);
    const active = provider ?? providers.find(entry => entry.id === this.activeId()) ?? providers[0]!;
    const key = await this.providerKey(active.id);
    if (!key?.trim()) throw new Error(`Add the API key for ${active.label} in Settings first.`);
    const chosen = model?.trim() || active.model;
    const ids = active.kind === 'elevenlabs-music' ? (await this.models.catalog('music', key)).models.map(entry => entry.id) : [];
    try { validateMusicModel(active.kind, chosen, ids); }
    catch (error) { throw new Error(model ? (error as Error).message : `The saved model for "${active.label}" is not currently available. Update the provider in Settings. ${(error as Error).message}`); }
    return { provider: active, model: chosen, key };
  }
}

export { defaultMusicModel };
