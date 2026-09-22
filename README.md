# SfxChat

A Windows desktop workbench for creating, comparing, and organizing sound effects and
music with a chat assistant. [Public source](https://github.com/Dorely/SfxChat) ·
[MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md).

## v0.1

Chat occupies a resizable left sidebar. Effects Library, Music Library, and
conversation-specific Playground views share the right workspace. Generate sound
effects through ElevenLabs and music through a separately configured music provider,
audition candidates, record feedback, regenerate linked alternatives, and organize
names, descriptions, tags, collections, and review status. WAV/MP3 imports and exports
preserve original bytes. Search includes original prompts and feedback. Local library
use needs no provider login.

Work is organized into projects. The project dropdown in the top bar switches between them,
and each project holds its own conversations plus its own effects and music libraries,
while provider configuration and credentials stay app-level. Session titles are editable in
place, and the assistant names each session as the scope of the work becomes clear.

The Playground generates either kind. Sound effects use the ElevenLabs key from
Settings; music uses the active **music provider**, which is configured independently of
chat providers and of the effects key — choosing Gemini for chat does not configure
Gemini for music, and an ElevenLabs sound-effects key is never reused for Music. One
provider is active; a generation can target another configured provider. Each candidate
is a separate billed generation, and music generations are slower than effects.

The chat composer shows a local tiktoken estimate including the draft, instructions,
and tool history against the selected model's default Codex context size (272,000
tokens for the configured models). The meter is advisory; hidden reasoning and
server accounting can differ. See [context counter evidence](docs/research/chat-context.md).

The assistant uses direct Codex OAuth and Responses streaming adapted from the
Lorekeeper and PixelChat references. There is no CLI prerequisite. Source and mock
tests alone do not establish that a particular account can log in or use a model;
see [verification](docs/verification.md) for actual evidence and live acceptance.

Music, Gemini analysis, mixing and edits beyond trimming/fades, cloud sync, multiple
libraries, automatic updates, signed installers, and other platform packages are
deferred. Composition plans, audio reference, inpainting, streaming, and stem separation
are available from the providers but not exposed by this app.

## Development on Windows x64

Use Node.js 22.12 or newer in the 22 release line, npm, and Git.

```powershell
npm ci
npm run dev
npm run typecheck
npm run package
```

Installation rebuilds SQLite for the pinned Electron runtime. Run `npm run rebuild` after
changing Electron/native dependencies. The unsigned installer is written to
`release/`; packaging does not publish it. Windows CI runs `npm ci`, the type check, and
the package build, then retains the installer as a build artifact.

This project carries no automated tests. Verify changes with `typecheck`, the production
build, and live/manual runs of the app, and record what was actually checked in
[verification](docs/verification.md).

For interactive debugging in VS Code, select `Debug SfxChat` in Run and Debug and
press F5. This launches the development app with source-mapped main-process and
renderer debugging. Close any existing SfxChat window first because the app allows
only one running instance.

## Connect and create

1. Open Settings and connect Codex in the system browser. The temporary callback
   listener uses localhost port 1455; another app's login may occupy that port.
2. Save your ElevenLabs API key in Settings. Credentials use Windows-backed
   encryption. Settings reads expose readiness, never stored values. An empty key
   removes the saved key.
3. Add a music provider (ElevenLabs Music or Gemini Lyria), choose its model, and save
   its API key. Music providers are configured separately from chat providers and from
   the effects key. The ElevenLabs Music API requires a paid plan.
4. Request sounds or music in chat or use the Playground form. Generation runs directly
   without a separate spending approval and uses your provider account's credits.
5. Audition candidates, record feedback, and regenerate. Metadata edits preserve
   original prompts, hashes, requests, and files.
6. Export original audio through the inspector. Choose a new destination filename;
   v0.1 refuses to overwrite an existing file.

For manual regeneration, edit **Generation prompt** in the inspector to describe
the complete desired sound. It starts with the original prompt; **Feedback** is
kept separately as review notes. Use chat to turn feedback into a revised prompt.
See the API knowledge notes — [sound effects](docs/knowledge/elevenlabs.md),
[ElevenLabs Music](docs/knowledge/elevenlabs-music.md), and
[Gemini Lyria](docs/knowledge/gemini-lyria.md) — for prompting guidance and documented
endpoint limitations.

