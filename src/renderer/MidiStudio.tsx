import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { Asset, SoundfontSummary } from '../shared/types'
import type { MidiComposition, MidiNote, MidiTrack } from '../shared/midi'
import { GM_PROGRAMS, MIDI_DEFAULT_VELOCITY, MIDI_MAX_TRACKS, midiCompositionProblem, midiDrumName, midiDurationSeconds, midiLengthBeats, midiTimeSignature, midiTrackLabel } from '../shared/midi'
import Icon from './Icon'

/**
 * The MIDI studio: a searchable list of the project's clips beside stacked piano rolls with the
 * controls for writing notes. Playback renders the draft through the bundled SoundFont bank and
 * sweeps a playhead over the rolls, highlighting the notes it passes. Editing lives here; saving
 * writes a derivative (or an authored clip for a new draft), so a composed original is preserved.
 */
type MidiStudioProps = {
  assets: Asset[]
  conversationId: string | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  onSaved: (asset: Asset) => Promise<void> | void
}

const ROW = 10
const GRID_MIN_BEATS = 8
const MIN_TRACK_ROWS = 18

const blankComposition = (): MidiComposition => ({ bpm: 120, timeSig: { numerator: 4, denominator: 4 }, tracks: [{ name: 'Piano', program: 0, notes: [] }] })

