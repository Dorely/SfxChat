import {
  beatSeconds,
  secondsBeat,
  valueOf,
  type Arrangement,
  type Track,
  type Effect,
  type SampleMap,
  type Instrument,
} from "./arrangement";

export interface SoundfontVoice {
  midiNoteOn(channel: number, pitch: number, velocity: number): void;
  midiNoteOff(channel: number, pitch: number): void;
  midiControl(channel: number, controller: number, value: number): void;
  midiPitchBend(channel: number, value: number): void;
  midiProgramSelect(
    channel: number,
    font: number,
    bank: number,
    program: number,
  ): void;
  render(buffers: Float32Array[]): void;
  close(): void;
}
export interface FontState {
  synth: SoundfontVoice;
  font: number;
}
interface Event {
  frame: number;
  end: number;
  pitch: number;
  velocity: number;
  sampleId?: string;
  offset?: number;
  reverse?: boolean;
}
interface Voice extends Event {
  phase: number;
  phase2: number;
  modPhase: number;
  filter: number;
  age: number;
  rng: number;
  grains: { age: number; start: number; length: number }[];
  nextGrain: number;
}
const db = (value: number) => Math.pow(10, value / 20);
const clamp = (x: number, low: number, high: number) =>
  Math.max(low, Math.min(high, x));
