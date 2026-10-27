import { useEffect, useMemo, useRef, useState } from 'react'
import type { Asset, AudioAnalysis, LoopCandidate, LoopSearchResult, MusicalAnalysis, TrimInput } from '../shared/types'
import Icon from './Icon'

type TrimEditorProps = {
  asset: Asset
  onClose: () => void
  onSave: (input: TrimInput) => Promise<Asset | null>
  onPlay: (key: string, playing: boolean) => void
  playingKey: string | null
}

const MAX_BINS = 320
const LOOP_COUNT = 8
/** Estimates below this confidence are hidden rather than shown as facts. */
const SHOW_CONFIDENCE = 0.3
const MATCH_WORDS: Record<LoopCandidate['match'], string> = { close: 'Close match', partial: 'Partial match', weak: 'Weak match' }

function seconds(value: number) { return Number.isFinite(value) ? value.toFixed(3) : '0.000' }
function durationLabel(value: number) { return Number.isFinite(value) ? `${value.toFixed(3)} s` : '—' }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }
function trimValues(start: number, end: number, duration: number, fadeInMs: number, fadeOutMs: number, name: string): TrimInput {
  return { startSeconds: clamp(start, 0, duration), endSeconds: clamp(end, 0, duration), fadeInMs: Math.max(0, fadeInMs || 0), fadeOutMs: Math.max(0, fadeOutMs || 0), ...(name.trim() ? { name: name.trim() } : {}) }
}
function loopValues(start: number, end: number, duration: number, crossfadeMs: number, name: string): TrimInput {
  return { startSeconds: clamp(start, 0, duration), endSeconds: clamp(end, 0, duration), loop: true, crossfadeMs: Math.max(0, crossfadeMs || 0), ...(name.trim() ? { name: name.trim() } : {}) }
}
async function runOperation<T>(name: string, args: unknown): Promise<T> {
  const response = await window.sfx.operation(name, args)
  if (!response.ok) throw new Error(response.error?.message ?? 'The operation failed.')
  return response.result as T
}
function sameTime(a: number, b: number) { return Math.abs(a - b) < 1e-6 }

/** Tempo, key and loudness chips; each is labeled as an estimate and explained on hover. */
function AudioFacts({ musical, error }: { musical: MusicalAnalysis | null | undefined; error: string | null }) {
  if (error) return <div className="audio-facts"><span className="audio-fact audio-fact-muted" title={error}>Tempo and key unavailable</span></div>
  if (musical === undefined) return <div className="audio-facts"><span className="audio-fact audio-fact-muted">Measuring tempo, key and loudness…</span></div>
  if (!musical) return null
  const tempo = musical.tempo && musical.tempo.confidence >= SHOW_CONFIDENCE ? musical.tempo : null
  const key = musical.key && musical.key.confidence >= SHOW_CONFIDENCE ? musical.key : null
  const lufs = musical.loudness.integratedLufs
  return <div className="audio-facts" aria-label="Measured estimates">
    <span className="audio-fact" title={tempo ? `Estimated from the rhythm of note onsets (confidence ${Math.round(tempo.confidence * 100)}%${tempo.steady ? ', steady' : ', drifting'}). It can read at half or double the felt speed.` : 'No steady beat was found, so loops use texture mode.'}>{tempo ? <>Tempo <strong>≈ {Math.round(tempo.bpm)} BPM</strong></> : 'No steady beat'}</span>
    {key && <span className="audio-fact" title={`Estimated from the notes that sound most (confidence ${Math.round(key.confidence * 100)}%). Relative major and minor keys are easy to confuse; also likely: ${key.alternatives.slice(0, 2).map(k => k.label).join(', ')}.`}>Key <strong>{key.label}</strong></span>}
    {lufs !== null && <span className="audio-fact" title="Integrated loudness (ITU-R BS.1770). Game and streaming targets are often between −23 and −14 LUFS; higher numbers are louder.">Loudness <strong>{lufs.toFixed(1)} LUFS</strong></span>}
    {(tempo || key) && <span className="audio-fact-note">estimates</span>}
  </div>
}