export default function MidiStudio({ assets, conversationId, selectedId, onSelect, onSaved }: MidiStudioProps) {
  const [composition, setComposition] = useState<MidiComposition>(blankComposition)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [loadedName, setLoadedName] = useState('')
  const [bank, setBank] = useState<SoundfontSummary | null>(null)
  const [query, setQuery] = useState('')
  const [snap, setSnap] = useState(0.5)
  const [zoom, setZoom] = useState(64)
  const [selected, setSelected] = useState<{ track: number; note: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [loop, setLoop] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const player = useRef<HTMLAudioElement | null>(null)
  const objectUrl = useRef<string | null>(null)
  const animation = useRef(0)
  const live = useRef(composition)
  live.current = composition

  const clips = useMemo(() => assets.filter(asset => asset.kind === 'midi').filter(asset => {
    const needle = query.trim().toLowerCase()
    return !needle || `${asset.name} ${asset.prompt}`.toLowerCase().includes(needle)
  }), [assets, query])

  useEffect(() => { void window.sfx.soundfontInfo().then(setBank).catch(() => undefined) }, [])
  // Selecting a MIDI asset elsewhere (the library or inspector) loads it into the rolls.
  useEffect(() => {
    if (!selectedId || selectedId === loadedId || !assets.some(asset => asset.id === selectedId && asset.kind === 'midi')) return
    void open(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const quantize = (beat: number) => (snap > 0 ? Math.round(beat / snap) * snap : Math.round(beat * 100) / 100)
  const update = (mutate: (draft: MidiComposition) => void) => setComposition(previous => { const next = structuredClone(previous) as MidiComposition; mutate(next); return next })

  const open = async (id: string) => {
    setError(null)
    try {
      const parsed = await window.sfx.midiNotes(id)
      setComposition(parsed); setLoadedId(id); setLoadedName(assets.find(asset => asset.id === id)?.name ?? ''); setSelected(null); onSelect(id)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not open that clip.') }
  }
  const startNew = () => { setComposition(blankComposition()); setLoadedId(null); setLoadedName(''); setSelected(null); setError(null); onSelect(null) }

  const stop = () => {
    cancelAnimationFrame(animation.current)
    player.current?.pause()
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null }
    setPlaying(false); setPlayhead(0)
  }
  useEffect(() => stop, [])

  const playBytes = async (bytes: Uint8Array) => {
    stop()
    objectUrl.current = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' }))
    const element = player.current ?? new Audio()
    player.current = element
    element.src = objectUrl.current
    element.loop = loop
    await element.play()
    setPlaying(true)
    const tick = () => {
      const current = player.current
      if (!current) return
      if (current.ended) { setPlaying(false); setPlayhead(0); return }
      setPlayhead((current.currentTime * live.current.bpm) / 60)
      animation.current = requestAnimationFrame(tick)
    }
    animation.current = requestAnimationFrame(tick)
  }
  const playDraft = async () => {
    setError(null)
    try { await playBytes(await window.sfx.previewMidi(composition)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not render this clip.') }
  }
  const probe = async (track: MidiTrack) => {
    setError(null)
    const probeTrack: MidiTrack = { ...track, notes: [{ pitch: 60, startBeat: 0, durationBeats: 0.5 }, { pitch: 64, startBeat: 0.5, durationBeats: 0.5 }, { pitch: 67, startBeat: 1, durationBeats: 1 }] }
    try { await playBytes(await window.sfx.previewMidi({ bpm: composition.bpm, timeSig: composition.timeSig, tracks: [probeTrack] })) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not preview that instrument.') }
  }

  const save = async () => {
    if (!conversationId) { setError('Select a conversation before saving a clip.'); return }
    const problem = midiCompositionProblem(composition)
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)
    try {
      const asset = await window.sfx.saveMidiEdit(conversationId, loadedId, composition, loadedName.trim() || undefined)
      setLoadedId(asset.id); setLoadedName(asset.name); await onSaved(asset)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save this clip.') }
    finally { setBusy(false) }
  }

  const pitchWindow = (track: MidiTrack) => {
    const pitches = track.notes.map(note => note.pitch)
    const centre = pitches.length ? pitches : [60]
    const low = Math.max(0, Math.min(...centre) - 8)
    const high = Math.min(127, Math.max(Math.max(...centre) + 8, low + MIN_TRACK_ROWS - 1))
    return { low, high, rows: high - low + 1 }
  }
  const addNote = (event: ReactMouseEvent, trackIndex: number, high: number) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const beat = Math.max(0, quantize((event.clientX - rect.left) / zoom))
    const row = Math.floor((event.clientY - rect.top) / ROW)
    const pitch = Math.max(0, Math.min(127, high - row))
    setSelected({ track: trackIndex, note: composition.tracks[trackIndex].notes.length })
    update(draft => { draft.tracks[trackIndex].notes.push({ pitch, startBeat: beat, durationBeats: snap || 0.5 }) })
  }
  const dragNote = (event: ReactMouseEvent, trackIndex: number, noteIndex: number, mode: 'move' | 'resize') => {
    event.preventDefault(); event.stopPropagation()
    const note = composition.tracks[trackIndex].notes[noteIndex]
    if (!note) return
    const originX = event.clientX, originY = event.clientY, baseStart = note.startBeat, basePitch = note.pitch, baseLength = note.durationBeats
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
    const release = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', release) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', release)
  }
  const removeNote = (trackIndex: number, noteIndex: number) => { update(draft => { draft.tracks[trackIndex].notes.splice(noteIndex, 1) }); setSelected(null) }

  const timeSig = midiTimeSignature(composition)
  const totalBeats = Math.max(GRID_MIN_BEATS, Math.ceil((midiLengthBeats(composition) + 4) / timeSig.numerator) * timeSig.numerator)
  const rollWidth = totalBeats * zoom
  const selectedNote: MidiNote | null = selected ? composition.tracks[selected.track]?.notes[selected.note] ?? null : null

  return (
    <div className="midi-studio" tabIndex={0} onKeyDown={event => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected) { event.preventDefault(); removeNote(selected.track, selected.note) }
    }}>
      <aside className="midi-rail">
        <div className="midi-rail-head">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search MIDI clips…" aria-label="Search MIDI clips" />
          <button className="midi-new" onClick={startNew}>New MIDI</button>
        </div>
        <ul className="midi-clip-list">
          {clips.map(clip => (
            <li key={clip.id}>
              <button className={clip.id === loadedId ? 'active' : ''} onClick={() => void open(clip.id)}>
                <strong>{clip.name}</strong>
                <span>{clip.midi?.noteCount ?? '—'} notes · {(clip.midi?.durationSeconds ?? 0).toFixed(1)}s</span>
              </button>
            </li>
          ))}
        </ul>
        {!clips.length && <p className="midi-hint">No MIDI clips yet. Ask the assistant to compose one, or press New MIDI and draw notes.</p>}
      </aside>

      <section className="midi-workspace">
        <div className="midi-transport">
          <button className={playing ? 'tab-active' : ''} onClick={() => (playing ? stop() : void playDraft())}>{playing ? 'Stop' : 'Play'}</button>
          <label className="midi-toggle"><input type="checkbox" checked={loop} onChange={event => { setLoop(event.target.checked); if (player.current) player.current.loop = event.target.checked }} /> Loop</label>
          <span className="midi-position">bar {(Math.floor(playhead / timeSig.numerator) + 1)} · beat {(Math.floor(playhead % timeSig.numerator) + 1)}</span>
          <label className="midi-field">Tempo <input type="number" min={20} max={300} value={composition.bpm} onChange={event => update(draft => { draft.bpm = Math.max(20, Math.min(300, Number(event.target.value) || 120)) })} /></label>
          <label className="midi-field">Meter
            <select value={timeSig.numerator} onChange={event => update(draft => { draft.timeSig = { numerator: Number(event.target.value), denominator: midiTimeSignature(draft).denominator } })}>
              {[2, 3, 4, 6, 12].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <select value={timeSig.denominator} onChange={event => update(draft => { draft.timeSig = { numerator: midiTimeSignature(draft).numerator, denominator: Number(event.target.value) } })}>
              {[2, 4, 8].map(value => <option key={value} value={value}>/{value}</option>)}
            </select>
          </label>
          <label className="midi-field">Snap
            <select value={snap} onChange={event => setSnap(Number(event.target.value))}>
              <option value={1}>1/4</option><option value={0.5}>1/8</option><option value={0.25}>1/16</option><option value={0}>off</option>
            </select>
          </label>
          <label className="midi-field">Zoom <input type="range" min={24} max={160} step={4} value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
          <button onClick={() => update(draft => { if (draft.tracks.length < MIDI_MAX_TRACKS) draft.tracks.push({ name: '', program: 0, notes: [] }) })} disabled={composition.tracks.length >= MIDI_MAX_TRACKS}>Add track</button>
          <button className="midi-save" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : loadedId ? 'Save as new clip' : 'Save clip'}</button>
        </div>
        {error && <div className="midi-error" role="alert">{error}</div>}
        <div className="midi-clip-name">
          <input value={loadedName} onChange={event => setLoadedName(event.target.value)} placeholder="Clip name" aria-label="Clip name" />
          <span>{midiLengthBeats(composition).toFixed(2)} beats · {midiDurationSeconds(composition).toFixed(2)}s · {composition.tracks.length} track{composition.tracks.length === 1 ? '' : 's'}</span>
        </div>

        <div className="midi-rolls">
          {composition.tracks.map((track, trackIndex) => {
            const view = pitchWindow(track)
            const melodic = bank?.presets.filter(preset => preset.bank === 0) ?? []
            const options = melodic.length
              ? melodic.slice(0, 128).map(preset => ({ program: preset.program, label: `${preset.program} · ${preset.name}` }))
              : GM_PROGRAMS.map((name, program) => ({ program, label: `${program} · ${name}` }))
            return (
              <div className="midi-track" key={trackIndex}>
                <div className="midi-track-head">
                  <input className="midi-track-name" value={track.name ?? ''} placeholder={midiTrackLabel(track, trackIndex)} onChange={event => update(draft => { draft.tracks[trackIndex].name = event.target.value || undefined })} aria-label={`Track ${trackIndex + 1} name`} />
                  {track.drums
                    ? <span className="midi-kit">General MIDI drum kit</span>
                    : <select value={track.program ?? 0} onChange={event => update(draft => { draft.tracks[trackIndex].program = Number(event.target.value) })} aria-label={`Track ${trackIndex + 1} instrument`}>
                        {options.map(option => <option key={option.program} value={option.program}>{option.label}</option>)}
                      </select>}
                  <label className="midi-toggle"><input type="checkbox" checked={track.drums === true} onChange={event => update(draft => { draft.tracks[trackIndex].drums = event.target.checked })} /> Drums</label>
                  <button className="icon-button" title="Hear this instrument" onClick={() => void probe(track)}><Icon name="play" /></button>
                  {composition.tracks.length > 1 && <button className="icon-button" title="Remove track" onClick={() => { update(draft => { draft.tracks.splice(trackIndex, 1) }); setSelected(null) }}><Icon name="close" /></button>}
                </div>
                <div
                  className="midi-grid"
                  style={{ height: view.rows * ROW, width: rollWidth, backgroundSize: `${zoom}px ${ROW}px, ${zoom * timeSig.numerator}px ${ROW}px` }}
                  onMouseDown={event => { if (event.target === event.currentTarget) { setSelected(null); addNote(event, trackIndex, view.high) } }}
                >
                  {track.notes.map((note, noteIndex) => {
                    const active = playing && playhead >= note.startBeat && playhead < note.startBeat + note.durationBeats
                    const isSelected = selected?.track === trackIndex && selected.note === noteIndex
                    return (
                      <div
                        key={`${noteIndex}-${note.pitch}-${note.startBeat}`}
                        className={`midi-note${isSelected ? ' selected' : ''}${active ? ' active' : ''}`}
                        style={{ left: note.startBeat * zoom, width: Math.max(4, note.durationBeats * zoom - 1), top: (view.high - note.pitch) * ROW, height: ROW - 1 }}
                        title={`${track.drums ? midiDrumName(note.pitch) : GM_PROGRAMS[Math.max(0, Math.min(127, track.program ?? 0))]} · beat ${note.startBeat} · velocity ${note.velocity ?? MIDI_DEFAULT_VELOCITY}`}
                        onMouseDown={event => { setSelected({ track: trackIndex, note: noteIndex }); dragNote(event, trackIndex, noteIndex, 'move') }}
                        onContextMenu={event => { event.preventDefault(); removeNote(trackIndex, noteIndex) }}
                      >
                        <span className="midi-note-handle" onMouseDown={event => { setSelected({ track: trackIndex, note: noteIndex }); dragNote(event, trackIndex, noteIndex, 'resize') }} />
                      </div>
                    )
                  })}
                  <div className="midi-playhead" style={{ left: playhead * zoom }} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="midi-selection">
          {selectedNote
            ? <>
                <span>{selectedNote.pitch} · beat {selectedNote.startBeat} · {selectedNote.durationBeats} beats</span>
                <label className="midi-field">Velocity <input type="number" min={1} max={127} value={selectedNote.velocity ?? MIDI_DEFAULT_VELOCITY} onChange={event => { const value = Math.max(1, Math.min(127, Number(event.target.value) || MIDI_DEFAULT_VELOCITY)); if (!selected) return; const { track, note } = selected; update(draft => { draft.tracks[track].notes[note].velocity = value }) }} /></label>
                <button onClick={() => selected && removeNote(selected.track, selected.note)}>Delete note</button>
              </>
            : <span className="midi-hint">Click an empty spot to draw a note; drag to move, drag the right edge to lengthen, right-click or Delete to remove.</span>}
        </div>
      </section>
    </div>
  )
}
