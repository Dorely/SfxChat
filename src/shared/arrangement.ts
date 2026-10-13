import { z } from "zod";

export const ENGINE_VERSION =
  "sfx-local-1/js-synthesizer-1.13.0/fluidsynth-2.4.6";
export const arrangementLimits = {
  tracks: 64,
  patterns: 1024,
  notes: 100000,
  seconds: 600,
  sampleBytes: 256 * 1024 * 1024,
  voicesPerTrack: 64,
};
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const beat = z.number().min(0).max(32000);
const name = z.string().min(1).max(200);
export const parameterRanges = {
  gain: [0, 2, 0.3],
  pan: [-1, 1, 0],
  attack: [0.001, 10, 0.01],
  decay: [0.001, 10, 0.2],
  sustain: [0, 1, 0.65],
  release: [0.005, 20, 0.3],
  cutoff: [20, 20000, 6000],
  resonance: [0.1, 12, 0.7],
  detune: [0, 50, 8],
  noise: [0, 1, 0],
  lfoRate: [0, 20, 0],
  lfoDepth: [0, 1, 0],
  fmRatio: [0.1, 16, 2],
  fmIndex: [0, 20, 2],
  rootPitch: [0, 127, 60],
  sampleStart: [0, 600, 0],
  sampleEnd: [0, 600, 0],
  loop: [0, 1, 0],
  reverse: [0, 1, 0],
  grainSize: [0.01, 0.5, 0.08],
  grainDensity: [1, 100, 20],
  grainSpread: [0, 1, 0.4],
  brightness: [0, 1, 0.5],
  pitchFall: [-96, 96, 0],
  program: [0, 127, 48],
  bank: [0, 128, 0],
  expression: [0, 127, 100],
  pedal: [0, 127, 0],
  pitchBend: [-2, 2, 0],
  drive: [0, 20, 1],
  threshold: [-60, 0, -18],
  ratio: [1, 20, 4],
  time: [0.005, 2, 0.25],
  feedback: [0, 0.95, 0.3],
  mix: [0, 1, 0.25],
  size: [0.1, 1, 0.6],
  eqDb: [-24, 24, 0],
} as const;
export type Parameter = keyof typeof parameterRanges;
export const instrumentParams: Record<string, Parameter[]> = {
  subtractive: [
    "gain",
    "attack",
    "decay",
    "sustain",
    "release",
    "cutoff",
    "detune",
    "noise",
    "lfoRate",
    "lfoDepth",
    "pitchFall",
    "pitchBend",
  ],
  fm: [
    "gain",
    "attack",
    "decay",
    "sustain",
    "release",
    "cutoff",
    "fmRatio",
    "fmIndex",
    "pitchBend",
  ],
  noise: [
    "gain",
    "attack",
    "decay",
    "sustain",
    "release",
    "cutoff",
    "lfoRate",
    "lfoDepth",
  ],
  resonator: [
    "gain",
    "attack",
    "decay",
    "sustain",
    "release",
    "cutoff",
    "noise",
    "brightness",
    "pitchFall",
    "pitchBend",
  ],
  sampler: [
    "gain",
    "attack",
    "decay",
    "sustain",
    "release",
    "rootPitch",
    "sampleStart",
    "sampleEnd",
    "loop",
    "reverse",
  ],
  granular: [
    "gain",
    "attack",
    "decay",
    "sustain",
    "release",
    "rootPitch",
    "sampleStart",
    "sampleEnd",
    "loop",
    "reverse",
    "grainSize",
    "grainDensity",
    "grainSpread",
  ],
  soundfont: ["gain", "program", "bank", "expression", "pedal", "pitchBend"],
};
export const effectParams: Record<string, Parameter[]> = {
  filter: ["cutoff", "resonance"],
  eq: ["cutoff", "resonance", "eqDb"],
  saturation: ["drive"],
  compressor: ["threshold", "ratio", "attack", "release"],
  delay: ["time", "feedback", "mix"],
  reverb: ["size", "mix"],
  gain: ["gain"],
  limiter: ["threshold"],
};
export const paramsSchema = z
  .record(z.string(), z.number())
  .default({})
  .superRefine((params, ctx) => {
    for (const [key, value] of Object.entries(params)) {
      const range = parameterRanges[key as Parameter];
      if (!range || value < range[0] || value > range[1])
        ctx.addIssue({
          code: "custom",
          message: `Invalid parameter ${key}: ${range ? `${range[0]}..${range[1]}` : "unknown"}`,
        });
    }
  });
