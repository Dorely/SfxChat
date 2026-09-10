# SfxChat file map

Current state: v0.1 Windows desktop application. Actual platform/provider evidence
is recorded in [verification](docs/verification.md).

## Root

| File | Responsibility |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Durable agent workflow, delegation, security, documentation, and verification practices. |
| [VISION.md](VISION.md) | Product intent for specialist chat, audio creation/review, and assistant-managed libraries. |
| [README.md](README.md) | Current status and entry point for the next development session. |
| [LICENSE](LICENSE) | MIT license for SfxChat. |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Dependency, vendored-skill, fixture, and audio-license notices. |
| [FILEMAP.md](FILEMAP.md) | This map of actual project files. |
| [.gitignore](.gitignore) | Excludes credentials, local data, generated media, dependencies, and build artifacts. |
| [.gitattributes](.gitattributes) | LF conventions for authored text and byte-preserving vendored skill handling. |
| [.vscode/launch.json](.vscode/launch.json) | VS Code F5 launch configuration for source-mapped Electron main and renderer debugging. |

## Documentation and API knowledge

| File | Responsibility |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Implemented runtime ownership, persistence, providers, and recovery. |
| [docs/verification.md](docs/verification.md) | Actual automated/platform checks and live acceptance status. |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Accepted v0.1 scope, delivery sequence, and verification requirements. |
| [docs/sources.md](docs/sources.md) | Source locations, revision/date/hash provenance, copy policy, and original documentation links. |
| [docs/research/agentic-audio-editing.md](docs/research/agentic-audio-editing.md) | Dated primary-source research, timing/representation limitations, and trimming design decisions. |
| [docs/research/audio-decoding.md](docs/research/audio-decoding.md) | Pinned MP3 decoder behavior, source revisions, licenses, and rebuild materials. |
| [third-party/](third-party/) | Decoder attribution, LGPL text, and corresponding upstream source/build archives shipped with the app. |
| [docs/knowledge/README.md](docs/knowledge/README.md) | API bundle navigation, historical-status caveats, and research boundaries. |
| [docs/knowledge/elevenlabs.md](docs/knowledge/elevenlabs.md) | Inherited SFX API request/prompt, output, provenance, and bounded-generation lessons. |
| [docs/knowledge/gemini-audio.md](docs/knowledge/gemini-audio.md) | Inherited audio-input, response, usage, and calibration lessons. |

## Repository-local skill

| File | Responsibility |
| --- | --- |
| [.agents/skills/elevenlabs-sound-effects/SKILL.md](.agents/skills/elevenlabs-sound-effects/SKILL.md) | Exact copy of the installed ElevenLabs sound-effects skill; frontmatter name is `sound-effects`. |
| [.agents/skills/elevenlabs-sound-effects/references/installation.md](.agents/skills/elevenlabs-sound-effects/references/installation.md) | Exact upstream CLI/SDK installation and authentication examples; no packages are installed by this copy. |
| [.agents/skills/elevenlabs-sound-effects/LICENSE](.agents/skills/elevenlabs-sound-effects/LICENSE) | Original ElevenLabs MIT license for the copied skill material. |

## Application foundation

