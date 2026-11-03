# Local agent sound workbench

SfxChat 0.2 includes a Windows x64 console command and stdio MCP server. Both use
the desktop app's library, credentials, jobs, and audition UI. No separate Node
installation, API key arguments, daemon, or remote service is required. The desktop
starts on demand and stays open when clients disconnect; closing it cancels active
provider transport with the existing uncertain-outcome rules.

## Install

Install the unsigned Windows installer. Open a new terminal for the user PATH update:

```powershell
sfxchat help
sfxchat skill install --scope project --project C:\work\game --target codex --target claude --dry-run
sfxchat skill install --scope project --project C:\work\game --target codex --target claude --mcp
sfxchat skill install --scope user --target codex --target claude --mcp
```

MCP registration occurs only with `--mcp`. The app's Settings → Agent integrations
provides the same install, preview, status, uninstall, conflict replacement, and
connection status operations. Existing diagnostic logs remain in Settings. A custom
skills parent is supported by `--directory C:\skills` or the custom directory field.
Use explicit `--scope project|user`; project scope requires `--project`. Custom
folders are used exactly as supplied, with a `sfxchat` child. Named targets can be
repeated, and duplicates are coalesced.

| Scope | Codex skill | Claude Code skill | MCP configuration |
| --- | --- | --- | --- |
| Project | `<project>/.agents/skills/sfxchat` | `<project>/.claude/skills/sfxchat` | `<project>/.codex/config.toml`, `<project>/.mcp.json` |
| User | `~/.agents/skills/sfxchat` | `~/.claude/skills/sfxchat` | `$CODEX_HOME/config.toml` (default `~/.codex`), `~/.claude.json` |

Registration names the server `sfxchat` and points to the installed runtime and CLI
using absolute paths. The Codex entry sets `tool_timeout_sec = 1900` so long
`review_wait` calls fit (Codex otherwise ends tool calls after 60 seconds); an existing
entry without it reports `different` and needs `--force` to update. Project
registration is therefore machine-local: review before committing it to a team
repository. Harness trust/restart requirements still apply.
Moving/uninstalling the app invalidates those paths; rerun integration installation
at the new location. App uninstall removes only its owned PATH entry, not skills,
harness configuration, or the audio library.

```powershell
sfxchat skill status --scope project --project C:\work\game --target codex --mcp
sfxchat skill uninstall --scope project --project C:\work\game --target codex --mcp
```

Identical installations do not write files. Differing skill files or an existing
different `sfxchat` MCP entry fail before writing; `--force` explicitly replaces
those items after backing them up beside the originals. Other harness entries are
preserved. JSON whitespace may be reformatted; unrelated TOML text is retained.
Unusual inline/quoted SfxChat TOML definitions require manual editing. All targets
are preflighted; concurrent edits are checked again before each write. If a later
write fails, earlier writes may remain and their backups can be restored. Uninstall
removes only known installed files and the requested server entry; custom files and
backups remain. Use status after resolving any partial installation.

## CLI and MCP

### Completing and archiving reviews

Done saves pending edits and completes/archives a review atomically, including
reviews with unresolved cues. Completed content is locked until Reopen; playback,
local Loop, inspection, and export remain available. Completion means the session
ended, not that every candidate was accepted. Both users and agents can finish or
reopen reviews, with attribution retained in immutable history.

- `review_complete` takes projectId, reviewId, expectedRevision, and
  optional final content. `review_reopen` takes the same scope and revision, without content.
- `review_update` refuses completed boards with REVIEW_COMPLETED; stale writes
  return REVISION_CONFLICT. Reconcile before retrying; never silently reopen.
- `review_list` accepts status: active (default), completed (archive), or all.
- Reads, history, waits, and export manifests expose status, completedAt, and
  completedBy (user or agent; completion fields are null while active).
- `review_wait` blocks until the review has saved revisions after `afterRevision`
  (default: the current revision), by default only the user's (`from: "any"` includes
  agents), or with `until: "completed"` until it is completed, which the user does by
  pressing Done. It returns `events` (revision, origin, time, kind created/saved/
  completed/reopened, status, and changed cue keys), the current `review`, a `cursor` to
  pass as `afterRevision` next time, and `timedOut`. `wait` is seconds: default 50
  (under common client tool timeouts), up to 1800. An already-completed board satisfies
  `until: "completed"` immediately. The in-app assistant does not get this tool.
- Resources use `sfxchat://projects/{projectId}/reviews/{reviewId}`.
  Read/open a review to observe it. Subscribe using the host's negotiated protocol:
  modern `subscriptions/listen` or legacy `resources/subscribe`. An update notification
  identifies the URI to read again. At most 128 reviews are watched per connection;
  reading an evicted review restores its watch. Reconnect and read after interruption.
  Host notification behavior varies; `review_wait` is the reliable fallback.

Protocol reference: [MCP resources and subscriptions](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/resources.mdx).

