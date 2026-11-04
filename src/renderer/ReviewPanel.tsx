import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import type { Asset, Snapshot } from '../shared/types';
import type { ReviewBoard, ReviewContent, ReviewCue } from '../shared/workbench';
import { AudioCardFrame } from './AudioCard';
import Icon from './Icon';
import { assetLoopRegion, usePlayback, type AuditionPlayer } from './audition';

export async function workbench<T = unknown>(name: string, args: unknown): Promise<T> {
  const response = await window.sfx.operation(name, args);
  if (!response.ok) throw new Error(`${response.error?.code}: ${response.error?.message}`);
  return response.result as T;
}
function ReviewFilter({ value, onChange, disabled }: { value: 'active' | 'completed'; onChange(value: 'active' | 'completed'): void; disabled?: boolean }) {
  return <select aria-label="Review list" value={value} disabled={disabled} onChange={e => onChange(e.target.value as 'active' | 'completed')}><option value="active">Active</option><option value="completed">Archived</option></select>;
}
const newCue = (key: string): ReviewCue => ({ key, label: 'New cue', brief: '', candidates: [], referenceId: null, referenceGainDb: 0, decision: 'unreviewed', selectedAssetId: null, notes: '' });

/** Compact entry point; a selected review becomes the Playground results. */
export function ReviewLauncher({ snapshot, onSelect }: { snapshot: Snapshot; onSelect(id: string): void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [filter, setFilter] = useState<'active' | 'completed'>('active');
  const boards = snapshot.reviews.filter(r => r.status === filter);
  const playgroundIds = snapshot.playground[snapshot.activeProjectId] ?? [];
  const startEmpty = playgroundIds.length > 128;
  const create = async () => {
    setBusy(true); setError('');
    try {
      const cue = newCue('cue_1'); cue.label = 'Candidates';
      cue.candidates = (startEmpty ? [] : playgroundIds).map(assetId => ({ assetId, label: '', notes: '', gainDb: 0 }));
      const created = await workbench<ReviewBoard>('review_create', { projectId: snapshot.activeProjectId, content: { title: 'Sound review', cues: [cue] }, open: false });
      onSelect(created.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create review.'); }
    finally { setBusy(false); }
  };
  return <div className="review-launcher">
    <ReviewFilter value={filter} onChange={setFilter} disabled={busy} />
    {boards.length > 0 && <select aria-label="Open audition review" value="" onChange={e => onSelect(e.target.value)} disabled={busy}><option value="" disabled>Open review…</option>{boards.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select>}
    <button className="secondary-button" disabled={busy} onClick={() => void create()}><Icon name="plus" /> {startEmpty ? 'New empty review' : 'New review'}</button>
    {error && <span role="alert" className="settings-error">{error}</span>}
  </div>;
}

/** Per-card audition settings: loop toggle and preview gain (never applied to the original file). */
function CardControls({ name, loop, onLoop, gainDb, onGain, locked }: { locked: boolean; name: string; loop: boolean; onLoop(checked: boolean): void; gainDb: number; onGain(gainDb: number): void }) {
  return <div className="review-card-controls">
    <label className="review-toggle"><input type="checkbox" role="switch" aria-label={`Loop ${name}`} checked={loop} onChange={e => onLoop(e.target.checked)} /><span aria-hidden="true" />Loop</label>
    <label className="review-gain">Preview<span className="review-gain-field"><input type="number" disabled={locked} min="-60" max="12" step="1" aria-label={`Preview gain for ${name} in dB`} value={gainDb} onChange={e => onGain(Number(e.target.value))} /><span>dB</span></span></label>
  </div>;
}

export const reviewKey = (reviewId: string, assetId: string) => `review:${reviewId}:${assetId}`;
/** Only cards using the active sound subscribe to its clock; the board and app stay still. */
function ReviewAudioCard({ player, reviewId, onPlayFrom, ...props }: Omit<ComponentProps<typeof AudioCardFrame>, 'isPlaying' | 'paused' | 'position' | 'duration' | 'onStop' | 'onSeek'> & { player: AuditionPlayer; reviewId: string; onPlayFrom(position: number): void }) {
  const key = reviewKey(reviewId, props.asset.id), playback = usePlayback(player, key);
  const playing = playback?.status === 'playing', paused = playback?.status === 'paused';
  return <AudioCardFrame {...props} isPlaying={playing} paused={paused} loading={playback?.loading} position={playback?.position ?? 0} duration={playback?.duration || props.asset.duration || 0} loopStart={assetLoopRegion(props.asset)?.startSeconds}
    onStop={() => { if (player.isCurrent(key)) player.stop(); }}
    onSeek={position => player.isCurrent(key) ? player.seek(key, position) : onPlayFrom(position)} />;
}

/** Native pickers only need the full library while focused, not once per cue at rest. */
function ReviewAssetSelect({ assets, value, excluded, disabled, placeholder, onChange }: { assets: Asset[]; value: string; excluded?: ReviewCue['candidates']; disabled: boolean; placeholder: string; onChange(id: string): void }) {
  const [focused, setFocused] = useState(false);
  const choices = focused && !disabled ? assets.filter(asset => !excluded?.some(candidate => candidate.assetId === asset.id)) : assets.filter(asset => asset.id === value);
  return <select disabled={disabled} value={value} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={event => onChange(event.target.value)}>
    <option value="">{placeholder}</option>{choices.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
  </select>;
}

export default function ReviewPanel({ snapshot, sessionId, selectedId, onSelect, onSelectAsset, player }: { snapshot: Snapshot; sessionId: string; selectedId: string; onSelect(id: string | null): void; onSelectAsset(id: string): void; player: AuditionPlayer }) {
  const boards = snapshot.reviews;
  const assetsById = useMemo(() => new Map(snapshot.assets.map(asset => [asset.id, asset])), [snapshot.assets]);
  const board = boards.find(r => r.id === selectedId);
  const [error, setError] = useState(''), [draft, setDraft] = useState<ReviewBoard | null>(board ?? null), [dirty, setDirty] = useState(false);
  const [format, setFormat] = useState<'original' | 'wav' | 'ogg'>('original'), [oggQuality, setOggQuality] = useState(5), [destination, setDestination] = useState('');
  const [result, setResult] = useState(''), [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'active' | 'completed'>(board?.status ?? 'active');
  const [loops, setLoops] = useState<Record<string, boolean>>({});
  const draftRef = useRef(draft), busyRef = useRef(false);
  const latest = board && board.revision > (draft?.revision ?? 0) ? board : draft;
  const completed = latest?.status === 'completed';
  const locked = busy || completed;
  const visibleBoards = boards.filter(r => r.status === filter);
  const scope = { projectId: snapshot.activeProjectId };
  const replaceDraft = (next: ReviewBoard | null, unsaved: boolean) => { draftRef.current = next; setDraft(next); setDirty(unsaved); };
  useEffect(() => {
    // A change notification can arrive before the save response (or vice versa).
    // Never replace that response with an older snapshot.
    if (!dirty && !busy && board && board.revision > (draftRef.current?.revision ?? 0)) replaceDraft(board, false);
  }, [board?.revision, dirty, busy]);
  const attempt = async (action: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true; setError(''); setBusy(true);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Review operation failed.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const change = (content: ReviewContent) => {
    if (!draftRef.current || locked || busyRef.current) return null;
    const next = { ...draftRef.current, ...content }; replaceDraft(next, true); return next;
  };
  const cueChange = (index: number, patch: Partial<ReviewCue>) => {
    const current = draftRef.current;
    return current && change({ title: current.title, cues: current.cues.map((cue, i) => i === index ? { ...cue, ...patch } : cue) });
  };
  const save = (submitted = draftRef.current) => attempt(async () => {
    if (!submitted || completed) return;
    const updated = await workbench<ReviewBoard>('review_update', { ...scope, reviewId: submitted.id, expectedRevision: submitted.revision, content: { title: submitted.title, cues: submitted.cues } });
    const current = draftRef.current;
    // Keep edits made while the request was in flight, rebased onto its saved revision.
    const edited = current !== submitted && current !== null;
    replaceDraft(edited ? { ...updated, title: current.title, cues: current.cues } : updated, edited);
  });
  const transition = (status: 'completed' | 'active') => attempt(async () => {
    const submitted = draftRef.current;
    if (!submitted || (status === 'active' && dirty)) return;
    const updated = await workbench<ReviewBoard>(status === 'completed' ? 'review_complete' : 'review_reopen', {
      ...scope, reviewId: submitted.id, expectedRevision: submitted.revision,
      ...(status === 'completed' ? { content: { title: submitted.title, cues: submitted.cues } } : {})
    });
    player.stop(); replaceDraft(updated, false); setFilter('active');
    // Done leaves the finished review; the Playground lists the reviews still open.
    if (status === 'completed') onSelect(null);
  });
  const decide = (index: number, decision: ReviewCue['decision'], selectedAssetId: string | null = null) => {
    if (busyRef.current) return;
    const next = cueChange(index, { decision, selectedAssetId });
    if (next) void save(next);
  };
  const stop = () => { setError(''); player.stop(); };
  const request = (cue: ReviewCue, assetId: string) => {
    const asset = assetsById.get(assetId), candidate = cue.candidates.find(c => c.assetId === assetId);
    const gainDb = candidate?.gainDb ?? cue.referenceGainDb;
    if (!Number.isFinite(gainDb) || gainDb < -60 || gainDb > 12) throw new Error('Preview gain must be between -60 and 12 dB.');
    return { key: reviewKey(selectedId, assetId), sessionId, reviewId: selectedId, assetId, gainDb, loop: !!loops[assetId], region: asset ? assetLoopRegion(asset) : null };
  };
  const play = async (cue: ReviewCue, assetId: string, from?: number) => {
    if (!board || busyRef.current) return;
    if (error) setError('');
    try { const next = request(cue, assetId); await (from === undefined ? player.toggle(next) : player.play(next, from)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Playback failed.'); }
  };
  // Loop and preview gain change live; neither restarts the sound.
  const loopToggle = (assetId: string, checked: boolean) => { setLoops(current => ({ ...current, [assetId]: checked })); player.setLoop(reviewKey(selectedId, assetId), checked); };
  const gainChange = (assetId: string, gainDb: number) => { if (Number.isFinite(gainDb) && gainDb >= -60 && gainDb <= 12) player.setGain(reviewKey(selectedId, assetId), gainDb); };
  const toggle = (cue: ReviewCue, id: string) => void play(cue, id);
  const move = (index: number, offset: number) => { if (!draft) return; const cues = [...draft.cues]; [cues[index], cues[index + offset]] = [cues[index + offset], cues[index]]; change({ ...draft, cues }); };
  if (!draft) return null;
  return <div className="review-results" aria-label="Playground audition results">
    <div className="review-board-bar">
      <div className="review-board-title"><span className="section-kicker">Cue review</span><ReviewFilter value={filter} onChange={setFilter} disabled={dirty || busy} /><select aria-label="Review board" value={visibleBoards.some(r => r.id === selectedId) ? selectedId : ""} disabled={dirty || busy} onChange={e => onSelect(e.target.value)}><option value="" disabled>Open review…</option>{visibleBoards.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></div>
      <span className="field-hint" role="status">{busy ? 'Review operation in progress…' : `Revision ${draft.revision} · saved by ${draft.origin}`} · {completed ? "Read-only review" : "Cue decisions save immediately."}</span>
      <div className="header-actions"><button className="secondary-button" disabled={dirty || busy} onClick={() => onSelect(null)}>All Playground sounds</button><button className="secondary-button" onClick={() => void stop()}>Stop audio</button>{!completed && <><button className="secondary-button" disabled={!dirty || busy} onClick={() => void save()}>Save review</button><button className="primary-button" disabled={busy} onClick={() => void transition('completed')}><Icon name="check" /> Done</button></>}{completed && <button className="primary-button" disabled={dirty || busy} onClick={() => void transition('active')}>Reopen</button>}</div>
    </div>
    <h2 className="review-current-title">{draft.title}</h2>
    {completed && <p className="review-completed" role="status">Done · Archived · Completed by {latest?.completedBy} {latest?.completedAt && new Date(latest.completedAt).toLocaleString()}. Reopen to edit; unresolved cues remain unreviewed.</p>}
    {dirty && <div className="review-board-bar"><span className="field-hint">{completed ? "This review was completed elsewhere. Your unsaved draft is preserved. Discard / reload before reopening." : "Unsaved changes. Save review, choose a cue decision, or press Done to save."}</span><button className="secondary-button" disabled={busy} onClick={() => replaceDraft(board ?? null, false)}>Discard / reload</button></div>}
    {error && <p role="alert" className="settings-error">{error}</p>}
    {board && board.revision > draft.revision && <p role="alert" className="settings-error">New feedback was saved elsewhere. Reload and reconcile before saving.</p>}
    <details className="review-details"><summary>Review details</summary><label>Review title<input disabled={locked} value={draft.title} onChange={e => change({ ...draft, title: e.target.value })} /></label></details>
    {draft.cues.map((cue, index) => {
      const reference = assetsById.get(cue.referenceId ?? '');
      return <section className="review-cue" key={index} aria-label={`Cue: ${cue.label}`}>
        <div className="review-cue-heading"><div><p className="eyebrow">Cue {String(index + 1).padStart(2, '0')}</p><h2>{cue.label}</h2>{cue.brief && <p className="review-brief">{cue.brief}</p>}</div><span className={`review-decision decision-${cue.decision}`}>{cue.decision === 'selected' ? 'Selected' : cue.decision === 'rejected' ? 'All rejected' : 'Unreviewed'}</span></div>
        <div className="review-cue-layout">
          <div className="review-card-grid">
            {reference && <div className="playground-slot review-reference"><div className="slot-label"><span>Current reference</span></div>
              <ReviewAudioCard player={player} reviewId={selectedId} onSelect={() => onSelectAsset(reference.id)} asset={reference} onToggle={() => toggle(cue, reference.id)} onPlayFrom={from => void play(cue, reference.id, from)} disabled={busy} compact>
                <CardControls locked={locked} name={reference.name} loop={!!loops[reference.id]} onLoop={checked => loopToggle(reference.id, checked)} gainDb={cue.referenceGainDb} onGain={gainDb => { gainChange(reference.id, gainDb); cueChange(index, { referenceGainDb: gainDb }); }} />
                <p className="field-hint">Compare candidates against this sound.</p>
              </ReviewAudioCard>
            </div>}
            {cue.candidates.map((candidate, ci) => {
              const asset = assetsById.get(candidate.assetId), picked = cue.decision === 'selected' && cue.selectedAssetId === candidate.assetId;
              const remove = () => cueChange(index, { candidates: cue.candidates.filter((_, i) => i !== ci), ...(picked ? { decision: 'unreviewed' as const, selectedAssetId: null } : {}) });
              return <div className="playground-slot" key={candidate.assetId}>
                <div className="slot-label"><span>Candidate {String(ci + 1).padStart(2, '0')}</span><button className="mini-button" aria-label={`Remove candidate ${ci + 1}`} disabled={locked} onClick={remove}><Icon name="close" /></button></div>
                {asset ? <ReviewAudioCard player={player} reviewId={selectedId} onSelect={() => onSelectAsset(asset.id)} asset={asset} title={candidate.label} selected={picked} review={picked ? 'accepted' : cue.decision === 'rejected' ? 'rejected' : 'unreviewed'} onToggle={() => toggle(cue, asset.id)} onPlayFrom={from => void play(cue, asset.id, from)} disabled={busy} compact>
                  <CardControls locked={locked} name={asset.name} loop={!!loops[asset.id]} onLoop={checked => loopToggle(asset.id, checked)} gainDb={candidate.gainDb} onGain={gainDb => { gainChange(asset.id, gainDb); cueChange(index, { candidates: cue.candidates.map((c, i) => i === ci ? { ...c, gainDb } : c) }); }} />
                  <button className={`secondary-button review-pick ${picked ? 'review-pick-active' : ''}`} aria-pressed={picked} disabled={locked} onClick={() => decide(index, 'selected', asset.id)}><Icon name="check" /> {picked ? 'Selected for this cue' : 'Select this candidate'}</button>
                  <label className="review-candidate-notes">Candidate notes<textarea disabled={locked} value={candidate.notes} placeholder="What works? What needs changing?" onChange={e => cueChange(index, { candidates: cue.candidates.map((c, i) => i === ci ? { ...c, notes: e.target.value } : c) })} /></label>
                </ReviewAudioCard> : <p role="alert">Candidate is unavailable. Remove it or reload the review.</p>}
              </div>;
            })}
            {!reference && !cue.candidates.length && <p className="review-empty">Add sounds from the library to begin comparing this cue.</p>}
          </div>
          <aside className="review-cue-sidebar" aria-label={`${cue.label} controls and feedback`}>
            <span className="section-kicker">Playback & feedback</span>
            <div className="review-buttons"><button className={cue.decision === 'unreviewed' ? 'review-active unreviewed' : ''} aria-pressed={cue.decision === 'unreviewed'} disabled={locked} onClick={() => decide(index, 'unreviewed')}>Unreviewed</button><button className={cue.decision === 'rejected' ? 'review-active rejected' : ''} aria-pressed={cue.decision === 'rejected'} disabled={locked} onClick={() => decide(index, 'rejected')}><Icon name="x" /> Reject all</button></div>
            <label>Cue feedback<textarea disabled={locked} value={cue.notes} placeholder="Direction for the next revision…" onChange={e => cueChange(index, { notes: e.target.value })} /></label>
            {draft.cueAudit?.[cue.key] && <p className="field-hint">Decision saved by {draft.cueAudit[cue.key].decision.origin} · {new Date(draft.cueAudit[cue.key].decision.at).toLocaleString()}</p>}
            <label>Add candidate<ReviewAssetSelect assets={snapshot.assets} excluded={cue.candidates} disabled={locked} value="" placeholder="Choose a sound…" onChange={id => { if (id) cueChange(index, { candidates: [...cue.candidates, { assetId: id, label: '', notes: '', gainDb: 0 }] }); }} /></label>
            <label>Current reference<ReviewAssetSelect assets={snapshot.assets} disabled={locked} value={cue.referenceId ?? ''} placeholder="None" onChange={id => cueChange(index, { referenceId: id || null })} /></label>
            <details className="review-details"><summary>Edit cue details</summary>
              <label>Label<input disabled={locked} value={cue.label} onChange={e => cueChange(index, { label: e.target.value })} /></label><label>Brief<textarea disabled={locked} value={cue.brief} onChange={e => cueChange(index, { brief: e.target.value })} /></label><label>Cue key<input disabled={locked} value={cue.key} onChange={e => cueChange(index, { key: e.target.value })} /></label>
              <div className="review-board-bar"><button className="secondary-button" disabled={locked || index === 0} onClick={() => move(index, -1)}>Move up</button><button className="secondary-button" disabled={locked || index === draft.cues.length - 1} onClick={() => move(index, 1)}>Move down</button><button className="secondary-button" disabled={locked} onClick={() => change({ ...draft, cues: draft.cues.filter((_, i) => i !== index) })}>Remove cue</button></div>
            </details>
          </aside>
        </div>
      </section>;
    })}
    <button className="secondary-button" disabled={locked} onClick={() => change({ ...draft, cues: [...draft.cues, newCue(`cue_${crypto.randomUUID().slice(0, 8)}`)] })}><Icon name="plus" /> Add cue</button>
    <details className="review-export review-details"><summary>Export selected sounds</summary><div className="review-board-bar"><label>Export format<select value={format} onChange={e => setFormat(e.target.value as typeof format)}><option value="original">Original bytes</option><option value="wav">PCM WAV</option><option value="ogg">Ogg Vorbis</option></select></label>{format === 'ogg' && <label>Quality<select value={oggQuality} onChange={e => setOggQuality(Number(e.target.value))}>{Array.from({ length: 11 }, (_, q) => <option key={q} value={q}>{q}</option>)}</select></label>}<label className="review-destination">New destination folder<input placeholder="New export folder" value={destination} onChange={e => setDestination(e.target.value)} /></label><button className="primary-button" disabled={dirty || busy || !destination} onClick={() => void attempt(async () => { const exported = await workbench<{ manifestPath: string }>('export_review', { ...scope, reviewId: draft.id, expectedRevision: draft.revision, destination, format, oggQuality }); setResult(`Exported: ${exported.manifestPath}`); })}><Icon name="download" /> Export selected</button></div>{result && <p role="status">{result}</p>}</details>
  </div>;
}