const hash = (text: string) => {
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
};
function random(v: { rng: number }) {
  let x = v.rng;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  v.rng = x >>> 0;
  return v.rng / 4294967296;
}
function envelope(
  age: number,
  held: number,
  p: Record<string, number>,
): number {
  const a = valueOf(p, "attack"),
    d = valueOf(p, "decay"),
    s = valueOf(p, "sustain"),
    r = valueOf(p, "release");
  const before = (t: number) =>
    t < a ? t / a : s + (1 - s) * Math.max(0, 1 - (t - a) / d);
  return age <= held
    ? before(age)
    : before(held) * Math.max(0, 1 - (age - held) / r);
}
// Polynomial bandlimited steps reduce oscillator discontinuity aliasing.
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}
function oscillator(
  phase: number,
  increment: number,
  shape: Instrument["waveform"],
): number {
  const t = phase % 1;
  if (shape === "sine") return Math.sin(t * Math.PI * 2);
  if (shape === "triangle") return 1 - 4 * Math.abs(t - 0.5);
  if (shape === "square")
    return (
      (t < 0.5 ? 1 : -1) + blep(t, increment) - blep((t + 0.5) % 1, increment)
    );
  return t * 2 - 1 - blep(t, increment);
}
class Processor {
  private z1 = [0, 0];
  private z2 = [0, 0];
  private envelope = 0;
  private index = 0;
  private delay: Float32Array[];
  private reverbs: Float32Array[];
  private reverbIndices = [0, 0, 0, 0];
  constructor(private rate: number) { this.delay = [new Float32Array(1), new Float32Array(1)]; this.reverbs = []; }
  process(buffer: Float32Array[], effect: Effect, sidechain?: Float32Array[]) {
    if (effect.bypass) return;
    if (effect.type === 'delay' && this.delay[0].length === 1) this.delay = [new Float32Array(this.rate * 2 + 1), new Float32Array(this.rate * 2 + 1)];
    if (effect.type === 'reverb' && !this.reverbs.length) this.reverbs = [0.0297, 0.0371, 0.0411, 0.0437].map(t => new Float32Array(Math.round(this.rate * t)));
    const p = effect.params,
      mix = valueOf(p, "mix"),
      cutoff = Math.min(this.rate * 0.45, valueOf(p, "cutoff"));
    const w = (2 * Math.PI * cutoff) / this.rate,
      cos = Math.cos(w),
      alpha = Math.sin(w) / (2 * valueOf(p, "resonance"));
    const a0 = 1 + alpha,
      b0 = (1 - cos) / 2 / a0,
      b1 = (1 - cos) / a0,
      b2 = b0,
      a1 = (-2 * cos) / a0,
      a2 = (1 - alpha) / a0;
    const delayFrames = Math.min(
      this.delay[0].length - 1,
      Math.round(valueOf(p, "time") * this.rate),
    );
    for (let i = 0; i < buffer[0].length; i++) {
      const level = Math.max(
        Math.abs((sidechain ?? buffer)[0][i]),
        Math.abs((sidechain ?? buffer)[1][i]),
      );
      const coefficient = Math.exp(
        -1 /
          (this.rate *
            (level > this.envelope
              ? valueOf(p, "attack")
              : valueOf(p, "release"))),
      );
      this.envelope = coefficient * this.envelope + (1 - coefficient) * level;
      const over = Math.max(
        0,
        20 * Math.log10(Math.max(1e-9, this.envelope)) -
          valueOf(p, "threshold"),
      );
      const compression = db(-over * (1 - 1 / valueOf(p, "ratio")));
      for (let ch = 0; ch < 2; ch++) {
        const x = buffer[ch][i];
        let y = x;
        switch (effect.type) {
          case "filter":
          case "eq": {
            const low = b0 * x + this.z1[ch];
            this.z1[ch] = b1 * x - a1 * low + this.z2[ch];
            this.z2[ch] = b2 * x - a2 * low;
            y =
              effect.type === "eq"
                ? x + low * (db(valueOf(p, "eqDb")) - 1)
                : low;
            break;
          }
          case "saturation":
            y =
              Math.tanh(x * (1 + valueOf(p, "drive"))) /
              Math.tanh(1 + valueOf(p, "drive"));
            break;
          case "compressor":
            y = x * compression;
            break;
          case "gain":
            y = x * valueOf(p, "gain");
            break;
          case "limiter":
            y = clamp(
              x,
              -db(valueOf(p, "threshold")),
              db(valueOf(p, "threshold")),
            );
            break;
          case "delay": {
            const delayed =
              this.delay[ch][
                (this.index - delayFrames + this.delay[ch].length) %
                  this.delay[ch].length
              ];
            this.delay[ch][this.index] = x + delayed * valueOf(p, "feedback");
            y = x * (1 - mix) + delayed * mix;
            break;
          }
          case "reverb": {
            let wet = 0;
            for (let j = ch; j < 4; j += 2) {
              const line = this.reverbs[j],
                at = this.reverbIndices[j],
                old = line[at];
              line[at] = x * 0.25 + old * (0.3 + valueOf(p, "size") * 0.62);
              this.reverbIndices[j] = (at + 1) % line.length;
              wet += old;
            }
            y = x * (1 - mix) + wet * mix;
            break;
          }
        }
        buffer[ch][i] = Number.isFinite(y) ? y : 0;
      }
      this.index = (this.index + 1) % this.delay[0].length;
    }
  }
}
export class SoundEngine {
  frame = 0;
  private events = new Map<string, Event[]>();
  private cursors = new Map<string, number>();
  private voices = new Map<string, Voice[]>();
  private processors = new Map<string, Processor>();
  private fontNotes = new Map<string, Event[]>();
  private fonts: Record<string, FontState>;
  private trackOrder: string[] = [];
  constructor(
    public document: Arrangement,
    public sampleRate: number,
    private samples: SampleMap,
    fonts: Record<string, FontState> = {},
  ) {
    this.fonts = fonts;
    this.compile();
  }
  private compile() {
    this.events.clear();
    this.trackOrder = [];
    const visit = (t: Track) => {
      if (this.trackOrder.includes(t.id)) return;
      for (const fx of t.effects)
        if (fx.sidechain)
          visit(this.document.tracks.find((x) => x.id === fx.sidechain)!);
      this.trackOrder.push(t.id);
    };
    for (const track of this.document.tracks) {
      visit(track);
      const events: Event[] = [];
      for (const clip of track.clips) {
        if (clip.sampleId)
          events.push({
            frame: Math.round(
              beatSeconds(this.document, clip.start) * this.sampleRate,
            ),
            end: Math.round(
              beatSeconds(this.document, clip.start + clip.length) *
                this.sampleRate,
            ),
            pitch: 60 + clip.transpose,
            velocity: clip.gain,
            sampleId: clip.sampleId,
            offset: clip.offset,
            reverse: clip.reverse,
          });
        else {
          const pattern = this.document.patterns.find(
            (p) => p.id === clip.patternId,
          )!;
          for (let repeat = 0; repeat < clip.length; repeat += pattern.length) {
            for (const note of pattern.notes) {
              const start = repeat + note.start - clip.offset;
              if (start < 0 || start >= clip.length) continue;
              events.push({
                frame: Math.round(
                  beatSeconds(this.document, clip.start + start) *
                    this.sampleRate,
                ),
                end: Math.round(
                  beatSeconds(
                    this.document,
                    clip.start + Math.min(clip.length, start + note.duration),
                  ) * this.sampleRate,
                ),
                pitch: clamp(note.pitch + clip.transpose, 0, 127),
                velocity: note.velocity * clip.gain,
              });
            }
            if (!clip.repeat) break;
          }
        }
      }
      events.sort((a, b) => a.frame - b.frame);
      if (events.length > 200000)
        throw new Error("Expanded track exceeds 200,000 events.");
      this.events.set(track.id, events);
      this.cursors.set(
        track.id,
        events.findIndex((e) => e.frame >= this.frame) === -1
          ? events.length
          : events.findIndex((e) => e.frame >= this.frame),
      );
      this.voices.set(track.id, this.voices.get(track.id) ?? []);
      this.fontNotes.set(track.id, this.fontNotes.get(track.id) ?? []);
    }
  }
  update(document: Arrangement) {
    this.document = document;
    this.compile();
  }
  close() {
    for (const f of Object.values(this.fonts)) f.synth.close();
  }
  private effective(track: Track): Track {
    if (!track.automation.length) return track;
    const copy = {
      ...track,
      instrument: {
        ...track.instrument,
        params: { ...track.instrument.params },
      },
      effects: track.effects.map((e) => ({ ...e, params: { ...e.params } })),
    };
    const beat = secondsBeat(this.document, this.frame / this.sampleRate);
    for (const lane of track.automation) {
      const points = lane.points;
      if (beat < points[0].beat) continue;
      let i = 0;
      while (i + 1 < points.length && points[i + 1].beat <= beat) i++;
      const a = points[i],
        b = points[i + 1],
        value =
          b && lane.interpolation === "linear"
            ? a.value +
              ((b.value - a.value) * (beat - a.beat)) / (b.beat - a.beat)
            : a.value;
      const parts = lane.target.split(".");
      if (parts.length === 1) {
        if (parts[0] === "gain") copy.gain = value;
        else copy.pan = value;
      } else if (parts[0] === "instrument")
        copy.instrument.params[parts[1]] = value;
      else
        copy.effects.find((e) => e.id === parts[1])!.params[parts[2]] = value;
    }
    return copy;
  }
  private sample(voice: Voice, track: Track, absolute: number): number[] {
    const ins = track.instrument,
      p = ins.params,
      age = voice.age / this.sampleRate,
      held = (voice.end - voice.frame) / this.sampleRate;
    const env = voice.sampleId
      ? Math.min(
          1,
          age / 0.005,
          Math.max(0, (voice.end - absolute) / this.sampleRate / 0.005),
        )
      : envelope(age, held, p);
    const frequency = Math.min(
      this.sampleRate * 0.4,
      440 *
        Math.pow(
          2,
          (voice.pitch -
            69 +
            valueOf(p, "pitchBend") +
            valueOf(p, "pitchFall") * Math.exp(-age * 30)) /
            12,
        ),
    );
    const increment = frequency / this.sampleRate;
    voice.phase = (voice.phase + increment) % 1;
    voice.phase2 =
      (voice.phase2 + increment * Math.pow(2, valueOf(p, "detune") / 1200)) % 1;
    voice.modPhase = (voice.modPhase + increment * (ins.type === 'resonator' ? 2.71 : valueOf(p, 'fmRatio'))) % 1;
    let x = 0,
      right: number | undefined;
    const pad = ins.pads.find((x) => x.pitch === voice.pitch),
      sampleId = voice.sampleId ?? pad?.sampleId ?? ins.sampleId;
    if (voice.sampleId || ins.type === "sampler" || ins.type === "granular") {
      const source = sampleId ? this.samples[sampleId] : undefined;
      if (!source)
        throw new Error(`Sample is unavailable: ${sampleId ?? track.id}`);
      const start =
          (voice.offset ?? valueOf(p, "sampleStart")) * source.sampleRate,
        end =
          valueOf(p, "sampleEnd") > 0 && !voice.sampleId
            ? Math.min(
                source.channels[0].length,
                valueOf(p, "sampleEnd") * source.sampleRate,
              )
            : source.channels[0].length;
      const length = Math.max(1, end - start),
        ratio = Math.pow(
          2,
          (voice.pitch -
            (voice.sampleId
              ? 60
              : (pad?.rootPitch ?? valueOf(p, "rootPitch")))) /
            12,
        ),
        reverse = voice.reverse ?? valueOf(p, "reverse") >= 0.5;
      const read = (position: number, ch: number) => {
        if (valueOf(p, "loop") >= 0.5 && !voice.sampleId)
          position = ((position % length) + length) % length;
        if (position < 0 || position >= length) return 0;
        const at = clamp(
            reverse ? end - 1 - position : start + position,
            0,
            source.channels[0].length - 1,
          ),
          floor = Math.floor(at),
          channel = source.channels[ch] ?? source.channels[0];
        return (
          channel[floor] * (1 - (at - floor)) +
          channel[Math.min(channel.length - 1, floor + 1)] * (at - floor)
        );
      };
      if (ins.type === "granular" && !voice.sampleId) {
        if (voice.age >= voice.nextGrain) {
          const grainLength = Math.round(
            valueOf(p, "grainSize") * this.sampleRate,
          );
          voice.grains.push({
            age: 0,
            start: random(voice) * length * valueOf(p, "grainSpread"),
            length: grainLength,
          });
          voice.nextGrain =
            voice.age + this.sampleRate / valueOf(p, "grainDensity");
        }
        right = 0;
        for (const grain of voice.grains) {
          const window =
              0.5 - 0.5 * Math.cos((2 * Math.PI * grain.age) / grain.length),
            pos =
              grain.start +
              ((grain.age * source.sampleRate) / this.sampleRate) * ratio;
          x += read(pos, 0) * window;
          right += read(pos, 1) * window;
          grain.age++;
        }
        voice.grains = voice.grains.filter((g) => g.age < g.length);
        const normal = Math.sqrt(
          Math.max(1, valueOf(p, "grainSize") * valueOf(p, "grainDensity")),
        );
        x /= normal;
        right /= normal;
      } else {
        x = read(age * source.sampleRate * ratio, 0);
        right = read(age * source.sampleRate * ratio, 1);
      }
    } else if (ins.type === "fm")
      x = Math.sin(
        2 * Math.PI * voice.phase +
          valueOf(p, "fmIndex") *
            Math.exp(-age * 2) *
            Math.sin(2 * Math.PI * voice.modPhase),
      );
    else if (ins.type === "noise") x = random(voice) * 2 - 1;
    else if (ins.type === "resonator")
      x =
        (random(voice) * 2 - 1) * valueOf(p, "noise") +
        (Math.sin(voice.phase * Math.PI * 2) +
          Math.sin(voice.modPhase * Math.PI * 2) * 0.35) *
          Math.exp(-age * (1 + valueOf(p, "brightness") * 10));
    else
      x =
        (oscillator(voice.phase, increment, ins.waveform) +
          oscillator(
            voice.phase2,
            increment * Math.pow(2, valueOf(p, "detune") / 1200),
            ins.waveform,
          )) *
          0.5 +
        (random(voice) * 2 - 1) * valueOf(p, "noise");
    if (right === undefined) {
      const cutoff =
        valueOf(p, "cutoff") *
        (1 -
          valueOf(p, "lfoDepth") *
            (0.5 + 0.5 * Math.sin(2 * Math.PI * age * valueOf(p, "lfoRate"))));
      voice.filter +=
        (x - voice.filter) *
        (1 -
          Math.exp(
            (-2 * Math.PI * Math.min(cutoff, this.sampleRate * 0.45)) /
              this.sampleRate,
          ));
      x = voice.filter;
      right = x;
    }
    voice.age++;
    const gain =
      env * voice.velocity * (voice.sampleId ? 1 : valueOf(p, "gain"));
    return [x * gain, right * gain];
  }
  process(
    frames: number,
    options: { stem?: string; master?: boolean } = {},
  ): Float32Array[] {
    const result = [new Float32Array(frames), new Float32Array(frames)],
      buffers = new Map<string, Float32Array[]>();
    const buses = new Map(
      this.document.buses.map((b) => [
        b.id,
        [new Float32Array(frames), new Float32Array(frames)],
      ]),
    );
    const anySolo = this.document.tracks.some((t) => t.solo);
    for (const id of this.trackOrder) {
      const track = this.effective(
          this.document.tracks.find((t) => t.id === id)!,
        ),
        buffer = [new Float32Array(frames), new Float32Array(frames)];
      const events = this.events.get(id)!,
        voices = this.voices.get(id)!,
        font = this.fonts[id];
      let cursor = this.cursors.get(id)!;
      if (font) {
        const p = track.instrument.params;
        font.synth.midiProgramSelect(
          0,
          font.font,
          Math.round(valueOf(p, "bank")),
          Math.round(valueOf(p, "program")),
        );
        font.synth.midiControl(0, 11, Math.round(valueOf(p, "expression")));
        font.synth.midiControl(0, 64, Math.round(valueOf(p, "pedal")));
        font.synth.midiPitchBend(
          0,
          clamp(Math.round(8192 + valueOf(p, "pitchBend") * 4096), 0, 16383),
        );
      }
      for (let i = 0; i < frames; ) {
        const absolute = this.frame + i;
        while (cursor < events.length && events[cursor].frame <= absolute) {
          const event = events[cursor++];
          if (font && !event.sampleId) {
            font.synth.midiNoteOn(
              0,
              event.pitch,
              Math.round(clamp(event.velocity, 0, 1) * 126 + 1),
            );
            this.fontNotes.get(id)!.push(event);
          } else {
            if (voices.length >= 64) voices.shift();
            voices.push({
              ...event,
              phase: 0,
              phase2: 0,
              modPhase: 0,
              filter: 0,
              age: 0,
              rng: hash(`${this.document.seed}:${id}:${cursor}`) || 1,
              grains: [],
              nextGrain: 0,
            });
          }
        }
        if (font) {
          const held = this.fontNotes.get(id)!;
          for (const event of held)
            if (event.end <= absolute) font.synth.midiNoteOff(0, event.pitch);
          this.fontNotes.set(
            id,
            held.filter((e) => e.end > absolute),
          );
          const next = Math.min(
            this.frame + frames,
            events[cursor]?.frame ?? Infinity,
            ...this.fontNotes.get(id)!.map((e) => e.end),
          );
          const count = Math.max(1, next - absolute);
          font.synth.render([
            buffer[0].subarray(i, i + count),
            buffer[1].subarray(i, i + count),
          ]);
          const gain = valueOf(track.instrument.params, "gain");
          for (let n = i; n < i + count; n++) {
            buffer[0][n] *= gain;
            buffer[1][n] *= gain;
            for (const voice of voices) {
              const [l, r] = this.sample(voice, track, this.frame + n);
              buffer[0][n] += l;
              buffer[1][n] += r;
            }
          }
          i += count;
        } else {
          for (const voice of voices) {
            const [l, r] = this.sample(voice, track, absolute);
            buffer[0][i] += l;
            buffer[1][i] += r;
          }
          i++;
        }
      }
      this.cursors.set(id, cursor);
      this.voices.set(
        id,
        voices.filter(
          (v) =>
            this.frame + frames <
            v.end +
              (v.sampleId
                ? 0
                : valueOf(track.instrument.params, "release") *
                  this.sampleRate),
        ),
      );
      for (const fx of track.effects)
        this.effect(
          `${id}:${fx.id}`,
          buffer,
          fx,
          fx.sidechain ? buffers.get(fx.sidechain) : undefined,
        );
      const left = Math.cos(((track.pan + 1) * Math.PI) / 4) * track.gain,
        right = Math.sin(((track.pan + 1) * Math.PI) / 4) * track.gain;
      const audible = !track.mute && (!anySolo || track.solo);
      for (let i = 0; i < frames; i++) {
        buffer[0][i] *= audible ? left : 0;
        buffer[1][i] *= audible ? right : 0;
      }
      buffers.set(id, buffer);
      if (!options.stem || options.stem === id)
        for (let i = 0; i < frames; i++) {
          result[0][i] += buffer[0][i];
          result[1][i] += buffer[1][i];
        }
      for (const send of track.sends) {
        const bus = buses.get(send.busId)!;
        for (let i = 0; i < frames; i++) {
          bus[0][i] += buffer[0][i] * send.gain;
          bus[1][i] += buffer[1][i] * send.gain;
        }
      }
    }
    for (const bus of this.document.buses) {
      const buffer = buses.get(bus.id)!;
      for (const fx of bus.effects)
        this.effect(
          `bus:${bus.id}:${fx.id}`,
          buffer,
          fx,
          fx.sidechain ? buffers.get(fx.sidechain) : undefined,
        );
      if (!options.stem || options.stem === bus.id)
        for (let i = 0; i < frames; i++) {
          result[0][i] += buffer[0][i] * bus.gain;
          result[1][i] += buffer[1][i] * bus.gain;
        }
    }
    if (options.master !== false && !options.stem)
      for (const fx of this.document.master)
        this.effect(
          `master:${fx.id}`,
          result,
          fx,
          fx.sidechain ? buffers.get(fx.sidechain) : undefined,
        );
    this.frame += frames;
    return result;
  }
  private effect(
    id: string,
    buffer: Float32Array[],
    effect: Effect,
    sidechain?: Float32Array[],
  ) {
    let processor = this.processors.get(id);
    if (!processor) {
      processor = new Processor(this.sampleRate);
      this.processors.set(id, processor);
    }
    processor.process(buffer, effect, sidechain);
  }
}
