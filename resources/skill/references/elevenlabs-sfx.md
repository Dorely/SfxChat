For ElevenLabs sound effects, write a compact, self-contained description of what
should be audible. Lead with the source and action; add only useful material,
texture, intensity, perspective, acoustic space, and attack/decay details. Translate
abstract intent into audible traits, rather than sending a story, design rationale,
or instructions to a chat assistant. Keep the full creative brief in chat.
Use natural language and relevant audio terms: one-shot for a single non-repeating
event, ambience or drone for a sustained texture, impact, whoosh, glitch, or braam
when appropriate. Do not force every descriptor into every prompt.
Examples: "One-shot ceramic token landing on oak, close dry clack with a short ring."
"A rusty latch rattles, then releases with a sharp snap."
"Steady ventilation drone with soft air hiss and a low motor hum."
For a connected sequence, state the order with then/followed by; for simultaneous
layers, describe their relationship. Ambience and multi-part effects are supported.
Prefer separate source sounds when independent editing or precise synchronization
is needed, but stay within the requested generation scope. This app cannot mix or
layer assets; do not claim to have assembled a scene. Prompted event counts, timing,
tempo, pitch, isolation, and loop quality are targets to audition, not guarantees.
Describe desired acoustic properties positively (e.g. dry, close, isolated) instead
of relying on long exclusion lists. No dedicated negative-prompt field, weighted
prompt syntax, SSML, or TTS audio-tag controls are exposed by this SFX endpoint.

Use the generation fields for controls: omit duration or use null for automatic
length when timing is flexible; specify 0.5–30 seconds for a required clip length,
allowing room for the event and its decay. Duration controls the whole clip, not
exact event placement. For a sub-0.5-second deliverable, generate within the range
and use local trimming with timing evidence. Set loop=true for a repeating bed and
describe a continuous texture; avoid a terminal hit or fade-out unless requested.
Looping does not increase the 30-second generation maximum. Use loop=false for
finite events. Influence is adherence, not quality or volume: omitted uses 0.3;
higher values follow wording more closely with less variation, lower values allow
more variation. Keep the default unless intent or feedback calls for an adjustment.
Do not put API settings, output format, or candidate counts into the sound description.
count requests separate candidates from the same prompt; use separate calls for
distinct prompts within the requested scope. The website's four-result behavior
does not apply here. Default remains one candidate.
On a requested revision, inspect the parent prompt and feedback, then rewrite a
complete sound description that incorporates the change and removes conflicting
traits. Never send only "make it shorter" or "same as before". parentId records
local lineage; it sends no source audio or previous context to ElevenLabs and cannot
guarantee an identical performance. Iterate from user audition feedback without
claiming that a higher influence value or successful request proves improvement.
