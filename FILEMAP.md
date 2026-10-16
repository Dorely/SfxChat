# SfxChat file map

Current state: v0.2 Windows desktop and local agent workbench. Actual platform/provider evidence
is recorded in [verification](docs/verification.md).

## Local workstation additions

| File | Responsibility |
| --- | --- |
| [src/shared/arrangement.ts](src/shared/arrangement.ts) | Arrangement, source, parameter and patch contracts; validation and tempo conversion. |
| [src/shared/arrangement-operations.ts](src/shared/arrangement-operations.ts) | Shared discovery/edit/render schemas and musical transformations. |
| [src/shared/sound-engine.ts](src/shared/sound-engine.ts), [soundfont-engine.ts](src/shared/soundfont-engine.ts) | Shared block scheduling, instruments/effects and WASM SoundFont lifecycle. |
| [src/main/arrangements.ts](src/main/arrangements.ts) | Schema-v6 document/history/job ownership, pinned dependencies, packages and MIDI export. |
| [src/main/arrangement-render-worker.ts](src/main/arrangement-render-worker.ts) | Offline streaming mix/stem/variation rendering and encoded-file diagnostics. |
| [src/main/wav-reader.ts](src/main/wav-reader.ts) | Bounded WAV range decoding and streaming full-length analysis. |
| [src/renderer/ArrangementStudio.tsx](src/renderer/ArrangementStudio.tsx), [arrangement.css](src/renderer/arrangement.css) | Manual arrangement, note/drum, instrument, mixer, automation, revision and export editors. |
| [src/renderer/arrangement-player.ts](src/renderer/arrangement-player.ts), [arrangement-worker.ts](src/renderer/arrangement-worker.ts), [arrangement-worklet.ts](src/renderer/arrangement-worklet.ts) | User-controlled worker/worklet transport and shared-core live rendering. |
| [docs/research/local-dsp.md](docs/research/local-dsp.md) | DSP sources, algorithm limits and licensing boundaries. |
| [docs/workstation-trials.md](docs/workstation-trials.md) | Actual MCP creative trials, preservation evidence, exported candidate inventory and pending listening decisions. |
| [third-party/wasm-synthesis](third-party/wasm-synthesis/README.md) | Pinned WASM engine sources, hashes, licenses and rebuild directions. |
| [resources/skill/references/arranging.md](resources/skill/references/arranging.md), [synthesis.md](resources/skill/references/synthesis.md), [mixing.md](resources/skill/references/mixing.md), [sound-design.md](resources/skill/references/sound-design.md), [local-workflow.md](resources/skill/references/local-workflow.md) | General musical/sound-design guidance and local operation workflow, routed by the canonical guidance manifest. |

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
| [docs/research/midi.md](docs/research/midi.md) | Pinned FluidSynth/gcem/SoundFont provenance, GM bank licensing and sample caveat, build recipe, and build-spike evidence. |
| [docs/research/music-composition.md](docs/research/music-composition.md) | Sources and limits for the composing guidance shipped as runtime prompt and skill references. |
| [third-party/](third-party/) | Decoder attribution, LGPL text, and corresponding upstream source/build archives shipped with the app. |
| [third-party/synthesis/](third-party/synthesis/) | Pinned FluidSynth 2.6.1 and gcem archives with hashes and LGPL/Apache license texts for offline MIDI rendering. |
| [resources/soundfonts/](resources/soundfonts/) | Bundled GeneralUser GS General MIDI bank and its license, packaged as an app resource for playback and export. |
| [resources/icon.svg](resources/icon.svg), [icon-small.svg](resources/icon-small.svg) | App icon masters: full design, and a simplified pixel-grid version for 16-24 px. |
| [resources/icon.ico](resources/icon.ico), [icon.png](resources/icon.png) | Icon rasters rendered from the masters (ICO 16-256 px with the small master at 16-24 px; 512 px PNG) for the window, installer, and packaged resources. |
| [docs/knowledge/README.md](docs/knowledge/README.md) | API bundle navigation, historical-status caveats, and research boundaries. |
| [docs/knowledge/elevenlabs.md](docs/knowledge/elevenlabs.md) | Dated official SFX prompting review, endpoint/app control mapping, revision examples, source discrepancies, and evidence limits. |
| [docs/knowledge/elevenlabs-music.md](docs/knowledge/elevenlabs-music.md) | Dated official Music endpoint review, request mapping, limits, prompt-suggestion errors, prompting synthesis, and evidence limits. |
| [docs/knowledge/gemini-lyria.md](docs/knowledge/gemini-lyria.md) | Dated Lyria/Interactions review, model table, response parsing, limitations, and prompting synthesis. |
| [docs/knowledge/voice-generation.md](docs/knowledge/voice-generation.md) | Dated TTS source/control coverage, endpoint mapping, bounds, evidence and budget. |
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
| [electron.vite.config.ts](electron.vite.config.ts), [electron-builder.yml](electron-builder.yml) | Desktop builds, live/offline audio worker build ownership and dev serving, and unsigned Windows NSIS packaging. |
| [scripts/dev-browser.mjs](scripts/dev-browser.mjs) | Launches the real Electron owner without a window and requests graceful browser-host shutdown. |
| [src/main/browser-host.ts](src/main/browser-host.ts) | Loopback-only development renderer/RPC/SSE/media transport with origin validation. |
| [src/shared/api.ts](src/shared/api.ts) | Fixed capability factory shared by isolated preload and browser transport. |
| [src/renderer/browser-api.ts](src/renderer/browser-api.ts) | Same-origin browser calls, byte restoration, change/UI events, and host-path file dialogs. |
| [src/shared/types.ts](src/shared/types.ts) | Renderer/preload/application operation, project, and snapshot contracts. |
| [src/shared/chat-models.ts](src/shared/chat-models.ts) | Configured model IDs, Codex effort lists, default context sizes, and legacy/default resolution. |
| [src/shared/voice-models.ts](src/shared/voice-models.ts) | Reviewed TTS profiles/controls, Gemini catalog/voices, defaults, conservative future-model guidance and admission guards. |
| [src/shared/provider-identities.ts](src/shared/provider-identities.ts) | Shared official Gemini host recognition for credential routing. |
| [src/main/provider-keys.ts](src/main/provider-keys.ts) | Serialized shared vendor credentials and safe legacy consolidation/conflict selection. |
| [src/main/voice-registry.ts](src/main/voice-registry.ts) | Independent saved model/default voice and active vendor. |
| [src/main/providers/voice.ts](src/main/providers/voice.ts) | Bounded REST TTS, voice discovery, cached authenticated ElevenLabs model discovery and target validation, original bytes/provenance. |
| [src/renderer/VoiceControls.tsx](src/renderer/VoiceControls.tsx) | Shared live-model refresh/picker, model guidance/controls, voice discovery and Playground voice form. |
| [src/renderer/ProviderSettings.tsx](src/renderer/ProviderSettings.tsx) | Vendor key entry, encrypted-key conflict selection, and voice defaults. |
| [src/shared/music-models.ts](src/shared/music-models.ts) | Music provider presets, reviewed model catalogs, and app-side duration bounds. |
| [src/main/chat-registry.ts](src/main/chat-registry.ts) | Generic provider/model registry, combined selection, test-gated saves, and active chat resolution. |
| [src/main/music-registry.ts](src/main/music-registry.ts) | Music model target registry and active/override resolution through shared vendor keys. |
| [src/main/chat-context.ts](src/main/chat-context.ts) | Cached local tiktoken context estimates with encrypted-reasoning exclusion and estimated media substitution. |
| [src/main/providers/generic/sse.ts](src/main/providers/generic/sse.ts) | Shared SSE frame splitting for generic chat adapters. |
| [src/main/providers/generic/chat.ts](src/main/providers/generic/chat.ts) | Chat Completions transport, history conversion, and reasoning-effort fallback. |
| [src/main/providers/generic/responses.ts](src/main/providers/generic/responses.ts) | Generic Responses transport without Codex-only headers. |
| [src/main/providers/generic/anthropic.ts](src/main/providers/generic/anthropic.ts) | Anthropic Messages transport with tool_use/tool_result translation. |
| [src/main/providers/generic/registry.ts](src/main/providers/generic/registry.ts) | Provider/model validation, base-URL normalization, and effort parsing. |
| [src/main/providers/generic/capabilities.ts](src/main/providers/generic/capabilities.ts) | Capability probes, max-tokens discovery, vision/audio flags, and tool filtering. |
| [src/main/store.ts](src/main/store.ts) | SQLite schema v6 migrations, project reviews/shared Playground, lifecycle locks/history, workspace deletion and request replay, FTS5, assets, conversations, jobs, tool ledger, and recovery. |
| [src/main/media.ts](src/main/media.ts) | Original/chat storage, import, integrity checks, PCM16 conversion, serialized editing/analysis, and bounded decoded cache. |
| [src/main/audio.ts](src/main/audio.ts) | Bounded MP3/WAV decode, timestamped amplitude windows, energy event detection, loop-seam probing, exact sample-frame trims, loop crossfades, fades, mono WAV clip rendering, and float32 WAV rendering. |
| [src/main/png.ts](src/main/png.ts) | Minimal 8-bit RGB PNG encoder over Node zlib (filter 0 scanlines, hand-rolled CRC32 and chunks). |
| [src/main/spectrogram.ts](src/main/spectrogram.ts) | Self-contained STFT spectrogram rendering: radix-2 FFT, Hann window, full-scale-dB scaling, colormap, time/frequency grid, and exact mapping. |
| [src/shared/midi.ts](src/shared/midi.ts) | Beat-based MIDI note model, bounds, General MIDI instrument/drum names, and duration/summary helpers. |
| [src/main/midi.ts](src/main/midi.ts) | Standard MIDI File writer and parser plus clip duration for the MIDI creator. |
| [src/main/soundfont.ts](src/main/soundfont.ts) | SoundFont bank resolution, SF2 preset enumeration, and cached bank identity for MIDI playback. |
| [src/main/midi-render.ts](src/main/midi-render.ts) | Serialized helper-backed MIDI-to-audio rendering with a bounded on-disk cache. |
| [src/main/validation.ts](src/main/validation.ts) | Runtime validation of privileged operations and generation inputs. |
| [src/main/service.ts](src/main/service.ts) | Shared library operations, project-scoped snapshots, sequential generation jobs, chat turns, capability-gated media attachments (transcript cards, history eviction), and tool execution. |
| [src/main/diagnostics.ts](src/main/diagnostics.ts) | Rotating local JSONL records, diagnostic references, and credential redaction. |
| [src/main/providers/errors.ts](src/main/providers/errors.ts) | Bounded provider error parsing, request IDs, readable failures, and safe diagnostic fields. |
| [src/main/assistant.ts](src/main/assistant.ts) | Composition of canonical guidance and internal assistant tool adapters. |
| [src/main/index.ts](src/main/index.ts) | Electron lifecycle, validated IPC, media protocol, provider wiring, and native dialogs. |
| [src/preload/index.ts](src/preload/index.ts) | Isolated renderer bridge with fixed operations and change notifications. |
| [src/main/providers/auth.ts](src/main/providers/auth.ts) | Codex browser OAuth/PKCE, refresh serialization, and login lifecycle. |
| [src/main/providers/codex.ts](src/main/providers/codex.ts) | Account Responses SSE transport and tool/message normalization. |
| [src/main/providers/elevenlabs.ts](src/main/providers/elevenlabs.ts) | Validated SFX requests, exact returned bytes, and response provenance. |
| [src/main/providers/elevenlabs-music.ts](src/main/providers/elevenlabs-music.ts) | Validated Music requests, length/instrumental mapping, `song-id` provenance, and returned formats. |
| [src/main/providers/gemini-music.ts](src/main/providers/gemini-music.ts) | Lyria prompt composition, Interactions requests with `store:false`, step/lyrics parsing, and fixed-length guards. |
| [src/main/providers/secrets.ts](src/main/providers/secrets.ts) | Atomic encrypted credential storage using injected OS protection and store-safe secret names. |
| [src/renderer/index.html](src/renderer/index.html), [src/renderer/main.tsx](src/renderer/main.tsx) | Renderer entrypoint and content security policy; applies the stored theme before first render. |
| [src/renderer/themes.css](src/renderer/themes.css), [src/renderer/theme.ts](src/renderer/theme.ts) | Theme color tokens (Studio, Midnight, Ember, Daylight) and the per-device theme preference. |
| [src/renderer/App.tsx](src/renderer/App.tsx), [src/renderer/styles.css](src/renderer/styles.css) | Project switcher, project/conversation deletion confirmations, theme picker, session renaming, chat with the composer model picker, effects, music, and voice libraries, Playground generation, audition, inspector, two-pane settings, and token-based styling. |
| [src/renderer/Icon.tsx](src/renderer/Icon.tsx) | Shared inline SVG icon set drawn for this project, replacing font glyph icons. |
| [src/renderer/TrimEditor.tsx](src/renderer/TrimEditor.tsx) | Waveform trim selection, fine-window zoom, fades, spectrogram panel, exact rendered preview, and derived-asset saving. |
| [src/renderer/MidiStudio.tsx](src/renderer/MidiStudio.tsx) | MIDI workspace: clip rail, track lanes with sticky headers and key gutters on a shared ruler, note editing and keyboard nudging, transport with playhead audition, and derivative saving. |
| [src/renderer/ChatContextMeter.tsx](src/renderer/ChatContextMeter.tsx) | Throttled composer context indicator, threshold styling, and estimate details. |
| [.github/workflows/windows.yml](.github/workflows/windows.yml) | Credential-free Windows typecheck and installer artifact build. |

