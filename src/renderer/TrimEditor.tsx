import { useEffect, useMemo, useRef, useState } from 'react'
import type { Asset, AudioAnalysis, TrimInput } from '../shared/types'
import Icon from './Icon'

type TrimEditorProps = {
  asset: Asset
  onClose: () => void
  onSave: (input: TrimInput) => Promise<Asset | null>
  onPlay: (key: string, playing: boolean) => void
  playingKey: string | null
}

const MAX_BINS = 320

function seconds(value: number) { return Number.isFinite(value) ? value.toFixed(3) : '0.000' }
function durationLabel(value: number) { return Number.isFinite(value) ? `${value.toFixed(3)} s` : '—' }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }
function trimValues(start: number, end: number, duration: number, fadeInMs: number, fadeOutMs: number, name: string): TrimInput {
  return { startSeconds: clamp(start, 0, duration), endSeconds: clamp(end, 0, duration), fadeInMs: Math.max(0, fadeInMs || 0), fadeOutMs: Math.max(0, fadeOutMs || 0), ...(name.trim() ? { name: name.trim() } : {}) }
}

export default function TrimEditor({ asset, onClose, onSave, onPlay, playingKey }: TrimEditorProps) {
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewLoading, setViewLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(asset.duration || 0)
  const [startDraft, setStartDraft] = useState('0.000')
  const [endDraft, setEndDraft] = useState(seconds(asset.duration || 0))
  const [fadeInMs, setFadeInMs] = useState(0)
  const [fadeOutMs, setFadeOutMs] = useState(0)
  const [name, setName] = useState(`${asset.name || 'Untitled sound'} trim`)
  const [viewStart, setViewStart] = useState(0)
  const [viewEnd, setViewEnd] = useState(asset.duration || 1)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [showSpectrogram, setShowSpectrogram] = useState(true)
  const [spectrogramUrl, setSpectrogramUrl] = useState<string | null>(null)
  const [spectrogramLoading, setSpectrogramLoading] = useState(false)
  const [spectrogramError, setSpectrogramError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const analysisRequestRef = useRef(0)
  const previewRequestRef = useRef(0)
  const spectrogramRequestRef = useRef(0)
  const previewAudioRef = useRef<HTMLAudioElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const previewKey = `trim-preview-${asset.id}`

  const duration = analysis?.duration || asset.duration || 0
  const fullStart = 0
  const fullEnd = duration

  const loadSpectrogram = async (startSeconds: number, endSeconds: number) => {
    const request = ++spectrogramRequestRef.current
    setSpectrogramLoading(true)
    setSpectrogramError(null)
    try {
      const bytes = await window.sfx.spectrogram(asset.id, { startSeconds, endSeconds, width: 768, height: 320 })
      if (request !== spectrogramRequestRef.current) return
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      setSpectrogramUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url })
    } catch (reason) {
      if (request === spectrogramRequestRef.current) setSpectrogramError(reason instanceof Error ? reason.message : 'Unable to render the spectrogram.')
    } finally {
      if (request === spectrogramRequestRef.current) setSpectrogramLoading(false)
    }
  }

  const loadAnalysis = async (startSeconds?: number, endSeconds?: number, initial = false) => {
    const request = ++analysisRequestRef.current
    if (initial) setLoading(true)
    else setViewLoading(true)
    setError(null)
    try {
      const next = await window.sfx.analyzeAudio(asset.id, { ...(startSeconds == null ? {} : { startSeconds }), ...(endSeconds == null ? {} : { endSeconds }), bins: MAX_BINS })
      if (request !== analysisRequestRef.current) return
      setAnalysis(next)
      if (initial) {
        setStart(next.startSeconds); setEnd(next.endSeconds)
        setStartDraft(seconds(next.startSeconds)); setEndDraft(seconds(next.endSeconds))
        setViewStart(next.startSeconds); setViewEnd(next.endSeconds); setLoading(false)
      } else { setViewStart(next.startSeconds); setViewEnd(next.endSeconds) }
      if (showSpectrogram) void loadSpectrogram(next.startSeconds, next.endSeconds)
    } catch (reason) {
      if (request === analysisRequestRef.current) setError(reason instanceof Error ? reason.message : 'Unable to analyze this audio.')
    } finally {
      if (request !== analysisRequestRef.current) return
      if (initial) setLoading(false); else setViewLoading(false)
    }
  }

  const toggleSpectrogram = () => {
    const next = !showSpectrogram
    setShowSpectrogram(next)
    if (!next) {
      spectrogramRequestRef.current += 1
      setSpectrogramLoading(false)
      setSpectrogramError(null)
      setSpectrogramUrl(previous => { if (previous) URL.revokeObjectURL(previous); return null })
    } else if (analysis) {
      void loadSpectrogram(analysis.startSeconds, analysis.endSeconds)
    }
  }

  useEffect(() => {
    setAnalysis(null); setStart(0); setEnd(asset.duration || 0)
    setStartDraft('0.000'); setEndDraft(seconds(asset.duration || 0))
    setViewStart(0); setViewEnd(asset.duration || 1); setFadeInMs(0); setFadeOutMs(0)
    setName(`${asset.name || 'Untitled sound'} trim`); setPreviewUrl(null)
    spectrogramRequestRef.current += 1
    setSpectrogramUrl(null); setSpectrogramError(null); setSpectrogramLoading(false)
    void loadAnalysis(undefined, undefined, true)
    return () => { analysisRequestRef.current += 1; previewRequestRef.current += 1; spectrogramRequestRef.current += 1 }
  }, [asset.id])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  useEffect(() => () => { if (spectrogramUrl) URL.revokeObjectURL(spectrogramUrl) }, [spectrogramUrl])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => () => { previewRequestRef.current += 1; onPlay(previewKey, false) }, [onPlay, previewKey])
  useEffect(() => {
    const audio = previewAudioRef.current
    if (!audio) return
    let cancelled = false
    if (playingKey === previewKey) void audio.play().catch(reason => {
      if (cancelled) return
      setError(reason instanceof Error ? reason.message : 'Unable to play the selection.')
      onPlay(previewKey, false)
    })
    else audio.pause()
    return () => { cancelled = true }
  }, [playingKey, previewKey, onPlay, previewUrl])
  useEffect(() => {
    if (previewUrl || playingKey === previewKey) onPlay(previewKey, false)
    if (previewUrl) setPreviewUrl(null)
    setPreviewLoading(false)
    previewRequestRef.current += 1
  }, [start, end, fadeInMs, fadeOutMs])

  const rate = analysis?.sampleRate ?? 1
  const validFades = fadeInMs <= 10000 && fadeOutMs <= 10000 && Math.round(fadeInMs * rate / 1000) + Math.round(fadeOutMs * rate / 1000) <= Math.round(end * rate) - Math.round(start * rate)
  const validSelection = Boolean(analysis && end > start && start >= fullStart && end <= fullEnd && validFades)
  const durationForInput = analysis?.duration || asset.duration || 0
  const input = useMemo(() => trimValues(start, end, durationForInput, fadeInMs, fadeOutMs, name), [start, end, durationForInput, fadeInMs, fadeOutMs, name])
  const selectionDuration = Math.max(0, end - start)
  const visibleBins = useMemo(() => analysis?.bins || [], [analysis])
  const updateStart = (value: number, draft = seconds(value)) => { const next = clamp(value, fullStart, Math.max(fullStart, end - 0.001)); setStart(next); setStartDraft(draft) }
  const updateEnd = (value: number, draft = seconds(value)) => { const next = clamp(value, Math.min(fullEnd, start + 0.001), fullEnd); setEnd(next); setEndDraft(draft) }
  const commitStartDraft = () => { if (startDraft === seconds(start)) return; const value = Number(startDraft); const next = clamp(Number.isFinite(value) ? value : start, fullStart, Math.max(fullStart, end - 0.001)); setStart(next); setStartDraft(seconds(next)) }
  const commitEndDraft = () => { if (endDraft === seconds(end)) return; const value = Number(endDraft); const next = clamp(Number.isFinite(value) ? value : end, Math.min(fullEnd, start + 0.001), fullEnd); setEnd(next); setEndDraft(seconds(next)) }

  const handlePreview = async () => {
    const audio = previewAudioRef.current
    if (playingKey === previewKey) {
      audio?.pause()
      if (audio) audio.currentTime = 0
      onPlay(previewKey, false)
      return
    }
    if (!validSelection || previewLoading) return
    setError(null)
    if (previewUrl && audio) {
      audio.currentTime = 0
      onPlay(previewKey, true)
      return
    }
    const previewRequest = ++previewRequestRef.current
    setError(null); setPreviewLoading(true); onPlay(previewKey, false)
    try {
      const bytes = await window.sfx.previewTrim(asset.id, input)
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }))
      if (previewRequest !== previewRequestRef.current) { URL.revokeObjectURL(url); return }
      setPreviewUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url })
      onPlay(previewKey, true)
    } catch (reason) { if (previewRequest === previewRequestRef.current) setError(reason instanceof Error ? reason.message : 'Unable to render the preview.')
    } finally { if (previewRequest === previewRequestRef.current) setPreviewLoading(false) }
  }
  const handleSave = async () => {
    if (!validSelection || saving) return
    setSaving(true); setError(null); onPlay(previewKey, false)
    try { const created = await onSave(input); if (created) onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save the trimmed asset.') }
    finally { setSaving(false) }
  }
  const requestView = (nextStart: number, nextEnd: number) => {
    if (!analysis || nextEnd <= nextStart) return
    void loadAnalysis(nextStart <= fullStart ? undefined : nextStart, nextEnd >= fullEnd ? undefined : nextEnd)
  }
  const zoomSelection = () => { if (validSelection) requestView(start, end) }
  const resetZoom = () => requestView(fullStart, fullEnd)
  const pan = (direction: -1 | 1) => { const windowSize = Math.max(0.001, viewEnd - viewStart); const distance = Math.max(0.001, windowSize * 0.6); const nextStart = clamp(viewStart + direction * distance, fullStart, Math.max(fullStart, fullEnd - windowSize)); requestView(nextStart, Math.min(fullEnd, nextStart + windowSize)) }
  const span = Math.max(0.000001, viewEnd - viewStart)
  const startX = clamp((start - viewStart) / span, 0, 1)
  const endX = clamp((end - viewStart) / span, 0, 1)

  return <div ref={modalRef} className="trim-modal" role="dialog" aria-modal="true" aria-labelledby="trim-editor-title" onKeyDown={event => {
    if (event.key === 'Escape' && !saving) { event.stopPropagation(); onClose() }
    if (event.key === 'Tab') {
      const items = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), audio[controls]') ?? [])
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <div className="trim-editor">
      <div className="trim-editor-header"><div><p className="eyebrow">Trim a sound</p><h2 id="trim-editor-title">Trim {asset.name || 'Untitled sound'}</h2></div><button className="icon-button" onClick={onClose} disabled={saving} aria-label="Close trim editor"><Icon name="close" /></button></div>
      <div className="trim-editor-scroll">
        <div className="trim-waveform-heading"><span className="field-label">Measured waveform</span><span className="trim-decoder">{analysis?.sampleRate ? `${analysis.sampleRate.toLocaleString()} Hz · ${analysis.channels} ch · Times use decoded audio` : 'Analyzing…'}</span><button type="button" className="mini-button trim-spectrogram-toggle" onClick={toggleSpectrogram} aria-pressed={showSpectrogram}>Spectrogram</button></div>
        <div className="trim-waveform-wrap"><svg className="trim-waveform" viewBox="0 0 1000 180" preserveAspectRatio="none" role="img" aria-label="Audio waveform with selected trim range"><line x1="0" y1="90" x2="1000" y2="90" className="trim-waveform-axis" />{visibleBins.map((bin, index) => { const x = clamp((bin.startSeconds - viewStart) / span, 0, 1) * 1000; const width = Math.max(1, (bin.endSeconds - bin.startSeconds) / span * 1000); const yMax = 90 - clamp(bin.max, -1, 1) * 76; const yMin = 90 - clamp(bin.min, -1, 1) * 76; const yRms = 90 - clamp(bin.rms, -1, 1) * 48; return <g key={`${bin.startFrame}-${index}`}><rect className="trim-waveform-rms" x={x} y={Math.min(90, yRms)} width={width} height={Math.abs(yRms - 90) || 1} /><line className="trim-waveform-bar" x1={x + width / 2} x2={x + width / 2} y1={yMax} y2={yMin} /></g> })}<rect className="trim-selection" x={startX * 1000} y="0" width={Math.max(0, (endX - startX) * 1000)} height="180" /></svg><div className="trim-range-inputs"><input type="range" min={viewStart} max={viewEnd} step="0.001" value={clamp(start, viewStart, viewEnd)} onChange={event => updateStart(Number(event.target.value))} aria-label="Trim start in seconds" disabled={loading || viewLoading || saving || !analysis} /><input type="range" min={viewStart} max={viewEnd} step="0.001" value={clamp(end, viewStart, viewEnd)} onChange={event => updateEnd(Number(event.target.value))} aria-label="Trim end in seconds" disabled={loading || viewLoading || saving || !analysis} /></div></div>
        <div className="trim-time-labels"><span>{seconds(viewStart)} s</span><span>{seconds(viewEnd)} s</span></div>
        {showSpectrogram && <div className="trim-spectrogram-wrap"><div className="trim-waveform-heading"><span className="field-label">Spectrogram — the same view the assistant can attach</span>{spectrogramLoading && <span className="trim-decoder">Rendering…</span>}</div>{spectrogramError ? <p className="trim-error" role="alert">{spectrogramError}</p> : spectrogramUrl ? <img className="trim-spectrogram" src={spectrogramUrl} alt={`Spectrogram of ${asset.name} from ${seconds(viewStart)} to ${seconds(viewEnd)} seconds`} /> : <div className="trim-spectrogram-placeholder">Rendering…</div>}</div>}
        <div className="trim-zoom-controls"><button className="mini-button" onClick={() => pan(-1)} disabled={loading || viewLoading || viewStart <= fullStart} aria-label="Pan waveform left"><Icon name="arrow-left" /></button><button className="secondary-button" onClick={zoomSelection} disabled={!validSelection || viewLoading || saving}>Zoom selection</button><button className="secondary-button" onClick={resetZoom} disabled={!analysis || viewLoading || saving}>Reset zoom</button><button className="mini-button" onClick={() => pan(1)} disabled={loading || viewLoading || viewEnd >= fullEnd} aria-label="Pan waveform right"><Icon name="arrow" /></button></div>
        <div className="trim-selection-summary"><span>Selection <strong>{durationLabel(selectionDuration)}</strong></span><span>In {seconds(start)} s</span><span>Out {seconds(end)} s</span></div>
        {!validFades && <p className="trim-error" role="alert">Each fade must be at most 10 seconds, and both fades together must fit within the selection.</p>}
        <div className="trim-fields"><label>In point (s)<input type="number" min="0" max={durationForInput} step="0.001" value={startDraft} onChange={event => { setStartDraft(event.target.value); const value = Number(event.target.value); if (Number.isFinite(value)) updateStart(value, event.target.value) }} onBlur={commitStartDraft} disabled={loading || saving || !analysis} /></label><label>Out point (s)<input type="number" min="0" max={durationForInput} step="0.001" value={endDraft} onChange={event => { setEndDraft(event.target.value); const value = Number(event.target.value); if (Number.isFinite(value)) updateEnd(value, event.target.value) }} onBlur={commitEndDraft} disabled={loading || saving || !analysis} /></label></div>
        <div className="trim-fields"><label>Fade in (ms)<input type="number" min="0" max="10000" step="1" value={fadeInMs} onChange={event => setFadeInMs(Math.max(0, Number(event.target.value) || 0))} disabled={saving || !analysis} /></label><label>Fade out (ms)<input type="number" min="0" max="10000" step="1" value={fadeOutMs} onChange={event => setFadeOutMs(Math.max(0, Number(event.target.value) || 0))} disabled={saving || !analysis} /></label></div>
        <label className="trim-name-field">New asset name<input maxLength={200} value={name} onChange={event => setName(event.target.value)} disabled={saving || !analysis} /></label><p className="field-hint trim-analysis-note">Times use decoded audio. Original preserved.</p>{error && <p className="trim-error" role="alert">{error}</p>}{previewUrl && <div className="trim-preview"><span className="field-label">Preview</span><audio ref={previewAudioRef} src={previewUrl} controls onPlay={() => onPlay(previewKey, true)} onPause={() => { if (playingKey === previewKey) onPlay(previewKey, false) }} onEnded={() => { if (playingKey === previewKey) onPlay(previewKey, false) }} /></div>}
      </div>
      <div className="trim-editor-footer"><button className="secondary-button" onClick={handlePreview} disabled={!validSelection || previewLoading || saving}><Icon name={playingKey === previewKey ? 'stop' : 'play'} />{previewLoading ? 'Preparing…' : playingKey === previewKey ? 'Stop selection' : 'Play selection'}</button><button className="primary-button" onClick={() => void handleSave()} disabled={!validSelection || loading || saving}>{saving ? 'Saving…' : 'Save as new asset'}</button></div>
    </div>
  </div>
}
