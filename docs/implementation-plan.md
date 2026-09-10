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
6. Verify services, transports, recovery, secure storage, mocked Electron workflow,
   native SQLite, and installed package. Real login/generation/listener checks are
   recorded separately and must not be inferred from compilation or mocks.

One library per Windows user; Playground membership/order belongs to a conversation.
Default chat model follows Lorekeeper (`gpt-5.6-sol`), configurable in settings.
Default SFX model is `eleven_text_to_sound_v2`, MP3 output, one candidate unless
otherwise requested. No approval dialogs, spending caps, or artificial count limits.
Music, Gemini analysis, local editing/mixing, cloud sync, multiple library locations,
automatic updates, signing, and non-Windows packaging are deferred.

Use focused reviewed commits and Windows CI without live credentials. Produce an
unsigned installer locally. Preserve the ElevenLabs vendored license separately.
