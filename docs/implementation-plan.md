# v0.1 implementation plan

Accepted 2026-09-10. VISION is product intent, revised before implementation only
when intent changes. Implementation evidence belongs in README and architecture.

1. Publish the reviewed foundation as public MIT `Dorely/SfxChat`, retaining history.
2. Build Windows x64 Electron/React/TypeScript with electron-vite, electron-builder
   NSIS, isolated preload operations, SQLite migrations/FTS5, and immutable media.
3. Adapt Lorekeeper/PixelChat direct Codex OAuth PKCE and Responses SSE transport.
   Keep credentials in Windows-backed secure storage, with no CLI dependency.
4. Implement persistent chat/tool orchestration and ElevenLabs SFX generation,
   sequential durable jobs, cancellation, explicit uncertain outcomes, and no
   automatic replay of potentially billed work. Generation requests run directly.
5. Build the resizable left-third chat and right-side Library/Playground. Include
   WAV/MP3 import, search, tags/collections/reviews, provenance, linked regeneration,
   waveform playback, seeking/loop/preview volume, comparison, and original export.
6. Verify services, transports, recovery, secure storage, and the installed package by
   type checking, production builds, and live/manual runs. Real login/generation/listener
   checks are recorded separately and must not be inferred from compilation.

Libraries and conversations are scoped to a project; Playground membership/order belongs to a conversation.
Default chat model follows Lorekeeper (`gpt-5.6-sol`), configurable in settings.
Default SFX model is `eleven_text_to_sound_v2`, MP3 output, one candidate unless
otherwise requested. No approval dialogs, spending caps, or artificial count limits.
Music, Gemini analysis, local editing/mixing, cloud sync, multiple library locations,
automatic updates, signing, and non-Windows packaging are deferred.

## Music providers (added after v0.1)

Accepted 2026-09-21. Music became a first-class library kind with its own provider
configuration, deliberately separate from chat providers and from the sound-effects key:
one active music provider with an optional per-generation override, its own
`music-key-<id>` secret, and a `generate_music` tool. ElevenLabs Music and Google's Lyria
models are implemented; researched prompting guidance is written into the runtime
assistant prompt per active provider and recorded in
[docs/knowledge](knowledge/README.md). Composition plans, audio reference, inpainting,
streaming, stem separation, image-to-music input, and provider-side metadata (word
timestamps, waveform visuals) remain deferred, as do new assistant tools for inspecting
or modifying music files.

## Projects and session titles (added after v0.1)

Accepted 2026-09-22. Projects sequester work: each project owns its conversations, messages,
jobs, Playground ordering, and its effects and music libraries, switched by a dropdown in the
top bar next to the Workspace label. Existing libraries migrate to one Default project
(schema v2). Provider configuration and credentials stay app-level, and originals/ stays a
flat asset-id store. Session and project titles are editable in place; a rename_session tool
plus explicit prompt guidance keep each session labeled as its scope evolves. Deferred:
project deletion, cross-project copy or move of assets and conversations, per-project
providers and keys, and assistant-side project creation or switching.

Use focused reviewed commits, the type check, and local package builds without live
credentials; the project uses no hosted CI. Produce unsigned packages locally. Preserve the ElevenLabs vendored
license separately. Automated test suites of any kind are out of scope for this project;
see [AGENTS.md](../AGENTS.md).
