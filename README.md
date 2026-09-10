# SfxChat

A specialist chat workbench for creating, auditioning, refining, and organizing sound effects and music.

## Current status

This is a documentation-only repository foundation. It contains product direction, agent guidance, provisional architecture, and API knowledge carried over from Chimera. There is no runnable app, package manifest, build command, configured credential, or implemented provider integration yet.

Electron with React/TypeScript is the likely direction; the technology choice remains provisional. No .NET or Blazor application has been copied.

## Start the next session

1. Read [VISION.md](VISION.md), [AGENTS.md](AGENTS.md), [FILEMAP.md](FILEMAP.md), and [architecture](docs/architecture.md).
2. Read the relevant [API knowledge](docs/knowledge/README.md) and [source provenance](docs/sources.md). The repository-local [ElevenLabs skill](.agents/skills/elevenlabs-sound-effects/SKILL.md) is included with its license and installation reference.
3. Confirm the implementation stack and first end-to-end slice. Recheck current Codex authentication and provider capabilities before building integrations; research music generation separately.

The eventual product includes Codex account login, securely configured ElevenLabs/Gemini credentials, and assistant-managed audio libraries searchable by traits, tags, and initial prompts. These are requirements, not completed features.

The copied skill is reference material and does not install its CLI or SDK. Its model names, parameters, limits, and setup examples are a dated snapshot. No API calls, paid generation, media copying, or package installation were performed for this foundation.

This repository was initialized locally on `main`. No remote is configured and nothing has been published.