## Agent workbench

| File | Responsibility |
| --- | --- |
| [docs/agent-workbench.md](docs/agent-workbench.md) | CLI/MCP operations, scopes, installation, review/export contracts and limits. |
| [docs/chimera-integration.md](docs/chimera-integration.md) | Migration recipe for Chimera's raw API and HTML audition workflow; no sibling edits. |
| [docs/research/agent-runtime.md](docs/research/agent-runtime.md) | Pinned runtime/encoder rebuild, official sources and guidance extraction provenance. |
| [src/cli/index.ts](src/cli/index.ts) | JSON CLI, on-demand desktop startup, authenticated client, stdio MCP tools/media/resources and bounded review notification watches. |
| [src/main/operations.ts](src/main/operations.ts) | Shared schemas/dispatch, project scopes, deletion, validation, and default cue-sheet presentation with separate save/UI outcomes. |
| [src/main/bridge.ts](src/main/bridge.ts) | Private named-pipe endpoint, authenticated framing and protected discovery. |
| [src/main/ui-port.ts](src/main/ui-port.ts) | Explicit renderer commands, acknowledgment, visibility stop and actual playback status. |
| [src/main/exporter.ts](src/main/exporter.ts) | Integrity-checked original/WAV/Vorbis exports, cue packs, provenance and incomplete manifests. |
| [src/shared/workbench.ts](src/shared/workbench.ts) | Review, revision attribution, playback, installation and error contracts. |
| [src/shared/guidance.ts](src/shared/guidance.ts) | Canonical packaged guidance imports shared by app and CLI. |
| [src/shared/install.ts](src/shared/install.ts) | Project/user/custom skills and Codex/Claude MCP config installation with conflict/backups. |
| [src/shared/native.ts](src/shared/native.ts) | Narrow bounded helper transport for DPAPI and directory ACL operations. |
| [src/renderer/AudioCard.tsx](src/renderer/AudioCard.tsx) | Shared sound-card frame, lazy cached waveforms, memoized MIDI roll and playhead, seek/time transport, and native preview controls for libraries, Playground, inspector and cue reviews. |
| [src/renderer/ReviewPanel.tsx](src/renderer/ReviewPanel.tsx) | Cue-grouped cards, project-wide active/archive launcher, per-card playback subscriptions, lazy library pickers, Done/reopen, references, preview settings, immediate decision saves, notes/drafts, stale revisions and pack export. |
| [src/renderer/audition.ts](src/renderer/audition.ts) | User-controlled single-source WebAudio playback/Loop, card-scoped external progress subscriptions, seeking, cancellable loading and lifecycle reports. |
| [src/renderer/AgentSettings.tsx](src/renderer/AgentSettings.tsx) | Scoped integration installation, explicit MCP registration, status and previews. |
| [resources/skill/SKILL.md](resources/skill/SKILL.md) | Installable workflow and required reference/version discovery instructions. |
| [resources/skill/references/design.md](resources/skill/references/design.md), [workflow.md](resources/skill/references/workflow.md) | Complete shared creative direction, music brief examples, scope, jobs, session naming, reviews and export. |
| [resources/skill/references/elevenlabs-sfx.md](resources/skill/references/elevenlabs-sfx.md) | Complete SFX prompting, controls, examples, constraints and revisions. |
| [resources/skill/references/elevenlabs-voice.md](resources/skill/references/elevenlabs-voice.md), [gemini-voice.md](resources/skill/references/gemini-voice.md) | Canonical voice selection, script/delivery/pronunciation guidance, examples, revisions and unsupported features. |
| [resources/skill/references/editing.md](resources/skill/references/editing.md) | Measurement/visual/listening evidence, exact trims, fades, seam probes and loops. |
| [resources/skill/references/elevenlabs-music.md](resources/skill/references/elevenlabs-music.md), [gemini-lyria.md](resources/skill/references/gemini-lyria.md) | Complete supported-provider music guidance, controls and examples. |
| [resources/skill/references/music-craft.md](resources/skill/references/music-craft.md), [midi-instruments.md](resources/skill/references/midi-instruments.md), [midi-workflow.md](resources/skill/references/midi-workflow.md) | Composing craft, arranging for the General MIDI bank, and the compose_midi workflow, bounds, and evidence limits. |
| [scripts/build-agent.mjs](scripts/build-agent.mjs) | CLI/runtime/skill packaging, pinned source verification (encoding and synthesis archives) and native helper build. |
| [native/helper.cpp](native/helper.cpp), [native/CMakeLists.txt](native/CMakeLists.txt) | Windows DPAPI/ACL/PATH, bounded Vorbis encoder, and offline FluidSynth MIDI rendering, linked against pinned sources. |
| [installer/agent.nsh](installer/agent.nsh) | User command discovery installation/removal hooks. |
| [third-party/encoding/](third-party/encoding/) | Unmodified libogg/libvorbis source archives, SHA-256 manifests, official listings and BSD notices. |
| [third-party/node-LICENSE.txt](third-party/node-LICENSE.txt) | Pinned redistributed Node runtime and dependency license bundle. |
