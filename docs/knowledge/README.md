# API knowledge bundle

This bundle carries forward only knowledge related to using audio APIs properly. It is a historical implementation handoff, not freshly verified provider documentation or a complete sound-design curriculum.

| Read | Purpose |
| --- | --- |
| [ElevenLabs notes](elevenlabs.md) | Request/prompt construction, formats, generation provenance, bounded batches, and retry behavior. |
| [Gemini audio notes](gemini-audio.md) | Audio attachments, model-dependent settings, response handling, usage reporting, and calibration limits. |
| [Vendored ElevenLabs skill](../../.agents/skills/elevenlabs-sound-effects/SKILL.md) | Original local skill snapshot, with [installation reference](../../.agents/skills/elevenlabs-sound-effects/references/installation.md) and [MIT license](../../.agents/skills/elevenlabs-sound-effects/LICENSE). |
| [Sources and provenance](../sources.md) | Original paths, snapshot revisions, hashes, extraction dates, and provider documentation links. |

Read the relevant provider note alongside the skill before implementation. Recheck models, parameters, limits, prices, SDKs, and terms using official documentation at that time. The inherited skill's installation examples are not app setup instructions, and CLI authentication does not implement SfxChat's own secure settings.

The notes preserve API-handling lessons without copying audio, game-specific taste, audition history, local model installations, or executable utilities. Music-generation API selection and broader expert prompting research are future work. Nothing here establishes that the Gemini audio-input endpoint generates music or that a model can reliably approve sound quality.
