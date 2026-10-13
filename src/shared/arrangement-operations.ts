import { z } from "zod";
import {
  arrangementSchema,
  trackSchema,
  patternSchema,
  sectionSchema,
  busSchema,
  tempoSchema,
  effectSchema,
  parameterRanges,
  instrumentParams,
  effectParams,
  starterPatches,
  arrangementLimits,
  validateArrangement,
  type Arrangement,
} from "./arrangement";

const project = { projectId: z.string().uuid() },
  target = { ...project, arrangementId: z.string().uuid() },
  revision = { ...target, expectedRevision: z.number().int().positive() };
const mutation = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("settings"),
      values: arrangementSchema
        .pick({
          name: true,
          intent: true,
          kind: true,
          seed: true,
          length: true,
          tempos: true,
          master: true,
        })
        .partial(),
    })
    .strict(),
  z.object({ type: z.literal("track"), value: trackSchema }).strict(),
  z.object({ type: z.literal("pattern"), value: patternSchema }).strict(),
  z.object({ type: z.literal("section"), value: sectionSchema }).strict(),
  z.object({ type: z.literal("bus"), value: busSchema }).strict(),
  z
    .object({
      type: z.literal("remove"),
      collection: z.enum(["tracks", "patterns", "sections", "buses"]),
      id: z.string(),
    })
    .strict(),
]);
export const transformSchema = z
  .object({
    patternId: z.string(),
    mode: z.enum([
      "transpose",
      "repeat",
      "sequence",
      "rhythm",
      "quantize",
      "swing",
      "humanize",
    ]),
    amount: z.number().min(-96).max(96).default(0),
    grid: z.number().min(0.015625).max(4).default(0.25),
    repeats: z.number().int().min(1).max(32).default(2),
    seed: z.number().int().min(1).max(2147483647).default(1),
  })
  .strict();
export const renderSchema = z
  .object({
    startBeat: z.number().min(0).optional(),
    endBeat: z.number().positive().optional(),
    sectionId: z.string().optional(),
    stems: z.boolean().default(false),
    loop: z.boolean().default(false),
    crossfadeMs: z.number().min(0).max(100).default(5),
    tailSeconds: z.number().min(0).max(20).default(3),
    encoding: z.enum(["float32", "pcm24"]).default("float32"),
    variations: z.number().int().min(1).max(16).default(1),
    seed: z.number().int().positive().max(2147483647).optional(),
  })
  .strict();
