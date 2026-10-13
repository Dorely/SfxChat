/**
 * Standard MIDI File reader/writer for the MIDI creator.
 *
 * Writes format-1 files (conductor track plus one track per composition track) and reads
 * format-0/1 files, converting between file ticks and the beat-based model in `src/shared/midi.ts`.
 * Beats are tempo-independent, so note positions survive a file that changes tempo even though
 * the model carries a single tempo.
 */
import {
  MIDI_DRUM_CHANNEL, MIDI_MAX_NOTES, MIDI_MAX_NOTES_PER_TRACK, MIDI_MAX_TRACKS, MIDI_TICKS_PER_QUARTER,
  MidiComposition, MidiNote, MidiTimeSignature, MidiTrack, clampProgram, midiCompositionProblem,
  midiDurationSeconds, midiTimeSignature, midiTrackLabel, midiVelocity
} from '../shared/midi';
import { valueOf, type Arrangement, type Track } from '../shared/arrangement';

const META = 0xff;
const END_OF_TRACK = 0x2f;
const MAX_SCANNED_EVENTS = 200_000;

interface Event { tick: number; order: number; bytes: number[] }
interface OpenNote { pitch: number; start: number; velocity: number }
interface ParsedTrack {
  name: string | null;
  notesByChannel: Map<number, MidiNote[]>;
  programs: Map<number, number>;
  tempo: number | null;
  timeSig: MidiTimeSignature | null;
  events: number;
}

const varint = (value: number): number[] => {
  const safe = Math.max(0, Math.floor(value));
  let rest = Math.floor(safe / 128);
  const bytes = [safe % 128];
  while (rest > 0) { bytes.unshift((rest % 128) | 0x80); rest = Math.floor(rest / 128); }
  return bytes;
};

const trackChunk = (events: Event[]): Buffer => {
  const body: number[] = [];
  let previous = 0;
  for (const event of events) { body.push(...varint(event.tick - previous)); previous = event.tick; body.push(...event.bytes); }
  const chunk = Buffer.from(body);
  const header = Buffer.alloc(8);
  header.write('MTrk', 0, 'latin1');
  header.writeUInt32BE(chunk.length, 4);
  return Buffer.concat([header, chunk]);
};

const textEvent = (type: number, text: string): number[] => {
  const bytes = [...Buffer.from(text, 'utf8')].slice(0, 127);
  return [META, type, bytes.length, ...bytes];
};

const tempoEvent = (bpm: number): number[] => {
  const microseconds = Math.min(0xffffff, Math.max(1, Math.round(60_000_000 / bpm)));
  return [META, 0x51, 3, (microseconds >> 16) & 0xff, (microseconds >> 8) & 0xff, microseconds & 0xff];
};

const timeSignatureEvent = (timeSig: MidiTimeSignature): number[] => {
  const exponent = Math.max(0, Math.min(7, Math.round(Math.log2(timeSig.denominator))));
  return [META, 0x58, 4, timeSig.numerator & 0xff, exponent, 24, 8];
};

const endOfTrack = (tick: number): Event => ({ tick, order: 9, bytes: [META, END_OF_TRACK, 0] });

