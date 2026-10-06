# Arranging for the General MIDI bank

Every clip plays through a General MIDI (GM) SoundFont bank, so a track's character comes from its
**program number** (0-127) on a melodic track, or from `drums: true` for the GM percussion kit.
The bank ships with the app and can be replaced by the user, but the program numbers below are the
GM standard and map to equivalent instruments in any compliant bank.

## Program families

The 128 programs are grouped into sixteen families. Choosing within the right family matters more
than the exact instrument, because the family determines register, articulation, and how the
sample behaves under sustain.

| Programs | Family | Typical role |
| --- | --- | --- |
| 0-7 | Piano | Chordal comping, a steady rhythmic bed, ragtime and lo-fi leads |
| 8-15 | Chromatic percussion | Bells, marimba, and glassy accents; good for hooks and high sparkle |
| 16-23 | Organ | Sustained harmony, gospel and funk stabs, pads with movement |
| 24-31 | Guitar | Rhythmic comping; clean (27) for funk, overdriven/distorted (29/30) for rock |
| 32-39 | Bass | The bass line: finger (33), pick (34), synth (38/39) per genre |
| 40-47 | Strings and orchestral | Sustained lines, pads, solos; harp (46) and timpani (47) as colour |
| 48-55 | Ensembles | Full string and synth-string beds, choir, and orchestra hits |
| 56-63 | Brass | Section stabs and leads; trumpet (56), horn (60), brass section (61) |
| 64-71 | Reeds | Solos and counter-melodies; saxes, oboe, clarinet |
| 72-79 | Pipe | Flute (73), recorder, pan flute; light and airy leads |
| 80-87 | Synth leads | Electronic leads; square (80), sawtooth (81), fifths (86) |
| 88-95 | Synth pads | Sustained harmonic beds; warm (89), choir (91), bowed (92) |
| 96-103 | Synth effects | Textures and transitions; rain, crystal, atmosphere |
| 104-111 | Ethnic | Sitar, banjo, koto, kalimba, bagpipe for colour and hooks |
| 112-119 | Percussive | Pitched percussion and drum-like tones; taiko (116), melodic tom (117) |
| 120-127 | Sound effects | Foley and effects; use sparingly and on purpose |

## Choosing instruments for roles

- **Bass:** 33 (finger) is the default; 34 (pick) is brighter for rock; 38/39 (synth) for
  electronic styles; 32 (acoustic) for acoustic and jazz. Keep bass lines low, one note at a time,
  and mostly on the root with occasional fifth or octave movement.
- **Chords/comping:** 4/5 (electric piano) for warm jazz and lo-fi; 0/1 (acoustic piano) for
  singer-songwriter and classical; 16 (drawbar organ) or 7 (clavinet) for funk and soul; 27 (clean
  electric guitar) for funk and pop; 89/91 (pads) for ambient and cinematic. Play chords as short
  repeated hits for rhythm, or long sustained notes for pads — not both at once in one track.
- **Lead/melody:** 73 (flute), 68 (oboe), 42 (cello), 56 (trumpet), 65 (alto sax), 80/81 (synth
  leads), 112 (tinkle bell) for high sparkle. Keep melodies in a single register and let one
  instrument own the tune.
- **Pads/sustain:** 48/49 (strings), 89 (warm pad), 91 (choir), 52/53 (voices). These fill the
  middle; keep them quiet in velocity and let them hold rather than move quickly.

## Register and spacing

GM instruments have natural ranges, and playing far outside them is the fastest way to make a clip
sound synthetic. As a working guide over MIDI note numbers:

- Bass and low foundation: 28-48
- Chords and harmonic middle: 48-72
- Lead and melody: 60-84
- Sparkle and accents: 72-96

Leave gaps between the roles. If the bass, chords, and melody all sit between 60 and 72, the clip
will sound muddy and peak early; spread them out and let each layer occupy its own band.

## The drum kit

Set `drums: true` on a track to use the GM percussion kit. The standard keys:

- **Kick:** 36 (Bass Drum 1), 35 (Acoustic Bass Drum)
- **Snare:** 38 (Acoustic Snare), 40 (Electric Snare), 39 (Hand Clap)
- **Hi-hats:** 42 (closed), 44 (pedal), 46 (open)
- **Toms:** 50 (high), 48 (hi-mid), 47 (low-mid), 45 (low), 41/43 (floor)
- **Cymbals:** 49 (crash), 51 (ride), 53 (ride bell), 52 (Chinese), 57 (crash 2)
- **Percussion colour:** 54 (tambourine), 56 (cowbell), 60/61 (bongos), 62-64 (congas),
  70 (maracas), 75 (claves), 76/77 (wood blocks), 81 (open triangle)

Write drum parts one voice at a time: kick pattern, then snare, then hats, then colour. Keep hats
lighter than the kick and snare, and vary velocity within a pattern rather than repeating one
value.

## What this bank rewards, and where it struggles

- **Rewards:** clear separation of roles, moderate densities, velocity variation, and note lengths
  that imply articulation (short, detached chords versus long, sustained pads).
- **Struggles with:** extremely fast repeated notes (the samples smear), very dense chords, wide
  dynamic extremes, and heavily distorted guitars, which sound thin compared with a produced
  record. Prefer clean or lightly driven instruments and let arrangement carry the energy.
- **Reverb and chorus are applied by the synth**, so notes ring past their end. Leave a little
  space at the end of a phrase rather than stacking notes right up to the bar line.
