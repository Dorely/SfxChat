# API knowledge bundle

This bundle carries forward knowledge related to using audio APIs properly. ElevenLabs sound-effect and Music guidance and the Gemini Lyria guidance were rechecked against official sources on 2026-09-21; the older Gemini audio-input notes and the sound-effects skill snapshot remain historical handoff material. It is not a complete sound-design curriculum.

Runtime guidance for the assistant lives in [assistant.ts](../../src/main/assistant.ts), which
selects the sound-effect instructions plus the active music provider's block each turn.
The notes below are the provenance and verification record for that text.

| Read | Purpose |
| --- | --- |
| [ElevenLabs sound-effect notes](elevenlabs.md) | Verified SFX prompting/control guidance, documentation discrepancies, app request mapping, revision examples, and evidence limits. |
| [ElevenLabs Music notes](elevenlabs-music.md) | Verified Music endpoint mapping, limits, `bad_prompt` suggestions, length discrepancy, prompting synthesis, and evidence limits. |
| [Gemini Lyria notes](gemini-lyria.md) | Verified Interactions request shape, model table, step/lyrics parsing, single-turn and watermark limits, and Lyria prompting synthesis. |
| [Gemini audio-input notes](gemini-audio.md) | Audio attachments, model-dependent settings, response handling, usage reporting, and calibration limits. Historical handoff material. |
| [Vendored ElevenLabs skills](../../.agents/skills/elevenlabs-sound-effects/SKILL.md) | Upstream sound-effects and [music](../../.agents/skills/elevenlabs-music/SKILL.md) snapshots, with their installation references and MIT licenses. |
| [Sources and provenance](../sources.md) | Original paths, snapshot revisions, hashes, extraction dates, and provider documentation links. |

Read the relevant provider note alongside the skill before implementation. Recheck models, parameters, limits, prices, SDKs, and terms using official documentation at that time. The inherited skill's installation examples are not app setup instructions, and CLI authentication does not implement SfxChat's own secure settings.

The notes preserve API-handling lessons without copying audio, game-specific taste, audition history, local model installations, or executable utilities. Nothing here establishes that the Gemini audio-input endpoint generates music or that a model can reliably approve sound quality. Earlier revisions of this bundle deferred music-generation research; that research now exists as the two notes above.
