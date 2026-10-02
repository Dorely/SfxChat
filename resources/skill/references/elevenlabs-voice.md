# ElevenLabs voice

Use `generate_voice` for a single spoken performance. Use the shared ElevenLabs key
in Settings; never request a voice key. Official guidance reviewed 2026-10-02.

## Voice and model

Inspect `guidance` for saved defaults. `list_voices` accepts `providerId:"elevenlabs"`,
optional `search`, `language`, and `pageToken`. Keep filters unchanged when paging.
Read descriptions and labels for accent, language, age, timbre, and use case. Match
habitual delivery to the brief: a soft voice may not shout convincingly despite tags.
Discovery returns existing account voices, not a voice-creation workflow. The default
George ID is a starting choice, not proof of suitability or account entitlement.

`eleven_v4` is the app default for expressive acting. `eleven_multilingual_v2` is
available for steadier narration. Both accept at most 10,000 characters per request.
Do not silently change models or split scripts into additional billed clips.
Check the selected model's language coverage; v2 supports fewer languages. In v4,
matching the source language keeps its accent; crossing languages aims for natural
target-language speech. Do not promise source-accent transfer across languages.

## Script and delivery

`text` holds the exact user-authored script, including punctuation and whitespace.
When preparing tags, phonetics, or requested normalization, put the complete prepared
version in `providerText`; keep `text` unchanged. Only the prepared version is sent
when present. Do not invent dialogue, extra vocalizations, or changed meaning.

For v4, square-bracket auditory tags direct emotion, delivery, or a vocal event. Place
delivery tags before their intended phrase and events where they should occur. A
small compatible pair such as `[whispering] [nervous]` is clearer than contradictory
stacks. Use English tag descriptions; their effect depends on voice and context.
Avoid visual actions, biographies, and camera directions. Ordinary direction text
such as "Say this sadly:" may be spoken aloud. v2 does not expose v4 tag behavior;
do not transplant expressive tags expecting equivalent control.

Punctuation shapes phrasing; ellipses suggest hesitation and selective capitals
suggest emphasis. Preserve the original when preparing punctuation or case changes.
v4 has no SSML: use tags/punctuation for pauses without promising exact milliseconds.
v2 supports sparse `<break time="0.5s" />` pauses; provider guidance limits breaks
to three seconds. Excessive breaks can destabilize speech. Exact silence lengths
belong to subsequent editing, not a guaranteed generation control.

For problematic names in v4, slash-delimited IPA can replace the word in prepared
text; include primary stress and check the intended locale. Avoid transcribing the
whole script. For v2, use a phonetic spelling or agreed spoken expansion instead:
phoneme SSML is unsupported. SfxChat has no pronunciation-dictionary management or
dictionary locator fields.

Numbers, dates, currencies, times, units, phone numbers, abbreviations, and URLs need
context. "03/04" is ambiguous; a code may need individual digits. Confirm uncertain
meaning before expansion. When normalization is requested, retain readable original
`text` and the agreed spoken expansion in `providerText`. Otherwise leave provider
default normalization in place. The app exposes no normalization switch. Never
silently change a date convention, currency, acronym, or user's wording.

## Controls and corrections

Optional `stability` and `similarity` range from 0 to 1; omission uses provider defaults.
Lower stability allows variation, higher stability favors consistency. Higher similarity
favors the source voice but can reduce naturalness. v4 supports only these two numeric
controls: no speed/style slider, speaker boost, or SSML. v2 also accepts app `speed`
0.7–1.2 (1 neutral), a conservative range. Speed is not an exact duration control.

Read the full parent request and listener feedback. Keep the script, model, voice,
and compatible settings; change the smallest cause. For flat delivery, simplify tags
or deliberately lower stability. For unwanted accent/timbre, select a better voice;
stronger directions cannot reliably repair a mismatch. For mispronunciation, change
only the problematic prepared rendering. For unstable pauses, reduce markup.
`parentId` records local lineage and sends no parent audio. Each revision is a new
purchase; provider advice to experiment never authorizes extra candidates or retries.

## Worked requests (original examples)

These are `generate_voice` fields. CLI/MCP also require actual `projectId`, `sessionId`,
and a fresh `requestId` per authorized purchase. Replace IDs from the app. These
recipes do not authorize an example batch.

Narration:

```json
{"text":"The observatory opens at dawn. Follow the blue path to the entrance.","providerId":"elevenlabs","model":"eleven_multilingual_v2","voiceId":"JBFqnCBsd6RMkjVDRZzb","speed":0.95,"count":1,"name":"Observatory welcome"}
```

Character line, preserving the user's words:

```json
{"text":"I kept the map. I thought you might come back.","providerText":"[hesitant] I kept the map. [softly] I thought you might come back.","providerId":"elevenlabs","model":"eleven_v4","voiceId":"JBFqnCBsd6RMkjVDRZzb","stability":0.4,"similarity":0.75,"count":1,"name":"Map keeper"}
```

Urgent whisper:

```json
{"text":"Stay close. The guard is turning around.","providerText":"[whispering] [urgent] Stay close. The guard is turning around.","providerId":"elevenlabs","model":"eleven_v4","voiceId":"JBFqnCBsd6RMkjVDRZzb","count":1,"name":"Quiet warning"}
```

Pronunciation and normalization, after the user requests both, confirms SOR-uh, and
wants separate code digits:

```json
{"text":"Sora, enter code 204.","providerText":"/ˈsɔːrə/, enter code two zero four.","providerId":"elevenlabs","model":"eleven_v4","voiceId":"JBFqnCBsd6RMkjVDRZzb","count":1,"name":"Code instruction"}
```

Feedback "keep the whisper, less panic" on Quiet warning becomes the complete
original `text`, prepared `[whispering] [calm] Stay close. The guard is turning around.`,
the same v4/voice, `count:1`, and the real parent asset ID in `parentId`. No speed field
is added. Generate this revision only when authorized.

## Sources and limits

Official [best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices),
[v4 behavior](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4),
[models/languages](https://elevenlabs.io/docs/overview/models),
[conversion](https://elevenlabs.io/docs/api-reference/text-to-speech/convert),
[voice discovery](https://elevenlabs.io/docs/api-reference/voices/search), and
[settings](https://elevenlabs.io/docs/api-reference/voices/settings/get).
SfxChat preserves returned MP3, scripts, settings, request IDs, available usage,
hashes, and lineage. Cloning, design, dictionary management, multi-speaker dialogue,
streaming, and real-time chat are unavailable. Voice access, media licensing, and
retention remain provider/account-specific. Skill licensing does not establish media
rights; playback and valid encoding do not establish listener approval.
