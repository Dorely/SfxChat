import { useEffect, useState } from 'react';
import type { AudioProviderId, Snapshot, VoiceGenerationInput } from '../shared/types';
import { providerLabel, VOICE_DEFAULTS } from '../shared/voice-models';
import VoiceControls from './VoiceControls';

export function SharedProviderKeys({ snapshot }: { snapshot: Snapshot }) {
  return <>{(['elevenlabs', 'gemini'] as const).map(id => <ProviderKey key={id} id={id} snapshot={snapshot} />)}</>;
}
function ProviderKey({ id, snapshot }: { id: AudioProviderId; snapshot: Snapshot }) {
  const status = snapshot.settings.providerKeys.find(s => s.id === id);
  const [key, setKey] = useState('');
  const [candidate, setCandidate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (action: () => Promise<void>) => { setError(null); setBusy(true); try { await action(); setKey('') } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save key.') } finally { setBusy(false) } };
  return <section className="settings-section settings-card"><div className="settings-section-heading"><div><h3>{providerLabel(id)}</h3><p>Used for {id === 'elevenlabs' ? 'effects, music and voice' : 'music, voice and direct Gemini chat'}. Saved keys are never displayed.</p></div><span className={`readiness ${status?.ready ? 'ready' : ''}`}><i />{status?.ready ? 'Key saved' : status?.candidates.length ? 'Choose saved key' : 'Not configured'}</span></div>
    {!!status?.candidates.length && <div className="key-conflict"><p>Different saved keys were found. Choose the one to retain for all {providerLabel(id)} capabilities.</p><select aria-label={`${providerLabel(id)} key to retain`} value={candidate} onChange={e => setCandidate(e.target.value)}><option value="">Choose saved key…</option>{status.candidates.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select><button className="secondary-button" disabled={!candidate || busy} onClick={() => void act(() => window.sfx.selectProviderKey(id, candidate))}>Use selected key</button></div>}
    {!status?.candidates.length && <div className="secret-row"><input type="password" aria-label={`${providerLabel(id)} API key`} autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={status?.ready ? 'Replace saved API key' : 'Paste API key'} /><button className="secondary-button" disabled={!key.trim() || busy} onClick={() => void act(() => window.sfx.saveProviderKey(id, key))}>{status?.ready || status?.candidates.length ? 'Replace key' : 'Save key'}</button>{status?.ready && <button className="text-button" disabled={busy} onClick={() => void act(() => window.sfx.saveProviderKey(id, ''))}>Remove key</button>}</div>}
    {error && <p className="settings-error" role="alert">{error}</p>}
  </section>;
}
export function VoiceSettings({ snapshot }: { snapshot: Snapshot }) {
  const [id, setId] = useState<AudioProviderId>(snapshot.settings.activeVoiceId);
  const config = snapshot.settings.voiceProviders.find(p => p.id === id) ?? VOICE_DEFAULTS[id];
  const [value, setValue] = useState<VoiceGenerationInput>({ kind: 'voice', text: '', providerId: id, model: config.model, voiceId: config.voiceId });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setValue({ kind: 'voice', text: '', providerId: id, model: config.model, voiceId: config.voiceId }); setSaved(false); }, [id, config.model, config.voiceId]);
  const action = async (operation: () => Promise<void>) => { setError(null); try { await operation(); setSaved(true) } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save voice settings.') } };
  return <section className="settings-section settings-card"><div className="settings-section-heading"><div><h3>{providerLabel(id)}</h3><p>Used when a voice generation does not name a model or voice.</p></div><span className={`readiness ${snapshot.settings.activeVoiceId === id ? 'ready' : ''}`}><i />{snapshot.settings.activeVoiceId === id ? 'Active for voice' : 'Not active'}</span></div>
    <VoiceControls value={value} providers={snapshot.settings.voiceProviders} configurationOnly onChange={next => { if (next.providerId !== id) setId(next.providerId!); setValue(next); setSaved(false) }} />
    <div className="model-row"><button className="secondary-button" onClick={() => void action(() => window.sfx.saveVoiceProvider({ id, model: value.model!, voiceId: value.voiceId! }))}>Save voice defaults</button><button className="secondary-button" disabled={snapshot.settings.activeVoiceId === id} onClick={() => void action(() => window.sfx.setActiveVoice(id))}>Use {providerLabel(id)} for voice</button></div>
    {saved && <p className="secure-note">Saved.</p>}{error && <p className="settings-error" role="alert">{error}</p>}
  </section>;
}
