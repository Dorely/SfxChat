import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { midiLengthBeats, midiVelocity } from '../shared/midi';
import type { Asset, Review } from '../shared/types';
import Icon from './Icon';
import { assetLoopRegion, usePlayback, usePlayer, type AuditionRequest } from './audition';

function shortDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDuration(duration: number | null) {
  if (duration == null) return 'Auto duration'
  return `${duration.toFixed(duration % 1 ? 1 : 0)}s`
}

const waveformCache = new Map<string, number[]>();
const Waveform = memo(function Waveform({ active, url }: { active?: boolean; url: string }) {
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [bars, setBars] = useState<number[]>(() => waveformCache.get(url) ?? [])
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '300px' })
    if (element.current) observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    const cached = waveformCache.get(url)
    if (cached) { setBars(cached); return }
    setBars([])
    let cancelled = false
    const controller = new AbortController()
    const decode = async () => {
      try {
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AudioContextClass) return
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) return
        const buffer = await response.arrayBuffer()
        const context = new AudioContextClass()
        let next: number[]
        try {
          const decoded = await context.decodeAudioData(buffer)
          const samples = decoded.getChannelData(0)
          next = Array.from({ length: 48 }, (_, index) => {
            const start = Math.floor(index * samples.length / 48)
            const end = Math.max(start + 1, Math.floor((index + 1) * samples.length / 48))
            let peak = 0
            for (let sample = start; sample < end; sample += 1) peak = Math.max(peak, Math.abs(samples[sample] || 0))
            return Math.round(16 + peak * 72)
          })
        } finally { await context.close().catch(() => undefined) }
        if (!cancelled) {
          if (waveformCache.size >= 256) waveformCache.delete(waveformCache.keys().next().value!)
          waveformCache.set(url, next); setBars(next)
        }
      } catch { /* unavailable media stays a quiet waveform */ }
    }
    void decode()
    return () => { cancelled = true; controller.abort() }
  }, [url, visible])
  return <div ref={element} className={`waveform ${active ? 'waveform-active' : ''} ${bars.length ? '' : 'waveform-loading'}`} aria-hidden="true">{(bars.length ? bars : Array.from({ length: 48 }, () => 16)).map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
})

interface RollNote { x: number; width: number; pitch: number; drum: boolean; strength: number }