| File | Responsibility |
| --- | --- |
| [package.json](package.json), [package-lock.json](package-lock.json) | Pinned runtime/development dependencies and build/test/package commands. |
| [tsconfig.json](tsconfig.json) | Strict TypeScript configuration. |
| [electron.vite.config.ts](electron.vite.config.ts), [electron-builder.yml](electron-builder.yml) | Desktop builds and unsigned Windows NSIS packaging. |
| [vitest.config.ts](vitest.config.ts), [scripts/test.mjs](scripts/test.mjs) | Unit tests using Electron's Node runtime and native-module ABI. |
| [scripts/smoke-installed.mjs](scripts/smoke-installed.mjs) | Installed-app startup, native SQLite, secure-storage availability, and packaged-mode isolation checks. |
| [src/shared/types.ts](src/shared/types.ts) | Renderer/preload/application operation and snapshot contracts. |
| [src/main/store.ts](src/main/store.ts) | SQLite schema migration, FTS5, assets, conversations, jobs, tool ledger, and recovery. |
| [src/main/media.ts](src/main/media.ts) | Original storage/import/export, integrity checks, serialized editing/analysis, and bounded decoded cache. |
| [src/main/audio.ts](src/main/audio.ts) | Bounded MP3/WAV decode, timestamped amplitude windows, exact sample-frame trims, fades, and float32 WAV rendering. |
| [src/main/validation.ts](src/main/validation.ts) | Runtime validation of privileged operations and generation inputs. |
| [src/main/service.ts](src/main/service.ts) | Shared library operations, sequential generation jobs, chat turns, and tool execution. |
| [src/main/diagnostics.ts](src/main/diagnostics.ts) | Rotating local JSONL records, diagnostic references, and credential redaction. |
| [src/main/providers/errors.ts](src/main/providers/errors.ts) | Bounded provider error parsing, request IDs, readable failures, and safe diagnostic fields. |
| [src/main/assistant.ts](src/main/assistant.ts) | Runtime sound-design instructions and assistant tool definitions. |
| [tests/runtime.test.ts](tests/runtime.test.ts) | Persistence, search, provenance, jobs, tool replay, import/export, and recovery tests. |
| [tests/fixtures/tone.mp3](tests/fixtures/tone.mp3) | Synthetic 440 Hz test tone, generated locally with FFmpeg; no provider-generated media. |
| [src/main/index.ts](src/main/index.ts) | Electron lifecycle, validated IPC, media protocol, provider wiring, and native dialogs. |
| [src/preload/index.ts](src/preload/index.ts) | Isolated renderer bridge with fixed operations and change notifications. |
| [src/main/providers/auth.ts](src/main/providers/auth.ts) | Codex browser OAuth/PKCE, refresh serialization, and login lifecycle. |
| [src/main/providers/codex.ts](src/main/providers/codex.ts) | Account Responses SSE transport and tool/message normalization. |
| [src/main/providers/elevenlabs.ts](src/main/providers/elevenlabs.ts) | Validated SFX requests, exact returned bytes, and response provenance. |
| [src/main/providers/secrets.ts](src/main/providers/secrets.ts) | Atomic encrypted credential storage using injected OS protection. |
| [src/main/testing.ts](src/main/testing.ts) | Deterministic development-only provider ports for Electron tests. |
| [tests/providers.test.ts](tests/providers.test.ts) | Secure-store, OAuth, streamed chat/tool, and SFX transport tests. |
| [src/renderer/index.html](src/renderer/index.html), [src/renderer/main.tsx](src/renderer/main.tsx) | Renderer entrypoint and content security policy. |
| [src/renderer/App.tsx](src/renderer/App.tsx), [src/renderer/styles.css](src/renderer/styles.css) | Chat, Library, Playground, audition, inspector, settings, and styling. |
| [src/renderer/TrimEditor.tsx](src/renderer/TrimEditor.tsx) | Waveform trim selection, fine-window zoom, fades, exact rendered preview, and derived-asset saving. |
| [tests/audio-editing.test.ts](tests/audio-editing.test.ts) | Sample/channel correctness, analysis zoom, fades, provenance/replay, source integrity, MP3 decode, and shutdown. |
| [tests/trim-editor.spec.ts](tests/trim-editor.spec.ts) | Electron trimming workflow, preview, waveform zoom, preserved originals, and persisted derivatives. |
| [playwright.config.ts](playwright.config.ts), [tests/workbench.spec.ts](tests/workbench.spec.ts) | Mocked Electron workflow, playback, persistence, and Windows secure-storage checks. |
| [tests/lifecycle.test.ts](tests/lifecycle.test.ts) | Shutdown, tool recovery, conversation attribution, and chat round-trip regressions. |
| [tests/diagnostics.test.ts](tests/diagnostics.test.ts), [tests/provider-errors.test.ts](tests/provider-errors.test.ts) | Log persistence/rotation, redaction, provider error details, and body-read bounds. |
| [tests/codex-history.test.ts](tests/codex-history.test.ts), [tests/history-repair.test.ts](tests/history-repair.test.ts), [tests/chat-diagnostics.test.ts](tests/chat-diagnostics.test.ts) | Streamed history preservation, ledger-based repair, follow-up errors, and generation without replay. |
| [.github/workflows/windows.yml](.github/workflows/windows.yml) | Credential-free Windows tests and installer artifact build. |
