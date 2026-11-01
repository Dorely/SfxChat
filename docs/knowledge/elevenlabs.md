# ElevenLabs sound effects: endpoint and prompting

Reviewed against official documentation on **2026-09-10**. This replaces the
historical prompting/request guidance from the handoff. The vendored
[skill](../../.agents/skills/elevenlabs-sound-effects/SKILL.md) remains an unchanged
source snapshot. See [provenance](../sources.md) and [verification](../verification.md).
Documentation review establishes the intended contract, not perceptual quality.

## Sources reviewed and discrepancies

The official [documentation index](https://elevenlabs.io/docs/llms.txt) identifies
the SFX overview, product guide, developer quickstart, FAQ, and endpoint reference.
These are the relevant findings, rather than rules borrowed from TTS or Music:

| Official source | Finding and application |
| --- | --- |
| [SFX capabilities and prompting](https://elevenlabs.io/docs/overview/capabilities/sound-effects) | Descriptions can cover individual effects, ordered sequences, ambience, and short musical components. Audio terminology is supported. Full music production belongs to the separate Music API, which SfxChat does not integrate. |
| [Help Center prompt guide](https://help.elevenlabs.io/hc/en-us/articles/25735604945041-How-do-I-prompt-for-sound-effects) | Balance specificity with brevity. Complex prompts are understood; generating components separately and combining them in an editor is recommended for greater control. This is a workflow preference, not an endpoint restriction to isolated events. |
| [Product guide and FAQ](https://elevenlabs.io/docs/eleven-creative/playground/sound-effects) | Explains auto duration, looping, influence, audition/revision, and website downloads. Its four outputs per click and 450-character prompt limit describe the website; the REST reference has no count field or documented text maximum. Do not impose those website behaviors on the app. |
| [Developer quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/sound-effects) | Uses the text-to-sound-effects conversion operation with a textual sound description. SfxChat implements direct HTTP instead of the illustrated SDK/playback setup. |
| [Create sound effect reference](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) | Defines the controls below. Use its 0.5-second minimum; the overview's 0.1-second minimum conflicts. Retain the app's MP3 format; website WAV availability is not evidence for changing HTTP response handling. |

The endpoint reference was also read through its [.md representation](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert.md).
No paid generation, account pricing audit, rights review, or listener evaluation was
performed in this prompting review. Historical pricing/rights claims are not renewed.

## What SfxChat actually sends

`POST https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128`
uses JSON and an `xi-api-key` resolved inside the privileged provider operation.

| App field | Endpoint field | Meaning |
| --- | --- | --- |
| `prompt` | `text` | Required description. Shared validation trims surrounding whitespace; the adapter sends it without chat history. |
| `duration` | `duration_seconds` | Optional 0.5–30 seconds. App null/omission omits the field for provider-selected duration. |
| `influence` | `prompt_influence` | Optional 0–1, documented default 0.3. Higher adherence reduces variation; it is not a quality score. |
| `loop` | `loop` | Optional boolean, default false; v2 supports smooth repetition. |
| `model` | `model_id` | Optional exact pin; omitted or `latest` sends the newest ID from the official API schema enum (`eleven_text_to_sound_v3` as of 2026-11-01, limited by account/region), falling back to the next newest only when an automatic request's model is refused. The API default remains `eleven_text_to_sound_v2`. |
| `count`, `name`, `parentId` | None | App candidate jobs, metadata, and lineage. No reference audio is transmitted. |

The schema exposes no negative-prompt field, seed, reference input, SSML controls,
or timestamp timeline. Do not invent them. Absence of a dedicated negative field
does not establish that natural-language exclusions can never work.

## SfxChat prompt-writing practice

The following is our practical synthesis, not a guaranteed formula or a measured
optimization. Runtime guidance lives in [assistant.ts](../../src/main/assistant.ts),
with field descriptions in [validation.ts](../../src/main/validation.ts). Markdown
and the vendored skill are not loaded into the running assistant.

Start with what makes the sound and what it does. Add details only if they help
distinguish the result: material, texture, force, proximity, room sound, attack, and
decay. Translate “a satisfying inventory action” into an audible event. Keep
narrative context, rationale, names, and job counts out of provider text. Prefer
desired properties such as dry or isolated to a long list of exclusions. These are
editorial defaults, not undocumented syntax rules.

Original illustrative prompts (not generated or auditioned):

| Intent | Complete provider description | App controls |
| --- | --- | --- |
| Inventory drop | One-shot ceramic token landing on oak, close dry clack with a short ring. | `duration: 1`, `loop: false` |
| Connected mechanism | A rusty latch rattles, then releases with a sharp snap. | Auto duration, `loop: false` |
| Background bed | Steady ventilation drone with soft air hiss and a low motor hum. | `duration: 10`, `loop: true` |
| Softer token revision | One-shot ceramic token set gently on oak, a muted close clack with a brief delicate ring. | Retain appropriate controls; link `parentId` |

For a sequence, describe order; for overlapping layers, describe their relationship.
If the user needs independently editable components, generate those within the
requested scope. The app has trimming/fades but no mixer, so it must not claim to
assemble layers. Short musical SFX are a documented capability, but do not promise
exact notes, tempo, isolated stems, or full-song production.

Use explicit duration when clip length matters and allow for decay. Otherwise auto
is appropriate. Clip length does not guarantee when an event starts or ends; use
local analysis, user timing feedback, and trimming for exact retained intervals.
For repeating beds, pair the loop flag with a continuous description. A loop does
not turn one request into an arbitrarily long file. Ask the user to audition its
boundary. Keep influence at the default unless intent or feedback justifies a
change; do not automatically maximize it.

Revisions need complete replacement descriptions. Inspect the parent and feedback,
retain the relevant subject, incorporate the change, and remove contradictory
traits. Sending only “make it shorter” loses the source description. The provider
does not receive `parentId`, prior prompts, or original audio and cannot be assumed
to preserve a performance. The inspector keeps feedback separate from an editable
Generation prompt, initialized from the original prompt. Use chat for help turning
review notes into a new prompt.

## Evidence and generation discipline

Keep originals, exact prompts/settings, provider/model and request identifiers when
available, hashes, lineage, and feedback. Playback gain stays separate. Valid bytes,
amplitude measurements, and prompt adherence do not establish aesthetic success.
The assistant has no audio-listening capability; listener decisions belong to the user.

The app queues sequential durable jobs within the requested scope, defaults to one
candidate, and does not automatically retry uncertain billed work. The inherited
batch script's manifest/dry-run workflow is not a prerequisite or an implemented
app feature. Credentials use OS-backed storage. For other formats, recheck the
API/account contract before changing the adapter; preserve returned bytes and
explicitly decode or wrap raw PCM rather than renaming it as WAV.