export type RenderInput = z.infer<typeof renderSchema>;
export const arrangementOperationDefinitions = {
  local_catalog: {
    schema: z.object({}).strict(),
    description:
      "Discover local instruments, effects, editable starter patches, parameter bounds and arrangement limits. No provider is used.",
  },
  arrangement_create: {
    schema: z.object({ ...project, document: arrangementSchema }).strict(),
    description:
      "Create a project-owned local arrangement. Start with structure, then add patterns and tracks incrementally.",
  },
  arrangement_list: {
    schema: z.object(project).strict(),
    description:
      "List arrangements in an explicit project, without note payloads.",
  },
  arrangement_get: {
    schema: z
      .object({
        ...target,
        revision: z.number().int().positive().optional(),
        trackId: z.string().optional(),
        sectionId: z.string().optional(),
        summary: z.boolean().default(false),
      })
      .strict(),
    description:
      "Read the current or historical arrangement, optionally one track or section. Summary omits note data.",
  },
  arrangement_edit: {
    schema: z
      .object({ ...revision, edits: z.array(mutation).min(1).max(128) })
      .strict(),
    description:
      "Atomically apply targeted edits at the expected revision. Track/pattern/section/bus edits upsert complete named elements, preserving unrelated elements. Read and reconcile conflicts.",
  },
  arrangement_restore: {
    schema: z
      .object({ ...revision, sourceRevision: z.number().int().positive() })
      .strict(),
    description:
      "Restore a historical document as a new revision. History remains intact.",
  },
  arrangement_history: {
    schema: z.object(target).strict(),
    description:
      "Read arrangement revision metadata for comparison, undo and redo.",
  },
  arrangement_transform: {
    schema: z.object({ ...revision, input: transformSchema }).strict(),
    description:
      "Apply a bounded, reproducible note transformation to one pattern; other patterns remain unchanged.",
  },
  arrangement_from_midi: {
    schema: z.object({ ...project, assetId: z.string().uuid() }).strict(),
    description:
      "Create an editable arrangement from an existing MIDI asset, preserving the original.",
  },
  arrangement_render: {
    schema: z
      .object({
        ...revision,
        sessionId: z.string().uuid(),
        requestId: z.string().uuid(),
        input: renderSchema.default(renderSchema.parse({})),
      })
      .strict(),
    description:
      "Queue local mix, section, loop, stem or seeded-variation rendering from an exact revision. Returns a durable render job. Poll arrangement_job; retry identical requestId only for recovery.",
  },
  arrangement_job: {
    schema: z.object({ ...project, jobId: z.string().uuid() }).strict(),
    description:
      "Read local render progress, diagnostics, outputs and immutable recipe. Does not play audio.",
  },
  arrangement_jobs: {
    schema: z.object(project).strict(),
    description: "List local arrangement render jobs in this project.",
  },
  arrangement_cancel: {
    schema: z.object({ ...project, jobId: z.string().uuid() }).strict(),
    description: "Cancel a local render without changing source arrangements.",
  },
  arrangement_export: {
    schema: z
      .object({
        ...target,
        revision: z.number().int().positive(),
        destination: z.string().min(1),
        format: z.enum(["package", "midi"]).default("package"),
      })
      .strict(),
    description:
      "Export a portable arrangement folder with sources/provenance, or representable note tracks as MIDI files and a limitations manifest. Refuses existing destinations.",
  },
  arrangement_import: {
    schema: z.object({ ...project, source: z.string().min(1) }).strict(),
    description:
      "Verify and reopen an exported local arrangement package into this project.",
  },
};
export const localCatalog = {
  version: 1,
  instruments: [
    "subtractive",
    "fm",
    "sampler",
    "granular",
    "noise",
    "resonator",
    "soundfont",
  ],
  effects: effectSchema.shape.type.options,
  parameters: parameterRanges,
  instrumentParameters: instrumentParams,
  effectParameters: effectParams,
  patches: starterPatches,
  limits: arrangementLimits,
  automation:
    "gain, pan, instrument.PARAMETER, effect.EFFECT_ID.PARAMETER; ordered beat/value points, step or linear",
  units:
    "Notes/clips/sections use quarter-note beats; sample regions/offsets and effect time use seconds; velocities 0..1; pitch is MIDI 0..127.",
  schemas: {
    track: z.toJSONSchema(trackSchema),
    pattern: z.toJSONSchema(patternSchema),
    section: z.toJSONSchema(sectionSchema),
    bus: z.toJSONSchema(busSchema),
    tempo: z.toJSONSchema(tempoSchema),
  },
};
export function applyEdits(
  doc: Arrangement,
  edits: z.infer<typeof mutation>[],
): Arrangement {
  const next = structuredClone(doc);
  for (const edit of edits) {
    if (edit.type === "settings") Object.assign(next, edit.values);
    else if (edit.type === "remove")
      (next[edit.collection] as { id: string }[]) = next[
        edit.collection
      ].filter((x) => x.id !== edit.id);
    else {
      const collection = (
        {
          track: "tracks",
          pattern: "patterns",
          section: "sections",
          bus: "buses",
        } as const
      )[edit.type];
      const entries = next[collection] as { id: string }[];
      const index = entries.findIndex((x) => x.id === edit.value.id);
      if (index < 0) entries.push(edit.value);
      else entries[index] = edit.value;
    }
  }
  return validateArrangement(next);
}
export function transformPattern(
  doc: Arrangement,
  input: z.infer<typeof transformSchema>,
): Arrangement {
  const next = structuredClone(doc),
    pattern = next.patterns.find((p) => p.id === input.patternId);
  if (!pattern) throw new Error("Pattern not found.");
  let seed = input.seed;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  if (input.mode === "rhythm")
    pattern.length *= Math.max(0.125, Math.min(8, input.amount));
  if (input.mode === "repeat" || input.mode === "sequence") {
    const notes = [...pattern.notes],
      length = pattern.length;
    const used = new Set(notes.map(n => n.id)); let serial = 0;
    const nextId = () => { let id: string; do { id = `variation-${serial++}`; } while (used.has(id)); used.add(id); return id; };
    for (let i = 1; i < input.repeats; i++)
      for (const n of notes)
        pattern.notes.push({
          ...n,
          id: nextId(),
          start: n.start + length * i,
          pitch: Math.round(
            n.pitch + (input.mode === "sequence" ? input.amount * i : 0),
          ),
        });
    pattern.length *= input.repeats;
  } else
    for (const n of pattern.notes) {
      if (input.mode === "transpose") n.pitch += Math.round(input.amount);
      if (input.mode === "rhythm") {
        const scale = Math.max(0.125, Math.min(8, input.amount));
        n.start *= scale;
        n.duration *= scale;
      }
      if (input.mode === "quantize")
        n.start = Math.round(n.start / input.grid) * input.grid;
      if (input.mode === "swing" && Math.round(n.start / input.grid) % 2 === 1)
        n.start += input.grid * Math.max(-0.9, Math.min(0.9, input.amount));
      if (input.mode === "humanize") {
        n.start = Math.max(
          0,
          n.start + (random() - 0.5) * Math.min(0.25, Math.abs(input.amount)),
        );
        n.velocity = Math.max(
          0.001,
          Math.min(1, n.velocity + (random() - 0.5) * 0.12),
        );
      }
      n.start = Math.max(0, Math.min(pattern.length - 0.001, n.start));
      n.duration = Math.max(
        0.001,
        Math.min(n.duration, pattern.length - n.start),
      );
    }
  return validateArrangement(next);
}
