# SfxChat file map

Current state: documentation and API knowledge only. No application source, runtime interfaces, migrations, tests, or build outputs exist.

## Root

| File | Responsibility |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Durable agent workflow, delegation, security, documentation, and verification practices. |
| [VISION.md](VISION.md) | Product intent for specialist chat, audio creation/review, and assistant-managed libraries. |
| [README.md](README.md) | Current status and entry point for the next development session. |
| [LICENSE](LICENSE) | MIT license for SfxChat. |
| [FILEMAP.md](FILEMAP.md) | This map of actual project files. |
| [.gitignore](.gitignore) | Excludes credentials, local data, generated media, dependencies, and build artifacts. |
| [.gitattributes](.gitattributes) | LF conventions for authored text and byte-preserving vendored skill handling. |

## Documentation and API knowledge

| File | Responsibility |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Provisional Electron/React direction, ownership boundaries, security requirements, and reference-app lessons. |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Accepted v0.1 scope, delivery sequence, and verification requirements. |
| [docs/sources.md](docs/sources.md) | Source locations, revision/date/hash provenance, copy policy, and original documentation links. |
| [docs/knowledge/README.md](docs/knowledge/README.md) | API bundle navigation, historical-status caveats, and research boundaries. |
| [docs/knowledge/elevenlabs.md](docs/knowledge/elevenlabs.md) | Inherited SFX API request/prompt, output, provenance, and bounded-generation lessons. |
| [docs/knowledge/gemini-audio.md](docs/knowledge/gemini-audio.md) | Inherited audio-input, response, usage, and calibration lessons. |

## Repository-local skill

| File | Responsibility |
| --- | --- |
| [.agents/skills/elevenlabs-sound-effects/SKILL.md](.agents/skills/elevenlabs-sound-effects/SKILL.md) | Exact copy of the installed ElevenLabs sound-effects skill; frontmatter name is `sound-effects`. |
| [.agents/skills/elevenlabs-sound-effects/references/installation.md](.agents/skills/elevenlabs-sound-effects/references/installation.md) | Exact upstream CLI/SDK installation and authentication examples; no packages are installed by this copy. |
| [.agents/skills/elevenlabs-sound-effects/LICENSE](.agents/skills/elevenlabs-sound-effects/LICENSE) | Original ElevenLabs MIT license for the copied skill material. |

Future application files belong here only after they are created. Intended capabilities and unresolved runtime choices live in VISION and architecture.
