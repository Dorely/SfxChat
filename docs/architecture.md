# SfxChat architecture

## Runtime and ownership

v0.2 uses Electron, React/TypeScript, electron-vite, and electron-builder with a
Windows x64 NSIS target and Linux x64 AppImage and .deb targets. Exact versions live in
the lockfile. This document describes implementation; [verification](verification.md)
records actual checks. [VISION](../VISION.md) remains product intent.

## Distribution

Each platform packages only for itself: `npm run package` builds the native helper,
pinned runtime, and the current platform's targets in `release/`. The profile is
Electron's `appData`/SfxChat (`%APPDATA%` on Windows, `$XDG_CONFIG_HOME` or `~/.config`
on Linux); `src/shared/platform.ts` gives the CLI the same location and executable
names. On Linux the desktop executable is `SfxChat`; the .deb installs it under
`/opt/SfxChat`, links `/usr/bin/sfxchat` to the agent CLI as the Windows installer adds
the agent directory to the user PATH, and keeps electron-builder's Chromium sandbox and
AppArmor handling. An AppImage mounts at a new temporary path on each launch, so agent
integration installation refuses there and points users to the .deb. The Linux helper
statically links the C++ runtime and builds FluidSynth without OpenMP, so it needs only
glibc; CI builds on Ubuntu 22.04 to keep that floor at glibc 2.35.

The [Build and release](../.github/workflows/release.yml) workflow type-checks and
packages both platforms on every push and pull request. On a push to `main` whose
`package.json` version has no GitHub release, it publishes `v<version>` with the
installer, AppImage, and .deb once both builds pass. Packages are unsigned and there is
no auto-update; a published version is never rebuilt or replaced.

The main process owns persistence, media, providers, credentials, jobs, and turns.
React owns presentation, selection, forms, and audition controls. The sandboxed,
isolated preload exposes fixed typed operations. Every IPC call validates arguments
and verifies the requesting main frame. The renderer has no Node integration or
general filesystem/shell tool. The shared operation registry owns external schemas/descriptions and delegates to
`WorkbenchService`, `Store`, media, review playback and export owners. UI and internal
assistant adapters use these owners too; provider transports remain behind service ports.

`npm run dev:browser` runs the built renderer over a loopback development host,
while the same Electron main process owns the real profile, secure storage,
providers, background jobs, and local agent bridge. It creates no desktop
window. A shared fixed API factory binds either validated IPC or JSON HTTP calls;
browser responses restore bounded audio byte arrays, SSE delivers changes and
acknowledged UI commands, and the existing scoped media handler serves originals.
The UI identifies browser mode explicitly. Native file pickers become host-path
dialogs that call the same import/export operations. There are no mock services,
fixtures, separate test libraries, or browser credential stores.

The host is unavailable in packaged builds. It binds a random port on `127.0.0.1`,
checks the exact Host header, requires the exact Origin and JSON POST for privileged
calls and shutdown, and requires same-origin fetch metadata for SSE/media. It grants
no CORS access, denies framing, limits RPC input to 2 MiB, and restricts static files
to the built renderer. It is a local development transport, not a remote service.
Use one browser tab because active project and playback state belong to one owning
UI. Closing the last event stream clears UI readiness and playback reports; Ctrl+C
requests normal app shutdown so jobs follow the existing shutdown/recovery rules.
Source changes require rebuilding and reloading; this mode does not provide HMR.
A lost event stream stops playback and displays a disconnected-host notice.

The shell is constrained to the window height. Conversation history and workspace
content scroll inside their panels, keeping the chat composer and headers visible.
Chat follows streamed output while the reader is at the bottom. Scrolling up pauses
following; returning to the bottom, sending a message, or selecting a conversation
returns to the latest content. This follow state belongs only to the renderer.

The chat panel appears only when chat is configured: Codex is connected or a custom
model is saved (custom models save only after a live test). Without either, the panel
is hidden and the top-bar chat button opens Settings. Otherwise that button hides or
shows the panel, and the choice is a renderer-local preference in browser storage, like
the theme, so the desktop window and the browser development host keep separate values.
A hidden panel stays mounted so composer drafts survive, skips context estimates, and
returns to the latest content when shown. While it is hidden, the top bar carries a
session switcher for selecting, creating, renaming, and deleting sessions.

The fixed `chatContext` IPC operation estimates selected-conversation context in
the main process using bundled `js-tiktoken`/`o200k_base`. It shares the turn's
instruction builder and uses repaired persisted history or active in-memory
history, plus streamed text and the trimmed composer draft. Display-only activity
and errors do not inflate the count. Media parts in history are stripped before
tokenization and replaced by documented estimates (PNG pixels/750, WAV duration ×
32 tokens per second, flat 1000 fallback) flagged by `includesEstimatedMedia`.
The renderer throttles updates and rejects
stale responses. Model metadata supplies default Codex context sizes; unknown
models show an unknown limit. The approximate meter is advisory, with encrypted
reasoning omitted and flagged. See [evidence and limits](research/chat-context.md).

## Persistence and originals

SQLite uses WAL, foreign keys, transactional migrations, and FTS5 search. Schema v5
stores conversations, messages, assets, jobs, Playground ordering, settings/wire
history, turn state, and a tool-call ledger. Newer schema versions are rejected.

Schema v2 adds projects: every conversation and asset carries a project_id column, and one
setting (project-active) names the active project. A library written before projects is
migrated in one transaction into a single Default project. project_id deliberately carries no
REFERENCES clause, because SQLite cannot add a NOT NULL foreign key to an existing table when
foreign keys are enabled. Project deletion explicitly removes dependent records transactionally. The snapshot the renderer
receives is the active project's slice, and every asset lookup carries an explicit project
scope - the conversation's project when the call has one, otherwise the active project - so
an id from another project fails exactly like a missing one, including on the empty-query
search path. Provider configuration, credentials, and the flat originals/<asset-id> store
stay app-level and shared across projects.
Search covers names, descriptions, tags, collections, prompts, reviews, and feedback.

Assets and jobs carry `kind` (`effect`, `music`, or `voice`). Records written before music
existed have no field and are read as sound effects; no migration was required. All three
kinds share the immutable `originals/<asset-id>.<format>` store: kind is metadata, so
integrity checks, trimming, export, and the media protocol keep one code path. Music tracks and voice
clips also retain `providerPrompt` when the app appended provider-specific guidance to
the submitted text, and `lyrics` when the provider returned lyrics or structure text.

