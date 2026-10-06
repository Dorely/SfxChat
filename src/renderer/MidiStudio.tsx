import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import type { Asset, SoundfontSummary } from '../shared/types'
import type { MidiComposition, MidiNote, MidiTrack } from '../shared/midi'
import { GM_DRUMS, GM_PROGRAMS, MIDI_BPM_MAX, MIDI_BPM_MIN, MIDI_DEFAULT_VELOCITY, MIDI_MAX_TRACKS, MIDI_TIME_SIG_DENOMINATORS, midiCompositionProblem, midiDrumName, midiDurationSeconds, midiLengthBeats, midiNoteCount, midiTimeSignature, midiTrackLabel } from '../shared/midi'
import Icon from './Icon'

/**
 * The MIDI studio: the project's clips beside an arrangement of piano-roll lanes. Each lane has a
 * sticky header and keyboard, and shares one ruler and horizontal scroll. Playback renders the draft
 * through the bundled SoundFont bank and sweeps a playhead over the lanes. Editing lives here; saving
 * writes a derivative (or an authored clip for a new draft), so a composed original is preserved.
 */
type MidiStudioProps = {
  assets: Asset[]
  conversationId: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  onSaved: (asset: Asset) => Promise<void> | void
}

const ROW = 12
const HEAD_WIDTH = 220
const KEYS_WIDTH = 112
const MIN_TRACK_ROWS = 20
const PITCH_PADDING = 5
const SNAPS = [{ value: 1, label: '1/4' }, { value: 0.5, label: '1/8' }, { value: 0.25, label: '1/16' }, { value: 0, label: 'Free' }]
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const BLACK_KEYS = new Set([1, 3, 6, 8, 10])
const DRUM_LOW = 35
const DRUM_HIGH = 81

