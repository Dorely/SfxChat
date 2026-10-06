import { useEffect, useRef, useState, type ReactNode } from 'react';
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

/** Shared visual card used by library, Playground, inspector, and cue audition. */
export function AudioCardFrame({ asset, selected = false, isPlaying, onToggle, onSelect, compact = false, title, review = asset.review, disabled = false, activeAction = 'Stop', seek, children }: {
  asset: Asset; selected?: boolean; isPlaying: boolean; onToggle(): void; onSelect?(): void;
  compact?: boolean; title?: string; review?: Review; disabled?: boolean; activeAction?: 'Stop' | 'Pause'; seek?: ReactNode; children?: ReactNode;
}) {
  return <article data-asset-id={asset.id} className={`asset-card ${selected ? 'asset-selected' : ''} ${compact ? 'asset-compact' : ''}`} onClick={onSelect}>
    <div className="asset-card-top">
      <button className={`play-button ${isPlaying ? 'playing' : ''}`} disabled={disabled && !isPlaying} onClick={event => { event.stopPropagation(); onToggle(); }} aria-label={`${isPlaying ? activeAction : 'Play'} ${title || asset.name}`}><Icon name={isPlaying ? 'pause' : 'play'} /></button>
      <div className="asset-title"><strong>{title || asset.name || 'Untitled sound'}</strong><span>{asset.format.toUpperCase()} · {formatDuration(asset.duration)}</span></div>
      <span className={`review-mark review-${review}`} title={review} role="img" aria-label={`Review: ${review}`}><Icon name={review === 'accepted' ? 'check' : review === 'rejected' ? 'x' : 'dot'} /></span>
    </div>
    <Waveform active={isPlaying} url={window.sfx.mediaUrl(`asset/${asset.id}`)} />
    {seek}
    <div className="asset-card-bottom"><span className={`kind-chip kind-${asset.kind ?? 'effect'}`}>{asset.kind === 'midi' ? 'MIDI' : asset.kind === 'voice' ? 'VOICE' : asset.kind === 'music' ? 'MUSIC' : 'SFX'}</span><span>{formatDuration(asset.duration)}</span><div className="asset-tags">{asset.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div><span className="asset-date">{shortDate(asset.createdAt)}</span></div>
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