```powershell
sfxchat status
sfxchat guidance
sfxchat tools
sfxchat call projects_list
sfxchat call project_create --json '{"name":"Game sound design"}'
sfxchat call session_create --input C:\work\session.json
sfxchat watch-review <projectId> <reviewId> [--from user|any] [--once]
sfxchat mcp
```

Normal results are one JSON object: `{ "ok": true, "result": ... }`. Failures are
`{ "ok": false, "error": { "code": "...", "message": "..." } }` with exit code 1.
Diagnostics never go to MCP stdout. Use JSON files to avoid shell quoting surprises.
`watch-review` is the exception: it holds one connection and prints JSON lines
(`watch.started`, each review event, `watch.retrying` while the app is unreachable,
then `watch.ended`) until the review is completed, or after the first events with `--once`.
`tools` returns current descriptions and JSON schemas. MCP exposes those same names,
structured results, PNG/audio content, and the `sfxchat://guidance` resource.

Operations cover projects/sessions, generation and jobs, imports, library search and
metadata, Playground ordering, analysis, trimming/loop derivatives, spectrograms,
bounded audio clips, cue reviews, explicit playback, exports, and guidance. External
operations always carry the project/session context their schema requires. Switching
the displayed project does not change a caller's context. Only review open/play
intentionally switches the visible workspace. Concurrent UI switches can return
`UI_BUSY`; retry after checking status. General library operations remain independent.

`generate_voice` uses the same generation envelope below. Its `input` contains exact
`text`, optional separate `providerText`, `providerId` (`elevenlabs` or `gemini`),
`model`, `voiceId`, optional Gemini `style` or supported ElevenLabs numeric controls,
`count`, `name`, and `parentId`. Omitting model/voice uses saved defaults, frozen at
admission. `list_voices` accepts providerId, search, language, and pageToken without
project/session scope. `list_voice_models` accepts `providerId` and optional `refresh`
without project/session scope. ElevenLabs uses its saved key and a live TTS catalog
(up-to-five-minute cache); Gemini returns a labeled built-in catalog. Read each entry's
`selectable`, `note`, `guidanceStatus`, `controls`, `maxCharacters`, `languages`, and
`requiresAlphaAccess`, then put an exact selectable ID into `generate_voice.input.model`.
The response also includes `latestModel`, the resolved saved `defaultModel`,
`defaultFollowsLatest`, and `defaultVoiceId`. Omitted models follow the newest model
unless the user pinned one. `list_audio_models` (`kind` `effect` or `music`, optional
`refresh`) lists ElevenLabs sound/music IDs from the official public API schema with
`latestModel`; `generate_sounds` and `generate_music` accept an optional `model` pin. Discovery does
not generate speech or change defaults. New/unreviewed IDs accept plain text only;
realtime variants cannot use this workbench's speech transport. Missing models and
failed discovery are explicit errors, never automatic replacements of a pinned model.
`list_voice_models` discovers speech models only.
`guidance` includes canonical voice references, roster/defaults,
and schemas; read the applicable provider document before preparing speech. One shared
vendor key is configured in Settings, never in CLI/MCP requests. Voice libraries,
review/export operations, and transcript search use the same scoped asset operations.

```powershell
sfxchat call list_voice_models --json '{"providerId":"elevenlabs","refresh":true}'
sfxchat call list_voices --json '{"providerId":"elevenlabs","language":"en"}'
```

MCP calls those same operations directly. Read the model-specific reference returned
by `guidance` before preparing speech: v4/v3 tags differ from legacy narration/Flash
prompting, and supported controls change with the model. Per-request model selection
preserves the user's Settings defaults and is frozen in admitted jobs.

Generation input has this envelope (replace IDs with real IDs):

```json
{
  "projectId": "<project UUID>",
  "sessionId": "<session UUID>",
  "requestId": "<new UUID retained by the caller>",
  "input": { "prompt": "One-shot ceramic token landing on oak, close dry clack with a short ring.", "count": 1, "duration": 2, "loop": false, "influence": 0.3 }
}
```

Generation returns admission status and durable job IDs without waiting for provider
completion. Preserve the request ID. Exact replay returns the original admission
and jobs; altered arguments or scope return `REQUEST_CONFLICT`. Admission can be
`admitting`, `admitted`, `incomplete`, or `interrupted`, with partial IDs and error
details retained. `incomplete` is an operation result, not permission to buy another
batch. A timeout or disconnect does not cancel admitted jobs. Use `inspect_jobs` or
`jobs_wait` (up to 30 seconds), and `cancel_job` for explicit cancellation. Running
jobs interrupted by app shutdown become uncertain; queued jobs remain eligible on
restart. An uncertain request is never silently repeated. Music provider selection
is pinned at admission; changing the active provider cannot redirect queued work.

