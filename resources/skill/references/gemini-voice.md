# Gemini voice

Use `generate_voice` for one speaker reciting a script through Gemini TTS. The shared
Gemini key in Settings also serves Lyria and direct Gemini chat. TTS is separate from
the Live API. Official guidance reviewed 2026-10-02.

## Model and voice

Prefer saved selections unless the user requests a change. The default is
`gemini-3.8-flash-tts`; `gemini-3.8-flash-lite-tts` offers faster everyday speech.
Flash is the stronger choice for demanding prosody, dialects, and vocal bursts.
Never silently switch models after an error. The app limits script plus style to
8,000 UTF-8 bytes per clip, conservatively below the documented 8,192-input-token
window, and never splits a script into extra purchases.

The app includes 30 standard voices: Kore is firm, Sulafat warm, Achernar soft, and
Puck upbeat, for example. Descriptions are hints, not quality guarantees. Use
`list_voices` with `providerId:"gemini"`, optional `search`, `language` (language code),
and `pageToken` to discover additional regional prebuilt voices. Keep filters the
same when paging. Read returned language/region/accent and voice traits; use the
returned ID, not the display name. Language is inferred from the transcript. Check
model language coverage; Flash and Lite differ.

Choose suitable permanent voice traits before directing delivery. Asking style to
change age, gender, or fundamental timbre can fight the voice. SfxChat cannot design
or replicate voices. Do not call imaginary persona tools, use expiring stateless
voice keys, or request voice-specific credentials. Reuse the voice ID for a character.

## Transcript, style, and events

`text` holds exact user wording, punctuation, whitespace, and line breaks. Gemini 3.8
treats synthesis text as a verbatim transcript. Put sustained delivery in separate
`style`: a brief coherent phrase describing emotion, pace, prosody, pitch movement,
intensity, or volume. Style is optional. Do not prepend biographies, director blocks,
or script instructions: plain-text directions in the transcript may be spoken aloud.

Use angle-bracket tags for momentary human vocal events or pauses, such as `<breath>`,
`<sigh>`, and `<short pause>`. Sustained whispering belongs in `style`, not an inline
`<whispering>` direction. Place events sparingly where needed. Do not request music,
footfalls, or non-vocal effects through vocal tags. Keep tags in English for non-English
scripts. These are cues, not exact timing guarantees or SSML.

If preparing tags, punctuation, emphasis, phonetics, or normalization, retain original
`text` and put the complete version in `providerText`. Only the prepared version is
synthesized when present. Do not invent breaths/laughter against a strict script.
Punctuation and ellipses guide phrasing; selective capitals suggest emphasis.
"Measured, gently rising pitch on the question" is more actionable than stacked moods.
Exact silence lengths belong to later editing.

For sensitive names/abbreviations, establish pronunciation and locale. With editing
permission, use a phonetic spelling or spoken expansion in `providerText`; preserve
the original. Resolve ambiguous dates, digits, and units before normalization. The
app exposes no Gemini IPA/phoneme control, SSML, dictionary API, normalization switch,
numeric pitch, speed, stability, or similarity. Do not copy ElevenLabs square tags
or settings into Gemini requests.

## Consistency and revisions

Keep model, voice, language convention, and concise style consistent across approved
clips. Long Audio Profile/Director's Notes blocks can compete with recitation.
Repeated demands for identical timbre can degrade a clear request; choose the right
existing voice and add only the turn's needed style. Natural hesitation may suit
authored dialogue, but adding disfluencies changes user wording and needs editing authority.

Read the full parent request and actual feedback. Simplify style if delivery is too
theatrical; move/remove a misplaced event; choose a better regional voice if permanent
traits are wrong. Correct only troublesome prepared pronunciations. Revisions send
the full script/settings; `parentId` records lineage without sending prior audio.
There is no seed or consistent-performance flag. `count` means separately billed
clips, default one. Provider experimentation advice never authorizes extra purchases
or an automatic retry of an uncertain request.

## Worked requests (original examples)

These are `generate_voice` fields. CLI/MCP also require actual `projectId`, `sessionId`,
and a fresh `requestId`. Replace IDs from the app. These recipes are not an authorized batch.

Narration with separate pacing:

```json
{"text":"The gallery closes in ten minutes. Please make your way to the lobby.","providerId":"gemini","model":"gemini-3.8-flash-lite-tts","voiceId":"Sulafat","style":"warm, clear public announcement at a measured pace","count":1,"name":"Gallery closing"}
```

Character line:

```json
{"text":"You brought a ladder to a lighthouse? I admire your optimism.","providerId":"gemini","model":"gemini-3.8-flash-tts","voiceId":"Puck","style":"dry amusement, conversational, slight emphasis on optimism","count":1,"name":"Lighthouse keeper"}
```

Urgent whisper:

```json
{"text":"Keep the light off. Someone is outside.","providerId":"gemini","model":"gemini-3.8-flash-tts","voiceId":"Achernar","style":"whispered urgently, restrained and quick","count":1,"name":"Dark room warning"}
```

Spanish line where the user requests a breath before the second sentence:

```json
{"text":"Ya llegamos. Abre la puerta.","providerText":"Ya llegamos. <breath> Abre la puerta.","providerId":"gemini","model":"gemini-3.8-flash-tts","voiceId":"Kore","style":"calm and relieved","count":1,"name":"Arrival"}
```

Pronunciation/normalization after the user confirms NEH-ree and wants units expanded:

```json
{"text":"Neri, move the sensor 5 cm.","providerText":"Neh-ree, move the sensor five centimeters.","providerId":"gemini","model":"gemini-3.8-flash-tts","voiceId":"Kore","style":"clear, precise instruction","count":1,"name":"Sensor placement"}
```

Feedback "too fast, keep it quiet" on Dark room warning yields identical original
`text`, same Flash/voice, `style:"quiet whisper, deliberate pacing"`, `count:1`, and
the real parent ID in `parentId`. No speed slider or new persona is added. If the user
requests a hesitation, prepared `Keep the light off. <short pause> Someone is outside.`
records it separately. Generate only the authorized revision.

## Sources and limits

Official [speech/prompting guide](https://ai.google.dev/gemini-api/docs/speech-generation),
[Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts),
[Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts),
[voices](https://ai.google.dev/api/voices), and
[Interactions](https://ai.google.dev/gemini-api/docs/interactions).
The app sends Interactions with `store:false`, separate style metadata, one voice,
and unary WAV, preserving bytes without adding a second WAV header. Store false
concerns interaction storage, not a blanket data-use promise. Streaming, real-time
chat, multi-speaker turns, backchannel/overlap controls, dictionary management,
voice design, and replication are unavailable. IDs, available usage, hashes, and
lineage establish technical provenance, not listening quality or media rights.
