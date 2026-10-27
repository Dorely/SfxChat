# Music and sound-tool roadmap

Accepted 2026-10-27. This is planned direction, not evidence of implemented
behavior; [architecture](architecture.md) and [verification](verification.md)
record what exists. Each phase lands as focused commits with recorded checks.

The user is not a musician, so every tool must be usable by the in-app assistant
and MCP agents through the shared operation registry, with a manual UI path in the
same place a user already looks. Direct game-engine integration stays out of scope;
exports remain engine-neutral.

## Gap summary

Already present: provider generation, MIDI composition, the arrangement workstation
(patterns, clips, seven instrument types, eight effects, buses, sends, sidechain,
automation, stems, seeded variations), trimming, loop crossfade renders, energy
event detection, seam probing, spectrograms and bounded listening clips.

Missing, by origin:

- DAW analysis (Ableton, Mixed In Key): tempo, beat/bar grid, key estimate, loudness.
- Game audio: automatic loop-point search, intro-then-loop delivery with loop
  metadata, family loudness matching, round-robin variants, audio sprites.
- Audacity/Edison: normalize, amplify, reverse, speed/pitch/stretch, DC removal,
  noise/click cleanup, effect chains on library audio, batch macros.
- FL Studio piano roll and Ableton MIDI effects: scale lock, chords and
  progressions, arpeggiator, strum, flam, legato, velocity shaping, note repeat
  with probability, invert/retrograde.
- Sampling (FL Slicex, Ableton Simpler, hardware samplers): capture regions of any
  audio, including provider output, as reusable samples with pitch and loop
  metadata; chop takes into kits; turn samples into playable instruments.
- Sound design: slice a multi-hit take into one-shots, layer builder,
  sfxr-style generators, procedural ambience/engines, creature and sci-fi effects
  (pitch/formant shift, ring modulation, frequency shift, bitcrush), Doppler and
  distance motion, convolution reverb, transient shaper, gate.
- Workstation inputs: microphone recording, hardware MIDI input, VST3/CLAP hosting.

## UI principles

- **One editor for library audio.** The trim dialog becomes an audio editor with
  modes (Trim, Loop, later Process and Slice) over one shared waveform, spectrogram,
  zoom and selection. Modes change the controls below the waveform, not the view.
- **Candidates, not verdicts.** Algorithmic results (loop points, slices, key)
  appear as a ranked, selectable list that also draws on the waveform. Selecting a
  candidate moves the selection; nothing is saved or played automatically.
- **Plain words first, numbers on demand.** Rows lead with a readable summary
  ("16 bars · starts after a 7.5 s intro · seam: close match") and keep exact
  frames and metric breakdowns in a details line or tooltip. Musical terms carry a
  short explanation. Estimates are labeled as estimates.
- **One-shot audition.** Preview buttons render and play once (selection, seam,
  loop twice through). Loop toggles stay user-controlled. Agents may prepare and
  open reviews but never start playback.
- **Same operation, both paths.** Every button calls the operation an agent calls,
  so results, lineage and errors match. Agent results land in the library,
  Playground and reviews the user already uses.
- **Batch from the library.** Multi-asset tools (loudness matching, export presets,
  variants) start from a library selection, show a per-item plan, then run.

## Phases

### 1. Musical analysis foundation

Streaming decode for analysis beyond the 64 MiB editing bound (full-length music);
a shared DSP module (FFT, filters, resampling); onset envelope; tempo and beat grid
with bar/downbeat estimate and confidence; key estimate with confidence; integrated
loudness (ITU-R BS.1770 / EBU R128 gating) and sample peak.

- Agent: `analyze_audio` gains `musical: true`.
- UI: editor header chips (tempo, key, loudness, each marked "estimate" with
  confidence) and an optional bar grid over the waveform.
- Checks: synthetic signals with known tempo/key/loudness, real library tracks.

### 2. Loop-point finder

`find_loop_points` ranks loop candidates for music (bar-aligned, phrase-length
preference, optional intro) and for non-musical ambience (texture and level
continuity, no grid). Each candidate is refined to the sample with phase alignment
and seam metrics, and carries a recommended crossfade. `audio_listen` gains a
`loopSeam` clip (end of loop into its start) so capable models can hear the splice.

