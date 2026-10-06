# Composing with the workbench

How `compose_midi` fits the SfxChat workflow, for the app assistant and for CLI/MCP agents. It is
the only generation path that needs no provider, key, or spend: the notes *are* the artifact, and
the app writes them to a Standard MIDI File that plays through the bundled General MIDI bank.

## The call

Supply a short `prompt` (what the clip is for, in musical terms) and a `composition`:

- `bpm` 20-300 and an optional `timeSig` (default 4/4).
- 1-8 `tracks`. Each track has optional `name`, optional `program` (GM 0-127), optional
  `drums: true`, and its `notes`.
- Each note has `pitch` (0-127), `startBeat`, `durationBeats`, and optional `velocity` (1-127,
  default 100). Positions and lengths are in **quarter-note beats**: a quarter note is 1.0, an
  eighth 0.5, a half 2.0, a bar of 4/4 is 4.0.

Limits are enforced before anything is written: 8 tracks, 500 notes per track, 2000 notes total,
and a clip of at most ten minutes. A clip needs at least one note.

Composition is local and immediate, but it still runs as a normal job: it returns durable job IDs
right away, appears in the MIDI library and the comparison playground, and is recorded with the
exact composition for later reproduction.

## Iterating

Revising means sending a **complete new composition** with `parentId` set to the clip being
changed — an earlier clip is never modified, and the revision chain stays intact. Change one thing
per revision (tempo, an instrument, the drum pattern, the melody's register) so the effect of the
change is audible and attributable. Keep the `prompt` describing the intent; the composition is
how that intent is currently realised.

Read [making music that works](music-craft.md) before composing and
[arranging for the General MIDI bank](midi-instruments.md) when choosing instruments and registers.

## Hearing the result

Only if the `audio_listen` tool is available to your model (the calling model must accept audio
input). It renders the clip through the bundled bank and returns a bounded mono clip. What you hear
is the bank's approximation of the written notes, not a performance, and the user's audition
decides whether the clip is any good. The written notes remain the primary record of what the clip
is: reason about the composition directly, and treat a render as a second opinion.

## Finishing

Place the clip you want the user to compare in the playground with `set_playground`, like any other
sound. In the app, the MIDI studio shows the clip as a piano roll: the user can edit notes by hand,
pick a different instrument from the bank, and play it with a moving playhead. Manual edits produce
a derivative with its own lineage, so the composed original is preserved.

## Evidence limits

- A render through the bank is an observation at that bank's fidelity; it is not proof of musical
  quality, and it is not listening evidence for a model that lacks audio input.
- Craft guidance is convention, not law. Deliberate departures are fine when the brief asks for
  them, and measured structure (tempo, note counts, density) is not a judgement of how the music
  sounds.
