# Gemini music generation (Lyria): endpoint and prompting

Reviewed against official documentation on **2026-09-21**. No generation, audition,
or rights review was performed here. See [provenance](../sources.md) and
[verification](../verification.md).

The runtime form of this guidance is [`musicLyriaInstructions` in assistant.ts](../../src/main/assistant.ts),
selected per turn from the active music provider. This note is the source material and
the record of what was verified; markdown is not injected into the assistant at runtime.

Unlike ElevenLabs sound effects, there is no upstream Google agent skill to vendor.
This note is our own distillation of the official documentation.

## Sources reviewed

| Official source | Finding and application |
| --- | --- |
| [Generate music with Lyria](https://ai.google.dev/gemini-api/docs/music-generation) | Lyria 3.5 and Lyria 3 Clip generate 44.1 kHz stereo audio through the Interactions API from text prompts (and up to ten images). Model IDs, lengths, response shape, limitations, and best practices. |
| [Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview) | `POST /v1beta/interactions` with `x-goog-api-key`, an `Interaction` made of ordered execution steps, `store` retention control, and the supported-model table that lists `lyria-3.5`, `lyria-3-clip-preview`, and `lyria-3-pro-preview`. |
| [Lyria prompt guide](https://ai.google.dev/gemini-api/docs/lyria-prompt-guide) | Recognized genre and instrument vocabulary, structure tags and arrows, timing markers, lyrics formatting, vocal profiles, language matching, and the clip-first iteration habit. |
| [Pricing](https://ai.google.dev/gemini-api/docs/pricing) | Lyria 3.5 and Lyria 3 Pro are listed at $0.08 per song and Lyria 3 Clip at $0.04 per song as of this review date. Prices are account- and date-specific; recheck before relying on them. |

## Endpoint contract used by this app

`POST https://generativelanguage.googleapis.com/v1beta/interactions`, JSON body,
`x-goog-api-key` header:

```json
{ "model": "lyria-3.5", "input": "<composed prompt>", "store": false }
```

- `store: false` opts the interaction out of server-side retention. The API defaults to
  storing interactions; this app does not need `previous_interaction_id` state because
  music generation is single-turn.
- **No duration, instrumental, tempo, key, or seed parameters exist.** Lyria reads length
  and instrumentation from the prompt. The app appends `Instrumental only, no vocals.`
  when the user asks for an instrumental, and `Target length: about N seconds.` when a
  length is requested for a full-song model. The exact composed text is stored on the
  asset as `providerPrompt`.
- `lyria-3-clip-preview` always returns exactly 30 seconds. The app rejects any other
  requested length for that model before sending a request, rather than silently
  ignoring it.
- Output is MP3 by default. WAV is requestable through `response_format`; this app does
  not send that field yet, and the adapter still honors the returned MIME type when
  choosing the stored file extension. `response_format` behavior is **unverified here**.

### Response parsing

Responses contain `steps[]`; `model_output` steps hold content blocks of
`{ type: 'audio', data: <base64>, mime_type }` and `{ type: 'text', text: <lyrics or
structure> }`. The app iterates the steps (the documented `output_audio` convenience
property returns only the last audio block and can miss interleaved content), decodes the
audio, and stores returned text blocks as the asset's lyrics. The interaction `id` is
recorded as the request ID. A response with no audio block becomes a readable provider
error carrying the provider message, block reason, or finish reason when present.

## Models

| Model ID | Behavior | Notes |
| --- | --- | --- |
| `lyria-3.5` | Full-length songs, roughly a couple of minutes, with vocals and lyrics by default | Default choice here. Length follows the prompt. |
| `lyria-3-clip-preview` | Always exactly 30 seconds | Cheapest way to explore a direction before committing to a full song. |
| `lyria-3-pro-preview` | Legacy full-song model | Listed in the Interactions model table; kept selectable. |

## Limitations

- **Single-turn.** There is no continuation, section re-editing, or inpainting. A revision
  is a brand-new song, and the assistant should say so rather than promising a targeted fix.
- **Safety filters.** Prompts requesting a specific artist's voice or using copyrighted
  lyrics are blocked rather than rewritten.
- **Watermarking.** Every output carries an inaudible SynthID watermark.
- **Determinism.** Identical prompts still vary between calls.
- **Length.** Clip is fixed at 30 seconds; full-song lengths are prompt-influenced, not
  parameterized, so the app's duration field is a request rather than a guarantee.

## Prompt-writing practice

Synthesis for our own prompts, not a documented formula and not a measured optimization.

1. **Lead with genre**, optionally combined or era-qualified: `deep house`, `boom bap`,
   `shoegaze`, `Berlin minimal techno`, `1980s post-punk`.
2. **Name instruments and textures** when they matter — `Rhodes piano`, `303 acid bass`,
   `tabla`, `muted trumpet`, `warm analog synth pads under a dry acoustic guitar`.
3. **State tempo and key** (`122 BPM`, `in D minor`) so the result can be layered.
4. **Describe structure as tags or arrows**: `[Intro] -> [Verse 1] -> [Chorus] -> [Bridge]
   -> [Outro]`, and motion within it ("build tension through the pre-chorus, then drop to
   silence before an explosive chorus").
5. **Use numbered timing blocks** when sections must land at known moments:
   `[0:00 - 0:10] Intro: soft lo-fi beat with vinyl crackle`.
6. **Lyrics:** put custom lyrics under a `Lyrics:` header with `[Verse]`/`[Chorus]` tags and
   parentheses for backing vocals, or describe the narrative and let the model write them.
   Prompt in the language the lyrics should be sung in.
7. **Instrumental:** write `Instrumental only, no vocals.`; the flag alone does not exist.
8. **Vocal direction:** name range and timbre (female alto, male baritone, weathered
   rocker), or request spoken/chop effects explicitly.
9. **Iterate with the clip model** before spending a full-song generation on an idea.

Illustrative prompts for our own guidance (authored, not generated or auditioned):

| Intent | Provider prompt | App controls |
| --- | --- | --- |
| Exploration | `Dark cinematic cyberpunk synthwave at 110 BPM in D minor, heavy distorted bass, ominous arpeggiated analog synths, ethereal vocalise. Instrumental only, no vocals.` | `lyria-3-clip-preview`, no length |
| Full song | `An upbeat feel-good indie-pop song in G major at 122 BPM, bright acoustic guitar, handclaps, warm female harmonies.` plus `Lyrics:` sections | `lyria-3.5`, `durationMs: 120000` |
| Timed score | `[0:00 - 0:10] Intro: solo piano. [0:10 - 0:40] Build: strings enter, add taiko. [0:40 - 0:55] Outro: fade to piano.` | `lyria-3.5`, `durationMs: 55000` |

## Evidence and discipline

Lyria returns lyrics and structure alongside the audio, so the app stores that text with
the asset for provenance. Billing is per generated song, the clip model costs less, and
results vary between identical calls; a successful request and a valid MP3 do not
establish that the music fits the brief. The assistant has no listening capability, and
the SynthID watermark means outputs are identifiable as generated audio.
