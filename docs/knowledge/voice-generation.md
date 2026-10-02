# Voice generation review — 2026-10-02

Both providers support single-speaker TTS. This implementation uses direct REST;
no new SDK or provider credentials are introduced. The canonical instructions are
[ElevenLabs voice](../../resources/skill/references/elevenlabs-voice.md) and
[Gemini voice](../../resources/skill/references/gemini-voice.md), embedded unchanged
in runtime guidance, CLI/MCP guidance, and installed skills. Examples are original
SfxChat scripts, not copied provider examples or instructions to purchase a batch.

## Official sources reviewed

| ID | Source | Coverage |
| --- | --- | --- |
| E1 | [TTS overview](https://elevenlabs.io/docs/overview/capabilities/text-to-speech) | Capabilities and boundaries. |
| E2 | [Best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices) | Phrasing, emotional tags, pauses, pronunciation, normalization, iteration. |
| E3 | [Eleven v4](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4) | Two numeric settings, no SSML/speed, cross-language accent behavior, voice fit. HTML retrieval failed in the search tool; official `.md` version was read directly. |
| E4 | [Models](https://elevenlabs.io/docs/overview/models) | IDs, per-model character limits and language coverage. |
| E5 | [Convert endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) | Binary response, output format, voice ID, settings, text normalization fields. |
| E6 | [Voice search](https://elevenlabs.io/docs/api-reference/voices/search) | V2 list, search/language filters, pagination, labels. |
| E7 | [Voice settings](https://elevenlabs.io/docs/api-reference/voices/settings/get) | Stability/similarity/speed and legacy settings. |
| E8 | [Playground TTS](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech) | Voice choice and practical slider ranges. |
| G1 | [Speech generation](https://ai.google.dev/gemini-api/docs/speech-generation) | Current 3.8 models, REST examples, verbatim transcript, style/events, voices/languages, output format, complete prompting guide. |
| G2 | [Flash TTS model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts) | Model capabilities and token window. |
| G3 | [Flash-Lite TTS model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts) | Model tradeoffs and language coverage. |
| G4 | [Voice API](https://ai.google.dev/api/voices) | Regional voice discovery, exact ID, top-level metadata and consistent pagination filters. |
| G5 | [Interactions](https://ai.google.dev/gemini-api/docs/interactions) | `store:false`, response steps and usage. |
| P | [ElevenLabs API pricing](https://elevenlabs.io/pricing/api), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Dated budget check; account rates/discounts can differ. |
| T | [ElevenLabs terms](https://elevenlabs.io/terms-of-use), [Gemini terms](https://ai.google.dev/gemini-api/terms) | Account/region, permitted use, retention and rights remain provider-specific. No blanket generated-media license assertion. |

## Recommendation coverage

| Recommendation | Guidance/control or explicit boundary | Sources |
| --- | --- | --- |
| Choose appropriate existing voice, inspect timbre/accent/use case | Both references, `list_voices`, shared dropdown and ID entry | E1/E2/E6/E8, G1/G4 |
| Match model to acting versus narration/throughput | Both references; two choices per vendor; never silent fallback | E3/E4, G1/G2/G3 |
| Match language and region | Labels, language discovery filter, v4 cross-language caveat, Gemini inferred language | E3/E4/E6, G1/G4 |
| Preserve user-authored words | Exact untrimmed `text`; distinct optional `providerText`; searchable original transcript | E5, G1 |
| v4 emotion, combinations, placement | Sparse compatible square tags, auditory-only direction, character/whisper examples | E2/E3 |
| Punctuation, emphasis, pacing | References explain punctuation/case; prepared rendering preserves original | E2, G1 |
| Pauses | v4 punctuation/tags, v2 sparse break markup; Gemini point-event tags, no exact timing promise | E2/E3, G1 |
| IPA/phonetic alternatives | v4 slash IPA/stress, v2/Gemini agreed phonetic rendering; no dictionary API | E2/E3/E5, G1 |
| Numbers/dates/units/abbreviations/URLs | Confirm ambiguous readings; requested expansion in `providerText`; no app normalization switch | E2/E5 |
| Supported numeric settings | Stability/similarity 0–1; only v2 speed 0.7–1.2; reject v4 speed and SSML | E3/E5/E7/E8 |
| Separate Gemini style from transcript | `style` maps to speech metadata; concise sustained emotion/pace/prosody/pitch | G1 |
| Vocal bursts versus sustained delivery | English angle tags for local breaths/sighs/pauses; sustained whisper in style, including foreign scripts | G1 |
| Stable voice identity and concise directions | Same voice/model; long persona blocks and permanent-trait style changes discouraged | G1/G4 |
| Correct failures and revise from feedback | Full parent script, smallest deliberate changes, model/voice/settings retained, local `parentId` | E2/E3, G1 |
| Experimentation and candidates | Default one, explicit count, no automatic extra clips/splitting/retries | App purchase policy |
| Voice design/cloning, dictionaries, dialogue/live/streaming | Explicitly unavailable; no nonexistent tool examples | E1/E5, G1/G4 |
| Preserve returned originals and evidence | MP3/WAV bytes, hashes, original/prepared scripts, settings, model/voice, request IDs, available usage, lineage | E5, G1/G5 |

## Request mapping and limits

ElevenLabs posts to `/v1/text-to-speech/{voiceId}?output_format=mp3_44100_128` with
`text`, `model_id`, and supported `voice_settings`. Original MP3 is retained. The
model table's 10,000-character limit is validated before admission; no split is made.
The app deliberately exposes the conservative 0.7–1.2 legacy speed range despite
wider values appearing in some endpoint schemas. It exposes neither legacy style
exaggeration/boost nor language override, normalization modes, dictionary locators,
seeds, continuity context, or timestamps. v4 instructions take precedence over
older general advice about SSML and controls.

Gemini posts to `/v1beta/interactions`, `store:false`, with one `user_input` text
item, optional `speech_metadata.style`, one `speech_config` voice, and unary
`audio/wav`. The last model-output audio block is decoded and saved as returned;
no PCM-to-WAV wrapping is applied. The app bound is 8,000 UTF-8 bytes of prepared
script plus style, not a claimed 8,000-token provider limit. The reviewed model
window is 8,192 input/16,384 output tokens. Regional discovery uses `/v1beta/voices`
with `type=prebuilt`; standard names remain selectable without discovery. App
discovery exposes search/language, not every server-side trait filter. No multi-speaker,
voice design/replication, live transport, or headerless streaming PCM is implemented.

Voice jobs snapshot provider, model, voice, and submitted optional controls at admission.
Omitted numeric controls deliberately retain provider defaults (not falsely reported
as measured numeric values). Keys resolve at dispatch. Each response is bounded;
uncertain outcomes are never retried. Older effect/music JSON remains readable with
missing kinds interpreted as effects. Trims inherit voice kind and retain generation
provenance on their immutable parent.

## Budget and evidence

The authorized live check permits one short clip per provider, two total, within $1.
On this date ElevenLabs listed v4 at $0.022/1,000 characters temporarily, with a
$0.08 regular rate. Gemini listed Flash TTS audio at $9/million tokens temporarily
($18 regular), about 25 audio tokens/second. A short sentence is comfortably below
the combined budget at these list rates. Rates are estimates, not an invoice.
Read [verification](../verification.md) for actual attempts, failures, technical
results, and listening limits. No provider recommendation to experiment expands
that authorization.
