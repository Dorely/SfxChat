# Composition, sound design, and instruction research

Read/reviewed **2026-10-13**. This replaces the 2026-10-06 MIDI-only review.
The earlier review read a textbook landing page, not substantive chapters; it did
not establish its broad composing claims. References now teach general principles,
with no built-in genre profiles. Styles belong to user briefs.

| Exact material read | Supported guidance | Limits and treatment |
| --- | --- | --- |
| Andrea Stolpe, Berklee, [Simple Tools for Better Melodies](https://online.berklee.edu/takenote/simple-tools-for-better-melodies/) | Rhythmic identity, repetition/contrast, rests and placement | Songwriting perspective; no guarantee of memorability. Original instrumental example in music-craft. |
| Ableton, [Creating Melodies 1: Contour](https://makingmusic.ableton.com/creating-melodies-1-contour) | Direction, range, steps/leaps as deliberate choices | Contour is one dimension; no universal emotion mapping. |
| Open Music Theory, [The Sentence](https://openmusictheory.github.io/sentence.html), presentation/continuation/fragmentation/cadence | Developing an idea and accelerating toward an ending | A form convention, not universal phrase length. Textbook is CC BY-SA 4.0; chapter text/examples are not reproduced. |
| Ableton, [Creating Variation 2: Mutation Over Generations](https://makingmusic.ableton.com/creating-variation-2-mutation-over-generations) | Preserve identity while changing one meaningful feature | Can become directionless without phrase/form decisions. |
| Vienna Symphonic Library, [Violin](https://www.vsl.co.at/academy/strings/violin/) and [Concert Flute](https://www.vsl.co.at/academy/woodwinds/concert-flute), sound production, register, techniques and combinations | Register, bow/breath, role and balance | Real instrumental behavior does not imply recorded articulations in GeneralUser; no orchestral style profile. |
| Native Instruments, [House Music 101](https://blog.native-instruments.com/house-music-101/), worked drum/bass/swing/arrangement example; [Trance music](https://blog.native-instruments.com/trance-music/), composition, layers, build/breakdown | Background for requested demonstration briefs only | Vendor examples. Claims about minor keys causing emotion, universal speaker pitch limits, and genre absolutes were not adopted. No house/trance skill modules. |
| FMOD Studio 2.04, [Authoring Events](https://www.fmod.com/docs/2.04/studio/authoring-events.html), layered instruments and random/envelope/sidechain/seek modulators | Layer roles, temporal structure, bounded variation per trigger | No FMOD/game-engine integration or full modulator parity. |
| OpenAI, [Build skills](https://learn.chatgpt.com/docs/build-skills), fetched with official documentation connector | Focused workflow, explicit evidence, progressive disclosure into references | Manual task trials evaluate usefulness; no automated suites per repository policy. Local skill-creator instructions also read. |

Focused references include use/limits, original examples, ordinary-language intent,
failure symptoms and revision choices. `music-craft` teaches compact rhythmic/contour
identity, clear repetition, deliberate variation, phrasing and theme-alone comparison
for “memorable melody”; no checklist promises memorability. Groove-first, root-position
bass, parallel-fifth avoidance, phrase lengths and genre/emotion associations are
contextual choices. Fractional beats support fine timing; the old contrary claim was
inaccurate.

`src/shared/guidance.ts` is the sole document manifest for runtime retrieval,
packaging, installation and hashing. The assistant receives a concise router and
loads relevant topics; the complete response remains available. UI help uses the
same operation. Provider technical references remain separate. Sources and successful
renders do not establish listener acceptance.
