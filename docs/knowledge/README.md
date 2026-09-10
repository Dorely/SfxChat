# API knowledge bundle

This bundle carries forward knowledge related to using audio APIs properly. ElevenLabs endpoint and prompting guidance was rechecked against official sources on 2026-09-10; Gemini notes and the vendored skill remain historical handoff material. It is not a complete sound-design curriculum.

| Read | Purpose |
| --- | --- |
| [ElevenLabs notes](elevenlabs.md) | Verified SFX prompting/control guidance, documentation discrepancies, app request mapping, revision examples, and evidence limits. |
| [Gemini audio notes](gemini-audio.md) | Audio attachments, model-dependent settings, response handling, usage reporting, and calibration limits. |
| [Vendored ElevenLabs skill](../../.agents/skills/elevenlabs-sound-effects/SKILL.md) | Original local skill snapshot, with [installation reference](../../.agents/skills/elevenlabs-sound-effects/references/installation.md) and [MIT license](../../.agents/skills/elevenlabs-sound-effects/LICENSE). |
| [Sources and provenance](../sources.md) | Original paths, snapshot revisions, hashes, extraction dates, and provider documentation links. |

Read the relevant provider note alongside the skill before implementation. Recheck models, parameters, limits, prices, SDKs, and terms using official documentation at that time. The inherited skill's installation examples are not app setup instructions, and CLI authentication does not implement SfxChat's own secure settings.

The notes preserve API-handling lessons without copying audio, game-specific taste, audition history, local model installations, or executable utilities. Music-generation API selection and broader expert prompting research are future work. Nothing here establishes that the Gemini audio-input endpoint generates music or that a model can reliably approve sound quality.