## Make music

Switch the Playground to **Music**, choose a length, and optionally mark the track
instrumental or target a different configured provider. Music prompts carry the whole
creative direction — genre, instrumentation, tempo, key, structure, and any lyrics — so
a revision is a new generation with a restated direction, not an edit of the previous
track. Lyria and ElevenLabs Music answer length, structure, and vocal questions
differently; the assistant follows the active provider's documented behavior, and each
note above records what was verified and what remains unverified.

## Trim sounds

Open a sound's inspector and choose **Trim as new asset**. Set the in/out points,
zoom into the selection to refine its edges, optionally add short fades, and click
**Play selection** to hear just that area. The button switches to **Stop selection**
during playback. Changing the selection or fades stops the old preview; the next
play uses the updated area. **Save as new asset** creates a WAV in the library and current Playground.
The source is retained, and the new asset records its parent, exact sample-frame
interval, fades, source hash, and decoder. Export the derivative through its inspector.

The assistant can use `analyze_audio` to examine timestamped amplitude measurements,
zoom into smaller intervals, and call `trim_asset` to keep a focused section. These
local operations need no audio-provider key or paid generation. The assistant can
locate activity from measurements; it cannot identify an event by hearing it. Give
timing hints when the desired event is ambiguous, and audition the result.

Editing supports MP3 and RIFF PCM/float WAV, up to 64 MiB each for source bytes and
decoded float samples. Unsupported WAV encodings remain available for original-file
playback/export. Edits use decoded duration (which can differ from MP3 metadata),
round endpoints to nearest sample frames, and save float32 WAV without another lossy
encode. Zero fades preserve retained decoded samples; optional fades change only
their edge samples. Preview gain does not affect saved audio. Research findings and
source links are recorded under [docs/research](docs/research/agentic-audio-editing.md).

The initial configurable chat model is `gpt-5.6-sol`, following Lorekeeper. SFX uses
`eleven_text_to_sound_v2`, `mp3_44100_128`, optional 0.5–30 second duration, looping,
and prompt influence. Account availability and output rights are provider-controlled.
This version does not send audio to a listening model or claim aesthetic approval.

## Data and recovery

The per-user `%APPDATA%/SfxChat` directory contains `library.sqlite`, `originals/`, and
encrypted `secrets/`. Do not publish this directory. Uninstalling does not
intentionally delete library data. See verification for the tested installed path. What the app lists is scoped to the active project; switching projects changes the listing, not where files live.

Renderer reloads leave jobs and turns running. Closing the app stops active work.
On restart, undispatched jobs can run, while interrupted dispatched requests become
uncertain and are never automatically replayed. Cancellation may occur after billing.
Invalid returned audio is retained with a failed job. Export checks original hashes.

## Troubleshooting

Settings → **Open diagnostic logs** opens `%APPDATA%/SfxChat/logs`. Logs record chat
requests, tool activity, generation outcomes, and errors with conversation/job IDs,
HTTP status, provider error details, and request IDs when supplied. Failed chat
messages include a diagnostic reference that matches the saved record. Logs rotate
at 2 MB with three archives. Credentials are redacted; request bodies, chat text,
tool arguments/results, and audio are not routinely logged. A provider's error
message can quote submitted content, so review diagnostics before sharing them.

If a chat follow-up fails after generation, the completed sound remains available.
Continuing the conversation reuses saved tool outcomes. Older histories affected
by the empty-terminal-output bug restore missing calls from the durable tool ledger
before contacting Codex; the repair does not generate audio again.

## Project references

- [VISION](VISION.md): product intent, not implementation status.
- [Architecture](docs/architecture.md) and [FILEMAP](FILEMAP.md): runtime and navigation.
- [Accepted plan](docs/implementation-plan.md): v0.1 scope.
- [API knowledge](docs/knowledge/README.md) and [sources](docs/sources.md): provenance.