Stable errors include `INVALID_ARGUMENTS`, `INVALID_PATH`, `REQUEST_CONFLICT`,
`REVISION_CONFLICT`, `DESTINATION_EXISTS`, `EXPORT_INCOMPLETE`, `INSTALL_CONFLICT`,
`UI_BUSY`, `UI_UNAVAILABLE`, `UI_TIMEOUT`, `PLAYBACK_FAILED`, `CLOSING`, and transport
errors. Existing lower-level failures use `OPERATION_FAILED`; inspect the message.
Neither readiness nor successful compilation proves that a provider account works.

## MIDI composition

`compose_midi` writes note data (positions and lengths in quarter-note beats, an optional General
MIDI program per track, or `drums` for the GM percussion kit) to a Standard MIDI File. It needs no
provider, key, or spend, and returns durable job IDs like the other generation operations. MIDI
clips report their musical duration, and playback renders them through the bundled General MIDI
bank. Copy the composing guidance from the `guidance` operation's `controls.midi` schema and the
three `midi-*`/`music-craft` documents. `audio_listen` accepts a MIDI clip and returns the clip
rendered through the bank as mono WAV — an observation of that render rather than a performance,
and meaningful only for a calling model that receives audio. Revising means sending a complete new
composition with `parentId`; existing clips are never modified. Finish by arranging the comparison
board with `set_playground` like any other sound.

## Audition and export

`review_create` stores `{title,cues}` for a project and opens the new sheet in the
Playground by default, selecting its project without autoplay. Pass `open:false`
to prepare a draft, then call `review_open` when it is ready. The returned review
includes `ui.status`: `opened`, `skipped`, or `failed`. A failed open also includes
`ui.code` and `ui.message`; the review is already saved, so retry `review_open`
with its returned ID instead of creating another sheet. Updates do not navigate.
Each ordered cue has a stable
filename-safe key, label, brief, candidates, optional current reference, notes,
preview gains. A decision
is `unreviewed`, `selected` with a candidate ID, or `rejected` with no selected ID.
These are separate from an asset's general library review. Each saved revision is
retained; current decision and notes attribution survives unrelated board edits.
`review_update` requires `expectedRevision`; `review_get`, `review_history`, and
`review_wait` retrieve feedback without erasing another person's edit.
In the UI, selecting a candidate, rejecting all, or marking a cue unreviewed saves
the current draft immediately, including pending notes and other edits. Save review
also saves edits independently of a decision. Failed saves retain the draft and
surface revision conflicts for reconciliation.

`review_open` never autoplays. CLI/MCP and assistant tools have no playback start
or stop controls. Users click Play/Stop in a review card; Loop is an optional user
checkbox, off on opening a review. A single WebAudio source plays the clip, with
no timed retrigger scheduler or overlapping repeats. View, session/project/review
changes, visibility loss, native hide/minimize, and explicit stop end playback.
Playback status is renderer state, never evidence of hearing or approval. Model
listening requires an audio-capable harness; the human's audition remains separate.

The asset inspector offers original, PCM WAV, and Ogg Vorbis export. Cue packs export
selected candidates under stable cue-key filenames. Destinations must be absolute
and new. Originals are hash checked. WAV is 16-bit PCM; Vorbis uses quality 5,
libvorbis 1.3.7 and libogg 1.3.6. Conversion retains sample rate and channel count,
clips float values outside full scale for PCM16, and never applies preview gain.
Conversion uses the existing 64 MiB source/decoded-float bounds. Vorbis currently
supports mono/stereo, 8–192 kHz; other channel counts can use original or WAV.

Individual exports include a JSON sidecar with source record, ancestry, original
and exported hashes, prompt/settings and conversion details. Packs include
`manifest.json`, the saved review with unresolved/rejected cues and notes, and all
selected-file records. A failed pack leaves `incomplete.json` and reports
`EXPORT_INCOMPLETE`; integrate only complete packs. Original audio and its provenance
remain in SfxChat. Imported media has only the provenance actually supplied/known;
software licenses do not establish media rights.

## Guidance

`resources/skill/references` is the maintained source for both the internal assistant
and installed skill. Builds embed that text in the app and CLI and package complete
references with a SHA-256 version file. `sfxchat guidance` returns the current hash,
all documents, configured provider IDs/models/readiness, and supported control
schemas. No keys or OAuth tokens are returned. The skill instructs agents to compare
its snapshot hash and retrieve the current documents when versions differ, then
load guidance for the provider actually used, including overrides.

See [Chimera migration](chimera-integration.md), [encoder/runtime provenance](research/agent-runtime.md),
[architecture](architecture.md), and [verification evidence](verification.md).

Reviews and the regular Playground are project-scoped and shared across conversations.
Do not supply sessionId to review operations, export_review, or set_playground.
Conversation attribution remains required for generation and jobs.
`session_delete` permanently removes a conversation's messages and job/tool history while
retaining project audio, reviews and Playground. `project_delete` removes its workspace
records, including reviews/history and library records. Original media files remain on
disk. Use deletion only on explicit user intent; active work must finish first.