Original files live at `originals/<asset-id>.<format>`. Unique temporary writes are
renamed before database registration. Provenance includes SHA-256, bytes, probed
duration, exact prompt/settings, request ID/usage when returned, and revision parent.
Invalid returned audio remains preserved but fails its job. A crash between file
write and database commit can leave an unreferenced original; startup does not delete
it or regenerate. Imports validate WAV/MP3/Ogg Vorbis/MIDI before copying. Ogg Vorbis
originals decode through the bundled helper (`decode`, libvorbisfile, to 32-bit float
WAV within the editing bounds), so they edit, analyze and convert like other audio.
Import reads a file's own loop (the first WAV `smpl` loop, or Ogg `LOOPSTART` with
`LOOPLENGTH`/`LOOPEND` sample tags) into the asset's `loopPoint`. An import entry may
carry a name, tags and description; otherwise the asset takes the file's title tag, then
its filename. When a generation's returned length misses its requested length (effect
`duration`, music `durationMs`) by more than 0.5 s, the asset records `lengthCheck` and
the completed job a `note`. Export verifies hashes and refuses existing destinations
unless `overwrite` is set. Playback gain never changes files.

The `sfx-media://asset/<uuid>` protocol resolves only known assets and supports byte
ranges. The UI never supplies arbitrary local paths for media access.

Chat attachment media lives at `chat-media/<attachment-id>.<png|wav>`, written with
the same unique-temp rename and referenced by `ChatAttachment` metadata on the tool
activity message. The `sfx-media://chat/<message-id>/<attachment-id>` form serves
it, resolving only attachments recorded on a message in the active project and
supporting byte ranges. A crash between file write and message insert leaves an
unreferenced attachment file that startup does not delete. Transcript attachments
deliberately outlive model-context eviction: history eviction bounds what the
model resends, while the chat record keeps every attached image and clip the user
may want to inspect.

## Local trimming and audio evidence

`WorkbenchService.analyzeAudio`, `previewTrim`, and `trimAsset` own audio editing;
validated IPC and assistant `analyze_audio`/`trim_asset` tools use those operations.
The renderer owns selection, zoom, draft fades, and exclusive audition state.
Analysis, rendered previews, and final trims use the same decoded PCM timeline.
There is no provider invocation for editing and no new credential requirement.
The trim editor's Play selection button renders and starts the selected interval
in one action, including its fades. It can stop playback and replay from the in point.
Selection/fade changes invalidate the preview; unchanged previews can be replayed
without re-rendering. Playback uses the workbench's exclusive player state.

`MediaLibrary` serializes audio operations, verifies source SHA-256 on every request,
and caches at most one decoded asset. `audio.ts` decodes MP3 with pinned
`mpg123-decoder` (gapless enabled), or RIFF PCM 8/16/24/32-bit and IEEE float
32/64-bit WAV locally. Decode errors fail rather than permit edits across gaps.
Source bytes are bounded to 64 MiB and decoded float samples to 192 MiB (about
nine minutes of 44.1 kHz stereo, covering full provider tracks); processing yields
between blocks. Shutdown waits for pending edits and analysis; edits cannot commit
after the service closes. Original import/export support is independent of these
editing bounds and encoding restrictions.
If shutdown or a transaction failure races a completed trim file write, the operation
removes its own unregistered derivative; a hard crash can still leave an orphan.

Analysis returns versioned absolute second/frame intervals, sample rate, channels,
decoded duration, source hash, and 1–512 min/max/peak/RMS bins (96 default). Smaller
requested windows measure the samples again at finer resolution. Amplitudes are
linear full-scale values without normalization; extrema span all channels and RMS
counts each channel independently, avoiding cancellation from downmixing. An `envelope`
summary from 5 ms RMS windows gives the loudest window and, relative to it, the first
times within 60/40/20 dB (onset) and the times after which the level stays more than
20/40/60 dB below (decay; null while still above at the interval end). No event
labels, perceptual-silence claims, or hearing are inferred. The assistant is instructed
to inspect an overview, zoom near boundaries, and ask for timing hints if semantic
identity is needed. See the [research note](research/agentic-audio-editing.md).

Two optional analysis probes extend this. `events:true` runs energy-based
detection (5 ms RMS envelope; adaptive threshold at the 20th-percentile noise
floor +12 dB with a −60 dBFS floor; 30 ms minimum event, 50 ms minimum gap) and
returns up to 64 candidate intervals with exact frames, peak, and RMS — candidate
cut regions, never identified sounds. `seamProbe` measures how a candidate
loop's end wraps to its start: the single-sample splice step, 50 ms head/tail
RMS, Pearson correlation between the last and first window, zero-crossing
distances, and `suggestedOffsetFrames`, which slides both endpoints (length
preserved) within ±50 ms and is only reported when it improves correlation by
at least 0.1, so phase noise never nudges an aligned loop.

Trims retain a half-open interval `[startFrame,endFrame)` after rounding seconds to
nearest frames. Optional linear fade lengths round to frames and cannot overlap.
The shared renderer writes float32 WAV with a fact chunk. A preview returns its
bytes through fixed IPC without registering an asset. Saving retains a new file,
then atomically registers the derivative, current Playground membership, activity,
and (for tools) durable result. Replayed tool IDs do not create another derivative.
New assets have `source: edited`, unreviewed status, parent ID, source hash, requested
parameters, actual sample/fade frames, decoder version, and output encoding. Original
generation records remain on the parent; the original prompt is retained for search.
Older JSON asset records without `edit` remain readable without a schema migration.
Float32 conversion can reduce precision of imported 32-bit integer/64-bit float WAV;
MP3 always requires decoding. Originals remain byte-identical for export.

`trim_asset` also renders loop outputs. `loop: true` keeps the selection's exact
length, so the loop period equals the source spacing between `start` and `end`. The
seam crossfade (`crossfadeMs`, 0–5000 ms) blends the loop's last frames into the
source frames just before `start` (`crossfadeSource: 'before-start'`); a loop that
starts closer to the file start than the crossfade instead fades its first frames in
from the frames just after `end` (`'after-end'`). Either way the wrap lands on
consecutive source frames. `crossfadeShape` picks the blend curve: `linear` (the
default; gains sum to one, right for correlated material such as repeating bars) or
`equal-power` (sine/cosine, so uncorrelated noise or ambience does not dip mid-blend).
find_loop_points recommends linear for music and equal-power for texture. Optional
`levelMatchDb` (±12 dB, usually a candidate's `seam.levelDeltaDb`) ramps the loop body
from 0 dB at its start to minus that at its end, so a loop whose end is louder does
not jump in level at the wrap; blend material after the end takes the end gain.
`levelMatchSeconds` confines the ramp to the loop's last seconds (0 dB before), for an
end that winds down rather than one that is uniformly off.
`loopCrossfadeSource`/`loopBlend`/`loopSample` in `audio.ts` define this once for the
render and the seam preview (`renderSeam`). Fades are rejected with a loop. `TrimEdit`
version 2 records `crossfadeFrames`, `crossfadeSource`, `crossfadeShape`,
`levelMatchDb`, `levelMatchFrames` (when the ramp is confined), `outputFrames` and the loop region; version 1 loop records describe the superseded
render that dropped the crossfade length (shortening the period by it). The interval
fields keep naming the source selection, and records without `loop` stay readable.

`introStartSeconds` (loop only, between 0 and `start`) also keeps the source from
there up to `start` as an intro that plays once: the output is `[introStart, end)`
with the loop region `[start − introStart, outputFrames)`. Every loop render embeds
that region as a RIFF `smpl` chunk with one forward loop whose `dwEnd` is exclusive,
which is how Godot's WAV importer reads it (Loop Mode "Detect From WAV", the
default); spec-literal tools that treat `dwEnd` as inclusive play one extra frame per
pass. `loopRegion` (media) reads the region from the edit record (version 1 loops
repeat the whole file), PCM16 WAV exports carry the chunk too, and export manifests
add `loop` with the frames, intro seconds and Godot guidance. Ogg Vorbis exports
carry no loop metadata Godot reads, so the manifest gives the Loop Offset to set in
Godot's Import dock.