- UI: editor Loop mode with options (length range in bars or seconds, allow intro),
  "Find loop points", candidate list drawn as brackets on the waveform, "Play seam",
  crossfade field, "Save loop as new asset" (existing `trim_asset loop:true`).
- Checks: synthetic loops with known periods, previously hand-made library loops,
  long provider tracks beyond the old decode bound.

### 3. Sampling

Any library audio, including provider-generated music, effects and voice, is a
first-class sample source. The engine can already play an asset through sampler,
granular, drum-pad and audio-clip paths by ID with source sample offsets; this
phase adds the sampling workflow around that.

- Capture: save a region of any asset as a sample asset with lineage back to the
  generated original and its prompt, plus sample metadata: detected root pitch
  (estimate with confidence), suggested sustain-loop points from the loop finder,
  peak-normalized trim, and role tags (hit, tonal, texture, phrase, vocal).
- Chop: split a take or generated track at onsets, beats or bars into a sample kit
  mapped to drum pads, or into a phrase set for audio clips.
- Use: create or update an arrangement track from a sample or kit in one operation
  (sampler with root pitch and loop, granular, or pads), so agents can go from
  "generate a texture" to "play it as an instrument" without manual wiring.
- Agent: `sample_capture`, `sample_chop` and a `sample_instrument` arrangement
  helper, all reusing analysis and trimming.
- UI: editor "Sample" mode (region, detected pitch, sustain loop, role) with
  "Save sample" and "Use in Studio"; a chop view with pad assignments; a Studio
  sample browser filtered to sample assets with their source lineage.
- Provider origin is kept visible on every sample; skill code licensing never
  establishes rights to generated media, so provenance travels with the sample.

### 4. Loop delivery

Store loop points on an asset without cutting it (intro-then-loop). Export WAV with
a `smpl` loop and Ogg Vorbis with loop comments; verify conventions against official
format and consuming-tool documentation first. Review cards can loop between points.

- UI: "Keep intro, mark loop" save option in Loop mode; loop markers on cards;
  export dialog shows embedded loop points.

### 5. Processing library audio

`process_asset` renders a derivative with exact lineage: normalize (peak or LUFS
target with a peak ceiling), gain, reverse, DC removal, speed/pitch/time-stretch,
fade curves, and effect chains from the arrangement engine. Batch form for many
assets; family loudness matching.

- UI: editor Process mode as an ordered step list with before/after one-shot
  preview; library multi-select "Match loudness…" and "Process…".

### 6. Sound-effect builders

- Slice to assets: onsets or user markers split a take into tightened one-shots.
- Round-robin variants: bounded pitch, gain, filter and timing variation with seeds.
- Layer builder: transient/body/tail layers aligned on attacks, as an arrangement of
  kind `effect` so it stays editable.
- Export presets (rate, channels, format, naming) and audio sprites with a timing map.
- UI: editor Slice mode with editable markers; variant and layer actions from the
  library; export preset picker.

### 7. Composition helpers

Arrangement pattern transforms: scale/key lock, chord and progression builder from
symbols or roman numerals, arpeggiator, strum, flam, legato, velocity shaping,
note repeat with probability, invert/retrograde. Deterministic and seeded.

- UI: Studio pattern toolbar with a key/scale selector and transform menu that
  previews the change before applying.

### 8. Effects, generators and warp

Chorus/flanger/phaser, bitcrush/downsample, stereo width, gate and trance gate,
transient shaper, ring modulation, frequency shift, pitch/formant shift, convolution
reverb with bundled or imported impulse responses, Doppler and pan/distance sweeps,
tempo-synced modulation. sfxr-style generator presets with mutate; procedural
ambience and RPM-driven engines; warp audio to tempo.

### 9. Live input and plugins

Microphone recording into the library, hardware MIDI input for the Studio, and
VST3/CLAP effect hosting. Each starts with a research spike covering licensing,
process isolation, latency and secure permission prompts.

## Verification

Typecheck, production build, component checks with temporary helpers kept outside
the repository (synthetic signals with known answers plus real library audio), and
browser checks through `npm run dev:browser`. Results go into
[verification](verification.md) with explicit gaps. Measurements never stand in
for listening decisions.
