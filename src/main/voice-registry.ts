import type { AudioProviderId, VoiceProviderEntry, ProviderKeyStatus } from '../shared/types';
import { latestVoiceModel, providerLabel, validateVoiceTarget, VOICE_DEFAULTS } from '../shared/voice-models';
import { LATEST_MODEL } from '../shared/elevenlabs-models';
import type { Store } from './store';
import type { ProviderKeys } from './provider-keys';

/** ElevenLabs may save "latest"; the voice ID is still checked against a concrete profile. */
function validateConfiguration(id: AudioProviderId, config: { model: string; voiceId: string }): void {
  if (config.model === LATEST_MODEL && id !== 'elevenlabs') throw new Error('Choose a supported voice model for this provider.');
  validateVoiceTarget({ kind: 'voice', providerId: id, model: config.model === LATEST_MODEL ? latestVoiceModel(id) : config.model, voiceId: config.voiceId, text: 'Configuration validation' });
}

/** One voice configuration per vendor; model and voice are not credential owners. */
export class VoiceRegistry {
  constructor(private store: Store, private keys: ProviderKeys, private latest: (id: AudioProviderId) => string = latestVoiceModel) {}
  activeId(): AudioProviderId { return this.store.setting('voice-active', 'elevenlabs') === 'gemini' ? 'gemini' : 'elevenlabs'; }
  setActive(id: AudioProviderId): void { this.store.setSetting('voice-active', id); }
  configuration(id: AudioProviderId): { model: string; voiceId: string } {
    const saved = this.store.setting(`voice-${id}`, '');
    if (!saved) return VOICE_DEFAULTS[id];
    const config = JSON.parse(saved) as { model: string; voiceId: string };
    validateConfiguration(id, config);
    return config;
  }
  save(input: { id: AudioProviderId; model: string; voiceId: string }): void {
    validateConfiguration(input.id, input);
    this.store.setSetting(`voice-${input.id}`, JSON.stringify({ model: input.model, voiceId: input.voiceId }));
  }
  async entries(knownStatus?: ProviderKeyStatus[]): Promise<VoiceProviderEntry[]> {
    const status = knownStatus ?? await this.keys.status();
    return status.map(s => { const config = this.configuration(s.id); return { id: s.id, label: providerLabel(s.id), ...config, resolvedModel: config.model === LATEST_MODEL ? this.latest(s.id) : config.model, ready: s.ready }; });
  }
}