An asset `loopPoint` (seconds; null end means the file end; `source` file or user)
marks where an existing file repeats without re-rendering it, such as an imported
in-game track's loop offset. `update_asset` sets or clears it (validated against the
duration, refused for MIDI); it wins over a loop render's region for playback and for
the PCM16 WAV `smpl` chunk and export manifest. Original-format export embeds no new
metadata, so the manifest gives the seconds and Godot Loop Offset; an original WAV
keeps its own smpl chunk only while the loop point is still the one read from it.

### Musical analysis and loop finding

`dsp.ts` holds the shared FFT, Hann window, RBJ biquads, BS.1770 K-weighting and a
`FrameSource` abstraction: WAV assets stream bounded ranges through `WavReader` at any
length, other formats use the cached whole-file decode. `music-analysis.ts` computes
whole-file features once per source hash (the last four are cached) from a mono
22.05 kHz analysis signal on a 2048/512 STFT grid, up to 900 s: spectral-flux onset
envelope, chroma (150 Hz–5 kHz), 24 log band energies and per-frame level. From these
it estimates tempo (normalized onset autocorrelation over 50–220 BPM with a log-normal
prior around 120 BPM), a beat grid (Ellis 2007 dynamic programming), a bar phase
(4 beats per bar assumed; the phase with the most low-band onsets and harmonic change),
key (Krumhansl–Kessler profile correlation on mean chroma) and integrated loudness
(BS.1770 K-weighting with absolute/relative gating) plus sample peak. Each estimate
carries a confidence. Tempo may read at half, double or two-thirds of the felt tempo;
Key scoring covers the 24 major/minor keys; the summary adds the estimate's scale, the
seven modes sharing its notes (`sameNotes`) and each pitch class's relative strength.
`tempoHint` (analysis and loop search) recenters the prior narrowly (0.15 octave) on
an expected BPM, so it picks among the envelope's own periodicity peaks without
setting the exact value, and features are cached per hash and hint. `keyHint`
(a key or church mode) reports how its scale fits the pitch-class strengths: its share
of chroma beside the estimate's, weak scale notes, strong notes outside it, and for
major/minor its correlation and rank among the 24 keys. `analyze_audio`
with `musical:true` adds this summary, with beat and bar lists bounded to the
requested interval. None of it is listening evidence.

`find_loop_points` (`loop-finder.ts`) ranks loop candidates by comparing the context
around the jump (the end) with the context around the start. Music mode, chosen
automatically when tempo confidence is at least 0.3 with 16+ beats, uses beat-synchronous
units (chroma, band energies, level) over a one-to-two-bar context. It proposes
whole-bar loops starting on downbeats when the downbeat is known, with a small
preference for 4/8/16/32 bars (`barMultiple` restricts lengths to multiples of N
bars). Because a misread tempo or drifting beat grid can hide a real repeat, music
mode also compares the track with itself on 100 ms units with chroma (coarse 0.5 s
steps, then single-unit refinement) and keeps the best grid-free seeds alongside the
grid seeds. Each music length is then re-measured as the source's repeat spacing:
the lag within ±0.6 beat whose onset envelope, over ±2 bars around the start, best
correlates with the envelope one loop length later (quarter-frame steps; kept only
when it beats the seed length by 0.03 and reaches 0.2). `lengthSeconds` instead sets a
target: every seed uses it, and the same spacing search within ±0.25 beat plus the
end alignment fine-tune it (`requested-tuned`); `exactLength` keeps it to the sample,
so alignment only slides both points together. `prefer: "late"` steers which coarse
pairs survive toward later ends (up to +0.3 score by position in the region) and then
ranks candidates whose repeat is not weak and seam not rough first, by rank value plus
0.5 times the end's position. Texture mode uses 100 ms units smoothed over ±3 units, with no grid. Both
penalize seams inside fades, suppress near-duplicate candidates, and then refine each
survivor to the sample. The end is aligned to the start by waveform correlation
(±30 ms music, ±60 ms texture; skipped for an exact requested length), then both points
slide together by up to 1 ms to minimize the wrap step. Each candidate reports exact
final frames, `lengthSource` (`beat-grid`, `repeat-spacing`, `requested`,
`requested-tuned`, `texture-units`), the grid length, `rhythmCorrelation`, the implied tempo for whole
bars, start/end shifts already applied, a similarity score, a `close`/`partial`/
`weak` repeat label (`match`: context similarity, or rhythm and harmony agreement one
loop length later; texture similarity for textures), a separate `smooth`/`fair`/`rough`
`seamMatch` (seam correlation for music, the level step for textures), seam correlation, wrap step vs the source's natural step, a
like-for-like level delta with its `levelTrend` (walking back from the end in 0.5 s
blocks while the level stays nearer the end's than the start's: up to 1.5 s is a
`step`, a span under 30% of the loop a `wind-down`, otherwise `gradual`), a recommended
level match (the delta, ramped over twice the wind-down span or the whole loop; none
under 1 dB), and a recommended crossfade (5–60 ms music, 50–500 ms
texture, at most a quarter of the loop). Texture crossfades also stay within half
the median gap between sharp attacks (still-rising jumps of 4 dB or more) in the two
seconds before the start and end, so a long blend never doubles separate hits. Music ranking weighs context similarity,
rhythm agreement and seam correlation, plus a phrase prior: whole bar counts that are
multiples of 8 (+0.04) or 4 (+0.03) rank above other even counts, and odd or
fractional counts lose 0.03 (a repeat-spacing length counts its nearest whole bar). Labels and ranking are heuristics for choosing
what to audition.

