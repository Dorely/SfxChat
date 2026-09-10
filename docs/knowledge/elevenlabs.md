# ElevenLabs sound effects API notes

These notes summarize existing API knowledge for the SfxChat workbench. Provider behavior, model names, limits, pricing, account terms, SDK signatures, and output rights come from the installed skill snapshot and Chimera's September 2026 work; they were not freshly verified for this handoff. Revalidate against official documentation and account terms before implementation. See [sources](../sources.md), [architecture](../architecture.md), and the vendored [ElevenLabs skill](../../.agents/skills/elevenlabs-sound-effects/SKILL.md).

## Request shape

The sound-effects operation accepts a concise text description and optional controls:

- `text` (required): the requested sound event.
- `model_id`: the source examples use `eleven_text_to_sound_v2`; treat this as a historical default, not a current guarantee.
- `duration_seconds`: optional, with the inspected skill documenting 0.5–30 seconds. Let the service auto-select a duration only when the product explicitly allows it.
- `prompt_influence`: optional 0–1 adherence control; the inspected example defaults to 0.3.
- `loop`: boolean; the source says looping is supported by v2, but verify model support before exposing it.
- `output_format`: request through the SDK/CLI parameter or HTTP query as supported by the current endpoint.

Python uses `ElevenLabs()` and `client.text_to_sound_effects.convert(...)`, returning an iterable audio stream. TypeScript uses `ElevenLabsClient` from `@elevenlabs/elevenlabs-js` and `client.textToSoundEffects.convert(...)`, returning a stream that can be piped to a file. The old unscoped `elevenlabs` npm package is called deprecated in the installation reference; confirm package status during setup. A raw HTTP shape used by the source pilot was `POST /v1/sound-generation?output_format=...` with JSON fields matching the controls and an `xi-api-key` header. Treat that endpoint and header detail as subject to live reference verification.

The source script reads `ELEVENLABS_API_KEY` from the environment; SfxChat's app-configured credentials must instead be persisted through its planned OS-backed secure-storage boundary and resolved by the provider adapter. Never put API keys in the repository, client bundle, logs, manifests, or prompts. Installing a skill or SDK does not authorize spending credits or establish output rights.

## Prompting and formats

Describe one short, isolated event and its material/action. Use concrete terms such as “dry card-stock flex and fingertip tap” rather than a broad scene. For a compound gesture, list elements in temporal order. Keep the fuller creative brief and approval rationale in the workbench; send the generator only the compact provider prompt. Individual source events are easier to edit and layer than a whole scene.

The inspected skill lists MP3, Opus, PCM, μ-law, and A-law choices, including `mp3_44100_128`, `pcm_44100`, and `pcm_48000`. These are historical capability notes, not a current format contract. Preserve the provider response bytes exactly before conversion. A raw PCM response needs explicit sample rate, channel count, sample width, and encoding metadata. Wrap it in a valid WAV container or supply the decoder's explicit raw format parameters; renaming raw bytes to `.wav` does not add a WAV header. Probe compressed formats for codec/container validity. The source measurement pattern records duration, codec, sample rate, channels, bit depth where available, loudness, peak, and SHA-256.

## Provenance and bounded generation

Each generated candidate should retain its prompt, model, requested format/duration, generation timestamp, provider/request identifier when returned, raw-file path, SHA-256 of the exact response bytes, and an approval state. Preserve raw bytes and never overwrite an existing candidate silently. Keep provider/account license review attached to the artifact; free output is not automatically cleared for commercial use, and isolated SFX redistribution may have policy restrictions.

Use a manifest preflight before any request. Validate output location, candidate IDs, event counts, prompt presence, duration and influence ranges, format, and existing-file hashes. Default to a dry run that performs no network request. On resume, skip an existing candidate only after its stored hash matches the file. Execute sequentially with a bounded batch and rate pacing. A failed request should record UTC time, status, redacted detail, and prompt, then stop; automatic retries can create duplicate billable generations. Never overwrite a file or retry blindly after an uncertain timeout without an explicit, idempotency-aware policy.

Treat duration, format, rate, credit, pricing, and terms information as revalidation points. The provider’s current API reference and account dashboard are authoritative at implementation time.
