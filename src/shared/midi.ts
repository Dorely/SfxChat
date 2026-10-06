/**
 * Symbolic MIDI note model shared by the main process, renderer, and assistant tools.
 *
 * Notes are expressed in quarter-note beats rather than ticks: beats are tempo-independent,
 * natural for the model to author, and map directly onto the piano-roll grid. `src/main/midi.ts`
 * converts to and from Standard MIDI File ticks.
 */

export interface MidiNote {
  /** MIDI key number, 0-127. */
  pitch: number;
  /** Start position in quarter-note beats from the beginning of the clip. */
  startBeat: number;
  /** Length in quarter-note beats; at least one tick once written. */
  durationBeats: number;
  /** 1-127; omitted means the default velocity. */
  velocity?: number;
}

export interface MidiTrack {
  name?: string;
  /** General MIDI program, 0-127. Ignored for drum tracks. */
  program?: number;
  /** Percussion track: rendered on the GM drum channel. */
  drums?: boolean;
  notes: MidiNote[];
}

export interface MidiTimeSignature {
  numerator: number;
  denominator: number;
}

export interface MidiComposition {
  /** Beats per minute, 20-300. */
  bpm: number;
  timeSig?: MidiTimeSignature;
  /** One to `MIDI_MAX_TRACKS` tracks. */
  tracks: MidiTrack[];
}

export interface MidiTrackSummary {
  name: string;
  program: number;
  drums: boolean;
  noteCount: number;
}

/** Recorded on every MIDI asset so the inspector and cards need no re-parse. */
export interface MidiSummary {
  bpm: number;
  timeSig: MidiTimeSignature;
  ticksPerQuarter: number;
  tracks: MidiTrackSummary[];
  noteCount: number;
  durationSeconds: number;
}

export const MIDI_TICKS_PER_QUARTER = 480;
export const MIDI_BPM_MIN = 20;
export const MIDI_BPM_MAX = 300;
export const MIDI_TIME_SIG_DENOMINATORS = [1, 2, 4, 8, 16];
export const MIDI_MAX_TRACKS = 8;
export const MIDI_MAX_NOTES_PER_TRACK = 500;
export const MIDI_MAX_NOTES = 2000;
export const MIDI_MAX_PITCH = 127;
export const MIDI_DEFAULT_VELOCITY = 100;
export const MIDI_MAX_DURATION_SECONDS = 600;
export const MIDI_DEFAULT_TIME_SIG: MidiTimeSignature = { numerator: 4, denominator: 4 };
export const MIDI_DRUM_CHANNEL = 9;

/** General MIDI Level 1 melodic programs, index = program number. */
export const GM_PROGRAMS: readonly string[] = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
  'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
  'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
  'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'SynthStrings 1', 'SynthStrings 2',
  'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'SynthBrass 1', 'SynthBrass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)', 'Lead 5 (charang)',
  'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass + lead)',
  'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)', 'Pad 5 (bowed)',
  'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
  'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)', 'FX 5 (brightness)',
  'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot'
];

/** General MIDI percussion key map (notes 35-81); other keys have no standard name. */
export const GM_DRUMS: Readonly<Record<number, string>> = {
  35: 'Acoustic Bass Drum', 36: 'Bass Drum 1', 37: 'Side Stick', 38: 'Acoustic Snare', 39: 'Hand Clap',
  40: 'Electric Snare', 41: 'Low Floor Tom', 42: 'Closed Hi-Hat', 43: 'High Floor Tom', 44: 'Pedal Hi-Hat',
  45: 'Low Tom', 46: 'Open Hi-Hat', 47: 'Low-Mid Tom', 48: 'Hi-Mid Tom', 49: 'Crash Cymbal 1', 50: 'High Tom',
  51: 'Ride Cymbal 1', 52: 'Chinese Cymbal', 53: 'Ride Bell', 54: 'Tambourine', 55: 'Splash Cymbal',
  56: 'Cowbell', 57: 'Crash Cymbal 2', 58: 'Vibraslap', 59: 'Ride Cymbal 2', 60: 'Hi Bongo', 61: 'Low Bongo',
  62: 'Mute Hi Conga', 63: 'Open Hi Conga', 64: 'Low Conga', 65: 'High Timbale', 66: 'Low Timbale',
  67: 'High Agogo', 68: 'Low Agogo', 69: 'Cabasa', 70: 'Maracas', 71: 'Short Whistle', 72: 'Long Whistle',
  73: 'Short Guiro', 74: 'Long Guiro', 75: 'Claves', 76: 'Hi Wood Block', 77: 'Low Wood Block',
  78: 'Mute Cuica', 79: 'Open Cuica', 80: 'Mute Triangle', 81: 'Open Triangle'
};