/** MIDI has no decodable waveform; show its notes instead: pitched notes above, drum hits in a strip below. */
const MidiRoll = memo(function MidiRoll({ active, assetId }: { active?: boolean; assetId: string }) {
  const [roll, setRoll] = useState<{ notes: RollNote[]; low: number; high: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    window.sfx.midiNotes(assetId).then(composition => {
      const length = Math.max(midiLengthBeats(composition), 1e-6)
      const notes = composition.tracks.flatMap(track => track.notes.map(note => ({
        x: note.startBeat / length * 1000,
        width: Math.max(note.durationBeats / length * 1000, 3),
        pitch: note.pitch,
        drum: track.drums === true,
        strength: .45 + .55 * midiVelocity(note) / 127
      })))
      const pitches = notes.filter(note => !note.drum).map(note => note.pitch)
      const low = pitches.length ? Math.min(...pitches) : 60, high = pitches.length ? Math.max(...pitches) : 60
      const span = Math.max(high - low, 11)
      if (!cancelled) setRoll({ notes, low: low - (span - (high - low)) / 2, high: high + (span - (high - low)) / 2 })
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [assetId])
  const hasDrums = !!roll?.notes.some(note => note.drum)
  const pitchedHeight = hasDrums ? 33 : 41
  const rowHeight = roll ? pitchedHeight / (roll.high - roll.low + 1) : 0
  return <svg className={`midi-roll ${active ? 'midi-roll-active' : ''}`} viewBox="0 0 1000 41" preserveAspectRatio="none" aria-hidden="true">
    {roll?.notes.map((note, index) => note.drum
      ? <rect key={index} className="midi-roll-drum" x={note.x} y={36} width={3} height={5} opacity={note.strength} />
      : <rect key={index} x={note.x} y={(roll.high - note.pitch) * rowHeight} width={note.width} height={Math.max(rowHeight, 2)} opacity={note.strength} />)}
  </svg>
})

export function playbackTime(seconds: number) {
  const tenths = Math.floor(Math.max(0, seconds) * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}

/**
 * The waveform doubles as the seek bar: click or drag to move the playhead (the seek
 * lands on release, so dragging does not stutter), or use the arrow keys (Shift for 5 s).
 */
export function SeekSurface({ name, position, duration, active, loopStart, onSeek, className = '', children }: { name: string; position: number; duration: number; active: boolean; loopStart?: number | null; onSeek?(position: number): void; className?: string; children: ReactNode }) {
  const [drag, setDrag] = useState<number | null>(null);
  const enabled = !!onSeek && duration > 0;
  const at = (element: HTMLElement, clientX: number) => { const box = element.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - box.left) / Math.max(1, box.width))) * duration; };
  const shown = drag ?? position;
  return <div className={`seek-surface ${enabled ? 'seek-enabled' : ''} ${className}`} role="slider" tabIndex={enabled ? 0 : -1} aria-label={`Seek ${name}`} aria-disabled={!enabled || undefined}
    aria-valuemin={0} aria-valuemax={Math.round(duration * 10) / 10} aria-valuenow={Math.round(shown * 10) / 10} aria-valuetext={`${playbackTime(shown)} of ${playbackTime(duration)}`}
    onClick={event => event.stopPropagation()}
    onPointerDown={event => { if (!enabled || event.button !== 0) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDrag(at(event.currentTarget, event.clientX)); }}
    onPointerMove={event => { if (drag !== null && event.currentTarget.hasPointerCapture(event.pointerId)) setDrag(at(event.currentTarget, event.clientX)); }}
    onPointerUp={event => { if (drag === null) return; const next = at(event.currentTarget, event.clientX); setDrag(null); onSeek?.(next); }}
    onPointerCancel={() => setDrag(null)}
    onKeyDown={event => {
      if (!enabled) return;
      const step = event.shiftKey ? 5 : 1;
      const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? position + step : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? position - step : event.key === 'Home' ? 0 : event.key === 'End' ? duration : null;
      if (next === null) return;
      event.preventDefault(); event.stopPropagation(); onSeek!(Math.max(0, Math.min(duration, next)));
    }}>
    {children}
    {loopStart != null && loopStart > 0 && duration > 0 && <span className="card-loop-start" style={{ left: `${Math.min(1, loopStart / duration) * 100}%` }} title="Loop start: everything before it plays once" aria-hidden="true" />}
    {(active || shown > 0) && duration > 0 && <span className="card-playhead" style={{ left: `${Math.max(0, Math.min(1, shown / duration)) * 100}%` }} aria-hidden="true" />}
  </div>;
}

