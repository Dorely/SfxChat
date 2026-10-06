# Making music that works

Composing craft for `compose_midi`. Everything here is a working convention, not a rule: musical
decisions follow the brief, and the user's audition is the final judge. These are starting points
that reliably produce usable clips, and deliberate departures are fine when the brief asks for
them.

## Start from the groove, not the melody

For anything rhythmic, decide tempo, meter, and the drum pattern first. A clip with a strong
two- or four-bar pattern and a simple melody beats a busy melody over a vague pulse.

- **Backbeat** (most pop, rock, funk, lo-fi): kick on beats 1 and 3, snare on 2 and 4, hi-hat on
  every eighth. This is the default that reads as "band".
- **Four-on-the-floor** (house, techno, EDM, disco): kick on every beat, clap or snare on 2 and 4,
  open hi-hat on the off-beats (the "and" of each beat).
- **Half-time** (trap, downtempo, cinematic): kick on 1, snare on 3, so the pulse feels twice as
  slow while the hats stay busy.
- **Sparse** (ambient, underscore): drop the kit entirely, or keep only a low kick and a single
  shaker on the off-beats.

Keep the pattern to two or four bars and vary it with small changes rather than new patterns: add
a kick before the downbeat, open the hi-hat on the last eighth of the phrase, drop the snare on
the final bar for a fill. Velocity variation is what makes a pattern sound played rather than
programmed — accent the downbeats (110-120), sit the body of the pattern near 95-105, and use
50-70 for ghost notes and off-beat hats.

## Harmony: a few chords, cleanly voiced

Pick one key and stay in it. In a major key the diatonic triads are I, ii, iii, IV, V, vi, and
vii°; in a natural minor key they are i, ii°, III, iv, v, VI, and VII. Progressions that carry a
lot of music with almost no effort:

- `I - V - vi - IV` — the most common modern loop; works for pop, cinematic, and lo-fi.
- `ii - V - I` — the core jazz cadence; use it to end phrases.
- `I - vi - IV - V` — the 1950s doo-wop loop; strong and immediately familiar.
- `vi - IV - I - V` — the same loop starting on the relative minor; slightly sadder.
- `i - VI - III - VII` — a minor-key workhorse for dramatic and cinematic beds.
- Twelve-bar blues: `I` for four bars, `IV` for two, `I` for two, `V`, `IV`, `I`, `V`.

One chord per bar is the safe default; two per bar for a driving feel; one every two bars for a
slow, spacious one. Change chords where the drums land hardest so the change is felt.

**Voicing and voice leading.** Keep bass notes low (roughly E1-C3) and root-position; keep the
upper voices in the middle range and move them as little as possible between chords. Prefer
common tones and stepwise motion; resolve the leading tone (the note a semitone below the tonic)
upward to the tonic. Avoid moving two voices in parallel fifths or octaves, and avoid stacking
everything in the same octave — that is where muddiness comes from. Three-note chords with clear
spacing sound better than dense six-note ones.

## Melody: one idea, repeated and varied

A melody built from a two-to-five-note motif, repeated and altered, sounds intentional; a melody
of unrelated notes sounds random. Useful tools:

- **Repetition** — state the motif plainly the first time.
- **Sequence** — repeat it a step or a third higher or lower; this creates momentum cheaply.
- **Rhythmic variation** — keep the pitches, change the rhythm, or hold the last note longer.
- **Call and response** — let the melody answer the chords, or alternate two phrases.
- **Contour** — shape phrases toward a high point and back down rather than wandering.

Bring the melody in *after* the groove is established (typically bar 3 or 5), and leave rests.
Silence between phrases makes a melody memorable and stops a clip from sounding like an exercise.
Prefer stepwise motion with a few leaps that are then stepped back down.

## Structure in the space of a clip

Clips are usually 8-32 bars. Build in phrases of two, four, or eight bars, because that is what
listeners expect a phrase to be, and assemble sections by adding and removing layers:

- **Intro (2-4 bars):** drums and bass, or a single sustained pad.
- **Main (8 bars):** the full texture with the melody.
- **Contrast (4-8 bars):** drop to two layers, change instrument or register, or move to a
  relative key. Change *something*, not everything.
- **Return (4-8 bars):** back to the main idea, often with one added layer.
- **Outro (2 bars):** thin out or resolve to the tonic.

For a loopable bed, keep the last bar open (no final tonic resolution) so the end leads back to
the start. For a finished cue, end on a resolved chord, usually a long tonic.

## Dynamics and texture

Write the shape of a phrase with velocity, not with more notes. Build into a phrase start
(velocity rising over the last beat), ease out at the end. Add and remove layers for larger
contrast: a second percussion layer, an octave doubling of the melody, or a counter-line in a
different instrument family.

Watch density. Six or eight tracks of block chords will sound congested and peak faster.
Counter-melodies, bass, drums, and one chordal instrument is a complete arrangement for most
clips. Give the ear one thing to follow at a time.

## Idiom starting points

| Style | Tempo | Kit | Harmonics | Lead |
| --- | --- | --- | --- | --- |
| Lo-fi hip hop | 70-90 | soft backbeat, ghosted hats | Electric Piano (4/5), finger bass (33) | mellow keys or flute (73) |
| Cinematic bed | 60-90 | sparse kick, taiko (116), timpani (47) | String Ensemble (48/49), pad (89) | solo cello (42) or horn (60) |
| EDM / house | 124-128 | four-on-the-floor, clap on 2 and 4 | Synth Bass (38/39) | saw lead (81), plucks |
| Orchestral | 70-100 | timpani (47), taiko (116) | Strings (48/49) | Woodwinds (68/73) over brass (61) |
| Funk | 100-115 | snare backbeat, tight hats | Clavinet (7), finger bass (33) | brass stabs (61), organ (16) |
| Ambient | 60-70 | none, or a single low pulse | Pad (89/91), choir (52/53) | Bell (14/112), long tones |
| Chiptune | 90-150 | GM kit, hard velocities | Square lead (80), triangle-ish bass (38) | fast arpeggios, octave jumps |

## Working with feedback

When the user asks for a change, revise the whole composition and change one thing at a time:
tempo, key, one instrument, the drum pattern, melody register, or arrangement density. Recalling
what changed is what makes the next revision land. Keep the brief itself stable — the `prompt` is
what the clip is *for*; the composition is how it currently does it.

## Limits to keep in mind

- You cannot hear the result unless `audio_listen` is available to your model, and even then you
  hear a render through the General MIDI bank, not a performance.
- The bank is an approximation. A "strings" part is a sampled approximation; write idiomatically
  for the instrument family rather than expecting a produced record.
- Tempo feel, swing, and micro-timing cannot be expressed precisely: positions snap to the beat
  grid, so convey feel through note lengths, velocity, and syncopation.