/** One independent track per file avoids channel collisions for large arrangements. */
export function writeArrangementMidi(doc: Arrangement, track: Track): Buffer {
  const tick = (beat: number) => Math.round(beat * MIDI_TICKS_PER_QUARTER);
  const conductor: Event[] = [{ tick: 0, order: 0, bytes: textEvent(0x03, doc.name) }];
  for (const tempo of doc.tempos) conductor.push({ tick: tick(tempo.beat), order: 1, bytes: tempoEvent(tempo.bpm) }, { tick: tick(tempo.beat), order: 2, bytes: timeSignatureEvent(tempo) });
  for (const section of doc.sections) conductor.push({ tick: tick(section.start), order: 3, bytes: textEvent(0x06, section.name) });
  conductor.sort((a, b) => a.tick - b.tick || a.order - b.order); conductor.push(endOfTrack(tick(doc.length)));
  const p = track.instrument.params, channel = p.bank === 128 ? 9 : 0;
  const events: Event[] = [{ tick: 0, order: 0, bytes: textEvent(0x03, track.name) }];
  const cc = (at: number, controller: number, value: number) => events.push({ tick: tick(at), order: 1, bytes: [0xb0 | channel, controller, Math.max(0, Math.min(127, Math.round(value)))] });
  const bend = (at: number, value: number) => { const n = Math.max(0, Math.min(16383, Math.round(8192 + value * 4096))); events.push({ tick: tick(at), order: 1, bytes: [0xe0 | channel, n & 127, n >> 7] }); };
  const programAt = (beat: number) => {
    let value = valueOf(p, 'program');
    for (const lane of track.automation.filter(l => l.target === 'instrument.program')) {
      let i = lane.points.length - 1;
      while (i >= 0 && lane.points[i].beat > beat) i--;
      if (i < 0) continue;
      const a = lane.points[i], b = lane.points[i + 1];
      value = b && lane.interpolation === 'linear' ? a.value + (b.value - a.value) * (beat - a.beat) / (b.beat - a.beat) : a.value;
    }
    return Math.round(value);
  };
  cc(0, 7, track.gain * 127); cc(0, 10, (track.pan + 1) * 63.5);
  if (track.instrument.type === 'soundfont') {
    if (channel !== 9) { cc(0, 0, 0); cc(0, 32, valueOf(p, 'bank')); }
    events.push({ tick: 0, order: 2, bytes: [0xc0 | channel, Math.round(valueOf(p, 'program'))] });
    cc(0, 11, valueOf(p, 'expression')); cc(0, 64, valueOf(p, 'pedal')); bend(0, valueOf(p, 'pitchBend'));
  }
    for (const lane of track.automation) {
      const control = lane.target === 'instrument.expression' ? 11 : lane.target === 'instrument.pedal' ? 64 : lane.target === 'gain' ? 7 : lane.target === 'pan' ? 10 : -1;
      if (control < 0 && !['instrument.pitchBend', 'instrument.program', 'instrument.bank'].includes(lane.target)) continue;
      for (let i = 0; i < lane.points.length; i++) {
        const a = lane.points[i], b = lane.points[i + 1];
        const steps = b && lane.interpolation === 'linear' ? Math.max(1, Math.ceil((b.beat - a.beat) * 24)) : 1;
        for (let step = 0; step < steps; step++) { const at = b && lane.interpolation === 'linear' ? a.beat + (b.beat - a.beat) * step / steps : a.beat, v = b && lane.interpolation === 'linear' ? a.value + (b.value - a.value) * step / steps : a.value;
          if (events.length > 500000) throw new Error('MIDI automation exceeds export event limit.');
          if (control >= 0) cc(at, control, lane.target === 'gain' ? v * 127 : lane.target === 'pan' ? (v + 1) * 63.5 : v);
          else if (lane.target === 'instrument.program') events.push({tick: tick(at), order: 2, bytes: [0xc0 | channel, Math.round(v)]});
          else if (lane.target === 'instrument.bank') {
            cc(at, 0, Math.floor(Math.round(v) / 128)); cc(at, 32, Math.round(v) % 128);
            // Bank select takes effect only with a following program change.
            events.push({tick: tick(at), order: 2, bytes: [0xc0 | channel, programAt(at)]});
          }
          else bend(at, v);
        }
      }
    }
  for (const clip of track.clips) {
    const pattern = doc.patterns.find(p => p.id === clip.patternId); if (!pattern) continue;
    for (let at = 0; at < clip.length; at += pattern.length) {
      for (const note of pattern.notes) { const start = at + note.start - clip.offset; if (start < 0 || start >= clip.length) continue;
        const from = tick(clip.start + start), to = Math.max(from + 1, tick(clip.start + Math.min(clip.length, start + note.duration))), pitch = Math.max(0, Math.min(127, note.pitch + clip.transpose));
        events.push({ tick: from, order: 4, bytes: [0x90 | channel, pitch, Math.max(1, Math.min(127, Math.round(note.velocity * clip.gain * 127)))] }, { tick: to, order: 3, bytes: [0x80 | channel, pitch, 0] });
      }
      if (events.length > 500000) throw new Error('Expanded MIDI track exceeds export event limit.');
      if (!clip.repeat) break;
    }
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order); events.push(endOfTrack(Math.max(tick(doc.length), events.at(-1)?.tick ?? 0)));
  const header = Buffer.alloc(14); header.write('MThd'); header.writeUInt32BE(6, 4); header.writeUInt16BE(1, 8); header.writeUInt16BE(2, 10); header.writeUInt16BE(MIDI_TICKS_PER_QUARTER, 12);
  return Buffer.concat([header, trackChunk(conductor), trackChunk(events)]);
}