/** Shared visual card used by library, Playground, inspector, and cue audition. */
export function AudioCardFrame({ asset, selected = false, isPlaying, paused = false, onToggle, onStop, onSeek, onSelect, compact = false, title, review = asset.review, disabled = false, loading = false, position = 0, duration = asset.duration ?? 0, loopStart, children }: {
  asset: Asset; selected?: boolean; isPlaying: boolean; paused?: boolean; onToggle(): void; onStop(): void; onSeek?(position: number): void; onSelect?(): void;
  compact?: boolean; title?: string; review?: Review; disabled?: boolean; loading?: boolean; position?: number; duration?: number; loopStart?: number | null; children?: ReactNode;
}) {
  const name = title || asset.name;
  return <article data-asset-id={asset.id} className={`asset-card ${selected ? 'asset-selected' : ''} ${compact ? 'asset-compact' : ''}`} onClick={onSelect}>
    <div className="asset-card-top">
      <button className={`play-button ${isPlaying ? 'playing' : ''}`} disabled={disabled && !isPlaying} onClick={event => { event.stopPropagation(); onToggle(); }} aria-label={`${loading ? 'Cancel loading' : isPlaying ? 'Pause' : paused ? 'Resume' : 'Play'} ${name}`} aria-busy={loading || undefined}>{loading ? <span className="spinner" /> : <Icon name={isPlaying ? 'pause' : 'play'} />}</button>
      <button className="mini-button card-stop" disabled={!isPlaying && !paused && !loading} onClick={event => { event.stopPropagation(); onStop(); }} aria-label={`Stop ${name} and return to the start`} title="Stop and return to the start"><Icon name="stop" /></button>
      <div className="asset-title"><strong>{title || asset.name || 'Untitled sound'}</strong><span>{[asset.format.toUpperCase(), formatDuration(asset.duration), asset.midi && `${Math.round(asset.midi.bpm)} BPM`, asset.midi && `${asset.midi.tracks.length} ${asset.midi.tracks.length === 1 ? 'track' : 'tracks'}`].filter(Boolean).join(' · ')}</span></div>
      <span className={`review-mark review-${review}`} title={review} role="img" aria-label={`Review: ${review}`}><Icon name={review === 'accepted' ? 'check' : review === 'rejected' ? 'x' : 'dot'} /></span>
    </div>
    <SeekSurface className="card-waveform" name={name} position={position} duration={duration} active={isPlaying || paused} loopStart={loopStart} onSeek={disabled ? undefined : onSeek}>
      {asset.kind === 'midi' ? <MidiRoll active={isPlaying} assetId={asset.id} /> : <Waveform active={isPlaying} url={window.sfx.mediaUrl(`asset/${asset.id}`)} />}
    </SeekSurface>
    <div className="card-transport"><span className="card-playback-time">{playbackTime(position)} / {playbackTime(duration)}</span>{paused && <span className="card-paused">Paused</span>}</div>
    <div className="asset-card-bottom"><span className={`kind-chip kind-${asset.kind ?? 'effect'}`}>{asset.kind === 'midi' ? 'MIDI' : asset.kind === 'voice' ? 'VOICE' : asset.kind === 'music' ? 'MUSIC' : 'SFX'}</span><div className="asset-tags">{asset.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div><span className="asset-date">{shortDate(asset.createdAt)}</span></div>
    {children}
  </article>;
}

const gainDb = (gain: number) => gain <= 0 ? -120 : 20 * Math.log10(gain);

/** A library, Playground or inspector card playing through the shared player. */
export default function AudioCard({ asset, onSelect, selected, playerKey, compact = false }: { asset: Asset; onSelect: () => void; selected: boolean; playerKey?: string; compact?: boolean }) {
  const player = usePlayer(), key = playerKey || asset.id;
  const playback = usePlayback(player, key);
  const [loop, setLoop] = useState(false), [gain, setGain] = useState(1), [error, setError] = useState('');
  const region = assetLoopRegion(asset);
  const request = (): AuditionRequest => ({ key, assetId: asset.id, gainDb: gainDb(gain), loop, region });
  const run = (action: Promise<void>) => { setError(''); void action.catch(e => setError(e instanceof Error ? e.message : 'Playback failed.')); };
  const playing = playback?.status === 'playing', paused = playback?.status === 'paused';
  const duration = playback?.duration || asset.duration || 0;
  return <AudioCardFrame asset={asset} selected={selected} compact={compact} isPlaying={playing} paused={paused} loading={playback?.loading} position={playback?.position ?? 0} duration={duration} loopStart={region?.startSeconds} onSelect={onSelect}
    onToggle={() => run(player.toggle(request()))}
    onStop={() => { if (player.isCurrent(key)) player.stop(); }}
    onSeek={position => player.isCurrent(key) ? player.seek(key, position) : run(player.play(request(), position))}>
    <div className="preview-controls" onClick={event => event.stopPropagation()}><label title={region ? 'The intro plays once, then the loop repeats.' : undefined}><input type="checkbox" checked={loop} onChange={event => { setLoop(event.target.checked); player.setLoop(key, event.target.checked); }} /> Loop</label><label className="gain-control">Gain <input type="range" min="0" max="1" step="0.05" value={gain} onChange={event => { const next = Number(event.target.value); setGain(next); player.setGain(key, gainDb(next)); }} aria-label="Preview gain" /></label></div>
    {error && <p className="field-hint card-error" role="alert">{error}</p>}
  </AudioCardFrame>;
}
