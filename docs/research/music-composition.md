# Music composition guidance

Provenance for the composing knowledge shipped with the MIDI creator. Research performed
**2026-10-06 UTC**. The knowledge lives in what the model actually receives at runtime — the
`midi-composition` assistant block and the three packaged skill references — not in this note;
this note records where it came from and what is not claimed.

## Sources consulted

| Source | Location | What was read |
| --- | --- | --- |
| Open Music Theory | <https://openmusictheory.github.io/> and `about.html` | An openly licensed, college-level music theory textbook (Kris Shaffer, Bryn Hughes, Brian Moseley; Hybrid Pedagogy Publishing). Read for scope and license; used as the open reference for standard concepts (diatonic function, voice leading, phrase structure). |
| MIDI.org — General MIDI | <https://midi.org/general-midi> | The MIDI Association's GM overview: GM 1, GM 2, and GM Lite; GM 1 first published 1991, superseded by GM 2 in 1999, still the common format for Standard MIDI File distribution. |
| Wikipedia — General MIDI | <https://en.wikipedia.org/wiki/General_MIDI> | Secondary confirmation of the 1991 MMA/JMSC publication and the GM 1 program/drum layout. |
| General MIDI 1 specification | Member-gated download via MIDI.org | **Not read directly.** The program and drum lists used by the app are the widely published GM 1 standard values, encoded in [`src/shared/midi.ts`](../../src/shared/midi.ts) and repeated in the instrument reference. |

## What was produced

Three references under `resources/skill/references/`, registered in
[`guidanceDocuments`](../../src/shared/guidance.ts) so the app assistant, the installed skill, and
CLI/MCP agents all receive identical text:

- `music-craft.md` — composing craft: groove first, harmony and voicing, motif-based melody,
  phrase structure, dynamics, idiom starting points, revision discipline.
- `midi-instruments.md` — arranging for the GM bank: program families, instrument choices per
  role, register and spacing, the drum map, and what the bank rewards or struggles with.
- `midi-workflow.md` — using the tool: call shape and bounds, revision through `parentId`,
  hearing results through `audio_listen` when available, finishing by arranging the playground,
  and the evidence limits.

All three are original SfxChat prose written for this feature. No text was copied from any source,
so the share-alike terms of the Open Music Theory license do not attach to this material; the
source is recorded so a reader can go deeper, and its license permits exactly that kind of reuse
with attribution, which this note provides.

## Evidence limits

- **No listening evaluation.** Nothing here is a claim about how any clip sounds, and the render a
  model may hear is the bundled bank's approximation of the written notes, not a performance.
- **Conventions, not laws.** Progressions, drum patterns, and structure advice are widely used
  defaults that reliably produce usable clips. Deliberate departures are expected when the brief
  calls for them.
- **Genre recipes are starting points.** The tempo and instrumentation table in `music-craft.md`
  describes common practice in each style, not a requirement, and not a quality judgement.
- **The GM 1 specification was not read directly** (it is member-gated); the program and drum
  values are the standard published lists, and a replacement bank may voice them differently.