The seam preview (`audio_listen` with `loopSeam`, and the editor's Play seam) renders
the last `contextSeconds` of the loop, the crossfaded wrap, and its opening exactly as
a `trim_asset loop:true` render would play it. The UI receives float32 WAV bytes
through fixed IPC. The assistant receives a bounded mono 16-bit clip with the seam's
position. `loopSeam` cannot be combined with start/end.

Sources: ITU-R BS.1770-4; D. Ellis, "Beat Tracking by Dynamic Programming" (2007);
Krumhansl & Kessler (1982) key profiles; R. Bristow-Johnson, Audio EQ Cookbook.

## Multimodal assistant context

Two capability-gated tools let the model use sight and sound on library assets when
the active chat model supports them. `spectrogram_view` renders a spectrogram PNG
and attaches it; `audio_listen` attaches a bounded audio clip. `TOOL_CAPABILITIES`
maps them to `vision` and `audio`, `toolsForModel` withholds them when the saved
flag is `false`, and `capabilityNote` amends the instructions, so degradation is
mechanical as well as epistemic.

Images are rendered in the main process by self-authored code with no new
dependencies: `png.ts` is a minimal 8-bit RGB encoder over Node's zlib, and
`spectrogram.ts` is an iterative radix-2 FFT with a Hann window (2048 samples
default, halving down to 256 for short intervals), one-sided magnitudes
normalized to full-scale-sine dB with an −80 dB floor, and a 256-entry
perceptual colormap over a faint tenth-of-width time grid. Width (256–1024,
default 768) and height (128–512, default 384) are bounded; log frequency
(default) or linear rows map to exact frequency edges, and the tool result
returns that mapping instead of drawing text into pixels. PNGs are transient:
regenerated per request on the serialized decode queue, never written to disk,
and shared by the tool and the renderer's trim-editor spectrogram panel (the
fixed `spectrogram` IPC operation returns the same bytes the model sees).

Clips are mono-downmixed 16-bit PCM WAV at the source sample rate, at most 30
seconds and about 3 MiB; `renderClip` fails with a suggested shorter window
rather than exceeding the bound.

Attached media enters model history as a labeled user item pushed immediately
after the tool's `function_call_output`: a text part naming the tool call and
asset, then the `input_image` data URL or `input_audio` WAV. The tool ledger
stores only the lean JSON result (attachment id, dimensions/duration, mapping,
note), never bytes. Responses and Codex transports pass the parts through
verbatim; Chat Completions maps them to `image_url`/`input_audio` content parts;
Anthropic maps images to base64 `image` blocks and replaces audio with an
explicit "this provider accepts no audio input" marker, because the Messages API
has no audio input. Persisted history keeps only the newest 8 images and 3 audio
clips; older parts become a marker text telling the model to re-attach, bounding
both the settings table and per-turn resend cost. The runtime instructions frame
the three evidence channels: measurements are exact but non-semantic, the image
is a secondary view whose pixels never set cut points, and attached audio is
listening at the provider model's fidelity — observations, with the user's
audition remaining the authority.

Capability probes now test what they claim: the responses-kind audio probe sends
a real `input_audio` part (it previously sent text only and could report false
positives), and the Anthropic kind records `audio: false` deterministically
instead of probing an input the Messages API does not have. Whether the hosted
Codex backend and configured generic providers accept media parts in live traffic
is a verification item, not an assumption.

Every attachment is also recorded for the user. The tool activity message carries
a `ChatAttachment` (id, kind, label, media type, size, interval) and the
transcript renders it as a card — spectrogram image or playable clip with its
label — under the activity text. Snapshots carry attachment metadata only; bytes
stream lazily from `sfx-media://chat/...` with byte ranges, so seeking works and
message payloads stay light.

## Jobs and turns

Each candidate is a durable job persisted before sequential dispatch. Requests run
without extra spending approvals or app-imposed count limits. Cancelling queued work
prevents dispatch. Cancellation after dispatch or interrupted transport means an
uncertain outcome; no billed request is silently retried. A fully received result
is retained even if cancellation races it.

Large explicit requests are admitted in transactions of up to 128 jobs, yielding
between transactions to keep shutdown responsive. This is not a candidate limit.
If the app closes during preparation, only candidates already queued are retained;
the activity message explains this before admission begins.

Chat runs outside renderer lifetimes and persists streamed messages/activity.
Runtime instructions and tool field descriptions provide sound-design guidance,
[reviewed ElevenLabs prompting practices](knowledge/elevenlabs.md), and
[reviewed music prompting practices](knowledge/elevenlabs-music.md). Per turn,
`chatInstructions` appends the configured music providers with their exact IDs, the
active choice, and each configured provider-kind block (`musicInstructions` in `assistant.ts`),
and voiceInstructions appends both voice rosters/defaults and canonical provider references.
The model sees provider-accurate limits and prompting advice and copies a real
provider ID rather than one it guesses. Provider generation receives no parent audio
or chat history; `parentId` is local lineage only. These app adapters expose no
continuation/editing of an earlier generation. Manual
regeneration uses an editable Generation prompt, prefilled from the original, separately
from review feedback, and reuses requested duration rather than measured file duration.
Canonical packaged references under `resources/skill/references` are embedded by the
build and composed into assistant instructions. The installed skill receives the
same text, with harness-specific instructions in its concise SKILL.md.

Per turn, chatInstructions also states the current project, the current session title, and
who set it, together with the rule that only this project's conversations and library are
visible. The assistant keeps labels current through a rename_session tool: it names a session
once the goal is clear, renames it when the subject materially changes, and leaves a title
the user chose alone unless the work has moved on. A user rename records titleSource "user"
and always wins over the automatic first-message title; creating and switching projects are
user actions with no assistant tool.
The generation tools wait for results so the assistant can organize returned assets.
Their initial job IDs are recorded atomically with creation. Duplicate tool calls
return durable results; conflicting IDs are rejected. Stopping a turn stops its wait;
jobs have separate cancellation controls.

Codex merges streamed output items with terminal output by item/call identity;
an empty or partial terminal output never erases observed messages or calls.
Before a new turn, older orphaned function-call outputs are paired with calls from
the same conversation's completed tool ledger. The repaired history is persisted;
this repair performs no tool execution or generation. Missing or inconsistent
ledger records fail locally with a diagnostic instead of sending invalid history.

On restart, running jobs become uncertain, running messages become interrupted,
and undispatched jobs remain eligible. Interrupted tools are not re-executed.
Closing the app aborts active work and closes the database after shutdown. There is
no installed background service or tray process.

## MIDI composition and SoundFont playback

