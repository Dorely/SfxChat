---
name: sfxchat
description: Create and revise editable local music and sound, or use configured audio providers, through SfxChat. Includes composition, synthesis, arrangement, technical inspection, shared candidate reviews, voice, and export.
---

# SfxChat

Use the installed workbench for the complete workflow. The app owns arrangements,
providers, credentials, immutable originals, and jobs. Do not make raw provider
calls or build a separate audition interface. Follow the user's chosen route;
editable local synthesis needs no provider, API key, or paid generation.

1. Read `guidance`; compare its complete hash with `guidance.json` beside this
   skill. Use returned current documents if they differ. Discover tools/schemas
   through MCP or `sfxchat tools`; CLI calls use `sfxchat call <operation> --input
   <request.json>`. Select or create an explicit project and session. The visible
   UI project is not the agent's workflow context.
2. Load only relevant references, using `guidance` with `topics` (filename or stem).
   Omitting topics remains the complete response. For music read [composition](references/music-craft.md)
   and [arranging](references/arranging.md); for local sound sources read
   [synthesis](references/synthesis.md); for effects read [sound design](references/sound-design.md);
   for production read [mixing](references/mixing.md).
   Use [local workflow](references/local-workflow.md) for arrangements and revisions,
   [editing/evidence](references/editing.md) for analysis and loops, and
   [review workflow](references/workflow.md) for candidate decisions. These teach
   general principles. Derive stylistic choices from user briefs; do not invent
   fixed genre profiles, emotion mappings, or guarantees of memorability.
3. For local work discover `local_catalog`, save intent and structure, then add
   patterns/tracks incrementally. Use stable IDs and expected revisions. Clone a
   shared pattern to vary only one occurrence. Render a short preview before
   developing a long work. Preserve theme notes when changing instrumentation,
   and preserve timing when changing an effect's weight, unless requested otherwise.
4. For paid provider work read its exact reference first:
   [ElevenLabs effects](references/elevenlabs-sfx.md), [ElevenLabs music](references/elevenlabs-music.md),
   [Gemini music](references/gemini-lyria.md), [ElevenLabs voice](references/elevenlabs-voice.md),
   or [Gemini voice](references/gemini-voice.md). ElevenLabs effects, music and voice
   default to the newest model: omit `model` unless the user deliberately pins an
   older one, and read `list_audio_models` (effect/music) or `list_voice_models`
   for the resolved model and its notes. Query `list_voices` before selecting a voice. Preserve the exact script
   separately from delivery preparation. Respect authorized scope and count; don't
   silently switch providers or repeat uncertain billed work. Never ask for secrets.
5. Keep request IDs and returned job IDs. Retry the same ID only with identical
   arguments for recovery. Poll jobs rather than assuming submission is completion.
   Inspect diagnostics and provenance, then revise the requested dimension. Tool
   defects are not taste questions. Legacy [MIDI workflow](references/midi-workflow.md)
   and [GM mapping](references/midi-instruments.md) remain available; deriving an
   arrangement leaves the original MIDI unchanged.
6. Group initial and revised candidates with `review_create`/`review_update`.
   `review_open` opens the existing UI without autoplay. Agents cannot start audio.
   Reconcile review revision conflicts; preserve rejection and uncertainty. Read
   user decisions through `review_get`; to respond as the user works or wait for Done,
   loop on `review_wait` (or run `sfxchat watch-review`). Completed boards are locked;
   never reopen merely to bypass that lock. Agent completion is not human acceptance.
7. Export original assets, aligned stems/components, or portable arrangement
   packages to an absolute destination. Preserve source/license provenance, engine
   version, seeds, exact revision, and edit lineage. Preview gain does not alter
   originals. Inspect export manifests and reopen packages where required.

Technical checks are not listening. Use audio understanding only when the calling
model and transport genuinely support it; UI playback alone is not evidence that
the agent heard anything. Present plain-language listening choices and leave human
acceptance pending until the user listens.