export const midiVelocity = (note: MidiNote): number => note.velocity ?? MIDI_DEFAULT_VELOCITY;
export const clampProgram = (program: number | undefined): number =>
  program == null ? 0 : Math.min(127, Math.max(0, Math.round(program)));
export const midiNoteCount = (composition: MidiComposition): number =>
  composition.tracks.reduce((total, track) => total + track.notes.length, 0);

/** Quarter-note beats from the start to the end of the last sounding note. */
export const midiLengthBeats = (composition: MidiComposition): number =>
  composition.tracks.reduce(
    (longest, track) => track.notes.reduce((trackEnd, note) => Math.max(trackEnd, note.startBeat + note.durationBeats), longest),
    0
  );

export const midiDurationSeconds = (composition: MidiComposition): number => {
  const bpm = Math.min(MIDI_BPM_MAX, Math.max(MIDI_BPM_MIN, composition.bpm || MIDI_BPM_MIN));
  return (midiLengthBeats(composition) * 60) / bpm;
};

export const midiTimeSignature = (composition: MidiComposition): MidiTimeSignature => {
  const timeSig = composition.timeSig;
  if (!timeSig) return MIDI_DEFAULT_TIME_SIG;
  return { numerator: timeSig.numerator, denominator: timeSig.denominator };
};

export const midiTrackLabel = (track: MidiTrack, index: number): string => {
  const name = track.name?.trim();
  if (name) return name;
  if (track.drums) return 'Drums';
  return GM_PROGRAMS[clampProgram(track.program)] ?? `Track ${index + 1}`;
};

export const midiDrumName = (pitch: number): string => GM_DRUMS[pitch] ?? `Percussion ${pitch}`;

export const midiSummary = (composition: MidiComposition): MidiSummary => ({
  bpm: composition.bpm,
  timeSig: midiTimeSignature(composition),
  ticksPerQuarter: MIDI_TICKS_PER_QUARTER,
  tracks: composition.tracks.map((track, index) => ({
    name: midiTrackLabel(track, index),
    program: clampProgram(track.program),
    drums: track.drums === true,
    noteCount: track.notes.length
  })),
  noteCount: midiNoteCount(composition),
  durationSeconds: midiDurationSeconds(composition)
});

/** Human-readable reason a composition cannot be written, or null when it is within bounds. */
export const midiCompositionProblem = (composition: MidiComposition): string | null => {
  if (!Number.isFinite(composition.bpm) || composition.bpm < MIDI_BPM_MIN || composition.bpm > MIDI_BPM_MAX) {
    return `Tempo must be ${MIDI_BPM_MIN}-${MIDI_BPM_MAX} BPM.`;
  }
  const timeSig = midiTimeSignature(composition);
  if (!Number.isInteger(timeSig.numerator) || timeSig.numerator < 1 || timeSig.numerator > 12) return 'The time signature numerator must be 1-12.';
  if (!MIDI_TIME_SIG_DENOMINATORS.includes(timeSig.denominator)) return `The time signature denominator must be one of ${MIDI_TIME_SIG_DENOMINATORS.join(', ')}.`;
  if (composition.tracks.length < 1 || composition.tracks.length > MIDI_MAX_TRACKS) return `A clip needs 1-${MIDI_MAX_TRACKS} tracks.`;
  let total = 0;
  for (const [index, track] of composition.tracks.entries()) {
    const label = `Track ${index + 1}`;
    if (track.notes.length > MIDI_MAX_NOTES_PER_TRACK) return `${label} has more than ${MIDI_MAX_NOTES_PER_TRACK} notes.`;
    total += track.notes.length;
    for (const note of track.notes) {
      if (!Number.isFinite(note.pitch) || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > MIDI_MAX_PITCH) return `${label} has a note outside the 0-${MIDI_MAX_PITCH} range.`;
      if (!Number.isFinite(note.startBeat) || note.startBeat < 0) return `${label} has a note with an invalid start.`;
      if (!Number.isFinite(note.durationBeats) || note.durationBeats <= 0) return `${label} has a note with no length.`;
      const velocity = midiVelocity(note);
      if (!Number.isInteger(velocity) || velocity < 1 || velocity > 127) return `${label} has a velocity outside 1-127.`;
    }
  }
  if (total > MIDI_MAX_NOTES) return `A clip can hold up to ${MIDI_MAX_NOTES} notes.`;
  if (total < 1) return 'A clip needs at least one note.';
  if (midiDurationSeconds(composition) > MIDI_MAX_DURATION_SECONDS) return `A clip can be up to ${MIDI_MAX_DURATION_SECONDS / 60} minutes long.`;
  return null;
};