MIDI is the app's symbolic artifact form: notes rather than audio bytes. `AssetKind` gains `midi`
and `Asset.format` gains `mid`; the kind rides the existing JSON-blob records, FTS text, jobs,
playground, and export paths with no schema migration. `src/shared/midi.ts` owns the model in
quarter-note beats, its bounds, the General MIDI instrument and drum names, and the duration and
summary helpers. `src/main/midi.ts` writes format-1 Standard MIDI Files and parses format-0/1 files
back to beats, rejecting malformed input, SMPTE division, format 2, and clips beyond the editor's
bounds; duration is computed from the note timeline because `music-metadata` cannot probe an SMF.

`compose_midi` is a normal operation and assistant tool that runs locally: the service writes the
SMF in process, so there is no provider, credential, or network call, while keeping the same
durable job, request-id idempotency, playground, and tool-ledger behaviour as other generation. The
chat model is the composer; a revision resends a whole composition with `parentId`.

Playback is FluidSynth rendering the clip through the bundled GeneralUser GS bank in the native
helper (`render-midi`), cached on disk under `midi-renders/` and keyed by clip bytes, bank hash, and
render settings, then served as WAV from `sfx-media://asset/<id>` so existing cards and review
playback work unchanged. MIDI cards draw a note roll from `midiNotes` (pitched notes above a drum
strip) instead of a decoded waveform. Output is bounded by a caller-supplied musical length plus a
two-second decay tail, so a render is exactly as long as the model says.
`src/main/soundfont.ts` resolves the bank (bundled, or a user path from Settings) and enumerates its
presets for the instrument picker. Every audio a MIDI clip produces — card playback, listening,
previews, exports — comes from this one render path.

Symbolic clips stay off the audio path: `MediaLibrary.withAudio` rejects `mid` assets, so analysis,
trimming, and clip rendering refuse them with a clear message instead of decoding garbage, and the
trim editor steps aside for MIDI in the inspector. `audio_listen` is the exception and renders the
clip for a model with audio intake. Composing knowledge ships as the MIDI instruction block plus
three skill references (`music-craft.md`, `midi-instruments.md`, `midi-workflow.md`);
[research/music-composition.md](research/music-composition.md) records sources and limits, and
[research/midi.md](research/midi.md) records the engine, bank, and build provenance.

The MIDI studio (`MidiStudio.tsx`) is the MIDI tab: a searchable clip rail (a strip on narrow
workspaces) beside an arrangement of track lanes that share one ruler and horizontal scroll. Each
lane has a sticky header (name, instrument from the loaded bank or the drum kit, audition, remove)
and a clickable key gutter (drum lanes always list the full General MIDI kit, 35-81, and mark
keys outside it), and supports draw/move/resize/erase plus keyboard nudging and a
selected-note velocity control. Tempo, meter, snap and zoom sit in the transport, which renders the
draft and sweeps a playhead while highlighting the notes it passes; unsaved drafts prompt before
being replaced. Saving writes a derivative with `midiEdit` lineage for an existing
clip, or an `authored` clip for a new draft; composed originals are never modified.

## Providers and credentials

Codex directly adapts Lorekeeper/PixelChat OAuth PKCE and Responses SSE, with no CLI.
The adapter owns account headers/claims, message/tool events, refresh rotation, and
safe errors, and now sends the selected effort as `reasoning.effort` (PixelChat
precedent). A temporary localhost 1455 callback validates state and expiry.
Account and model access require real integration verification.

Generic chat providers implement the same `ServicePorts.chat` contract through
three adapters in `src/main/providers/generic/`: Chat Completions
(`chat.ts`, SSE `choices` deltas), generic Responses without Codex-only headers
(`responses.ts`), and Anthropic Messages (`anthropic.ts`, content-block SSE,
`tool_use`/`tool_result` translation, saved per-model `maxTokens` with an 8192
floor). `ChatRegistry` (`src/main/chat-registry.ts`) owns the provider/model
registry in SQLite settings, combined `Provider:Model` selection with per-model
effort lists, test-gated model saves (every listed effort must pass a lightweight
live probe), and vision/audio capability flags that filter future
vision/audio tools via `toolsForModel`. Stored conversation history stays
Responses-shaped; adapters convert in memory per turn. The renderer's model and effort picker
sits in the chat composer footer and calls the same `setActiveChat` operation; Settings → Chat
models lists, adds, tests, and removes custom models and endpoints.

`SecureStore` encrypts values with Electron `safeStorage` before atomic writes under
the profile's `secrets/`. Windows protection is OS-backed (DPAPI). Linux requires a
Secret Service keyring (GNOME Keyring, KWallet); Electron's `basic_text` fallback counts
as unavailable. Unavailable encryption fails explicitly. Plaintext credentials do not enter SQLite, settings reads, tools,
or diagnostics. Key entry is transient. Sibling-app auth caches are never imported.

ElevenLabs resolves its key at dispatch and preserves the SFX HTTP response as MP3.
HTTP status failures and uncertain transport outcomes are distinct. Production
provider requests have a three-minute timeout.

`ProviderKeys` owns one OS-encrypted key for each vendor (`elevenlabs`, `gemini`).
All ElevenLabs effects/music/voice dispatches share its key. Gemini music/voice and
direct chat at the official HTTPS host share its key; other generic chat hosts retain
their own credentials. Neither renderer reads nor assistant/CLI/MCP arguments receive
stored secrets. Key entry exists only at the vendor level. Equal legacy `music-key-*`
and direct Gemini `chat-key-*` values consolidate automatically. Different values block
vendor readiness and retain encrypted originals until Settings explicitly selects a
source or replaces the shared key. Authoritative ciphertext is written before legacy
copies are deleted. Deleting a model/target never deletes the shared vendor key.

`MusicRegistry` stores model target metadata separately from credentials. One music
entry is active and requests may target another by its exact ID. ElevenLabs entries
default to `"latest"`; entries report `resolvedModel` for display. `VoiceRegistry` stores
one model/default-voice selection per vendor plus the active voice vendor. These are
independent of shared credential selection. Music and voice requests have ten-minute
transport timeouts; effects retain three minutes. Discovery has a 30-second timeout.

`providers/voice.ts` dispatches single-speaker TTS. Selectable ElevenLabs speech models use
`/v1/text-to-speech/{voiceId}` and retain original MP3; Gemini 3.8 Flash/Flash-Lite use
Interactions with `store:false`, one voice, separate style metadata, and original unary
WAV. Shared validation rejects unavailable models, controls, SSML on v4/v3, and oversize
scripts before admission. Voice request JSON preserves original untrimmed `text`,
optional prepared `providerText`, model/voice, controls, count/name, and revision parent.
Resolved model and voice are frozen at admission; optional controls retain omission
when provider defaults are intended. Keys resolve inside privileged discovery, admission
validation, and dispatch. No fallback,
automatic splitting, or retries occur. Usage/request IDs are retained when returned.
`list_voices` discovers existing account/region voices; Gemini also has 30 bundled
standard choices. Voice design, cloning, dictionaries, dialogue, and live chat are absent.

