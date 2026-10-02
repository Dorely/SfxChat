import { useEffect, useState } from 'react';
import type { Snapshot } from '../shared/types';
import type { PlaybackState, ReviewBoard, ReviewContent, ReviewCue } from '../shared/workbench';
import { AudioCardFrame } from './AudioCard';
import Icon from './Icon';
import type { AuditionRequest } from './audition';

export async function workbench<T = unknown>(name: string, args: unknown): Promise<T> {
  const response = await window.sfx.operation(name, args);
  if (!response.ok) throw new Error(`${response.error?.code}: ${response.error?.message}`);
  return response.result as T;
}
const newCue = (key: string): ReviewCue => ({ key, label: 'New cue', brief: '', candidates: [], referenceId: null, referenceGainDb: 0, decision: 'unreviewed', selectedAssetId: null, notes: '' });

/** Compact entry point; a selected review becomes the Playground results. */
export function ReviewLauncher({ snapshot, sessionId, onSelect }: { snapshot: Snapshot; sessionId: string; onSelect(id: string): void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const boards = snapshot.reviews.filter(r => r.sessionId === sessionId);
  const create = async () => {
    setBusy(true); setError('');
    try {
      const cue = newCue('cue_1'); cue.label = 'Candidates';
      cue.candidates = (snapshot.playground[sessionId] ?? []).map(assetId => ({ assetId, label: '', notes: '', gainDb: 0 }));
      const created = await workbench<ReviewBoard>('review_create', { projectId: snapshot.activeProjectId, sessionId, content: { title: 'Sound review', cues: [cue] } });
      onSelect(created.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create review.'); }
    finally { setBusy(false); }
  };
  return <div className="review-launcher">
    {boards.length > 0 && <select aria-label="Open audition review" value="" onChange={e => onSelect(e.target.value)} disabled={busy}><option value="" disabled>Open review…</option>{boards.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select>}
    <button className="secondary-button" disabled={busy} onClick={() => void create()}><Icon name="plus" /> New review</button>
    {error && <span role="alert" className="settings-error">{error}</span>}
  </div>;
}

export default function ReviewPanel({ snapshot, sessionId, selectedId, onSelect, onSelectAsset, playback, onPlay, onStop }: { snapshot: Snapshot; sessionId: string; selectedId: string; onSelect(id: string | null): void; onSelectAsset(id: string): void; playback: PlaybackState; onPlay(input: AuditionRequest): Promise<void>; onStop(): void }) {
  const boards = snapshot.reviews.filter(r => r.sessionId === sessionId);
  const board = boards.find(r => r.id === selectedId);
  const [error, setError] = useState(''), [draft, setDraft] = useState<ReviewBoard | null>(board ?? null), [dirty, setDirty] = useState(false);
  const [format, setFormat] = useState<'original' | 'wav' | 'ogg'>('original'), [destination, setDestination] = useState('');
  const [result, setResult] = useState(''), [busy, setBusy] = useState(false);
  const [loops, setLoops] = useState<Record<string, boolean>>({});
  const scope = { projectId: snapshot.activeProjectId, sessionId };
  useEffect(() => { if (!dirty) setDraft(board ?? null); }, [board?.revision, dirty]);
  const attempt = async (action: () => Promise<unknown>) => { setError(''); setBusy(true); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Review operation failed.'); } finally { setBusy(false); } };
  const change = (content: ReviewContent) => { if (draft) { setDraft({ ...draft, ...content }); setDirty(true); } };
  const cueChange = (index: number, patch: Partial<ReviewCue>) => draft && change({ title: draft.title, cues: draft.cues.map((cue, i) => i === index ? { ...cue, ...patch } : cue) });
  const save = () => attempt(async () => { if (!draft) return; const updated = await workbench<ReviewBoard>('review_update', { ...scope, reviewId: draft.id, expectedRevision: draft.revision, content: { title: draft.title, cues: draft.cues } }); setDraft(updated); setDirty(false); });
  const stop = () => { setError(''); onStop(); };
  const play = (cue: ReviewCue, assetId: string) => attempt(async () => { if (!board) return; const candidate = cue.candidates.find(c => c.assetId === assetId); await onPlay({ sessionId, reviewId: board.id, assetId, gainDb: candidate?.gainDb ?? cue.referenceGainDb, loop: !!loops[assetId] }); });
  const loopToggle = (assetId: string, checked: boolean) => { if (isPlaying(assetId)) stop(); setLoops(current => ({ ...current, [assetId]: checked })); };
  const isPlaying = (id: string) => playback.status === 'playing' && playback.reviewId === selectedId && playback.assetId === id;
  const toggle = (cue: ReviewCue, id: string) => isPlaying(id) ? void stop() : void play(cue, id);
  const move = (index: number, offset: number) => { if (!draft) return; const cues = [...draft.cues]; [cues[index], cues[index + offset]] = [cues[index + offset], cues[index]]; change({ ...draft, cues }); };
  if (!draft) return null;
  return <div className="review-results" aria-label="Playground audition results">
    <div className="review-board-bar">
      <div className="review-board-title"><span className="section-kicker">Cue review</span><select aria-label="Review board" value={selectedId} disabled={dirty || busy} onChange={e => onSelect(e.target.value)}>{boards.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></div>
      <span className="field-hint">Revision {draft.revision} · saved by {draft.origin}</span>
      <div className="header-actions"><button className="secondary-button" disabled={dirty || busy} onClick={() => onSelect(null)}>All Playground sounds</button><button className="secondary-button" onClick={() => void stop()}>Stop audio</button><button className="primary-button" disabled={!dirty || busy} onClick={() => void save()}>Save review</button></div>
    </div>
    {dirty && <div className="review-board-bar"><span className="field-hint">Save to audition changed settings or leave this review.</span><button className="secondary-button" disabled={busy} onClick={() => { setDraft(board ?? null); setDirty(false); }}>Discard / reload</button></div>}
    {error && <p role="alert" className="settings-error">{error}</p>}
    {board && board.revision !== draft.revision && <p role="alert" className="settings-error">New feedback was saved elsewhere. Reload and reconcile before saving.</p>}
    <details className="review-details"><summary>Review details</summary><label>Review title<input value={draft.title} onChange={e => change({ ...draft, title: e.target.value })} /></label></details>
    {draft.cues.map((cue, index) => {
      const reference = snapshot.assets.find(a => a.id === cue.referenceId);
      return <section className="review-cue" key={index} aria-label={`Cue: ${cue.label}`}>
        <div className="review-cue-heading"><div><p className="eyebrow">Cue {String(index + 1).padStart(2, '0')}</p><h2>{cue.label}</h2>{cue.brief && <p className="review-brief">{cue.brief}</p>}</div><span className={`review-decision decision-${cue.decision}`}>{cue.decision === 'selected' ? 'Selected' : cue.decision === 'rejected' ? 'All rejected' : 'Unreviewed'}</span></div>
        <div className="review-cue-layout">
          <div className="review-card-grid">
            {reference && <div className="playground-slot review-reference"><div className="slot-label"><span>Current reference</span></div>
              <AudioCardFrame onSelect={() => onSelectAsset(reference.id)} asset={reference} isPlaying={isPlaying(reference.id)} onToggle={() => toggle(cue, reference.id)} disabled={dirty || busy} compact>
                <div className="review-card-controls"><label className="review-check"><input type="checkbox" aria-label={`Loop ${reference.name}`} checked={!!loops[reference.id]} onChange={e => loopToggle(reference.id, e.target.checked)} /> Loop</label><label>Preview dB<input type="number" min="-60" max="12" value={cue.referenceGainDb} onChange={e => cueChange(index, { referenceGainDb: Number(e.target.value) })} /></label></div>
                <p className="field-hint">Compare candidates against this sound.</p>
              </AudioCardFrame>
            </div>}
            {cue.candidates.map((candidate, ci) => {
              const asset = snapshot.assets.find(a => a.id === candidate.assetId), picked = cue.decision === 'selected' && cue.selectedAssetId === candidate.assetId;
              const remove = () => cueChange(index, { candidates: cue.candidates.filter((_, i) => i !== ci), ...(picked ? { decision: 'unreviewed' as const, selectedAssetId: null } : {}) });
              return <div className="playground-slot" key={candidate.assetId}>
                <div className="slot-label"><span>Candidate {String(ci + 1).padStart(2, '0')}</span><button className="mini-button" aria-label={`Remove candidate ${ci + 1}`} onClick={remove}><Icon name="close" /></button></div>
                {asset ? <AudioCardFrame onSelect={() => onSelectAsset(asset.id)} asset={asset} title={candidate.label} selected={picked} review={picked ? 'accepted' : cue.decision === 'rejected' ? 'rejected' : 'unreviewed'} isPlaying={isPlaying(asset.id)} onToggle={() => toggle(cue, asset.id)} disabled={dirty || busy} compact>
                  <div className="review-card-controls"><label className="review-check"><input type="checkbox" aria-label={`Loop ${asset.name}`} checked={!!loops[asset.id]} onChange={e => loopToggle(asset.id, e.target.checked)} /> Loop</label><label>Preview dB<input type="number" min="-60" max="12" value={candidate.gainDb} onChange={e => cueChange(index, { candidates: cue.candidates.map((c, i) => i === ci ? { ...c, gainDb: Number(e.target.value) } : c) })} /></label></div>
                  <button className={`secondary-button review-pick ${picked ? 'review-pick-active' : ''}`} aria-pressed={picked} onClick={() => cueChange(index, { decision: 'selected', selectedAssetId: asset.id })}><Icon name="check" /> {picked ? 'Selected for this cue' : 'Select this candidate'}</button>
                  <label className="review-candidate-notes">Candidate notes<textarea value={candidate.notes} placeholder="What works? What needs changing?" onChange={e => cueChange(index, { candidates: cue.candidates.map((c, i) => i === ci ? { ...c, notes: e.target.value } : c) })} /></label>
                </AudioCardFrame> : <p role="alert">Candidate is unavailable. Remove it or reload the review.</p>}
              </div>;
            })}
            {!reference && !cue.candidates.length && <p className="review-empty">Add sounds from the library to begin comparing this cue.</p>}
          </div>
          <aside className="review-cue-sidebar" aria-label={`${cue.label} controls and feedback`}>
            <span className="section-kicker">Playback & feedback</span>
            <div className="review-buttons"><button className={cue.decision === 'unreviewed' ? 'review-active unreviewed' : ''} aria-pressed={cue.decision === 'unreviewed'} onClick={() => cueChange(index, { decision: 'unreviewed', selectedAssetId: null })}>Unreviewed</button><button className={cue.decision === 'rejected' ? 'review-active rejected' : ''} aria-pressed={cue.decision === 'rejected'} onClick={() => cueChange(index, { decision: 'rejected', selectedAssetId: null })}><Icon name="x" /> Reject all</button></div>
            <label>Cue feedback<textarea value={cue.notes} placeholder="Direction for the next revision…" onChange={e => cueChange(index, { notes: e.target.value })} /></label>
            {draft.cueAudit?.[cue.key] && <p className="field-hint">Decision saved by {draft.cueAudit[cue.key].decision.origin} · {new Date(draft.cueAudit[cue.key].decision.at).toLocaleString()}</p>}
            <label>Add candidate<select value="" onChange={e => { if (e.target.value) cueChange(index, { candidates: [...cue.candidates, { assetId: e.target.value, label: '', notes: '', gainDb: 0 }] }); }}><option value="">Choose a sound…</option>{snapshot.assets.filter(a => !cue.candidates.some(c => c.assetId === a.id)).map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
            <label>Current reference<select value={cue.referenceId ?? ''} onChange={e => cueChange(index, { referenceId: e.target.value || null })}><option value="">None</option>{snapshot.assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <details className="review-details"><summary>Edit cue details</summary>
              <label>Label<input value={cue.label} onChange={e => cueChange(index, { label: e.target.value })} /></label><label>Brief<textarea value={cue.brief} onChange={e => cueChange(index, { brief: e.target.value })} /></label><label>Cue key<input value={cue.key} onChange={e => cueChange(index, { key: e.target.value })} /></label>
              <div className="review-board-bar"><button className="secondary-button" disabled={index === 0} onClick={() => move(index, -1)}>Move up</button><button className="secondary-button" disabled={index === draft.cues.length - 1} onClick={() => move(index, 1)}>Move down</button><button className="secondary-button" onClick={() => change({ ...draft, cues: draft.cues.filter((_, i) => i !== index) })}>Remove cue</button></div>
            </details>
          </aside>
        </div>
      </section>;
    })}
    <button className="secondary-button" onClick={() => change({ ...draft, cues: [...draft.cues, newCue(`cue_${crypto.randomUUID().slice(0, 8)}`)] })}><Icon name="plus" /> Add cue</button>
    <details className="review-export review-details"><summary>Export selected sounds</summary><div className="review-board-bar"><label>Export format<select value={format} onChange={e => setFormat(e.target.value as typeof format)}><option value="original">Original bytes</option><option value="wav">PCM WAV</option><option value="ogg">Ogg Vorbis</option></select></label><label className="review-destination">New destination folder<input placeholder="New export folder" value={destination} onChange={e => setDestination(e.target.value)} /></label><button className="primary-button" disabled={dirty || busy || !destination} onClick={() => void attempt(async () => { const exported = await workbench<{ manifestPath: string }>('export_review', { ...scope, reviewId: draft.id, expectedRevision: draft.revision, destination, format }); setResult(`Exported: ${exported.manifestPath}`); })}><Icon name="download" /> Export selected</button></div>{result && <p role="status">{result}</p>}</details>
  </div>;
}
