# Layered sound and variation

Start with the action, duration, repetition rate, and listening context. Identify
what must be recognized and what may be stylized. A useful temporal description is
preparation, contact, movement, and settling. It is a design option, not a required
four-part template: an instantaneous event or a steady ambience may need less.

Give each layer a job: transient for contact, low energy for weight, filtered noise
for friction or air, resonant tones for ringing, and a tail for space. These are
perceptual hypotheses to audition, not a reliable material-identification formula.
Do not add every layer by default. A narrow playback device or dense game scene may
make a carefully chosen midrange cue more useful than more sub-bass.

For “make the impact heavier without making it later,” preserve clip starts and
pattern onsets. An original experiment at 120 BPM uses a resonator note at beat 0,
MIDI 38, duration 0.12 beat, release 0.35 seconds; a filtered noise accent at the
same onset with 0.06-second decay; and a quieter FM ring lasting 0.8 seconds.
Put these on separate named tracks and render components with the same timeline.
Revise low-layer gain or pitch and release, then compare against the initial mix.
Do not move the noise accent unless the timing itself is the problem.

For related variations, keep the defining gesture while changing one or two
dimensions within a useful range: pitch, noise seed, texture density, or tail.
`arrangement_render` seeds vary stochastic sources; they do not automatically vary
deterministic notes or guarantee perceptually different results. Use targeted edits
for intentional pitch or timing variants. Avoid identical conspicuous accents in a
frequently repeated cue. Preserve recipe revisions and seeds for reproducibility.

A loop needs compatible rhythm, level, timbre, and motion at both ends. Exact-length
loop export omits a tail; a full-tail export lets an event decay. The seam taper can
reduce a sample discontinuity but cannot repair incompatible musical phrases or a
large texture change. Inspect boundary measurements and audition repeated use.
Keep a separate attack/release component when a repeating sustain needs a natural
entry and exit. Components and stems share a start and end policy.

If the action reads as a generic blast, reduce irrelevant layers and strengthen its
temporal gesture. If weight masks detail, shorten the low decay or lower its level.
If repeated use feels mechanical, vary an incidental layer while preserving identity.
If a loop pumps at the join, compare head/tail level and modulation phase before
increasing a fade. Technical measurements diagnose these issues but are not a
creative-quality score; user listening remains decisive.

Source read 2026-10-13: [FMOD, Authoring Events](https://www.fmod.com/docs/2.04/studio/authoring-events.html),
sections on layered instruments and random/envelope/sidechain/seek modulators.
Its per-trigger bounded variation informed the general workflow; SfxChat does not
implement FMOD events, engine integration, or every modulator described there.
The example and diagnostic recommendations are original design guidance.