`list_voice_models` uses the same provider owner for UI, assistant, CLI, and MCP.
ElevenLabs `GET /v1/models` is authenticated with the app's shared key, read with a
4 MiB bound and 30-second deadline, and filtered to `can_do_text_to_speech:true`.
An in-memory five-minute cache is scoped by a credential fingerprint; `refresh:true`
bypasses it. Responses carry source/time, saved model/voice defaults, language coverage,
alpha-access flags, prompting status, selectable status, controls and character bounds.
Discovery has no paid synthesis and does not change defaults. Failures surface explicitly;
there is no static fallback masquerading as current availability. Gemini returns its
reviewed built-in catalog, labeled as such. Music/SFX use separate discovery (below)
because this roster describes TTS only.

### ElevenLabs latest-model defaults

ElevenLabs effects, music and voice default to the sentinel model `"latest"`
(`shared/elevenlabs-models.ts`); an exact ID is a deliberate pin and is never upgraded or
substituted. Recency comes from the model ID's version suffix (`_v4`, `_v2_5`); equal
versions prefer the base family. Deprecated, unselectable (realtime), and alpha-only
models are not eligible.

- Voice: `latestVoiceModel` picks from the live `/v1/models` catalog (reviewed profiles
  before discovery). `"latest"` resolves at admission because controls and limits are
  model-specific, so the queued job records the exact model. `list_voice_models` returns
  `latestModel` and `defaultFollowsLatest`; Settings shows a Latest option.
- Effects and music: ElevenLabs has no model-list endpoint, so
  `providers/elevenlabs-models.ts` reads the `model_id` enum of `/v1/sound-generation` and
  `/v1/music` (with `x-fern-enum` deprecation) from the public, unauthenticated
  `https://api.elevenlabs.io/openapi.json`. Reads are bounded to 16 MiB and 30 seconds,
  cached six hours, retried after five minutes on failure, and keep the last good list; a
  first-run failure shows the reviewed IDs labeled `source:"built-in"`. `list_audio_models`
  serves UI, assistant, CLI and MCP. Effects accept an optional per-request `model`; music
  provider entries save `"latest"` by default and requests may pin `model` for one
  generation. Pinned IDs are checked against the catalog at admission.
