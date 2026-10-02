import type { AudioProviderId, ProviderKeyStatus } from '../shared/types';
import { providerLabel } from '../shared/voice-models';
import type { Store } from './store';
import { secretName, type SecureStore } from './providers/secrets';

import { isDirectGemini } from '../shared/provider-identities';
export { isDirectGemini } from '../shared/provider-identities';
interface Candidate { id: string; label: string; value: string }

/** One OS-protected key per vendor. Legacy values stay encrypted until resolved. */
export class ProviderKeys {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private store: Store, private secrets: SecureStore) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action); this.pending = result.catch(() => undefined); return result;
  }
  private records(key: string): Record<string, string>[] {
    const parsed: unknown = JSON.parse(this.store.setting(key, '[]'));
    if (!Array.isArray(parsed)) throw new Error('Saved provider configuration is invalid.');
    return parsed.filter((v): v is Record<string, string> => !!v && typeof v === 'object' && typeof v.id === 'string');
  }
  private sources(id: AudioProviderId): { id: string; label: string }[] {
    const sources: { id: string; label: string }[] = [{ id, label: `${providerLabel(id)} shared key` }];
    for (const entry of this.records('music-providers')) {
      if (entry.kind === (id === 'elevenlabs' ? 'elevenlabs-music' : 'gemini-lyria')) sources.push({ id: secretName('music-key', entry.id!), label: `Music: ${entry.label}` });
    }
    if (id === 'gemini') for (const entry of this.records('chat-providers')) {
      if (isDirectGemini(entry.baseUrl ?? '')) sources.push({ id: secretName('chat-key', entry.id!), label: `Chat: ${entry.label}` });
    }
    return sources;
  }
  private async candidates(id: AudioProviderId): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    for (const source of this.sources(id)) {
      const value = (await this.secrets.get(source.id))?.trim();
      if (value) candidates.push({ ...source, value });
    }
    return candidates;
  }
  private async consolidate(id: AudioProviderId, value: string | null): Promise<void> {
    // Write authoritative ciphertext first; failures never discard the only copy.
    if (value) await this.secrets.set(id, value); else await this.secrets.delete(id);
    for (const source of this.sources(id)) if (source.id !== id) await this.secrets.delete(source.id);
  }
  private async inspect(id: AudioProviderId): Promise<ProviderKeyStatus> {
    const candidates = await this.candidates(id);
    const distinct = new Set(candidates.map(c => c.value));
    if (distinct.size > 1) return { id, ready: false, candidates: candidates.map(({ id, label }) => ({ id, label })) };
    if (candidates.length && (candidates.length > 1 || candidates[0]!.id !== id)) await this.consolidate(id, candidates[0]!.value);
    return { id, ready: candidates.length > 0, candidates: [] };
  }
  status(): Promise<ProviderKeyStatus[]> {
    return this.serial(async () => {
      if (!await this.secrets.available()) return ['elevenlabs', 'gemini'].map(id => ({ id: id as AudioProviderId, ready: false, candidates: [] }));
      return [await this.inspect('elevenlabs'), await this.inspect('gemini')];
    });
  }
  get(id: AudioProviderId): Promise<string | null> {
    return this.serial(async () => {
      const status = await this.inspect(id);
      if (status.candidates.length) throw new Error(`Choose the ${providerLabel(id)} key to retain in Settings before using this provider.`);
      return this.secrets.get(id);
    });
  }
  save(id: AudioProviderId, key: string): Promise<void> {
    return this.serial(async () => {
      if ((await this.inspect(id)).candidates.length) throw new Error(`Choose the ${providerLabel(id)} key to retain before replacing or removing it.`);
      await this.consolidate(id, key.trim() || null);
    });
  }
  select(id: AudioProviderId, candidateId: string): Promise<void> {
    return this.serial(async () => {
      const candidate = (await this.candidates(id)).find(c => c.id === candidateId);
      if (!candidate) throw new Error('That saved key is no longer available. Refresh Settings.');
      await this.consolidate(id, candidate.value);
    });
  }
}