/** Serializes a composition as a format-1 Standard MIDI File. */
export const writeMidi = (composition: MidiComposition): Buffer => {
  const problem = midiCompositionProblem(composition);
  if (problem) throw new Error(problem);
  const conductor: Event[] = [
    { tick: 0, order: 0, bytes: textEvent(0x03, 'SfxChat') },
    { tick: 0, order: 1, bytes: tempoEvent(composition.bpm) },
    { tick: 0, order: 2, bytes: timeSignatureEvent(midiTimeSignature(composition)) },
    endOfTrack(0)
  ];
  const chunks = [trackChunk(conductor)];
  composition.tracks.forEach((track, index) => {
    const channel = track.drums ? MIDI_DRUM_CHANNEL : index;
    const events: Event[] = [{ tick: 0, order: 0, bytes: textEvent(0x03, midiTrackLabel(track, index)) }];
    if (!track.drums) events.push({ tick: 0, order: 1, bytes: [0xc0 | channel, clampProgram(track.program)] });
    for (const note of track.notes) {
      const start = Math.max(0, Math.round(note.startBeat * MIDI_TICKS_PER_QUARTER));
      const end = Math.max(start + 1, Math.round((note.startBeat + note.durationBeats) * MIDI_TICKS_PER_QUARTER));
      events.push({ tick: end, order: 2, bytes: [0x80 | channel, note.pitch, 0] });
      events.push({ tick: start, order: 3, bytes: [0x90 | channel, note.pitch, midiVelocity(note)] });
    }
    events.sort((first, second) => first.tick - second.tick || first.order - second.order);
    events.push(endOfTrack(events.length ? events[events.length - 1].tick : 0));
    chunks.push(trackChunk(events));
  });
  const header = Buffer.alloc(14);
  header.write('MThd', 0, 'latin1');
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(chunks.length, 10);
  header.writeUInt16BE(MIDI_TICKS_PER_QUARTER, 12);
  return Buffer.concat([header, ...chunks]);
};

const readVarint = (bytes: Buffer, from: number, end: number): { value: number; next: number } => {
  let value = 0;
  let position = from;
  for (let index = 0; index < 4; index++) {
    if (position >= end) throw new Error('A MIDI track ends in the middle of a value.');
    const byte = bytes[position++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: position };
  }
  throw new Error('A MIDI track holds an invalid value.');
};

const parseTrack = (bytes: Buffer, start: number, end: number, ticksPerQuarter: number): ParsedTrack => {
  let position = start;
  let tick = 0;
  let running = 0;
  let events = 0;
  let name: string | null = null;
  let tempo: number | null = null;
  let timeSig: MidiTimeSignature | null = null;
  const open = new Map<string, OpenNote[]>();
  const notesByChannel = new Map<number, MidiNote[]>();
  const programs = new Map<number, number>();
  const close = (channel: number, pitch: number, at: number) => {
    const note = open.get(`${channel}:${pitch}`)?.shift();
    if (!note || at <= note.start) return;
    const notes = notesByChannel.get(channel) ?? [];
    notes.push({
      pitch,
      startBeat: note.start / ticksPerQuarter,
      durationBeats: (at - note.start) / ticksPerQuarter,
      velocity: note.velocity
    });
    notesByChannel.set(channel, notes);
  };
  while (position < end) {
    const delta = readVarint(bytes, position, end);
    position = delta.next;
    tick += delta.value;
    events++;
    let status = bytes[position];
    if (status & 0x80) { running = status; position++; } else { status = running; }
    if (!status) throw new Error('A MIDI track holds an invalid event.');
    if (status === META) {
      const type = bytes[position++];
      const length = readVarint(bytes, position, end);
      position = length.next;
      const body = bytes.subarray(position, position + length.value);
      position += length.value;
      if (type === 0x03 && body.length) name = body.toString('utf8');
      else if (type === 0x51 && body.length >= 3) {
        const microseconds = (body[0] << 16) | (body[1] << 8) | body[2];
        if (microseconds > 0) tempo ??= Math.round(60_000_000 / microseconds);
      } else if (type === 0x58 && body.length >= 2) timeSig ??= { numerator: body[0], denominator: 2 ** body[1] };
      else if (type === END_OF_TRACK) break;
      running = 0;
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      const length = readVarint(bytes, position, end);
      position = length.next + length.value;
      running = 0;
      continue;
    }
    const channel = status & 0x0f;
    const type = status & 0xf0;
    if (type === 0x80 || type === 0x90) {
      const pitch = bytes[position++];
      const velocity = bytes[position++];
      if (type === 0x90 && velocity > 0) {
        const queue = open.get(`${channel}:${pitch}`) ?? [];
        queue.push({ pitch, start: tick, velocity });
        open.set(`${channel}:${pitch}`, queue);
      } else close(channel, pitch, tick);
    } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) position += 2;
    else if (type === 0xc0) programs.set(channel, bytes[position++]);
    else if (type === 0xd0) position += 1;
    else throw new Error('A MIDI track holds an unsupported event.');
    if (position > end) throw new Error('A MIDI track is truncated.');
  }
  for (const [key, queue] of [...open.entries()]) {
    const channel = Number(key.slice(0, key.indexOf(':')));
    for (const note of [...queue]) close(channel, note.pitch, tick);
  }
  return { name, notesByChannel, programs, tempo, timeSig, events };
};