export const instrumentSchema = z
  .object({
    type: z.enum([
      "subtractive",
      "fm",
      "sampler",
      "granular",
      "noise",
      "resonator",
      "soundfont",
    ]),
    waveform: z.enum(["sine", "triangle", "saw", "square"]).default("saw"),
    params: paramsSchema,
    sampleId: z.string().uuid().optional(),
    pads: z
      .array(
        z
          .object({
            pitch: z.number().int().min(0).max(127),
            sampleId: z.string().uuid(),
            rootPitch: z.number().int().min(0).max(127).default(60),
          })
          .strict(),
      )
      .max(128)
      .default([]),
  })
  .strict();
export const effectSchema = z
  .object({
    id,
    type: z.enum([
      "filter",
      "eq",
      "saturation",
      "compressor",
      "delay",
      "reverb",
      "gain",
      "limiter",
    ]),
    params: paramsSchema,
    sidechain: id.optional(),
    bypass: z.boolean().default(false),
  })
  .strict();
export const noteSchema = z
  .object({
    id,
    pitch: z.number().int().min(0).max(127),
    start: beat,
    duration: z.number().positive().max(32000),
    velocity: z.number().min(0.001).max(1).default(0.75),
  })
  .strict();
export const patternSchema = z
  .object({
    id,
    name,
    length: z.number().positive().max(32000),
    notes: z.array(noteSchema).max(10000),
    intent: z.string().max(4000).default(""),
  })
  .strict();
export const clipSchema = z
  .object({
    id,
    name,
    start: beat,
    length: z.number().positive().max(32000),
    patternId: id.optional(),
    sampleId: z.string().uuid().optional(),
    offset: beat.default(0),
    transpose: z.number().int().min(-96).max(96).default(0),
    gain: z.number().min(0).max(2).default(1),
    repeat: z.boolean().default(false),
    reverse: z.boolean().default(false),
  })
  .strict()
  .refine(
    (c) => Number(Boolean(c.patternId)) + Number(Boolean(c.sampleId)) === 1,
    "A clip needs exactly one pattern or sample.",
  );
export const automationSchema = z
  .object({
    id,
    target: z.string().min(1).max(160),
    points: z
      .array(z.object({ beat, value: z.number() }).strict())
      .min(1)
      .max(10000),
    interpolation: z.enum(["linear", "step"]).default("linear"),
  })
  .strict();
export const trackSchema = z
  .object({
    id,
    name,
    role: z.string().max(200).default(""),
    instrument: instrumentSchema,
    clips: z.array(clipSchema).max(1024).default([]),
    effects: z.array(effectSchema).max(16).default([]),
    sends: z
      .array(z.object({ busId: id, gain: z.number().min(0).max(2) }).strict())
      .max(8)
      .default([]),
    automation: z.array(automationSchema).max(64).default([]),
    gain: z.number().min(0).max(2).default(0.7),
    pan: z.number().min(-1).max(1).default(0),
    mute: z.boolean().default(false),
    solo: z.boolean().default(false),
  })
  .strict();
export const sectionSchema = z
  .object({
    id,
    name,
    start: beat,
    length: z.number().positive().max(32000),
    intent: z.string().max(4000).default(""),
  })
  .strict();
export const tempoSchema = z
  .object({
    beat,
    bpm: z.number().min(20).max(300),
    numerator: z.number().int().min(1).max(16).default(4),
    denominator: z
      .union([
        z.literal(1),
        z.literal(2),
        z.literal(4),
        z.literal(8),
        z.literal(16),
      ])
      .default(4),
  })
  .strict();
export const busSchema = z
  .object({
    id,
    name,
    effects: z.array(effectSchema).max(16).default([]),
    gain: z.number().min(0).max(2).default(1),
  })
  .strict();
export const arrangementSchema = z
  .object({
    soundfontHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    name,
    intent: z.string().max(10000).default(""),
    kind: z.enum(["music", "effect"]).default("music"),
    seed: z.number().int().min(1).max(2147483647).default(1),
    length: z.number().positive().max(32000).default(32),
    tempos: z
      .array(tempoSchema)
      .min(1)
      .max(1024)
      .default([{ beat: 0, bpm: 120, numerator: 4, denominator: 4 }]),
    sections: z.array(sectionSchema).max(256).default([]),
    patterns: z.array(patternSchema).max(1024).default([]),
    tracks: z.array(trackSchema).max(64).default([]),
    buses: z.array(busSchema).max(8).default([]),
    master: z
      .array(effectSchema)
      .max(16)
      .default([
        {
          id: "master-limit",
          type: "limiter",
          params: { threshold: -1 },
          bypass: false,
        },
      ]),
  })
  .strict();
