# SfxChat

A Windows desktop workbench for creating, comparing, and organizing sound effects, music, and
single-speaker voice with a chat assistant. [Public source](https://github.com/Dorely/SfxChat) ·
[MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md).

## v0.2

Chat occupies a resizable left sidebar. Effects Library, Music Library, Voice Library, and
conversation-specific Playground views share the right workspace. Generate sound
effects through ElevenLabs, music through a configured music target, and voice
through ElevenLabs or Gemini,
audition candidates, record feedback, regenerate linked alternatives, and organize
names, descriptions, tags, collections, and review status. WAV/MP3 imports and exports
preserve original bytes. Search includes original prompts, voice transcripts, and feedback. Local library
use needs no provider login.

Work is organized into projects. The project dropdown in the top bar switches between them,
and each project holds its own conversations plus its own effects, music, and voice libraries,
while provider configuration and credentials stay app-level. Session titles are editable in
place, and the assistant names each session as the scope of the work becomes clear.

The Playground supports Effects, Music, and Voice modes. Settings has **one API key
per provider**, shared across ElevenLabs effects/music/voice and Gemini music/voice/
direct Gemini chat. Model and default-voice choices are independent of credentials.
Equal legacy keys consolidate automatically; differing saved keys remain encrypted
until you choose which to retain. No capability-specific key fields remain.

Voice defaults to Eleven v4 or Gemini 3.8 Flash TTS, with Multilingual v2 and Gemini
3.8 Flash-Lite TTS alternatives. Choose an existing voice, discover regional voices,
and set supported delivery controls. Gemini style stays separate from its verbatim
transcript. Originals are MP3 for ElevenLabs and WAV for Gemini. The inspector preserves
script/voice/settings provenance and offers editable regeneration with parent lineage.
Every candidate is a separate purchase; scripts are never split, models never silently
changed, and uncertain generations never retried automatically. See the dated
[voice coverage and controls](docs/knowledge/voice-generation.md) and packaged
[ElevenLabs](resources/skill/references/elevenlabs-voice.md) / [Gemini](resources/skill/references/gemini-voice.md)
guides. Cloning, voice creation, multi-speaker dialogue, and real-time voice chat are
outside this implementation.

The chat composer shows a local tiktoken estimate including the draft, instructions,
and tool history against the selected model's default Codex context size (272,000
tokens for the configured models). The meter is advisory; hidden reasoning and
server accounting can differ. See [context counter evidence](docs/research/chat-context.md).

The assistant uses direct Codex OAuth and Responses streaming adapted from the
Lorekeeper and PixelChat references. There is no CLI prerequisite. Source and builds alone do not establish that a particular account can log in or use a model;
see [verification](docs/verification.md) for actual evidence and live acceptance.

Remote services, Gemini analysis, mixing and edits beyond trimming/loop processing,
cloud sync, automatic updates, signed installers, and other platform packages are
deferred. Composition plans, audio reference, inpainting, streaming, and stem separation
are available from the providers but not exposed by this app.

## Agent integration

The installer includes `sfxchat` and `sfxchat mcp`. Agents share the desktop library
and use persistent cue reviews for user audition, selections, feedback,
and export. The desktop starts on demand; disconnecting a client leaves admitted
jobs running. Generation request IDs prevent accidental repeat purchases.

Opening a review displays cue-grouped sound cards in the Playground results area.
Candidate notes and selection controls sit under each card, with cue feedback and
manual Loop toggles alongside or below. The Playground header and generation form stay
in place; **All Playground sounds** returns to the session’s regular results.
Selections and notes stay editable while you continue auditioning any cue. Save
review changes before switching reviews or exporting selected sounds.

```powershell
sfxchat guidance
sfxchat skill install --scope project --project C:\work\game --target codex --target claude --mcp --dry-run
sfxchat skill install --scope user --target codex --target claude --mcp
```

Settings → Agent integrations provides the same controls. Skills contain the full
app audio-design guidance and check its version against the running app. See the
[CLI/MCP and installation guide](docs/agent-workbench.md) and
[Chimera migration recipe](docs/chimera-integration.md). Actual verification and
remaining platform/provider gaps are recorded in [verification](docs/verification.md).

## Development on Windows x64

Use Node.js 22.12+ in the 22 line (or Node 24), npm, Git, and Visual Studio C++
Build Tools with the Windows SDK and CMake. The agent build downloads a checksum-pinned
Node 24 runtime for distribution; installed users need no Node installation. See
[rebuild details](docs/research/agent-runtime.md).

```powershell
npm ci
npm run dev:browser
npm run typecheck
npm run package
```

For manual UI verification, close any running SfxChat instance, run `npm run dev:browser`,
and open the printed `http://127.0.0.1:<port>` URL in the Codex in-app browser or a
regular browser. Use one tab. This is the real app renderer, library, jobs, and
OS-backed credentials, so edits and paid generations have their normal effects.
Electron owns the privileged operations without creating a desktop window; the
browser receives readiness only and never stores provider keys. The development
host binds only to loopback and refuses requests from other web origins. Import,
export, and directory selection use app dialogs for absolute paths on the host.

This mode builds once; rebuild and reload after code changes. CLI/MCP clients connect
to the same running owner and can open reviews in the browser without autoplay.
Playback is user-controlled; agents have no play/stop tools. Press Ctrl+C in the launching terminal to stop the host. Use `npm run dev`
for desktop-specific checks such as native dialogs and installer integration.

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
2. Save your ElevenLabs and/or Gemini API key in the provider sections of Settings. Credentials use Windows-backed
   encryption. Settings reads expose readiness, never stored values. An empty key
   removes the saved key.
3. Add a music target (ElevenLabs Music or Gemini Lyria) and choose its model, or
   choose voice defaults. These selections use the shared vendor key. Provider
   access and pricing depend on your account.
4. Request sounds, music, or single-speaker speech in chat or use the Playground form. Generation runs directly
   without a separate spending approval and uses your provider account's credits.
5. Audition candidates, record feedback, and regenerate. Metadata edits preserve
   original prompts, hashes, requests, and files.
6. Export original bytes, PCM WAV, or Ogg Vorbis through the inspector, or export
   selected cues as a pack. Choose a new destination; existing files are refused.

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
play uses the updated area. The **Spectrogram** toggle shows the same rendered
spectrogram view that the assistant can attach in chat. **Save as new asset** creates a WAV in the library and current Playground.
The source is retained, and the new asset records its parent, exact sample-frame
interval, fades, source hash, and decoder. Export the derivative through its inspector.

The assistant can use `analyze_audio` to examine timestamped amplitude
measurements, detect energy-based event intervals as candidate clip spots, and
probe how a candidate loop's end wraps to its start; `trim_asset` keeps a focused
section or renders a seamless loop with a wrap crossfade. These local operations
need no audio-provider key or paid generation. When the configured chat model
supports image and audio input, the assistant can also attach a spectrogram view
and a bounded listening clip of a library asset — those are observations at the
model's fidelity, never approval. Each attachment stays visible and playable in
the chat history for your own inspection. Give timing hints when the desired event is
ambiguous, and audition every result yourself.

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
Audio reaches a listening model only as a bounded clip through the assistant's
capability-gated tool when the model's saved flags allow it, and no aesthetic
approval is claimed.

## Data and recovery

The per-user `%APPDATA%/SfxChat` directory contains `library.sqlite`, `originals/`,
`chat-media/` (the spectrogram images and listening clips the assistant attached in
chat, kept for the transcript), and
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
