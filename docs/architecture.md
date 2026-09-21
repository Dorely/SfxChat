# SfxChat architecture

## Runtime and ownership

v0.1 uses Electron, React/TypeScript, electron-vite, and electron-builder with a
Windows x64 NSIS target. Exact versions live in the lockfile. This document describes
implementation; [verification](verification.md) records actual checks.
[VISION](../VISION.md) remains product intent.

The main process owns persistence, media, providers, credentials, jobs, and turns.
React owns presentation, selection, forms, and audition controls. The sandboxed,
isolated preload exposes fixed typed operations. Every IPC call validates arguments
and verifies the requesting main frame. The renderer has no Node integration or
general filesystem/shell tool. UI and assistant tools share `WorkbenchService`
and `Store`; provider-specific transports sit behind service ports.

The shell is constrained to the window height. Conversation history and workspace
content scroll inside their panels, keeping the chat composer and headers visible.
Chat follows streamed output while the reader is at the bottom. Scrolling up pauses
following; returning to the bottom, sending a message, or selecting a conversation
returns to the latest content. This follow state belongs only to the renderer.

The fixed `chatContext` IPC operation estimates selected-conversation context in
the main process using bundled `js-tiktoken`/`o200k_base`. It shares the turn's
instruction builder and uses repaired persisted history or active in-memory
history, plus streamed text and the trimmed composer draft. Display-only activity
and errors do not inflate the count. The renderer throttles updates and rejects
stale responses. Model metadata supplies default Codex context sizes; unknown
models show an unknown limit. The approximate meter is advisory, with encrypted
reasoning omitted and flagged. See [evidence and limits](research/chat-context.md).

## Persistence and originals

SQLite uses WAL, foreign keys, transactional migrations, and FTS5 search. Schema v1
stores conversations, messages, assets, jobs, Playground ordering, settings/wire
history, turn state, and a tool-call ledger. Newer schema versions are rejected.
Search covers names, descriptions, tags, collections, prompts, reviews, and feedback.

Original files live at `originals/<asset-id>.<format>`. Unique temporary writes are
renamed before database registration. Provenance includes SHA-256, bytes, probed
duration, exact prompt/settings, request ID/usage when returned, and revision parent.
Invalid returned audio remains preserved but fails its job. A crash between file
write and database commit can leave an unreferenced original; startup does not delete
it or regenerate. Imports validate WAV/MP3 before copying. Export verifies hashes
and refuses existing destinations. Playback gain never changes files.

The `sfx-media://asset/<uuid>` protocol resolves only known assets and supports byte
ranges. The UI never supplies arbitrary local paths for media access.

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
Source bytes and decoded float samples are bounded to 64 MiB; processing yields
between blocks. Shutdown waits for pending edits and analysis; edits cannot commit
after the service closes. Original import/export support is independent of these
editing bounds and encoding restrictions.
If shutdown or a transaction failure races a completed trim file write, the operation
removes its own unregistered derivative; a hard crash can still leave an orphan.

Analysis returns versioned absolute second/frame intervals, sample rate, channels,
decoded duration, source hash, and 1–512 min/max/peak/RMS bins (96 default). Smaller
requested windows measure the samples again at finer resolution. Amplitudes are
linear full-scale values without normalization; extrema span all channels and RMS
counts each channel independently, avoiding cancellation from downmixing. No event
labels, perceptual-silence claims, or hearing are inferred. The assistant is instructed
to inspect an overview, zoom near boundaries, and ask for timing hints if semantic
identity is needed. See the [research note](research/agentic-audio-editing.md).

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
Runtime instructions and tool field descriptions provide sound-design guidance and
[reviewed ElevenLabs prompting practices](knowledge/elevenlabs.md): complete audible
descriptions, deliberate duration/loop/adherence controls, and self-contained
revision prompts. Provider generation receives no parent audio or chat history;
`parentId` is local lineage only. Manual regeneration uses an editable Generation
prompt, prefilled from the original, separately from review feedback, and reuses
requested duration rather than measured file duration. Markdown/skill snapshots
are not injected into the assistant at runtime.
The generation tool waits for results so the assistant can organize returned assets.
Its initial job IDs are recorded atomically with creation. Duplicate tool calls
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
Responses-shaped; adapters convert in memory per turn.

`SecureStore` encrypts values with Electron `safeStorage` before atomic writes under
the profile's `secrets/`. Windows protection is OS-backed; unavailable encryption
fails explicitly. Plaintext credentials do not enter SQLite, settings reads, tools,
or diagnostics. Key entry is transient. Sibling-app auth caches are never imported.

ElevenLabs resolves its key at dispatch and preserves the SFX HTTP response as MP3.
HTTP status failures and uncertain transport outcomes are distinct. Production
provider requests have a three-minute timeout. Music and Gemini are deferred.

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

## Verification boundaries

Playwright runs the actual shell with temporary profiles and deterministic
provider ports; packaged builds refuse mock mode. The fixture is a synthetic
tone, not a quality sample. Windows CI builds an unsigned installer without
credentials. Signing, updates, and other-platform packaging are deferred.