export type Arrangement = z.infer<typeof arrangementSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Instrument = z.infer<typeof instrumentSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type Note = z.infer<typeof noteSchema>;
export interface ArrangementRecord {
  id: string;
  projectId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  origin: "user" | "agent";
  document: Arrangement;
}
export interface SampleData {
  sampleRate: number;
  channels: Float32Array[];
}
export type SampleMap = Record<string, SampleData>;
export const valueOf = (params: Record<string, number>, key: Parameter) =>
  params[key] ?? parameterRanges[key][2];
export function beatSeconds(doc: Arrangement, at: number): number {
  let seconds = 0;
  for (let i = 0; i < doc.tempos.length; i++) {
    const t = doc.tempos[i];
    if (at <= t.beat) break;
    seconds +=
      ((Math.min(at, doc.tempos[i + 1]?.beat ?? at) - t.beat) * 60) / t.bpm;
  }
  return seconds;
}
export function secondsBeat(doc: Arrangement, seconds: number): number {
  let remaining = seconds;
  for (let i = 0; i < doc.tempos.length; i++) {
    const t = doc.tempos[i],
      duration =
        (((doc.tempos[i + 1]?.beat ?? Infinity) - t.beat) * 60) / t.bpm;
    if (remaining <= duration) return t.beat + (remaining * t.bpm) / 60;
    remaining -= duration;
  }
  return 0;
}
export function validateArrangement(raw: unknown): Arrangement {
  const doc = arrangementSchema.parse(raw);
  const unique = (items: { id: string }[], label: string) => {
    if (new Set(items.map((x) => x.id)).size !== items.length)
      throw new Error(`Duplicate ${label} IDs.`);
  };
  unique(doc.tracks, "track");
  unique(doc.patterns, "pattern");
  unique(doc.sections, "section");
  unique(doc.buses, "bus");
  if (
    doc.tempos[0].beat !== 0 ||
    doc.tempos.some((t, i) => i > 0 && t.beat <= doc.tempos[i - 1].beat)
  )
    throw new Error("Tempo map must start at zero and be strictly ordered.");
  if (beatSeconds(doc, doc.length) > arrangementLimits.seconds)
    throw new Error("Arrangement exceeds ten minutes.");
  if (
    doc.patterns.reduce((n, p) => n + p.notes.length, 0) >
    arrangementLimits.notes
  )
    throw new Error("Arrangement exceeds 100,000 stored notes.");
  for (const p of doc.patterns) {
    unique(p.notes, "note");
    if (p.notes.some((n) => n.start + n.duration > p.length + 1e-6))
      throw new Error(`Notes exceed pattern ${p.id}.`);
  }
  const tracks = new Set(doc.tracks.map((t) => t.id)),
    buses = new Set(doc.buses.map((b) => b.id));
  if (doc.buses.some(b => tracks.has(b.id))) throw new Error('Tracks and buses require distinct IDs.');
  const checkParams = (params: Record<string, number>, allowed: Parameter[]) => { for (const key of Object.keys(params)) if (!allowed.includes(key as Parameter)) throw new Error(`Parameter ${key} is not supported by this instrument/effect.`); };
  const checkEffects = (effects: Effect[]) => { for (const effect of effects) { checkParams(effect.params, effectParams[effect.type]); if (effect.sidechain && effect.type !== 'compressor') throw new Error('Only compressors accept sidechain input.'); } };
  const dependencies = new Map<string, string[]>();
  for (const t of doc.tracks) {
    checkParams(t.instrument.params, instrumentParams[t.instrument.type]);
    checkEffects(t.effects);
    if (new Set(t.instrument.pads.map(p => p.pitch)).size !== t.instrument.pads.length) throw new Error('Sampler pad pitches must be unique.');
    unique(t.clips, "clip");
    unique(t.effects, "effect");
    unique(t.automation, "automation");
    for (const c of t.clips) {
      if (c.patternId && !doc.patterns.some((p) => p.id === c.patternId))
        throw new Error(`Missing pattern ${c.patternId}.`);
      if (c.start + c.length > doc.length + 1e-6)
        throw new Error(`Clip ${c.id} exceeds arrangement length.`);
    }
    for (const s of t.sends)
      if (!buses.has(s.busId)) throw new Error(`Missing bus ${s.busId}.`);
    const deps = t.effects.flatMap((f) => (f.sidechain ? [f.sidechain] : []));
    if (deps.some((d) => !tracks.has(d)))
      throw new Error("Sidechain track not found.");
    dependencies.set(t.id, deps);
    for (const lane of t.automation) {
      const parts = lane.target.split("."),
        key = parts.at(-1) as Parameter;
      if (
        parts.length === 1
          ? !["gain", "pan"].includes(key)
          : parts[0] === "instrument"
            ? parts.length !== 2
            : parts[0] === "effect"
              ? parts.length !== 3 || !t.effects.some((e) => e.id === parts[1])
              : true
      )
        throw new Error(`Unsupported automation target ${lane.target}.`);
      const range = parameterRanges[key];
      if (parts[0] === 'instrument' && !instrumentParams[t.instrument.type].includes(key)) throw new Error('Unsupported instrument automation parameter.');
      if (parts[0] === 'effect' && !effectParams[t.effects.find(e => e.id === parts[1])!.type].includes(key)) throw new Error('Unsupported effect automation parameter.');
      if (
        !range ||
        lane.points.some(
          (p, i) =>
            p.value < range[0] ||
            p.value > range[1] ||
            p.beat > doc.length ||
            (i > 0 && p.beat <= lane.points[i - 1].beat),
        )
      )
        throw new Error(`Invalid automation points for ${lane.target}.`);
    }
  }
  const visit = (id: string, path: Set<string>) => {
    if (path.has(id)) throw new Error("Sidechain routing cycle.");
    for (const next of dependencies.get(id) ?? [])
      visit(next, new Set([...path, id]));
  };
  for (const t of doc.tracks) visit(t.id, new Set());
  for (const bus of doc.buses) {
    checkEffects(bus.effects);
    unique(bus.effects, "effect");
    if (bus.effects.some((f) => f.sidechain && !tracks.has(f.sidechain)))
      throw new Error("Bus sidechain track not found.");
  }
  unique(doc.master, "master effect");
  checkEffects(doc.master);
  if (doc.master.some((f) => f.sidechain && !tracks.has(f.sidechain)))
    throw new Error("Master sidechain track not found.");
  for (const s of doc.sections)
    if (s.start + s.length > doc.length)
      throw new Error("Section exceeds arrangement length.");
  return doc;
}
export function sourceIds(doc: Arrangement): string[] {
  return [
    ...new Set(
      doc.tracks
        .flatMap((t) => [
          t.instrument.sampleId,
          ...t.instrument.pads.map((p) => p.sampleId),
          ...t.clips.map((c) => c.sampleId),
        ])
        .filter((x): x is string => Boolean(x)),
    ),
  ];
}
export const starterPatches: { name: string; instrument: Instrument }[] = [
  {
    name: "Warm bass",
    instrument: instrumentSchema.parse({
      type: "subtractive",
      waveform: "saw",
      params: { cutoff: 650, sustain: 0.55, release: 0.12, gain: 0.3 },
    }),
  },
  {
    name: "Open sky lead",
    instrument: instrumentSchema.parse({
      type: "subtractive",
      params: {
        detune: 18,
        cutoff: 7500,
        attack: 0.02,
        release: 0.5,
        gain: 0.2,
      },
    }),
  },
  {
    name: "Soft pad",
    instrument: instrumentSchema.parse({
      type: "subtractive",
      params: {
        attack: 0.8,
        release: 2,
        cutoff: 1800,
        detune: 12,
        lfoRate: 0.2,
        lfoDepth: 0.3,
        gain: 0.15,
      },
    }),
  },
  {
    name: "Glass bell",
    instrument: instrumentSchema.parse({
      type: "fm",
      params: {
        fmRatio: 3.5,
        fmIndex: 4,
        decay: 0.5,
        sustain: 0,
        release: 0.8,
      },
    }),
  },
  {
    name: "Deep kick",
    instrument: instrumentSchema.parse({
      type: "subtractive",
      waveform: "sine",
      params: {
        pitchFall: 36,
        decay: 0.17,
        sustain: 0,
        release: 0.08,
        gain: 0.8,
      },
    }),
  },
  {
    name: "Tight snare",
    instrument: instrumentSchema.parse({
      type: "noise",
      params: {
        cutoff: 6500,
        decay: 0.13,
        sustain: 0,
        release: 0.05,
        gain: 0.35,
      },
    }),
  },
  {
    name: "Metal hat",
    instrument: instrumentSchema.parse({
      type: "fm",
      params: {
        fmRatio: 7.3,
        fmIndex: 12,
        decay: 0.035,
        sustain: 0,
        release: 0.03,
        gain: 0.12,
      },
    }),
  },
  {
    name: "Stone friction",
    instrument: instrumentSchema.parse({
      type: "resonator",
      params: {
        noise: 0.9,
        cutoff: 1800,
        attack: 0.04,
        release: 0.4,
        gain: 0.25,
      },
    }),
  },
  {
    name: "Orchestral strings",
    instrument: instrumentSchema.parse({
      type: "soundfont",
      params: { program: 48, gain: 0.5, expression: 100 },
    }),
  },
];
