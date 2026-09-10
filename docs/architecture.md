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
Runtime instructions and tool definitions deliberately provide sound-design guidance.
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
safe errors. A temporary localhost 1455 callback validates state and expiry.
Account and model access require real integration verification.

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

Unit tests run inside Electron's Node for SQLite ABI compatibility. Playwright runs
the actual shell with temporary profiles and deterministic provider ports; packaged
builds refuse mock mode. The fixture is a synthetic tone, not a quality sample.
Windows CI builds an unsigned installer without credentials. Signing, updates, and
other-platform packaging are deferred.
