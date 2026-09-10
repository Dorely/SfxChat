# SfxChat

A Windows desktop workbench for creating, comparing, and organizing sound effects
with a chat assistant. [Public source](https://github.com/Dorely/SfxChat) ·
[MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md).

## v0.1

Chat occupies a resizable left sidebar. Library and conversation-specific Playground
views share the right workspace. Generate through ElevenLabs, audition candidates,
record feedback, regenerate linked alternatives, and organize names, descriptions,
tags, collections, and review status. WAV/MP3 imports and exports preserve original
bytes. Search includes original prompts and feedback. Local library use needs no
provider login.

The assistant uses direct Codex OAuth and Responses streaming adapted from the
Lorekeeper and PixelChat references. There is no CLI prerequisite. Source and mock
tests alone do not establish that a particular account can log in or use a model;
see [verification](docs/verification.md) for actual evidence and live acceptance.

Music, Gemini analysis, editing/mixing, cloud sync, multiple libraries, automatic
updates, signed installers, and other platform packages are deferred.

## Development on Windows x64

Use Node.js 22.12 or newer in the 22 release line, npm, and Git.

```powershell
npm ci
npm run dev
npm run typecheck
npm test
npm run test:e2e
npm run package
```

Installation rebuilds SQLite for the pinned Electron runtime. Unit tests use
Electron's embedded Node to match that native ABI. Run `npm run rebuild` after
changing Electron/native dependencies. The unsigned installer is written to
`release/`; packaging does not publish it. Windows CI runs credential-free checks
and retains the installer as a build artifact.

## Connect and create

1. Open Settings and connect Codex in the system browser. The temporary callback
   listener uses localhost port 1455; another app's login may occupy that port.
2. Save your ElevenLabs API key in Settings. Credentials use Windows-backed
   encryption. Settings reads expose readiness, never stored values. An empty key
   removes the saved key.
3. Request sounds in chat or use the Playground form. Generation runs directly
   without a separate spending approval and uses your provider account's credits.
4. Audition candidates, record feedback, and regenerate. Metadata edits preserve
   original prompts, hashes, requests, and files.
5. Export original audio through the inspector. Choose a new destination filename;
   v0.1 refuses to overwrite an existing file.

The initial configurable chat model is `gpt-5.6-sol`, following Lorekeeper. SFX uses
`eleven_text_to_sound_v2`, `mp3_44100_128`, optional 0.5–30 second duration, looping,
and prompt influence. Account availability and output rights are provider-controlled.
This version does not send audio to a listening model or claim aesthetic approval.

## Data and recovery

The per-user `%APPDATA%/SfxChat` directory contains `library.sqlite`, `originals/`, and
encrypted `secrets/`. Do not publish this directory. Uninstalling does not
intentionally delete library data. See verification for the tested installed path.

Renderer reloads leave jobs and turns running. Closing the app stops active work.
On restart, undispatched jobs can run, while interrupted dispatched requests become
uncertain and are never automatically replayed. Cancellation may occur after billing.
Invalid returned audio is retained with a failed job. Export checks original hashes.

## Project references

- [VISION](VISION.md): product intent, not implementation status.
- [Architecture](docs/architecture.md) and [FILEMAP](FILEMAP.md): runtime and navigation.
- [Accepted plan](docs/implementation-plan.md): v0.1 scope.
- [API knowledge](docs/knowledge/README.md) and [sources](docs/sources.md): provenance.
