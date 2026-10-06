import { useEffect, useRef, useState, type ReactNode } from 'react';
import { midiLengthBeats, midiVelocity } from '../shared/midi';
import type { Asset, Review } from '../shared/types';
import Icon from './Icon';

function shortDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDuration(duration: number | null) {
  if (duration == null) return 'Auto duration'
  return `${duration.toFixed(duration % 1 ? 1 : 0)}s`
}

function Waveform({ active, url }: { active?: boolean; url: string }) {
  const [bars, setBars] = useState<number[]>([])
  useEffect(() => {
    let cancelled = false
    const decode = async () => {
      try {
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AudioContextClass) return
        const response = await fetch(url)
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
        if (!cancelled) setBars(next)
      } catch { /* unavailable media stays a quiet waveform */ }
    }
    void decode()
    return () => { cancelled = true }
  }, [url])
  return <div className={`waveform ${active ? 'waveform-active' : ''} ${bars.length ? '' : 'waveform-loading'}`} aria-hidden="true">{(bars.length ? bars : Array.from({ length: 48 }, () => 16)).map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
}

interface RollNote { x: number; width: number; pitch: number; drum: boolean; strength: number }

/** MIDI has no decodable waveform; show its notes instead: pitched notes above, drum hits in a strip below. */
function MidiRoll({ active, assetId }: { active?: boolean; assetId: string }) {
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
}

/** Shared visual card used by library, Playground, inspector, and cue audition. */
export function AudioCardFrame({ asset, selected = false, isPlaying, onToggle, onSelect, compact = false, title, review = asset.review, disabled = false, activeAction = 'Stop', seek, children }: {
  asset: Asset; selected?: boolean; isPlaying: boolean; onToggle(): void; onSelect?(): void;
  compact?: boolean; title?: string; review?: Review; disabled?: boolean; activeAction?: 'Stop' | 'Pause'; seek?: ReactNode; children?: ReactNode;
}) {
  return <article data-asset-id={asset.id} className={`asset-card ${selected ? 'asset-selected' : ''} ${compact ? 'asset-compact' : ''}`} onClick={onSelect}>
    <div className="asset-card-top">
      <button className={`play-button ${isPlaying ? 'playing' : ''}`} disabled={disabled && !isPlaying} onClick={event => { event.stopPropagation(); onToggle(); }} aria-label={`${isPlaying ? activeAction : 'Play'} ${title || asset.name}`}><Icon name={isPlaying ? 'pause' : 'play'} /></button>
      <div className="asset-title"><strong>{title || asset.name || 'Untitled sound'}</strong><span>{[asset.format.toUpperCase(), formatDuration(asset.duration), asset.midi && `${Math.round(asset.midi.bpm)} BPM`, asset.midi && `${asset.midi.tracks.length} ${asset.midi.tracks.length === 1 ? 'track' : 'tracks'}`].filter(Boolean).join(' · ')}</span></div>
      <span className={`review-mark review-${review}`} title={review} role="img" aria-label={`Review: ${review}`}><Icon name={review === 'accepted' ? 'check' : review === 'rejected' ? 'x' : 'dot'} /></span>
    </div>
    {asset.kind === 'midi' ? <MidiRoll active={isPlaying} assetId={asset.id} /> : <Waveform active={isPlaying} url={window.sfx.mediaUrl(`asset/${asset.id}`)} />}
    {seek}
    <div className="asset-card-bottom"><span className={`kind-chip kind-${asset.kind ?? 'effect'}`}>{asset.kind === 'midi' ? 'MIDI' : asset.kind === 'voice' ? 'VOICE' : asset.kind === 'music' ? 'MUSIC' : 'SFX'}</span><div className="asset-tags">{asset.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div><span className="asset-date">{shortDate(asset.createdAt)}</span></div>
    {children}
  </article>;
}

export default function AudioCard({ asset, onSelect, selected, onPlay, playerKey, isPlaying, compact = false }: { asset: Asset; onSelect: () => void; selected: boolean; onPlay: (key: string, playing: boolean) => void; playerKey?: string; isPlaying: boolean; compact?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const effectivePlayerKey = playerKey || asset.id;
  const [position, setPosition] = useState(0), [loop, setLoop] = useState(false), [gain, setGain] = useState(1), [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) void audio.play().catch(() => onPlay(effectivePlayerKey, false));
    else audio.pause();
  }, [isPlaying, asset.id, onPlay, effectivePlayerKey]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = gain; }, [gain]);
  return <AudioCardFrame activeAction="Pause" asset={asset} selected={selected} compact={compact} isPlaying={isPlaying} onSelect={onSelect} onToggle={() => onPlay(effectivePlayerKey, !isPlaying)} seek={
    <input className="scrub" type="range" min="0" max={loaded && audioRef.current?.duration ? audioRef.current.duration : asset.duration || 1} step="0.01" value={position} onChange={event => { const next = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = next; setPosition(next); }} aria-label="Seek audio" />
  }>
    <audio ref={audioRef} src={window.sfx.mediaUrl(`asset/${asset.id}`)} loop={loop} preload="metadata" onLoadedMetadata={() => setLoaded(true)} onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onEnded={() => onPlay(effectivePlayerKey, false)} />
    <div className="preview-controls"><label><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} /> Loop</label><label className="gain-control">Gain <input type="range" min="0" max="1" step="0.05" value={gain} onChange={event => setGain(Number(event.target.value))} aria-label="Preview gain" /></label></div>
  </AudioCardFrame>;
}