export default function TrimEditor({ asset, onClose, onSave, onPlay, playingKey }: TrimEditorProps) {
  // A MIDI clip is symbolic: it is edited as notes in the MIDI studio, not decoded and trimmed.
  if (asset.format === 'mid') return null
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
  const [mode, setMode] = useState<'trim' | 'loop'>('trim')
  /** undefined while measuring; null when the file has no musical estimate. */
  const [musical, setMusical] = useState<MusicalAnalysis | null | undefined>(undefined)
  const [musicalError, setMusicalError] = useState<string | null>(null)
  const [showBars, setShowBars] = useState(false)
  const [loopSearchMode, setLoopSearchMode] = useState<'auto' | 'music' | 'texture'>('auto')
  const [loopMin, setLoopMin] = useState('')
  const [loopMax, setLoopMax] = useState('')
  const [allowIntro, setAllowIntro] = useState(true)
  const [loops, setLoops] = useState<LoopSearchResult | null>(null)
  const [loopSearching, setLoopSearching] = useState(false)
  const [crossfadeMs, setCrossfadeMs] = useState(10)
  const [seamUrl, setSeamUrl] = useState<string | null>(null)
  const [seamLoading, setSeamLoading] = useState(false)
  const musicalRequestRef = useRef(0)
  const loopRequestRef = useRef(0)
  const seamRequestRef = useRef(0)
  const seamAudioRef = useRef<HTMLAudioElement>(null)
  const seamKey = `seam-preview-${asset.id}`
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

  const loadMusical = async () => {
    const request = ++musicalRequestRef.current
    setMusical(undefined); setMusicalError(null)
    try {
      const result = await window.sfx.analyzeAudio(asset.id, { bins: 1, musical: true })
      if (request === musicalRequestRef.current) setMusical(result.musical ?? null)
    } catch (reason) {
      if (request === musicalRequestRef.current) { setMusical(null); setMusicalError(reason instanceof Error ? reason.message : 'Unable to estimate tempo and key.') }
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
        void loadMusical()
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
    setMode('trim'); setMusical(undefined); setMusicalError(null); setLoops(null); setSeamUrl(null); setShowBars(false)
    musicalRequestRef.current += 1; loopRequestRef.current += 1; seamRequestRef.current += 1
    spectrogramRequestRef.current += 1
    setSpectrogramUrl(null); setSpectrogramError(null); setSpectrogramLoading(false)
    void loadAnalysis(undefined, undefined, true)
    return () => { analysisRequestRef.current += 1; previewRequestRef.current += 1; spectrogramRequestRef.current += 1; musicalRequestRef.current += 1; loopRequestRef.current += 1; seamRequestRef.current += 1 }
  }, [asset.id])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  useEffect(() => () => { if (seamUrl) URL.revokeObjectURL(seamUrl) }, [seamUrl])
  useEffect(() => () => { if (spectrogramUrl) URL.revokeObjectURL(spectrogramUrl) }, [spectrogramUrl])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => () => { previewRequestRef.current += 1; onPlay(previewKey, false) }, [onPlay, previewKey])
  useEffect(() => () => { seamRequestRef.current += 1; onPlay(seamKey, false) }, [onPlay, seamKey])
  useEffect(() => {
    const audio = seamAudioRef.current
    if (!audio) return
    let cancelled = false
    if (playingKey === seamKey) void audio.play().catch(reason => {
      if (cancelled) return
      setError(reason instanceof Error ? reason.message : 'Unable to play the seam.')
      onPlay(seamKey, false)
    })
    else audio.pause()
    return () => { cancelled = true }
  }, [playingKey, seamKey, onPlay, seamUrl])
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
    if (seamUrl || playingKey === seamKey) onPlay(seamKey, false)
    if (seamUrl) setSeamUrl(null)
    setSeamLoading(false)
    seamRequestRef.current += 1
  }, [start, end, fadeInMs, fadeOutMs, crossfadeMs, mode])

  const rate = analysis?.sampleRate ?? 1
  const validFades = fadeInMs <= 10000 && fadeOutMs <= 10000 && Math.round(fadeInMs * rate / 1000) + Math.round(fadeOutMs * rate / 1000) <= Math.round(end * rate) - Math.round(start * rate)
  const validCrossfade = crossfadeMs <= 5000 && Math.round(crossfadeMs * rate / 1000) < Math.round(end * rate) - Math.round(start * rate)
  const validSelection = Boolean(analysis && end > start && start >= fullStart && end <= fullEnd && (mode === 'loop' ? validCrossfade : validFades))
  const durationForInput = analysis?.duration || asset.duration || 0
  const input = useMemo(() => mode === 'loop' ? loopValues(start, end, durationForInput, crossfadeMs, name) : trimValues(start, end, durationForInput, fadeInMs, fadeOutMs, name), [mode, start, end, durationForInput, fadeInMs, fadeOutMs, crossfadeMs, name])
  const activeLoop = loops?.candidates.find(c => sameTime(c.startSeconds, start) && sameTime(c.endSeconds, end)) ?? null
  const barsVisible = Boolean(musical?.tempo && musical.tempo.confidence >= SHOW_CONFIDENCE && musical.bars.length)
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
    setError(null); onPlay(seamKey, false)
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
  const switchMode = (next: 'trim' | 'loop') => {
    if (next === mode || saving) return
    onPlay(previewKey, false); onPlay(seamKey, false)
    setMode(next)
    setName(current => {
      const base = asset.name || 'Untitled sound'
      return current === `${base} trim` || current === `${base} loop` ? `${base} ${next}` : current
    })
  }
  const chooseLoop = (candidate: LoopCandidate) => {
    setStart(candidate.startSeconds); setEnd(candidate.endSeconds)
    setStartDraft(seconds(candidate.startSeconds)); setEndDraft(seconds(candidate.endSeconds))
    setCrossfadeMs(candidate.recommendedCrossfadeMs)
  }
  const findLoops = async () => {
    if (!analysis || loopSearching) return
    const request = ++loopRequestRef.current
    const min = Number(loopMin), max = Number(loopMax)
    setLoopSearching(true); setError(null)
    try {
      const result = await runOperation<LoopSearchResult>('find_loop_points', { projectId: asset.projectId, id: asset.id, input: { mode: loopSearchMode, allowIntro, count: LOOP_COUNT, ...(loopMin.trim() && min > 0 ? { minSeconds: min } : {}), ...(loopMax.trim() && max > 0 ? { maxSeconds: max } : {}) } })
      if (request !== loopRequestRef.current) return
      setLoops(result)
      if (result.candidates[0]) chooseLoop(result.candidates[0])
    } catch (reason) {
      if (request === loopRequestRef.current) { setLoops(null); setError(reason instanceof Error ? reason.message : 'Unable to find loop points.') }
    } finally { if (request === loopRequestRef.current) setLoopSearching(false) }
  }
  const handleSeam = async () => {
    const audio = seamAudioRef.current
    if (playingKey === seamKey) {
      audio?.pause()
      if (audio) audio.currentTime = 0
      onPlay(seamKey, false)
      return
    }
    if (!validSelection || seamLoading) return
    setError(null); onPlay(previewKey, false)
    if (seamUrl && audio) { audio.currentTime = 0; onPlay(seamKey, true); return }
    const request = ++seamRequestRef.current
    setSeamLoading(true)
    try {
      const bytes = await window.sfx.previewSeam(asset.id, { startSeconds: input.startSeconds, endSeconds: input.endSeconds, crossfadeMs: input.crossfadeMs, contextSeconds: 2 })
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }))
      if (request !== seamRequestRef.current) { URL.revokeObjectURL(url); return }
      setSeamUrl(previous => { if (previous) URL.revokeObjectURL(previous); return url })
      onPlay(seamKey, true)
    } catch (reason) { if (request === seamRequestRef.current) setError(reason instanceof Error ? reason.message : 'Unable to render the seam.')
    } finally { if (request === seamRequestRef.current) setSeamLoading(false) }
  }
  const handleSave = async () => {
    if (!validSelection || saving) return
    setSaving(true); setError(null); onPlay(previewKey, false); onPlay(seamKey, false)
    try { const created = await onSave(input); if (created) onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : mode === 'loop' ? 'Unable to save the loop.' : 'Unable to save the trimmed asset.') }
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
      const items = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), audio[controls]') ?? [])
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}>
    <div className="trim-editor">
      <div className="trim-editor-header"><div><p className="eyebrow">Edit audio · original preserved</p><h2 id="trim-editor-title">{asset.name || 'Untitled sound'}</h2><AudioFacts musical={musical} error={musicalError} /></div><button className="icon-button" onClick={onClose} disabled={saving} aria-label="Close audio editor"><Icon name="close" /></button></div>
      <div className="editor-modes" role="tablist" aria-label="Editor mode">{(['trim', 'loop'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? 'editor-mode-active' : ''} onClick={() => switchMode(value)} disabled={saving}>{value === 'trim' ? 'Trim' : 'Loop'}<span>{value === 'trim' ? 'Cut a section, with fades' : 'Find and save a seamless loop'}</span></button>)}</div>
      <div className="trim-editor-scroll">
        <div className="trim-waveform-heading"><span className="field-label">Measured waveform</span><span className="trim-decoder">{analysis?.sampleRate ? `${analysis.sampleRate.toLocaleString()} Hz · ${analysis.channels} ch · Times use decoded audio` : 'Analyzing…'}</span><div className="trim-view-toggles"><button type="button" className="mini-button" onClick={() => setShowBars(value => !value)} aria-pressed={showBars && barsVisible} disabled={!barsVisible} title={barsVisible ? 'Show estimated bar lines' : 'No steady beat grid was found'}>Bar grid</button><button type="button" className="mini-button" onClick={toggleSpectrogram} aria-pressed={showSpectrogram}>Spectrogram</button></div></div>
        <div className="trim-waveform-wrap"><svg className="trim-waveform" viewBox="0 0 1000 180" preserveAspectRatio="none" role="img" aria-label="Audio waveform with selected trim range"><line x1="0" y1="90" x2="1000" y2="90" className="trim-waveform-axis" />{visibleBins.map((bin, index) => { const x = clamp((bin.startSeconds - viewStart) / span, 0, 1) * 1000; const width = Math.max(1, (bin.endSeconds - bin.startSeconds) / span * 1000); const yMax = 90 - clamp(bin.max, -1, 1) * 76; const yMin = 90 - clamp(bin.min, -1, 1) * 76; const yRms = 90 - clamp(bin.rms, -1, 1) * 48; return <g key={`${bin.startFrame}-${index}`}><rect className="trim-waveform-rms" x={x} y={Math.min(90, yRms)} width={width} height={Math.abs(yRms - 90) || 1} /><line className="trim-waveform-bar" x1={x + width / 2} x2={x + width / 2} y1={yMax} y2={yMin} /></g> })}{showBars && barsVisible && musical!.bars.filter(bar => bar.seconds >= viewStart && bar.seconds <= viewEnd).map(bar => { const x = (bar.seconds - viewStart) / span * 1000; return <line key={bar.number} className={(bar.number - 1) % 4 === 0 ? 'trim-bar-line trim-bar-line-strong' : 'trim-bar-line'} x1={x} x2={x} y1="0" y2="180" /> })}<rect className="trim-selection" x={startX * 1000} y="0" width={Math.max(0, (endX - startX) * 1000)} height="180" />{mode === 'loop' && loops?.candidates.map(candidate => { const x1 = clamp((candidate.startSeconds - viewStart) / span, 0, 1) * 1000, x2 = clamp((candidate.endSeconds - viewStart) / span, 0, 1) * 1000, y = 4 + (candidate.rank - 1) * 6; return <rect key={candidate.rank} className={candidate === activeLoop ? 'loop-bracket loop-bracket-active' : 'loop-bracket'} x={x1} y={y} width={Math.max(1, x2 - x1)} height="3" /> })}</svg>{showBars && barsVisible && <div className="trim-bar-labels" aria-hidden="true">{musical!.bars.filter(bar => bar.seconds >= viewStart && bar.seconds <= viewEnd && (bar.number - 1) % 4 === 0).map(bar => <span key={bar.number} style={{ left: `${(bar.seconds - viewStart) / span * 100}%` }}>{bar.number}</span>)}</div>}<div className="trim-range-inputs"><input type="range" min={viewStart} max={viewEnd} step="0.001" value={clamp(start, viewStart, viewEnd)} onChange={event => updateStart(Number(event.target.value))} aria-label="Trim start in seconds" disabled={loading || viewLoading || saving || !analysis} /><input type="range" min={viewStart} max={viewEnd} step="0.001" value={clamp(end, viewStart, viewEnd)} onChange={event => updateEnd(Number(event.target.value))} aria-label="Trim end in seconds" disabled={loading || viewLoading || saving || !analysis} /></div></div>
        <div className="trim-time-labels"><span>{seconds(viewStart)} s</span><span>{seconds(viewEnd)} s</span></div>
        {showSpectrogram && <div className="trim-spectrogram-wrap"><div className="trim-waveform-heading"><span className="field-label">Spectrogram — the same view the assistant can attach</span>{spectrogramLoading && <span className="trim-decoder">Rendering…</span>}</div>{spectrogramError ? <p className="trim-error" role="alert">{spectrogramError}</p> : spectrogramUrl ? <img className="trim-spectrogram" src={spectrogramUrl} alt={`Spectrogram of ${asset.name} from ${seconds(viewStart)} to ${seconds(viewEnd)} seconds`} /> : <div className="trim-spectrogram-placeholder">Rendering…</div>}</div>}
        <div className="trim-zoom-controls"><button className="mini-button" onClick={() => pan(-1)} disabled={loading || viewLoading || viewStart <= fullStart} aria-label="Pan waveform left"><Icon name="arrow-left" /></button><button className="secondary-button" onClick={zoomSelection} disabled={!validSelection || viewLoading || saving}>Zoom selection</button><button className="secondary-button" onClick={resetZoom} disabled={!analysis || viewLoading || saving}>Reset zoom</button><button className="mini-button" onClick={() => pan(1)} disabled={loading || viewLoading || viewEnd >= fullEnd} aria-label="Pan waveform right"><Icon name="arrow" /></button></div>
        <div className="trim-selection-summary"><span>Selection <strong>{durationLabel(selectionDuration)}</strong></span><span>In {seconds(start)} s</span><span>Out {seconds(end)} s</span></div>
        {!validFades && <p className="trim-error" role="alert">Each fade must be at most 10 seconds, and both fades together must fit within the selection.</p>}
        <div className="trim-fields"><label>In point (s)<input type="number" min="0" max={durationForInput} step="0.001" value={startDraft} onChange={event => { setStartDraft(event.target.value); const value = Number(event.target.value); if (Number.isFinite(value)) updateStart(value, event.target.value) }} onBlur={commitStartDraft} disabled={loading || saving || !analysis} /></label><label>Out point (s)<input type="number" min="0" max={durationForInput} step="0.001" value={endDraft} onChange={event => { setEndDraft(event.target.value); const value = Number(event.target.value); if (Number.isFinite(value)) updateEnd(value, event.target.value) }} onBlur={commitEndDraft} disabled={loading || saving || !analysis} /></label></div>
        {mode === 'trim' ? <div className="trim-fields"><label>Fade in (ms)<input type="number" min="0" max="10000" step="1" value={fadeInMs} onChange={event => setFadeInMs(Math.max(0, Number(event.target.value) || 0))} disabled={saving || !analysis} /></label><label>Fade out (ms)<input type="number" min="0" max="10000" step="1" value={fadeOutMs} onChange={event => setFadeOutMs(Math.max(0, Number(event.target.value) || 0))} disabled={saving || !analysis} /></label></div> : <>
          <div className="trim-fields"><label>Seam crossfade (ms)<input type="number" min="0" max="5000" step="1" value={crossfadeMs} onChange={event => setCrossfadeMs(Math.max(0, Number(event.target.value) || 0))} disabled={saving || !analysis} /></label><p className="field-hint loop-crossfade-hint">The end blends into the start over this time. Short (5–30 ms) suits music; ambience often needs 200–500 ms.</p></div>
          {!validCrossfade && <p className="trim-error" role="alert">The crossfade must be at most 5 seconds and shorter than the loop.</p>}
          <section className="loop-panel" aria-labelledby="loop-panel-title">
            <div className="loop-panel-heading"><span id="loop-panel-title" className="field-label">Loop points</span><span className="field-hint">Ranked automatically. Choose one, listen to the seam, then save.</span></div>
            <div className="loop-options">
              <label>Look for<select value={loopSearchMode} onChange={event => setLoopSearchMode(event.target.value as typeof loopSearchMode)} disabled={loopSearching || saving}><option value="auto">Automatic</option><option value="music">Music (whole bars)</option><option value="texture">Ambience or texture</option></select></label>
              <label>Shortest (s)<input type="number" min="0" step="0.5" placeholder="auto" value={loopMin} onChange={event => setLoopMin(event.target.value)} disabled={loopSearching || saving} /></label>
              <label>Longest (s)<input type="number" min="0" step="0.5" placeholder="any" value={loopMax} onChange={event => setLoopMax(event.target.value)} disabled={loopSearching || saving} /></label>
              <label className="loop-intro-option"><input type="checkbox" checked={allowIntro} onChange={event => setAllowIntro(event.target.checked)} disabled={loopSearching || saving} />Allow an intro before the loop</label>
              <button type="button" className="secondary-button" onClick={() => void findLoops()} disabled={!analysis || loopSearching || saving}>{loopSearching ? 'Searching…' : loops ? 'Search again' : 'Find loop points'}</button>
            </div>
            {loops && <p className="field-hint loop-mode-note">{loops.mode === 'music' ? `Searched whole bars at an estimated ${Math.round(loops.tempo?.bpm ?? 0)} BPM.` : 'No steady beat, so loops follow texture and loudness instead of bars.'} Rankings are measurements, not listening — play the seam before saving.</p>}
            {loops && <ol className="loop-candidates">{loops.candidates.map(candidate => <li key={candidate.rank}><button type="button" className={candidate === activeLoop ? 'loop-candidate loop-candidate-active' : 'loop-candidate'} aria-pressed={candidate === activeLoop} onClick={() => chooseLoop(candidate)} disabled={saving}><span className="loop-rank">{candidate.rank}</span><span className="loop-text"><span className="loop-summary">{candidate.summary}</span><span className="loop-details">{seconds(candidate.startSeconds)}–{seconds(candidate.endSeconds)} s · context {Math.round(candidate.score * 100)}% · waveform {Math.round(Math.max(0, candidate.seam.correlation) * 100)}% · level {candidate.seam.levelDeltaDb >= 0 ? '+' : ''}{candidate.seam.levelDeltaDb.toFixed(1)} dB · crossfade {candidate.recommendedCrossfadeMs} ms</span></span><span className={`loop-match loop-match-${candidate.match}`}>{MATCH_WORDS[candidate.match]}</span></button></li>)}</ol>}
          </section>
        </>}
        <label className="trim-name-field">New asset name<input maxLength={200} value={name} onChange={event => setName(event.target.value)} disabled={saving || !analysis} /></label><p className="field-hint trim-analysis-note">Times use decoded audio. Original preserved.</p>{error && <p className="trim-error" role="alert">{error}</p>}{seamUrl && <div className="trim-preview"><span className="field-label">Seam preview — the loop end flowing into its start</span><audio ref={seamAudioRef} src={seamUrl} controls onPlay={() => onPlay(seamKey, true)} onPause={() => { if (playingKey === seamKey) onPlay(seamKey, false) }} onEnded={() => { if (playingKey === seamKey) onPlay(seamKey, false) }} /></div>}{previewUrl && <div className="trim-preview"><span className="field-label">{mode === 'loop' ? 'Loop preview — one pass of the saved loop' : 'Preview'}</span><audio ref={previewAudioRef} src={previewUrl} controls onPlay={() => onPlay(previewKey, true)} onPause={() => { if (playingKey === previewKey) onPlay(previewKey, false) }} onEnded={() => { if (playingKey === previewKey) onPlay(previewKey, false) }} /></div>}
      </div>
      <div className="trim-editor-footer">{mode === 'loop' && <button className="secondary-button" onClick={() => void handleSeam()} disabled={!validSelection || seamLoading || saving}><Icon name={playingKey === seamKey ? 'stop' : 'play'} />{seamLoading ? 'Preparing…' : playingKey === seamKey ? 'Stop seam' : 'Play seam'}</button>}<button className="secondary-button" onClick={handlePreview} disabled={!validSelection || previewLoading || saving}><Icon name={playingKey === previewKey ? 'stop' : 'play'} />{previewLoading ? 'Preparing…' : playingKey === previewKey ? 'Stop' : mode === 'loop' ? 'Play loop' : 'Play selection'}</button><button className="primary-button" onClick={() => void handleSave()} disabled={!validSelection || loading || saving}>{saving ? 'Saving…' : mode === 'loop' ? 'Save loop as new asset' : 'Save as new asset'}</button></div>
    </div>
  </div>
}
