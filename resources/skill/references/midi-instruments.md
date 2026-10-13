# General MIDI mapping and bank constraints

Use this mapping when a part needs the bundled General MIDI SoundFont. Program
numbers are zero-based. Query the actual bank presets; names are approximations,
not evidence of recorded articulation coverage. Use [arranging](arranging.md) for
general roles/register guidance and [composition](music-craft.md) for phrasing.

| Programs | Family |
| --- | --- |
| 0–7 | Piano |
| 8–15 | Chromatic percussion |
| 16–23 | Organ |
| 24–31 | Guitar |
| 32–39 | Bass |
| 40–47 | Strings, harp, timpani |
| 48–55 | Ensembles and voices |
| 56–63 | Brass |
| 64–71 | Reeds |
| 72–79 | Pipes |
| 80–87 | Synth leads |
| 88–95 | Synth pads |
| 96–103 | Synth effects |
| 104–111 | Additional instrument colors |
| 112–119 | Percussive instruments |
| 120–127 | Sound effects |

For “the same notes with a more delicate foreground,” an original experiment
changes a SoundFont track from program 56 (trumpet) to 73 (flute), then adjusts
expression and accompaniment balance. Keep the thematic pattern untouched. The
result is a bank-specific experiment; equal velocity does not mean equal loudness
or that one instrument always feels delicate.

Legacy MIDI uses `drums:true`; arrangement SoundFont percussion uses bank 128.
Common GM keys are kick 35/36, snare 38/40, clap 39, closed/open hat 42/46,
crash 49, ride 51, and toms 41/43/45/47/48/50. A sampler's pad mapping is separate.

Expression, pedal, pitch bend, velocity, and note lengths shape playback within
the bank's limits. They do not supply recorded legato transitions or bow strokes.
If attacks smear, revise density/duration or choose another source. If balance
fails, inspect register and accompaniment before raising the master. Do not assign
fixed registers or musical styles to every instrument family.

The new SoundFont path disables internal reverb/chorus and uses explicit effect
chains. Legacy native MIDI playback retains its own renderer behavior. General MIDI
conventions identify programs; whether they suit the brief is a listening judgment.
