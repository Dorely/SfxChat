# ElevenLabs Music: endpoint and prompting

Reviewed against official documentation on **2026-09-21**. The vendored
[skill](../../.agents/skills/elevenlabs-music/SKILL.md) is an unchanged upstream snapshot.
See [provenance](../sources.md) and [verification](../verification.md). A documentation
review establishes the intended contract, not perceptual quality; no generation,
audition, pricing audit, or rights review was performed here.

The runtime form of this guidance is [`musicElevenLabsInstructions` in assistant.ts](../../src/main/assistant.ts),
selected per turn from the active music provider. This note is the source material and
the record of what was verified; markdown is not injected into the assistant at runtime.

## Sources reviewed

| Official source | Finding and application |
| --- | --- |
| [Music capabilities overview](https://elevenlabs.io/docs/overview/capabilities/music) | Eleven Music is a text-to-music model with section control, vocals or instrumental, multilingual output, and commercial-use terms separate from the API contract. Music v2.5 is the newest model; v2 adds long-form sections, mid-track transitions, dense vocal delivery, and improved inpainting; v1 remains available through a transition period. |
| [Best practices](https://elevenlabs.io/docs/overview/capabilities/music/best-practices) | The model answers genre, mood, instrumentation, tempo, and production era whether or not the prompt states them. Production vocabulary, narrated arrangement, explicit exclusions for loops, timing cues, and lyrics handling are the levers. |
| [Prompting FAQ](https://help.elevenlabs.io/hc/en-us/articles/37781425844369-Are-there-any-best-practices-for-prompting-Eleven-Music) | Descriptive prompts beat short labels; naming a genre and style explicitly moves results. |
| [POST /v1/music](https://elevenlabs.io/docs/api-reference/music/compose) | Request fields, limits, and the binary audio response used by this app. |
| [POST /v1/music/detailed](https://elevenlabs.io/docs/api-reference/music/compose-detailed) | Multipart response with `composition_plan` and `song_metadata`, plus optional word timestamps and waveform visual. Not integrated here. |
| [Music quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/music) | Paid-plan requirement, an example prompt, and the `bad_prompt` / `bad_composition_plan` error contract with suggested replacements. |
| [Composition plans guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans) | Chunk-level plans with per-section styles and durations. Available upstream; not exposed by this app. |
| [API pricing](https://elevenlabs.io/pricing/api) | Pricing and plan terms are account-specific; no figure is asserted here. |

## What SfxChat actually sends

`POST https://api.elevenlabs.io/v1/music?output_format=auto` with a JSON body and an
`xi-api-key` resolved inside the privileged provider operation.

| App field | Endpoint field | Meaning |
| --- | --- | --- |
| `prompt` | `prompt` | Required description, at most 4100 characters. Shared validation trims whitespace; the adapter sends it unchanged and records it as `providerPrompt`. |
| `durationMs` | `music_length_ms` | Optional 3000–600000 ms. Omitted when the app leaves length to the model. |
| `instrumental` | `force_instrumental` | Sent as `true` only when requested. Documented as prompt-only, so it is never combined with a composition plan. |
| Model choice | `model_id` | `music_v2_5` by default, with `music_v2` and `music_v1` selectable. The app always sends the field rather than relying on the API default. |
| — | `output_format` | `auto`: mp3_44100_128 for v1 models, mp3_48000_192 for v2 models. |
| `count`, `name`, `providerId`, `parentId` | None | App-side candidate jobs, naming, provider routing, and local lineage. |

The response is raw audio bytes; the documented `song-id` response header is recorded as
the asset's request ID. No usage or cost header is documented for Music, so `usage`
stays null here. The adapter reads the response content type and stores the file as
WAV only if the provider actually returned WAV.

## Limits, errors, and discrepancies

- Length: the endpoint accepts `music_length_ms` from 3000 to 600000. The capabilities
  FAQ states a 3-second minimum and 5-minute maximum. The app permits the endpoint
  range and does not present the FAQ figure as a hard limit.
- Prompt length: 4100 characters, enforced locally before any request is sent.
- `prompt` and `composition_plan` are mutually exclusive; this app always sends a prompt.
- `seed` cannot be combined with a prompt, and composition plans, audio reference,
  inpainting, streaming, finetunes, video-to-music, and stem separation are not exposed.
- Errors 401, 422, and 429 are expected. A refused `prompt` returns `detail.status`
  `bad_prompt`; a refused plan returns `bad_composition_plan`. Both can carry
  `prompt_suggestion` / `composition_plan_suggestion`. The adapter surfaces the
  suggestion in the readable error and keeps the code for diagnostics, so the assistant
  can adopt the provider's rewording deliberately instead of retrying the same text.
- Content restrictions: naming artists or bands, or requesting copyrighted lyrics,
  is refused upstream. The prompt should describe the musical qualities instead.

## Prompt-writing practice

Synthesis for our own prompts, not a documented formula and not a measured optimization.

1. **Decide all five open questions** — genre, mood, instrumentation, tempo, era.
   `upbeat electronic track` leaves the model to pick the most average answer, while
   `French house, 122 BPM, filtered disco sample chops, sidechained bass, tight
   four-on-the-floor kick, rooftop-at-sunset mood, warm analog glue` does not.
2. **Speak production language.** Sidechained, close-mic'd, bone-dry, tape saturation,
   plate reverb are audible levers. If the vocabulary is missing, describe the space.
3. **Narrate the arrangement in order**, using the load-bearing words: start with just,
   then, bring in. An unstated silence gets filled.
4. **Loops are exclusion.** State bars, tempo, key, and what must not appear
   (`four bars, no melody — just drums`).
5. **Timing and lyrics.** Length can be stated in the prompt ("60 seconds"); lyrics can
   be supplied or requested; "instrumental only" or the flag removes vocals; timing cues
   such as "lyrics begin at 15 seconds" place entries. The app's duration field is a
   whole-file target and does not place events.
6. **Revisions restate everything.** The endpoint receives only the new prompt; nothing
   carries over from the previous generation. Bare feedback such as "make it shorter"
   loses the original direction.

Illustrative prompts for our own guidance (authored, not generated or auditioned):

| Intent | Provider prompt | App controls |
| --- | --- | --- |
| Menu music bed | `Warm minimal piano and soft marimba at 84 BPM in C major, gentle tape hiss, no drums, four bars, instrumental` | `durationMs: 30000`, `instrumental: true` |
| Trailer build | `Cinematic hybrid orchestral at 100 BPM in D minor — start with just a low pulse, add taiko hits after eight bars, then bring in a full string swell before dropping to silence` | `durationMs: 60000` |
| Song with lyrics | `Indie pop at 122 BPM in G major with handclaps and female harmonies` plus `[Verse 1]`/`[Chorus]` lyrics in the prompt | `instrumental: false` |

## Evidence and discipline

Keep exact prompts, returned bytes, hashes, provider/model, song ID, and local lineage.
Music generations are slower and separately billed per candidate; the app keeps its
sequential durable jobs and never retries an uncertain request. Valid audio, a matching
duration, and a successful HTTP status do not establish that a track fits the brief.
The assistant has no listening capability, and provider-set audio rights are separate
from SfxChat's own license.
