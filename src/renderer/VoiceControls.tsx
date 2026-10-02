import { useEffect, useRef, useState } from 'react';
import type { VoiceGenerationInput, VoiceOption, VoiceProviderEntry } from '../shared/types';
import { GEMINI_VOICES, providerLabel, VOICE_DEFAULTS, VOICE_MODELS } from '../shared/voice-models';

/** Provider-aware controls reused by manual generation, settings and regeneration. */
export default function VoiceControls({ value, providers, onChange, configurationOnly = false }: {
  value: VoiceGenerationInput; providers: VoiceProviderEntry[];
  onChange(value: VoiceGenerationInput): void; configurationOnly?: boolean;
}) {
  const providerId = value.providerId ?? 'elevenlabs';
  const defaults = providers.find(p => p.id === providerId) ?? VOICE_DEFAULTS[providerId];
  const model = value.model ?? defaults.model;
  const voiceId = value.voiceId ?? defaults.voiceId;
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('');
  const [page, setPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const serial = useRef(0);
  useEffect(() => { ++serial.current; setVoices(providerId === 'gemini' ? GEMINI_VOICES : []); setPage(null); setSearch(''); setLanguage(''); setError(null); setLoading(false); }, [providerId]);
  useEffect(() => { ++serial.current; setPage(null); setLoading(false); }, [search, language]);
  useEffect(() => () => { ++serial.current }, []);
  const update = (patch: Partial<VoiceGenerationInput>) => onChange({ ...value, providerId, model, voiceId, ...patch });
  const load = async (more = false) => {
    const version = ++serial.current;
    setLoading(true); setError(null);
    try {
      const result = await window.sfx.listVoices({ providerId, ...(search ? { search } : {}), ...(language ? { language } : {}), ...(more && page ? { pageToken: page } : {}) });
      if (version !== serial.current) return;
      setVoices(current => more ? [...current, ...result.voices.filter(v => !current.some(old => old.id === v.id))] : result.voices); setPage(result.nextPageToken);
    } catch (e) { if (version === serial.current) setError(e instanceof Error ? e.message : 'Voice discovery failed.'); }
    finally { if (version === serial.current) setLoading(false); }
  };
  const selected = voices.find(v => providerId === 'gemini' ? v.id.toLowerCase() === voiceId.toLowerCase() : v.id === voiceId);
  return <div className="voice-controls">
    <div className="generation-options">
      <label>Provider<select aria-label="Voice provider" value={providerId} onChange={e => {
        const id = e.target.value as typeof providerId;
        const next = providers.find(p => p.id === id) ?? VOICE_DEFAULTS[id];
        onChange({ kind: 'voice', text: value.text, count: value.count, name: value.name, parentId: value.parentId, providerId: id, model: next.model, voiceId: next.voiceId });
      }}>{(['elevenlabs', 'gemini'] as const).map(id => <option key={id} value={id}>{providerLabel(id)}{providers.find(p => p.id === id)?.ready ? '' : ' — key needed'}</option>)}</select></label>
      <label>Model<select aria-label="Voice model" value={model} onChange={e => { const next = { ...value, providerId, voiceId, model: e.target.value }; if (next.model === 'eleven_v4') delete next.speed; onChange(next) }}>{VOICE_MODELS[providerId].map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <label>Voice<select aria-label="Voice selection" value={selected?.id ?? voiceId} onChange={e => update({ voiceId: e.target.value })}>
        {!selected && <option value={voiceId}>{voiceId}</option>}{voices.map(v => <option value={v.id} key={v.id}>{v.name}{v.description ? ` — ${v.description.slice(0, 60)}` : ''}</option>)}
      </select></label>
    </div>
    <details className="voice-discovery"><summary>Find a voice or enter its ID</summary>
      <div className="generation-options"><label>Voice ID<input aria-label="Voice ID" value={voiceId} onChange={e => update({ voiceId: e.target.value })} /></label>
        <label>Search<input aria-label="Voice search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Narrator, warm…" /></label>
        <label>Language<input aria-label="Voice language filter" value={language} onChange={e => setLanguage(e.target.value)} placeholder={providerId === 'gemini' ? 'en-US' : 'en'} /></label>
        <button type="button" className="secondary-button" disabled={loading} onClick={() => void load()}>{loading ? 'Loading…' : 'Find voices'}</button>
        {page && <button type="button" className="secondary-button" disabled={loading} onClick={() => void load(true)}>Load more</button>}
      </div><p className="field-hint">{selected ? `${selected.description} ${Object.entries(selected.labels).map(([k, v]) => `${k}: ${v}`).join(' · ')}` : 'Discovery uses the shared provider key. It does not generate a clip.'}</p>
      {voices.length === 0 && !loading && <p className="field-hint">No voices loaded. Search the provider or enter an existing voice ID.</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
    </details>
    {!configurationOnly && <>
      {providerId === 'gemini' ? <label>Delivery style<textarea rows={2} aria-label="Voice delivery style" value={value.style ?? ''} onChange={e => update({ style: e.target.value })} placeholder="Optional: quiet, restrained urgency" /><span className="field-hint">Separate from spoken text. Use &lt;sigh&gt; or &lt;short pause&gt; for momentary vocal events; keep style brief.</span></label> : <div className="generation-options">
        <label>Stability<input aria-label="Voice stability" type="number" min="0" max="1" step="0.05" value={value.stability ?? ''} placeholder="Voice default" onChange={e => update({ stability: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        <label>Similarity<input aria-label="Voice similarity" type="number" min="0" max="1" step="0.05" value={value.similarity ?? ''} placeholder="Voice default" onChange={e => update({ similarity: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        {model === 'eleven_multilingual_v2' && <label>Speed<input aria-label="Voice speed" type="number" min="0.7" max="1.2" step="0.05" value={value.speed ?? ''} placeholder="Voice default" onChange={e => update({ speed: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>}
      </div>}
      <p className="field-hint">{providerId === 'elevenlabs' ? model === 'eleven_v4' ? 'Use square-bracket vocal tags such as [whispering] and punctuation for delivery. v4 supports slash-delimited IPA, but has no SSML or speed setting.' : 'Multilingual v2 supports speed and restrained SSML pauses. Narrative directions can be spoken aloud; keep the script intentional.' : 'Select a voice matching the language and accent. Natural delivery usually needs no style instruction.'}</p>
      <details><summary>Prepared script (optional)</summary><label>Provider text<textarea rows={3} aria-label="Prepared voice script" value={value.providerText ?? ''} onChange={e => update({ providerText: e.target.value || undefined })} placeholder="Use only for deliberate tags, pronunciation changes, or requested normalization." /><span className="field-hint">Original text remains preserved separately. Empty sends the original text exactly.</span></label></details>
    </>}
  </div>;
}

export function VoiceGenerator({ providers, activeId, onGenerate }: { providers: VoiceProviderEntry[]; activeId: 'elevenlabs' | 'gemini'; onGenerate(input: VoiceGenerationInput): Promise<boolean> }) {
  const [value, setValue] = useState<VoiceGenerationInput>({ kind: 'voice', text: '', count: 1 });
  const [submitting, setSubmitting] = useState(false);
  const resolved = { ...value, providerId: value.providerId ?? activeId };
  return <div className="generation-form voice-form"><label>Spoken text<textarea rows={3} aria-label="Voice spoken text" value={value.text} onChange={e => setValue({ ...value, text: e.target.value, providerText: undefined })} placeholder="Enter the words the voice should say…" /><span className="field-hint">Changing these words clears the prepared script.</span></label>
    <VoiceControls value={resolved} providers={providers} onChange={setValue} />
    <div className="generation-options"><label>Name (optional)<input aria-label="Voice clip name" value={value.name ?? ''} onChange={e => setValue({ ...value, name: e.target.value || undefined })} placeholder="Name this clip" /></label><label>Count<input aria-label="Voice candidate count" type="number" min="1" step="1" value={value.count ?? 1} onChange={e => setValue({ ...value, count: Number(e.target.value) || 1 })} /></label>
      <button className="primary-button generate-button" disabled={!value.text.trim() || submitting} onClick={() => { setSubmitting(true); void onGenerate(resolved).finally(() => setSubmitting(false)) }}>{submitting ? 'Queuing…' : 'Generate voice'}</button></div>
  </div>;
}
