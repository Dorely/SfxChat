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
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Dependency, vendored-skill, and audio-license notices. |
| [FILEMAP.md](FILEMAP.md) | This map of actual project files. |
| [.gitignore](.gitignore) | Excludes credentials, local data, generated media, dependencies, build artifacts, and local agent state. |
| [.gitattributes](.gitattributes) | LF conventions for authored text and byte-preserving vendored skill handling. |
| [.vscode/launch.json](.vscode/launch.json) | VS Code F5 launch configuration for source-mapped Electron main and renderer debugging. |

## Documentation and API knowledge

| File | Responsibility |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Implemented runtime ownership, persistence, providers, and recovery. |
| [docs/verification.md](docs/verification.md) | Dated manual, live, and build evidence with explicit gaps. |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Accepted v0.1 scope, delivery sequence, and verification requirements. |
| [docs/sources.md](docs/sources.md) | Source locations, revision/date/hash provenance, copy policy, and original documentation links. |
| [docs/research/agentic-audio-editing.md](docs/research/agentic-audio-editing.md) | Dated primary-source research, timing/representation limitations, and trimming design decisions. |
| [docs/research/audio-decoding.md](docs/research/audio-decoding.md) | Pinned MP3 decoder behavior, source revisions, licenses, and rebuild materials. |
| [docs/research/chat-context.md](docs/research/chat-context.md) | Codex default-context evidence, tokenizer provenance, and estimate limitations. |
| [third-party/](third-party/) | Decoder attribution, LGPL text, and corresponding upstream source/build archives shipped with the app. |
| [docs/knowledge/README.md](docs/knowledge/README.md) | API bundle navigation, historical-status caveats, and research boundaries. |
| [docs/knowledge/elevenlabs.md](docs/knowledge/elevenlabs.md) | Dated official SFX prompting review, endpoint/app control mapping, revision examples, source discrepancies, and evidence limits. |
| [docs/knowledge/elevenlabs-music.md](docs/knowledge/elevenlabs-music.md) | Dated official Music endpoint review, request mapping, limits, prompt-suggestion errors, prompting synthesis, and evidence limits. |
| [docs/knowledge/gemini-lyria.md](docs/knowledge/gemini-lyria.md) | Dated Lyria/Interactions review, model table, response parsing, limitations, and prompting synthesis. |
| [docs/knowledge/gemini-audio.md](docs/knowledge/gemini-audio.md) | Inherited audio-input, response, usage, and calibration lessons. |

## Repository-local skills

| File | Responsibility |
| --- | --- |
| [.agents/skills/elevenlabs-sound-effects/SKILL.md](.agents/skills/elevenlabs-sound-effects/SKILL.md) | Exact copy of the installed ElevenLabs sound-effects skill; frontmatter name is `sound-effects`. |
| [.agents/skills/elevenlabs-sound-effects/references/installation.md](.agents/skills/elevenlabs-sound-effects/references/installation.md) | Exact upstream CLI/SDK installation and authentication examples; no packages are installed by this copy. |
| [.agents/skills/elevenlabs-sound-effects/LICENSE](.agents/skills/elevenlabs-sound-effects/LICENSE) | Original ElevenLabs MIT license for the copied skill material. |
| [.agents/skills/elevenlabs-music/SKILL.md](.agents/skills/elevenlabs-music/SKILL.md) | Exact upstream ElevenLabs music skill snapshot; frontmatter name is `music`. |
| [.agents/skills/elevenlabs-music/references/api_reference.md](.agents/skills/elevenlabs-music/references/api_reference.md), [installation.md](.agents/skills/elevenlabs-music/references/installation.md) | Exact upstream Music endpoint parameters and SDK installation examples. |
| [.agents/skills/elevenlabs-music/LICENSE](.agents/skills/elevenlabs-music/LICENSE) | Original ElevenLabs MIT license for the copied music skill material. |

## Application foundation

