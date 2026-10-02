import { useEffect, useState } from 'react';
import type { Snapshot } from '../shared/types';
import type { ReviewBoard, ReviewContent, ReviewCue } from '../shared/workbench';

export async function workbench<T = unknown>(name: string, args: unknown): Promise<T> {
  const response = await window.sfx.operation(name, args);
  if (!response.ok) throw new Error(`${response.error?.code}: ${response.error?.message}`);
  return response.result as T;
}
export default function ReviewPanel({ snapshot, sessionId, selectedId, onSelect }: { snapshot: Snapshot; sessionId: string; selectedId: string | null; onSelect(id: string | null): void }) {
  const boards = snapshot.reviews.filter(r => r.sessionId === sessionId);
  const board = boards.find(r => r.id === selectedId);
  const [error, setError] = useState(''); const [draft, setDraft] = useState<ReviewBoard | null>(null); const [dirty, setDirty] = useState(false);
  const [format, setFormat] = useState<'original' | 'wav' | 'ogg'>('original'); const [destination, setDestination] = useState('');
  const [result, setResult] = useState(''); const [busy, setBusy] = useState(false);
  const scope = { projectId: snapshot.activeProjectId, sessionId };
  useEffect(() => { setDraft(board ?? null); setDirty(false); setError(''); }, [board?.id]);
  useEffect(() => { if (!dirty) setDraft(board ?? null); }, [board?.revision, dirty]);
  const attempt = async (action: () => Promise<unknown>) => { setError(''); setBusy(true); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Review operation failed.'); } finally { setBusy(false); } };
  const change = (content: ReviewContent) => { if (draft) { setDraft({ ...draft, ...content }); setDirty(true); } };
  const cueChange = (index: number, patch: Partial<ReviewCue>) => draft && change({ title: draft.title, cues: draft.cues.map((cue, i) => i === index ? { ...cue, ...patch } : cue) });
  const newCue = (key: string): ReviewCue => ({ key, label: 'New cue', brief: '', candidates: [], referenceId: null, referenceGainDb: 0, repeatIntervalMs: 300, singleVoice: false, decision: 'unreviewed', selectedAssetId: null, notes: '' });
  const create = () => attempt(async () => {
    const cue = newCue('cue_1'); cue.label = 'Candidates'; cue.candidates = (snapshot.playground[sessionId] ?? []).map(assetId => ({ assetId, label: '', notes: '', gainDb: 0 }));
    const created = await workbench<ReviewBoard>('review_create', { ...scope, content: { title: 'Sound review', cues: [cue] } }); onSelect(created.id);
  });
  const save = () => attempt(async () => { if (!draft) return; const updated = await workbench<ReviewBoard>('review_update', { ...scope, reviewId: draft.id, expectedRevision: draft.revision, content: { title: draft.title, cues: draft.cues } }); setDraft(updated); setDirty(false); });
  const play = (cue: ReviewCue, assetId: string, repeat = false) => attempt(async () => { if (!board) return; await workbench('playback_play', { ...scope, reviewId: board.id, cueKey: cue.key, assetId, repeat }); });
  return <section className="review-panel" aria-label="Cue reviews">
    <div className="review-toolbar"><h2>Cue reviews</h2><select aria-label="Review board" value={selectedId ?? ''} onChange={e => onSelect(e.target.value || null)}><option value="">Choose a review</option>{boards.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select><button onClick={() => void create()} disabled={busy}>New from Playground</button><button onClick={() => void attempt(() => workbench('playback_stop', scope))}>Stop audio</button></div>
    {error && <p role="alert" className="settings-error">{error}</p>}
    {draft ? <>
      <div className="review-toolbar"><label>Review title<input value={draft.title} onChange={e => change({ ...draft, title: e.target.value })} /></label><span>Revision {draft.revision} · last saved by {draft.origin}</span><button disabled={!dirty || busy} onClick={() => void save()}>Save review</button><button disabled={!dirty} onClick={() => { setDraft(board ?? null); setDirty(false); }}>Reload saved</button></div>
      {dirty && <p className="provider-note">Save changes before auditioning new candidates or preview settings.</p>}
      {board && board.revision !== draft.revision && <p role="alert">New feedback was saved elsewhere. Reload and reconcile before saving.</p>}
      {draft.cues.map((cue, index) => <article className="review-cue" key={index}>
        <div className="review-toolbar"><label>Cue key<input value={cue.key} onChange={e => cueChange(index, { key: e.target.value })} /></label><label>Label<input value={cue.label} onChange={e => cueChange(index, { label: e.target.value })} /></label><button disabled={index === 0} onClick={() => { const cues = [...draft.cues]; [cues[index - 1], cues[index]] = [cues[index], cues[index - 1]]; change({ ...draft, cues }); }}>Move up</button><button disabled={index === draft.cues.length - 1} onClick={() => { const cues = [...draft.cues]; [cues[index + 1], cues[index]] = [cues[index], cues[index + 1]]; change({ ...draft, cues }); }}>Move down</button><button onClick={() => change({ ...draft, cues: draft.cues.filter((_, i) => i !== index) })}>Remove cue</button></div>
        <label>Brief<textarea value={cue.brief} onChange={e => cueChange(index, { brief: e.target.value })} /></label>
        <div className="review-toolbar"><label>Current reference<select value={cue.referenceId ?? ''} onChange={e => cueChange(index, { referenceId: e.target.value || null })}><option value="">None</option>{snapshot.assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Reference gain (dB)<input type="number" min="-60" max="12" value={cue.referenceGainDb} onChange={e => cueChange(index, { referenceGainDb: Number(e.target.value) })} /></label>{cue.referenceId && <><button disabled={dirty || busy} onClick={() => void play(cue, cue.referenceId!)}>Play reference</button><button disabled={dirty || busy} onClick={() => void play(cue, cue.referenceId!, true)}>Repeat reference</button></>}</div>
        {cue.candidates.map((candidate, ci) => <div className="review-candidate" key={candidate.assetId}>
          <strong>{candidate.label || snapshot.assets.find(a => a.id === candidate.assetId)?.name || candidate.assetId}</strong>
          <div className="review-toolbar"><button disabled={dirty || busy} onClick={() => void play(cue, candidate.assetId)}>Play</button><button disabled={dirty || busy} onClick={() => void play(cue, candidate.assetId, true)}>Repeat</button><label>Preview dB<input type="number" min="-60" max="12" value={candidate.gainDb} onChange={e => cueChange(index, { candidates: cue.candidates.map((c, i) => i === ci ? { ...c, gainDb: Number(e.target.value) } : c) })} /></label><label><input type="radio" name={`pick-${index}`} checked={cue.decision === 'selected' && cue.selectedAssetId === candidate.assetId} onChange={() => cueChange(index, { decision: 'selected', selectedAssetId: candidate.assetId })} /> Select</label><button onClick={() => cueChange(index, { candidates: cue.candidates.filter((_, i) => i !== ci), ...(cue.selectedAssetId === candidate.assetId ? { decision: 'unreviewed', selectedAssetId: null } : {}) })}>Remove</button></div>
          <label>Candidate notes<textarea value={candidate.notes} onChange={e => cueChange(index, { candidates: cue.candidates.map((c, i) => i === ci ? { ...c, notes: e.target.value } : c) })} /></label>
        </div>)}
        <label>Add candidate<select value="" onChange={e => { if (e.target.value) cueChange(index, { candidates: [...cue.candidates, { assetId: e.target.value, label: '', notes: '', gainDb: 0 }] }); }}><option value="">Choose an asset</option>{snapshot.assets.filter(a => !cue.candidates.some(c => c.assetId === a.id)).map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
        <div className="review-toolbar"><label>Repeat interval (ms)<input type="number" min="40" max="3000" value={cue.repeatIntervalMs} onChange={e => cueChange(index, { repeatIntervalMs: Number(e.target.value) })} /></label><label><input type="checkbox" checked={cue.singleVoice} onChange={e => cueChange(index, { singleVoice: e.target.checked })} /> Single voice</label><label><input type="radio" name={`pick-${index}`} checked={cue.decision === 'unreviewed'} onChange={() => cueChange(index, { decision: 'unreviewed', selectedAssetId: null })} /> Unreviewed</label><label><input type="radio" name={`pick-${index}`} checked={cue.decision === 'rejected'} onChange={() => cueChange(index, { decision: 'rejected', selectedAssetId: null })} /> Reject all</label></div>
        {draft.cueAudit?.[cue.key] && <p className="provider-note">Decision saved by {draft.cueAudit[cue.key].decision.origin} at {draft.cueAudit[cue.key].decision.at}</p>}
        <label>Cue feedback<textarea value={cue.notes} onChange={e => cueChange(index, { notes: e.target.value })} /></label>
      </article>)}
      <button onClick={() => change({ ...draft, cues: [...draft.cues, newCue(`cue_${crypto.randomUUID().slice(0, 8)}`)] })}>Add cue</button>
      <div className="review-toolbar"><label>Export format<select value={format} onChange={e => setFormat(e.target.value as typeof format)}><option value="original">Original bytes</option><option value="wav">PCM WAV</option><option value="ogg">Ogg Vorbis</option></select></label><label>New destination folder<input placeholder="C:\project\audio\review-export" value={destination} onChange={e => setDestination(e.target.value)} /></label><button disabled={dirty || busy || !destination} onClick={() => void attempt(async () => { const exported = await workbench<{ manifestPath: string }>('export_review', { ...scope, reviewId: draft.id, expectedRevision: draft.revision, destination, format }); setResult(`Exported: ${exported.manifestPath}`); })}>Export selected</button></div>
      {result && <p>{result}</p>}
    </> : <p>Group candidates by cue, compare with current sounds, and save selections and feedback for your agent.</p>}
  </section>;
}