const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
const blankComposition = (): MidiComposition => ({ bpm: 120, timeSig: { numerator: 4, denominator: 4 }, tracks: [{ name: 'Piano', program: 0, notes: [] }] })
const trackColor = (index: number) => ({ '--track-color': `var(--track-${(index % 6) + 1})` }) as CSSProperties
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
const clockLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`

export default function MidiStudio({ assets, conversationId, selectedId, onSelect, onSaved }: MidiStudioProps) {
  const [composition, setComposition] = useState<MidiComposition>(blankComposition)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadedName, setLoadedName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [bank, setBank] = useState<SoundfontSummary | null>(null)
  const [query, setQuery] = useState('')
  const [snap, setSnap] = useState(0.5)
  const [zoom, setZoom] = useState(72)
  const [selected, setSelected] = useState<{ track: number; note: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [loop, setLoop] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const player = useRef<HTMLAudioElement | null>(null)
  const objectUrl = useRef<string | null>(null)
  const animation = useRef(0)
  const playSerial = useRef(0)
  const live = useRef(composition)
  live.current = composition

  const allClips = assets.filter(asset => asset.kind === 'midi')
  const clips = useMemo(() => allClips.filter(asset => {
    const needle = query.trim().toLowerCase()
    return !needle || `${asset.name} ${asset.prompt} ${asset.tags.join(' ')}`.toLowerCase().includes(needle)
  }), [assets, query])

  useEffect(() => { void window.sfx.soundfontInfo().then(setBank).catch(() => undefined) }, [])
  // Selecting a MIDI asset elsewhere (the library or inspector) loads it into the lanes.
  useEffect(() => {
    if (!selectedId || selectedId === loadedId || !assets.some(asset => asset.id === selectedId && asset.kind === 'midi')) return
    void open(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const quantize = (beat: number) => (snap > 0 ? Math.round(beat / snap) * snap : Math.round(beat * 100) / 100)
  const update = (mutate: (draft: MidiComposition) => void) => {
    setDirty(true); setNotice(null)
    setComposition(previous => { const next = structuredClone(previous) as MidiComposition; mutate(next); return next })
  }
  const discardOk = () => !dirty || window.confirm('Discard unsaved changes to this clip?')

  const open = async (id: string) => {
    if (id !== loadedId && !discardOk()) return
    setError(null); setNotice(null); stop()
    try {
      const parsed = await window.sfx.midiNotes(id)
      setComposition(parsed); setLoadedId(id); setLoadedName(assets.find(asset => asset.id === id)?.name ?? ''); setSelected(null); setDirty(false); onSelect(id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not open that clip.') }
  }
  const startNew = () => {
    if (!discardOk()) return
    stop(); setComposition(blankComposition()); setLoadedId(null); setLoadedName(''); setSelected(null); setError(null); setNotice(null); setDirty(false); onSelect(null)
  }

  const stop = () => {
    ++playSerial.current
    cancelAnimationFrame(animation.current)
    player.current?.pause()
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null }
    setPlaying(false); setRendering(false); setPlayhead(0)
  }
  useEffect(() => stop, [])

  const playRendered = async (render: () => Promise<Uint8Array>, follow: boolean) => {
    stop()
    const serial = playSerial.current
    setError(null); setRendering(true)
    try {
      const bytes = await render()
      if (serial !== playSerial.current) return
      objectUrl.current = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' }))
      const element = player.current ?? new Audio()
      player.current = element
      element.src = objectUrl.current
      element.loop = follow && loop
      await element.play()
      setRendering(false)
      if (!follow) return
      setPlaying(true)
      const tick = () => {
        const current = player.current
        if (!current || serial !== playSerial.current) return
        if (current.ended) { setPlaying(false); setPlayhead(0); return }
        setPlayhead((current.currentTime * live.current.bpm) / 60)
        animation.current = requestAnimationFrame(tick)
      }
      animation.current = requestAnimationFrame(tick)
    } catch (caught) {
      if (serial === playSerial.current) { setRendering(false); setError(caught instanceof Error ? caught.message : 'Could not render this clip.') }
    }
  }
  const togglePlay = () => {
    if (playing || rendering) { stop(); return }
    if (!midiNoteCount(composition)) { setError('Draw a few notes before playing.'); return }
    void playRendered(() => window.sfx.previewMidi(composition), true)
  }
  const audition = (track: MidiTrack, notes: MidiNote[]) => void playRendered(() => window.sfx.previewMidi({ bpm: composition.bpm, timeSig: composition.timeSig, tracks: [{ ...track, notes }] }), false)
  const probeInstrument = (track: MidiTrack) => audition(track, track.drums
    ? [{ pitch: 36, startBeat: 0, durationBeats: 0.5 }, { pitch: 42, startBeat: 0.5, durationBeats: 0.5 }, { pitch: 38, startBeat: 1, durationBeats: 0.5 }, { pitch: 42, startBeat: 1.5, durationBeats: 0.5 }]
    : [{ pitch: 60, startBeat: 0, durationBeats: 0.5 }, { pitch: 64, startBeat: 0.5, durationBeats: 0.5 }, { pitch: 67, startBeat: 1, durationBeats: 1 }])

  const save = async () => {
    if (!conversationId) { setError('Select a conversation before saving a clip.'); return }
    const problem = midiCompositionProblem(composition)
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)
    try {
      const asset = await window.sfx.saveMidiEdit(conversationId, loadedId, composition, loadedName.trim() || undefined)
      setLoadedId(asset.id); setLoadedName(asset.name); setDirty(false); setNotice(`Saved “${asset.name}”.`); await onSaved(asset); onSelect(asset.id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save this clip.') }
    finally { setBusy(false) }
  }

  const pitchWindow = (track: MidiTrack) => {
    const pitches = track.notes.map(note => note.pitch)
    // A drum lane always lists the whole General MIDI kit so every instrument has a labelled row.
    if (track.drums) {
      const low = Math.min(DRUM_LOW, ...pitches), high = Math.max(DRUM_HIGH, ...pitches)
      return { low, high, rows: high - low + 1 }
    }
    const centre = pitches.length ? pitches : [60, 72]
    const low = Math.max(0, Math.min(...centre) - PITCH_PADDING)
    const high = Math.min(127, Math.max(Math.max(...centre) + PITCH_PADDING, low + MIN_TRACK_ROWS - 1))
    return { low, high, rows: high - low + 1 }
  }
  const addNote = (event: ReactMouseEvent, trackIndex: number, high: number) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const raw = (event.clientX - rect.left) / zoom
    const beat = Math.max(0, snap > 0 ? Math.floor(raw / snap) * snap : quantize(raw))
    const pitch = Math.max(0, Math.min(127, high - Math.floor((event.clientY - rect.top) / ROW)))
    const track = composition.tracks[trackIndex]
    const length = snap || 0.5
    setSelected({ track: trackIndex, note: track.notes.length })
    update(draft => { draft.tracks[trackIndex].notes.push({ pitch, startBeat: beat, durationBeats: length }) })
    audition(track, [{ pitch, startBeat: 0, durationBeats: Math.min(1, length) }])
  }
  const dragNote = (event: ReactMouseEvent, trackIndex: number, noteIndex: number, mode: 'move' | 'resize') => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    setSelected({ track: trackIndex, note: noteIndex })
    const note = composition.tracks[trackIndex].notes[noteIndex]
    if (!note) return
    const originX = event.clientX, originY = event.clientY, baseStart = note.startBeat, basePitch = note.pitch, baseLength = note.durationBeats
    document.body.classList.add(mode === 'move' ? 'midi-dragging' : 'midi-resizing')
    const move = (moveEvent: MouseEvent) => {
      const beatDelta = (moveEvent.clientX - originX) / zoom
      const pitchDelta = -Math.round((moveEvent.clientY - originY) / ROW)
      update(draft => {
        const target = draft.tracks[trackIndex].notes[noteIndex]
        if (!target) return
        if (mode === 'move') {
          target.startBeat = Math.max(0, quantize(baseStart + beatDelta))
          target.pitch = Math.max(0, Math.min(127, basePitch + pitchDelta))
        } else target.durationBeats = Math.max(snap || 0.125, quantize(baseStart + baseLength + beatDelta) - target.startBeat)
      })
    }
    const release = () => { document.body.classList.remove('midi-dragging', 'midi-resizing'); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', release) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', release)
  }
  const removeNote = (trackIndex: number, noteIndex: number) => { update(draft => { draft.tracks[trackIndex].notes.splice(noteIndex, 1) }); setSelected(null) }
  const nudge = (beats: number, semitones: number) => {
    if (!selected) return
    const { track, note } = selected
    update(draft => {
      const target = draft.tracks[track].notes[note]
      if (!target) return
      target.startBeat = Math.max(0, Math.round((target.startBeat + beats) * 1000) / 1000)
      target.pitch = Math.max(0, Math.min(127, target.pitch + semitones))
    })
  }
  const removeTrack = (trackIndex: number) => {
    const track = composition.tracks[trackIndex]
    if (track.notes.length && !window.confirm(`Remove ${midiTrackLabel(track, trackIndex)} and its ${track.notes.length} notes?`)) return
    update(draft => { draft.tracks.splice(trackIndex, 1) }); setSelected(null)
  }
  const addTrack = () => update(draft => { if (draft.tracks.length < MIDI_MAX_TRACKS) draft.tracks.push({ name: '', program: 0, notes: [] }) })

  const timeSig = midiTimeSignature(composition)
  const beatsPerBar = (timeSig.numerator * 4) / timeSig.denominator
  const lengthBeats = midiLengthBeats(composition)
  const bars = Math.max(4, Math.ceil((lengthBeats + beatsPerBar) / beatsPerBar))
  const totalBeats = bars * beatsPerBar
  const rollWidth = totalBeats * zoom
  const noteCount = midiNoteCount(composition)
  const selectedTrack = selected ? composition.tracks[selected.track] ?? null : null
  const selectedNote: MidiNote | null = selected ? selectedTrack?.notes[selected.note] ?? null : null
  const position = `${Math.floor(playhead / beatsPerBar) + 1}.${Math.floor(playhead % beatsPerBar) + 1}`
  const melodic = bank?.presets.filter(preset => preset.bank === 0) ?? []
  const instruments = melodic.length
    ? melodic.slice(0, 128).map(preset => ({ program: preset.program, label: `${preset.program + 1}. ${preset.name}` }))
    : GM_PROGRAMS.map((name, program) => ({ program, label: `${program + 1}. ${name}` }))
  const gridStyle = (rows: number): CSSProperties => ({
    height: rows * ROW, width: rollWidth,
    backgroundImage: `linear-gradient(to right, var(--midi-bar) 1px, transparent 1px), linear-gradient(to right, var(--midi-beat) 1px, transparent 1px)${snap > 0 && snap < 1 && zoom * snap >= 10 ? ', linear-gradient(to right, var(--midi-sub) 1px, transparent 1px)' : ''}`,
    backgroundSize: `${zoom * beatsPerBar}px 100%, ${zoom}px 100%${snap > 0 && snap < 1 && zoom * snap >= 10 ? `, ${zoom * snap}px 100%` : ''}`,
  })

  return (
    <section className="workspace-panel midi-panel" tabIndex={-1} onKeyDown={event => {
      if (isTyping(event.target)) return
      if (event.key === ' ') { event.preventDefault(); togglePlay(); return }
      if (!selected) return
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeNote(selected.track, selected.note) }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); nudge((event.key === 'ArrowLeft' ? -1 : 1) * (snap || 0.25), 0) }
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); nudge(0, (event.key === 'ArrowDown' ? -1 : 1) * (event.shiftKey ? 12 : 1)) }
      else if (event.key === 'Escape') setSelected(null)
    }}>
      <div className="panel-header">
        <div><p className="eyebrow">Compose & arrange</p><h1>MIDI Studio <span>{allClips.length}</span></h1></div>
        <div className="header-actions">
          <button className="secondary-button" onClick={startNew}><Icon name="plus" /> New clip</button>
          <button className="primary-button" onClick={() => void save()} disabled={busy || !noteCount} title={loadedId ? 'Saves your edits as a new clip; the original stays unchanged.' : undefined}><Icon name="download" /> {busy ? 'Saving…' : loadedId ? 'Save as new clip' : 'Save clip'}</button>
        </div>
      </div>

      <div className="midi-layout">
        <aside className="midi-rail" aria-label="MIDI clips">
          <label className="search-field"><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search clips…" aria-label="Search MIDI clips" /></label>
          <div className="midi-clip-list">
            {clips.map(clip => (
              <button key={clip.id} className={`midi-clip${clip.id === loadedId ? ' midi-clip-active' : ''}`} onClick={() => void open(clip.id)}>
                <span className="midi-clip-icon"><Icon name="piano" /></span>
                <span className="midi-clip-copy">
                  <strong>{clip.name || 'Untitled clip'}</strong>
                  <small>{clip.midi ? `${clip.midi.tracks.length} trk · ${clip.midi.noteCount} notes · ${clockLabel(clip.midi.durationSeconds)}` : 'MIDI clip'}</small>
                </span>
              </button>
            ))}
            {!clips.length && <div className="midi-rail-empty"><Icon name="piano" /><p>{allClips.length ? 'No clips match that search.' : 'No MIDI clips yet. Ask the assistant to compose one, or draw notes in a new clip and save it.'}</p></div>}
          </div>
        </aside>

        <div className="midi-editor">
          <div className="midi-titlebar">
            <input className="midi-clip-name" value={loadedName} onChange={event => { setLoadedName(event.target.value); setDirty(true) }} placeholder="Untitled clip" aria-label="Clip name" />
            <span className={`midi-state${dirty ? ' midi-state-dirty' : ''}`}>{dirty ? 'Unsaved changes' : loadedId ? 'Saved clip' : 'New draft'}</span>
            <span className="midi-stats">{bars} bars · {midiDurationSeconds(composition).toFixed(1)}s · {composition.tracks.length} {composition.tracks.length === 1 ? 'track' : 'tracks'} · {noteCount} {noteCount === 1 ? 'note' : 'notes'}</span>
          </div>

          <div className="midi-transport">
            <button className={`midi-play${playing ? ' midi-play-active' : ''}`} onClick={togglePlay} aria-label={playing || rendering ? 'Stop' : 'Play'} title={playing || rendering ? 'Stop (Space)' : 'Play (Space)'}>{rendering ? <span className="spinner" /> : <Icon name={playing ? 'stop' : 'play'} />}</button>
            <div className="midi-lcd" aria-label="Playback position"><strong>{position}</strong><small>Bar · beat</small></div>
            <div className="midi-lcd"><strong>{clockLabel((playhead * 60) / composition.bpm)}</strong><small>Time</small></div>
            <button className={`midi-chip${loop ? ' midi-chip-on' : ''}`} aria-pressed={loop} onClick={() => { const next = !loop; setLoop(next); if (player.current) player.current.loop = next }} title="Loop playback"><Icon name="repeat" /> Loop</button>
            <span className="midi-divider" />
            <label className="midi-field"><span>Tempo</span><input type="number" min={MIDI_BPM_MIN} max={MIDI_BPM_MAX} value={composition.bpm} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0) update(draft => { draft.bpm = Math.max(MIDI_BPM_MIN, Math.min(MIDI_BPM_MAX, Math.round(value))) }) }} aria-label="Tempo in BPM" /><small>BPM</small></label>
            <label className="midi-field"><span>Meter</span>
              <select value={timeSig.numerator} onChange={event => update(draft => { draft.timeSig = { numerator: Number(event.target.value), denominator: midiTimeSignature(draft).denominator } })} aria-label="Beats per bar">
                {Array.from({ length: 12 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value}</option>)}
              </select>
              <em>/</em>
              <select value={timeSig.denominator} onChange={event => update(draft => { draft.timeSig = { numerator: midiTimeSignature(draft).numerator, denominator: Number(event.target.value) } })} aria-label="Beat unit">
                {MIDI_TIME_SIG_DENOMINATORS.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <div className="midi-field"><span>Snap</span><div className="midi-segment" role="radiogroup" aria-label="Snap">
              {SNAPS.map(option => <button key={option.label} role="radio" aria-checked={snap === option.value} className={snap === option.value ? 'midi-segment-on' : ''} onClick={() => setSnap(option.value)}>{option.label}</button>)}
            </div></div>
            <label className="midi-field midi-zoom"><span>Zoom</span><input type="range" min={24} max={180} step={4} value={zoom} onChange={event => setZoom(Number(event.target.value))} aria-label="Horizontal zoom" /></label>
          </div>
          {error && <div className="midi-message midi-message-error" role="alert"><Icon name="info" /> {error}<button className="mini-button" onClick={() => setError(null)} aria-label="Dismiss"><Icon name="close" /></button></div>}
          {notice && !error && <div className="midi-message" role="status"><Icon name="check" /> {notice}</div>}

          <div className="midi-arrange" style={{ '--midi-head': `${HEAD_WIDTH}px`, '--midi-keys': `${KEYS_WIDTH}px` } as CSSProperties}>
            <div className="midi-ruler-row">
              <div className="midi-corner">Tracks</div>
              <div className="midi-ruler" style={{ width: rollWidth }}>
                {Array.from({ length: bars }, (_, bar) => <span key={bar} className="midi-bar-label" style={{ left: bar * beatsPerBar * zoom, width: beatsPerBar * zoom }}>{bar + 1}</span>)}
                {(playing || playhead > 0) && <i className="midi-ruler-head" style={{ left: playhead * zoom }} />}
              </div>
            </div>
            {composition.tracks.map((track, trackIndex) => {
              const view = pitchWindow(track)
              const rows = Array.from({ length: view.rows }, (_, row) => view.high - row)
              return (
                <div className="midi-lane" key={trackIndex} style={trackColor(trackIndex)}>
                  <div className="midi-lane-head">
                    <input className="midi-track-name" value={track.name ?? ''} placeholder={midiTrackLabel(track, trackIndex)} onChange={event => update(draft => { draft.tracks[trackIndex].name = event.target.value || undefined })} aria-label={`Track ${trackIndex + 1} name`} />
                    {track.drums
                      ? <span className="midi-kit">General MIDI drum kit</span>
                      : <select className="midi-instrument" value={track.program ?? 0} onChange={event => update(draft => { draft.tracks[trackIndex].program = Number(event.target.value) })} aria-label={`Track ${trackIndex + 1} instrument`}>
                          {instruments.map(option => <option key={option.program} value={option.program}>{option.label}</option>)}
                        </select>}
                    <div className="midi-lane-actions">
                      <button className={`midi-chip${track.drums ? ' midi-chip-on' : ''}`} aria-pressed={track.drums === true} onClick={() => update(draft => { draft.tracks[trackIndex].drums = !draft.tracks[trackIndex].drums })} title="Play this track on the drum channel">Drums</button>
                      <span className="midi-lane-count">{track.notes.length} notes</span>
                      <button className="mini-button" title="Hear this instrument" aria-label={`Hear track ${trackIndex + 1} instrument`} onClick={() => probeInstrument(track)}><Icon name="play" /></button>
                      {composition.tracks.length > 1 && <button className="mini-button" title="Remove track" aria-label={`Remove track ${trackIndex + 1}`} onClick={() => removeTrack(trackIndex)}><Icon name="trash" /></button>}
                    </div>
                  </div>
                  <div className="midi-keys" style={{ height: view.rows * ROW }}>
                    {rows.map(pitch => {
                      const black = !track.drums && BLACK_KEYS.has(pitch % 12)
                      const unmapped = track.drums && !GM_DRUMS[pitch]
                      const label = track.drums ? GM_DRUMS[pitch] ?? noteName(pitch) : pitch % 12 === 0 ? noteName(pitch) : ''
                      return <button key={pitch} className={`midi-key${black ? ' midi-key-black' : ''}${pitch % 12 === 0 && !track.drums ? ' midi-key-c' : ''}${unmapped ? ' midi-key-unmapped' : ''}`} style={{ height: ROW }} title={unmapped ? `${noteName(pitch)}: no General MIDI drum on this key` : track.drums ? midiDrumName(pitch) : noteName(pitch)} tabIndex={-1} onMouseDown={event => { event.preventDefault(); audition(track, [{ pitch, startBeat: 0, durationBeats: 1 }]) }}>{label}</button>
                    })}
                  </div>
                  <div className="midi-grid" style={gridStyle(view.rows)} onMouseDown={event => { if (event.button === 0 && event.target === event.currentTarget) addNote(event, trackIndex, view.high) }}>
                    {!track.drums && rows.map((pitch, row) => BLACK_KEYS.has(pitch % 12) ? <i key={pitch} className="midi-row-shade" style={{ top: row * ROW, height: ROW }} /> : null)}
                    {track.notes.map((note, noteIndex) => {
                      const active = playing && playhead >= note.startBeat && playhead < note.startBeat + note.durationBeats
                      const isSelected = selected?.track === trackIndex && selected.note === noteIndex
                      const velocity = note.velocity ?? MIDI_DEFAULT_VELOCITY
                      const width = Math.max(5, note.durationBeats * zoom - 1)
                      return (
                        <div
                          key={`${noteIndex}-${note.pitch}-${note.startBeat}`}
                          className={`midi-note${isSelected ? ' midi-note-selected' : ''}${active ? ' midi-note-active' : ''}${track.drums && !GM_DRUMS[note.pitch] ? ' midi-note-unmapped' : ''}`}
                          style={{ left: note.startBeat * zoom, width, top: (view.high - note.pitch) * ROW, height: ROW - 1, opacity: 0.45 + (0.55 * velocity) / 127 }}
                          title={`${track.drums ? (GM_DRUMS[note.pitch] ?? `${noteName(note.pitch)} (outside the drum kit)`) : noteName(note.pitch)} · bar ${Math.floor(note.startBeat / beatsPerBar) + 1} · velocity ${velocity}`}
                          onMouseDown={event => dragNote(event, trackIndex, noteIndex, 'move')}
                          onContextMenu={event => { event.preventDefault(); removeNote(trackIndex, noteIndex) }}
                        >
                          {width > 30 && !track.drums && <span className="midi-note-label">{noteName(note.pitch)}</span>}
                          <span className="midi-note-handle" onMouseDown={event => dragNote(event, trackIndex, noteIndex, 'resize')} />
                        </div>
                      )
                    })}
                    {(playing || playhead > 0) && <div className="midi-playhead" style={{ left: playhead * zoom }} />}
                  </div>
                </div>
              )
            })}
            <div className="midi-add-row">
              <button className="midi-add-track" onClick={addTrack} disabled={composition.tracks.length >= MIDI_MAX_TRACKS}><Icon name="plus" /> Add track <small>{composition.tracks.length}/{MIDI_MAX_TRACKS}</small></button>
            </div>
          </div>

          <div className="midi-statusbar">
            {selectedNote && selected && selectedTrack
              ? <>
                  <span className="midi-selected-pill" style={trackColor(selected.track)}><i />{selectedTrack.drums ? GM_DRUMS[selectedNote.pitch] ?? noteName(selectedNote.pitch) : noteName(selectedNote.pitch)}</span>
                  <span>Bar {Math.floor(selectedNote.startBeat / beatsPerBar) + 1} · beat {((selectedNote.startBeat % beatsPerBar) + 1).toFixed(2).replace(/\.?0+$/, '')}</span>
                  <span>{selectedNote.durationBeats} {selectedNote.durationBeats === 1 ? 'beat' : 'beats'}</span>
                  <label className="midi-field midi-velocity"><span>Velocity</span><input type="range" min={1} max={127} value={selectedNote.velocity ?? MIDI_DEFAULT_VELOCITY} onChange={event => { const value = Number(event.target.value); const { track, note } = selected; update(draft => { draft.tracks[track].notes[note].velocity = value }) }} aria-label="Note velocity" /><output>{selectedNote.velocity ?? MIDI_DEFAULT_VELOCITY}</output></label>
                  <button className="secondary-button midi-delete" onClick={() => removeNote(selected.track, selected.note)}><Icon name="trash" /> Delete note</button>
                </>
              : <span className="midi-hint"><kbd>Click</kbd> draw · <kbd>Drag</kbd> move · <kbd>Edge</kbd> resize · <kbd>Right-click</kbd>/<kbd>Del</kbd> remove · <kbd>←→↑↓</kbd> nudge · <kbd>Space</kbd> play · click a key to hear it</span>}
          </div>
        </div>
      </div>
    </section>
  )
}