| File | Responsibility |
| --- | --- |
| [package.json](package.json), [package-lock.json](package-lock.json) | Pinned runtime/development dependencies and build/package commands. |
| [tsconfig.json](tsconfig.json) | Strict TypeScript configuration. |
| [electron.vite.config.ts](electron.vite.config.ts), [electron-builder.yml](electron-builder.yml) | Desktop builds and unsigned Windows NSIS packaging. |
| [src/shared/types.ts](src/shared/types.ts) | Renderer/preload/application operation, project, and snapshot contracts. |
| [src/shared/chat-models.ts](src/shared/chat-models.ts) | Configured model IDs, Codex effort lists, default context sizes, and legacy/default resolution. |
| [src/shared/music-models.ts](src/shared/music-models.ts) | Music provider presets, reviewed model catalogs, and app-side duration bounds. |
| [src/main/chat-registry.ts](src/main/chat-registry.ts) | Generic provider/model registry, combined selection, test-gated saves, and active chat resolution. |
| [src/main/music-registry.ts](src/main/music-registry.ts) | Independent music provider registry, active/override resolution, and `music-key` credential names. |
| [src/main/chat-context.ts](src/main/chat-context.ts) | Cached local tiktoken context estimates with encrypted-reasoning exclusion and estimated media substitution. |
| [src/main/providers/generic/sse.ts](src/main/providers/generic/sse.ts) | Shared SSE frame splitting for generic chat adapters. |
| [src/main/providers/generic/chat.ts](src/main/providers/generic/chat.ts) | Chat Completions transport, history conversion, and reasoning-effort fallback. |
| [src/main/providers/generic/responses.ts](src/main/providers/generic/responses.ts) | Generic Responses transport without Codex-only headers. |
| [src/main/providers/generic/anthropic.ts](src/main/providers/generic/anthropic.ts) | Anthropic Messages transport with tool_use/tool_result translation. |
| [src/main/providers/generic/registry.ts](src/main/providers/generic/registry.ts) | Provider/model validation, base-URL normalization, and effort parsing. |
| [src/main/providers/generic/capabilities.ts](src/main/providers/generic/capabilities.ts) | Capability probes, max-tokens discovery, vision/audio flags, and tool filtering. |
| [src/main/store.ts](src/main/store.ts) | SQLite schema v2 migration, projects, per-project scoping, FTS5, assets, conversations, jobs, tool ledger, and recovery. |
| [src/main/media.ts](src/main/media.ts) | Original storage/import/export, integrity checks, serialized editing/analysis, and bounded decoded cache. |
| [src/main/audio.ts](src/main/audio.ts) | Bounded MP3/WAV decode, timestamped amplitude windows, energy event detection, loop-seam probing, exact sample-frame trims, loop crossfades, fades, mono WAV clip rendering, and float32 WAV rendering. |
| [src/main/png.ts](src/main/png.ts) | Minimal 8-bit RGB PNG encoder over Node zlib (filter 0 scanlines, hand-rolled CRC32 and chunks). |
| [src/main/spectrogram.ts](src/main/spectrogram.ts) | Self-contained STFT spectrogram rendering: radix-2 FFT, Hann window, full-scale-dB scaling, colormap, time/frequency grid, and exact mapping. |
| [src/main/validation.ts](src/main/validation.ts) | Runtime validation of privileged operations and generation inputs. |
| [src/main/service.ts](src/main/service.ts) | Shared library operations, project-scoped snapshots, sequential generation jobs, chat turns, capability-gated media attachments with history eviction, and tool execution. |
| [src/main/diagnostics.ts](src/main/diagnostics.ts) | Rotating local JSONL records, diagnostic references, and credential redaction. |
| [src/main/providers/errors.ts](src/main/providers/errors.ts) | Bounded provider error parsing, request IDs, readable failures, and safe diagnostic fields. |
| [src/main/assistant.ts](src/main/assistant.ts) | Runtime sound-design, ElevenLabs SFX, and per-provider music prompting/revision instructions, session naming guidance, plus assistant tool definitions. |
| [src/main/index.ts](src/main/index.ts) | Electron lifecycle, validated IPC, media protocol, provider wiring, and native dialogs. |
| [src/preload/index.ts](src/preload/index.ts) | Isolated renderer bridge with fixed operations and change notifications. |
| [src/main/providers/auth.ts](src/main/providers/auth.ts) | Codex browser OAuth/PKCE, refresh serialization, and login lifecycle. |
| [src/main/providers/codex.ts](src/main/providers/codex.ts) | Account Responses SSE transport and tool/message normalization. |
| [src/main/providers/elevenlabs.ts](src/main/providers/elevenlabs.ts) | Validated SFX requests, exact returned bytes, and response provenance. |
| [src/main/providers/elevenlabs-music.ts](src/main/providers/elevenlabs-music.ts) | Validated Music requests, length/instrumental mapping, `song-id` provenance, and returned formats. |
| [src/main/providers/gemini-music.ts](src/main/providers/gemini-music.ts) | Lyria prompt composition, Interactions requests with `store:false`, step/lyrics parsing, and fixed-length guards. |
| [src/main/providers/secrets.ts](src/main/providers/secrets.ts) | Atomic encrypted credential storage using injected OS protection and store-safe secret names. |
| [src/renderer/index.html](src/renderer/index.html), [src/renderer/main.tsx](src/renderer/main.tsx) | Renderer entrypoint and content security policy. |
| [src/renderer/App.tsx](src/renderer/App.tsx), [src/renderer/styles.css](src/renderer/styles.css) | Project switcher, session renaming, chat, effects and music libraries, Playground generation, audition, inspector, settings, and styling. |
| [src/renderer/Icon.tsx](src/renderer/Icon.tsx) | Shared inline SVG icon set drawn for this project, replacing font glyph icons. |
| [src/renderer/TrimEditor.tsx](src/renderer/TrimEditor.tsx) | Waveform trim selection, fine-window zoom, fades, spectrogram panel, exact rendered preview, and derived-asset saving. |
| [src/renderer/ChatContextMeter.tsx](src/renderer/ChatContextMeter.tsx) | Throttled composer context indicator, threshold styling, and estimate details. |
| [.github/workflows/windows.yml](.github/workflows/windows.yml) | Credential-free Windows typecheck and installer artifact build. |
