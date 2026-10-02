import type { AudioProviderId, VoiceProviderEntry, ProviderKeyStatus } from '../shared/types';
import { providerLabel, validateVoiceTarget, VOICE_DEFAULTS } from '../shared/voice-models';
import type { Store } from './store';
import type { ProviderKeys } from './provider-keys';

/** One voice configuration per vendor; model and voice are not credential owners. */
export class VoiceRegistry {
  constructor(private store: Store, private keys: ProviderKeys) {}
  activeId(): AudioProviderId { return this.store.setting('voice-active', 'elevenlabs') === 'gemini' ? 'gemini' : 'elevenlabs'; }
  setActive(id: AudioProviderId): void { this.store.setSetting('voice-active', id); }
  configuration(id: AudioProviderId): { model: string; voiceId: string } {
    const saved = this.store.setting(`voice-${id}`, '');
    if (!saved) return VOICE_DEFAULTS[id];
    const config = JSON.parse(saved) as { model: string; voiceId: string };
    validateVoiceTarget({ ...config, kind: 'voice', providerId: id, text: 'Configuration validation' });
    return config;
  }
  save(input: { id: AudioProviderId; model: string; voiceId: string }): void {
    validateVoiceTarget({ kind: 'voice', providerId: input.id, model: input.model, voiceId: input.voiceId, text: 'Configuration validation' });
    this.store.setSetting(`voice-${input.id}`, JSON.stringify({ model: input.model, voiceId: input.voiceId }));
  }
  async entries(knownStatus?: ProviderKeyStatus[]): Promise<VoiceProviderEntry[]> {
    const status = knownStatus ?? await this.keys.status();
    return status.map(s => ({ id: s.id, label: providerLabel(s.id), ...this.configuration(s.id), ready: s.ready }));
  }
}