/** Parses a Standard MIDI File into the editor's beat-based composition model. */
export const parseMidi = (bytes: Buffer): MidiComposition => {
  if (bytes.length < 14 || bytes.toString('latin1', 0, 4) !== 'MThd') throw new Error('That file is not a Standard MIDI File.');
  const headerLength = bytes.readUInt32BE(4);
  if (headerLength < 6 || bytes.length < 8 + headerLength) throw new Error('The MIDI header is truncated.');
  const format = bytes.readUInt16BE(8);
  if (format === 2) throw new Error('Format 2 MIDI files are not supported.');
  const division = bytes.readUInt16BE(12);
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported.');
  const ticksPerQuarter = division || MIDI_TICKS_PER_QUARTER;
  let offset = 8 + headerLength;
  let bpm: number | null = null;
  let timeSig: MidiTimeSignature | null = null;
  let scanned = 0;
  const chunks: ParsedTrack[] = [];
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('latin1', offset, offset + 4);
    const length = bytes.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw new Error('A MIDI track is truncated.');
    if (id === 'MTrk') {
      const track = parseTrack(bytes, start, end, ticksPerQuarter);
      bpm ??= track.tempo;
      timeSig ??= track.timeSig;
      scanned += track.events;
      if (scanned > MAX_SCANNED_EVENTS) throw new Error('That MIDI file has too many events.');
      chunks.push(track);
    }
    offset = end;
  }
  if (!chunks.length) throw new Error('That MIDI file has no tracks.');
  const tracks: MidiTrack[] = [];
  const push = (channel: number, notes: MidiNote[], program: number | undefined, name: string | null) => {
    if (!notes.length) return;
    tracks.push({
      ...(name ? { name } : {}),
      program: clampProgram(program),
      drums: channel === MIDI_DRUM_CHANNEL,
      notes: notes.sort((first, second) => first.startBeat - second.startBeat)
    });
  };
  if (format === 0) {
    const merged = new Map<number, MidiNote[]>();
    const programs = new Map<number, number>();
    let name: string | null = null;
    for (const chunk of chunks) {
      name ??= chunk.name;
      for (const [channel, notes] of chunk.notesByChannel) merged.set(channel, [...(merged.get(channel) ?? []), ...notes]);
      for (const [channel, program] of chunk.programs) programs.set(channel, program);
    }
    for (const [channel, notes] of [...merged.entries()].sort((first, second) => first[0] - second[0])) push(channel, notes, programs.get(channel), name);
  } else {
    for (const chunk of chunks) for (const [channel, notes] of chunk.notesByChannel) push(channel, notes, chunk.programs.get(channel), chunk.name);
  }
  if (!tracks.length) throw new Error('That MIDI file has no notes.');
  const noteCount = tracks.reduce((total, track) => total + track.notes.length, 0);
  if (tracks.length > MIDI_MAX_TRACKS) throw new Error(`That MIDI file has more than ${MIDI_MAX_TRACKS} tracks, which is more than the editor supports.`);
  if (noteCount > MIDI_MAX_NOTES) throw new Error(`That MIDI file has more than ${MIDI_MAX_NOTES} notes, which is more than the editor supports.`);
  if (tracks.some(track => track.notes.length > MIDI_MAX_NOTES_PER_TRACK)) throw new Error(`That MIDI file holds more than ${MIDI_MAX_NOTES_PER_TRACK} notes in one track, which is more than the editor supports.`);
  return { bpm: bpm ?? 120, timeSig: timeSig ?? { numerator: 4, denominator: 4 }, tracks };
};

/** Clip length in seconds, used when registering an imported or generated MIDI asset. */
export const midiFileDurationSeconds = (bytes: Buffer): number => midiDurationSeconds(parseMidi(bytes));