- Automatic effect/music requests resolve at dispatch. A definite 400/403/404/422 refusal
  of the model itself (for example SFX v3's account/region limit) marks that model
  refused for the key fingerprint for this run and tries the next newest, at most three
  models; such refusals generate and bill nothing. Pinned requests never fall back. The
  asset's provenance records the model actually used, and diagnostics record each refusal.

`shared/voice-models.ts` owns reviewed prompting/control profiles rather than ElevenLabs
availability. v4, v3, Multilingual v2, Flash v2/v2.5 and deprecated Turbo have distinct
guidance. Realtime v4 Turbo/v3 Conversational require the unimplemented Text to Dialogue
WebSocket and are unselectable. Unknown TTS IDs use plain text with no numeric controls
or markup claims and a conservative 10,000-character bound. A smaller live character
limit always wins; deprecated free/subscriber limit fields are ignored. Model metadata
is provider data, not an instruction source. Admission and dispatch check the catalog
and shared controls before synthesis; an absent saved model fails without replacement.
Settings, Playground and inspector share the refreshing picker. Model switches remove
incompatible numeric controls but leave the prepared script for deliberate editing.
The canonical skill reference provides the fuller model-specific workflows and MCP
selection example; `generate_voice.input.model` overrides one request only.
Reviewed defaults can still be saved before configuring credentials; newly discovered
ElevenLabs defaults require authenticated discovery. Generation checks the live-backed
catalog (including its bounded cache) before admission.

The Voice Library, Playground Voice mode, and inspector use existing scoped jobs,
originals, playback, trimming, reviews, search, and exports. Transcript is indexed as
asset prompt; prepared script is stored separately. Trims preserve kind and point to
the immutable generation parent. The inspector exposes editable voice regeneration
controls without modifying original provenance. The same `generate_voice` and
`list_voices` and `list_voice_models` operations serve UI, assistant, CLI, and MCP.

Two adapters sit behind `ServicePorts.generateMusic`. `providers/elevenlabs-music.ts`
posts to `/v1/music` with `output_format=auto`, maps app fields to `prompt`,
`music_length_ms`, and `force_instrumental`, and records the `song-id` response header.
`providers/gemini-music.ts` posts to the Interactions endpoint with `store:false`,
composes the prompt from the app fields that Lyria has no parameters for (instrumental
and target length), rejects a custom length on the fixed 30-second clip model, and
parses `steps[]` for the audio block plus any returned lyrics. Provider errors keep the
provider's own message, code, and any suggested prompt rewrite. Both adapters record
the provider label and model on the asset, and neither retries a failed or uncertain
generation.

## Local agent interfaces

`src/main/operations.ts` defines validated operations with discoverable JSON schemas,
descriptions, and handlers. CLI and MCP call the same registry over one authenticated
local endpoint: a Windows named pipe or a Linux Unix socket. The desktop remains the only database/provider-credential owner.
External requests provide the project/session IDs their schemas require; project-scoped
review open selects its project and an available conversation in the UI without playback. Ordinary external operations never consult the visible
project. The original fixed IPC remains an adapter for dialogs and UI actions, while
`operation` accepts only registry names and validates their argument schema in main.
Internal assistant adapters retain durable tool ledgers and modality attachments.

The bridge uses a random 256-bit bearer token. On Windows the endpoint is a random
256-bit pipe name, and discovery (endpoint/token/PID) is DPAPI-encrypted for the current
user under a protected user/SYSTEM-only directory DACL. On Linux the endpoint is a
randomly named 0600 socket inside the profile's 0700 `bridge/` directory, and discovery
is a 0600 JSON file beside it; the CLI trusts it only when that directory is owned by the
user and closed to group and others. Leftover sockets from an unclean exit are removed at
startup. Secrets never enter returned discovery diagnostics.
This is a trusted local-user interface, not a sandbox against other processes running
as that same user. No TCP listener or separate daemon exists. One newline-delimited
request per connection is capped at 2 MiB; replies are capped at 32 MiB in the client.
A disconnected socket does not abort the admitted operation. Shutdown stops admission,
closes the bridge, aborts provider transport, and waits for owners before closing SQLite.

The CLI bundles its own pinned Node runtime, starts the desktop if discovery is absent
or stale, and outputs JSON envelopes with stable error codes. MCP uses the official
SDK's stdio transport, discovered tool schemas, structured results, native PNG/WAV
content, and a guidance resource. Installation is a separate local operation and
requires no running desktop. The shared installer supports scoped skills and explicit
MCP registration, all-target preflight, per-file backups, identical no-ops, and
explicit conflict replacement. Its config writes preserve unrelated entries.

Schema v3 transactionally adds `reviews`, immutable `review_history`, and
`external_requests`. A caller generation UUID is bound to normalized input, operation,
project and session. Each job-admission transaction also persists its job IDs to the
request row (and the internal waiting tool if applicable). Replays return existing
IDs; changed input/scope conflicts. Failed/partial admission remains incomplete;
startup marks unfinished admission interrupted. There is no silent second purchase.
Music requests record the resolved provider ID, and voice requests additionally freeze
model and voice at admission rather than following later UI changes. Existing queued/running job recovery is retained.

## Cue reviews, playback and export

Reviews have an active/completed lifecycle. Done saves the draft and completes the
review in one revision-checked transaction, even with unresolved cues. Completed
reviews move to Archived selectors and are read-only until explicitly reopened.
Pressing Done leaves the review and returns to the Playground, whose launcher lists
the reviews still open (the Archived filter reaches finished ones);
audition, local Loop, inspection, and export remain available. Completion means the
session ended, not that every cue was accepted. Completion time and user/agent
attribution accompany status in reads and exports. Completion/reopen revisions
remain in immutable history; reopen clears only the current completion stamp.
Stale drafts survive conflicts, and drafts overtaken by completion must be reloaded
before reopening. The store enforces completion locks for every caller.

Schema v4 initializes existing reviews as active and prevents older applications
from opening the library and bypassing completion locks. Historical JSON is
normalized on read without rewriting history. Renderer snapshots include both
active and archived reviews; review_list defaults to active.

review_wait blocks until a review has saved revisions after a cursor (by default only
the user's), or until it is completed, and returns those revisions as events with kind
and changed cue keys, the review, a new cursor, and timedOut. Waits default to 50
seconds and go up to 30 minutes; the bridge clears its idle socket timeout once a
request authenticates so long waits are not cut off. `sfxchat watch-review` loops it
into a JSON-lines stream. The in-app assistant does not get review_wait.

MCP exposes scoped review resource templates with subscription notifications through
the SDK's modern/legacy stdio routing. Reads, opens, and returned review mutations
start deduplicated revision watches (maximum 128 per connection; oldest evicted).
Watches use 30-second review_wait calls (any origin) over the existing private
bridge, back off from 1 to 30 seconds on failure, never launch the desktop, and abort
their sockets and timers when stdio closes. Notifications identify the changed URI; reads and
waits remain authoritative across disconnects and hosts that do not surface
notifications. Explicit reads restart evicted watches.

Reviews belong to one project and store ordered cue briefs, candidate/reference
IDs, preview gain, decisions and notes. Legacy repeat settings are ignored when
reading a current board and retained in immutable history. Candidate membership is checked
against that project. Updates compare expected revisions in the write transaction;
every saved revision has origin/time, with per-cue decision and notes stamps retained
across unrelated edits. Candidate-note stamps and `review_history` preserve feedback
attribution independently of general asset reviews. UI drafts survive stale-save errors.

ReviewPanel occupies the existing Playground results slot. AudioCardFrame supplies
the same title, waveform (or MIDI note roll), format, duration and tags as library/inspector
cards; review cards attach a loop switch, preview gain, cue selection and candidate notes
underneath. Cue controls
and feedback sit beside the cards, moving below at narrower container widths. The
Playground header, generation form and jobs remain in place. ReviewLauncher opens or
creates a board from the header; returning to all sounds restores regular results.
The WebAudio player reports state to the card presentation as well as RendererPort;
review cards do not introduce a second native audio player. Unsaved decisions, notes,
membership and preview gains do not disable auditioning candidates or references in
any cue; playback uses the current draft's preview gain. Selecting a candidate,
rejecting all, or marking a cue unreviewed immediately submits the current review
draft through the same revision-checked `review_update` operation as Save review.
Review editing controls are disabled during a pending operation to prevent competing
changes. Older snapshots cannot replace a successful save response. Failed saves retain the
draft and display the error. Other edits can still be saved explicitly, and manual
review navigation or exporting requires saving or discarding remaining edits first.

Every sound card (library, Playground, inspector and review) shows elapsed/total time
and a playhead over the waveform or MIDI roll. The waveform is the seek bar: click or
drag (the seek lands on release) or use the arrow keys when focused. Play/Pause keeps
the position; the separate Stop button and natural completion return to the start.
The renderer tracks position from the WebAudio context clock and decoded buffer
duration; seeking replaces the source at the chosen offset while retaining preview
gain and Loop, and a seek while paused stays paused. AuditionPlayer publishes a
renderer-local external store keyed by the owning control; each card subscribes only
to its own key. Clock ticks do not update App or rebuild cue
controls. RendererPort receives lifecycle status only, rather than per-frame reports.
Loading feedback and cancellation are local to the requested sound, without locking
review edits or other Play buttons. Superseded loads abort their fetch and cannot start
audio after Stop, navigation, or another Play. Asset pickers populate the full library
only while focused; idle controls retain only their current option. Shared audio cards
decode waveforms near the viewport and cache up to 256 small peak arrays; they abort
unmounted fetches. Memoized waveforms/note rolls do not rebuild on clock ticks. The trim editor's
seam and loop previews play their rendered blobs through the same player.

`review_create` saves first, then uses RendererPort to open the new sheet by default.
`open:false` supports draft preparation; the manual launcher uses it because it owns
its selection locally. Creation returns the saved review with a separate `ui.status`
(`opened`, `skipped`, or `failed`) so unavailable/busy/timed-out UI navigation never
turns a successful save into a creation failure. `review_open` retries navigation
without duplicating a sheet. Review updates do not switch the visible sheet.

RendererPort acknowledges UI commands and reports actual player state. Open commands
never autoplay. Conflicting simultaneous switches return UI_BUSY. The renderer's
AuditionPlayer owns one WebAudio context and a single source with preview gain for
every card and preview. Only a user click starts playback. Loop checkboxes default
off and live only in renderer interaction state. Loop and preview gain change live
without restarting: the source's `loop`, `loopStart` and `loopEnd` update in place.
An asset's `loopPoint`, else a loop render's recorded region
(`edit.loop.loopStartFrame`/`loopEndFrame`), is the looped part, so an intro plays once and only the loop repeats, matching an engine
that honors the smpl chunk; other sounds loop whole. The trim editor's loop preview
repeats the same way, with the kept intro first. Playback reports `paused` as well
as `playing`, `stopped` and `error`. Saving review edits or decisions does not stop
playback. No timed scheduling,
automatic retrigger, or programmatic play/stop operation remains. Explicit stop and
view/session/project/review changes clear active sources; visibility and native
hide/minimize events also stop. Other native audio players stop the review player.
Playback status is not an observation about audio content or listener decisions.

Exporter verifies source integrity and creates exclusive new files/directories. PCM16
conversion uses the serialized decoded-media owner and existing source/decoded bounds;
Vorbis runs the bundled helper with a timeout and output cap, `oggQuality` 0–10 (default 5, recorded in the sidecar) and mono/stereo
8–192 kHz bounds. Conversion preserves rate/count and excludes preview gain. Original
export preserves bytes. Single assets get sidecars; packs get saved decisions (including
unresolved cues), feedback, source/ancestor records, hashes and conversion settings.
Failed packs report EXPORT_INCOMPLETE and retain an incomplete manifest. Windows reserved
filenames are refused before pack creation. See [agent guide](agent-workbench.md) and
[rebuild/provenance](research/agent-runtime.md).

## Diagnostics

The main process writes best-effort JSONL diagnostics under the profile's `logs/`,
rotating a 2 MB file with three archives. Records correlate conversation, assistant
message, tool call, job, asset, and provider request IDs. Request logs describe item
types/IDs rather than bodies or prompts. Errors include bounded, allowlisted provider
message/code/type/parameter and HTTP status. Error-body reads have a 32 KB cap and
a two-second total deadline. HTML error pages are not dumped into logs or chat.

Provider boundaries redact the actual request credential before returning errors;
the logger also redacts secret fields and token patterns. Full request/response
bodies, tool arguments/results, credentials, and audio are not logged. Provider
error messages may quote user content. Failed chat messages retain readable details
and a diagnostic reference only after a successful log write. Logging failures never
replace the original error. The fixed `openLogs` IPC operation opens only the
profile's logs directory. There is no arbitrary-path or log-reading renderer API.

## Local arrangement workstation

Schema v6 transactionally adds project-owned arrangement documents, immutable
revision history and recoverable render jobs. `shared/arrangement.ts` validates
stable IDs, bounds, references and acyclic sidechains. `arrangement-operations`
owns the catalog, edit and render schemas and bounded transformations. The existing
operation registry dispatches UI, assistant, CLI and MCP to `main/arrangements.ts`.
Writes compare expected revisions inside the transaction. Track/section reads avoid
returning the whole score. Render jobs snapshot the exact recipe/revision and seed.
Settings edits remove creation defaults before making fields optional: omitted
length, tempo, intent, seed and master fields must not reset during targeted writes.

`shared/sound-engine.ts` is the block-processing core. Browser worker output feeds
an AudioWorklet; a main-owned Node worker uses the same scheduler/DSP and streams
WAV files independently of editor lifetime. Both use js-synthesizer 1.13.0 with
FluidSynth 2.4.6. Banks are pinned into content-addressed library storage on save;
source audio and bank hashes are verified without silent substitution. Existing
MIDI playback retains its native helper. Sources are decoded through the same
canonical main-process decoder for browser playback and export.
Electron Vite owns audio worker outputs. Main build/watch writes the offline worker
after output-directory cleanup; renderer builds emit the classic worker, worklet
and FluidSynth runtime as assets. The renderer dev server serves those fixed URLs
and compiles worker code on request. CLI prebuilds no longer write files that the
subsequent Vite launch removes.

The renderer owns draft editing and user-started playback only. Edits save after a
short idle interval; a pointer drag previews continuously and saves after release.
In-flight responses preserve newer drafts, conflicts remain visible, and per-project
drafts survive panel navigation within the renderer session. Studio panels expose
arrangement/section editing, notes/drums, instruments/sample regions, mixing/effects,
automation, jobs/export and history. Parameter drafts update the shared live core.
Rendered assets retain exact recipe, engine identity, source hashes, parameters,
seed and diagnostics. Float32/PCM24 output is 48 kHz; exact loops omit tails.
Sequential time-aligned stems omit master processing and include separate bus returns.
Packages carry the recipe, source originals, bank and provenance; MIDI export identifies
audio-only features explicitly. Missing dependencies fail visibly.

`wav-reader.ts` streams full-length amplitude summaries and reads bounded ranges for
events/listening. Loop probes compare head/tail windows without whole-file decode.
`shared/guidance.ts` is the canonical reference manifest consumed by the build,
installer and topic-selective/full guidance operation. Runtime instructions route
to those same general-principle references. See [DSP](research/local-dsp.md) and
[composition research](research/music-composition.md) for limitations and sources.

## Verification policy

This project carries no automated tests: no unit, integration, or end-to-end suites, no
test runners or test dependencies, and no test-only fixtures, mock providers, or
deterministic test modes. Verification is `npm run typecheck`, the production build, and
live/manual runs of the app, with the results recorded in [verification](verification.md).
The previous Playwright suites, their fixtures, the installed-app smoke script, and the
main-process mock port mode were removed on 2026-09-21 so no dead test infrastructure
remains. Removing mock mode also removed the `SFXCHAT_TEST_*` environment overrides, so
a development launch always uses the real per-user SfxChat profile. Provider behavior
established this way is limited to what was actually exercised; compilation, packaging,
and mock runs never establish provider, login, secure-storage, or platform integration.
Signing, updates, and macOS packaging are deferred.

## Project workspace and deletion

Schema v5 removes conversation ownership from reviews and merges each project's old
Playground lists in insertion order, deduplicating asset IDs. Review content, revisions,
completion state and immutable history remain intact; history reads omit obsolete
session ownership. Reviews and Playground membership are shared across conversations.
Review operations and MCP resource URIs require only project/review IDs; set_playground
requires projectId and assetIds. Generation and chat still retain session attribution.

project_delete and session_delete use the same service/store owners for UI, CLI and
MCP. The UI requires a confirmation that names the target. Conversation deletion removes
messages, persisted model history, tool/turn records, job history and external request records, retaining project
assets, reviews and Playground membership. Project deletion also removes reviews/history,
asset/search records and Playground membership in one transaction. Original and attachment
files remain on disk; this is not a storage-reclamation operation. Active responses, jobs,
edits or external admissions block deletion. Async imports and MIDI saves revalidate
conversation existence before committing. Deleting the selected or last project chooses
an existing project or creates Default; an empty active project gets a new conversation.
Provider configuration and credentials remain app-level.

The regular Playground renders 24 candidates per page. New review seeds up to 128
Playground candidates; larger lists offer New empty review for deliberate cue membership.
