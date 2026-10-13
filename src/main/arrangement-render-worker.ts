import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { open, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { analyzeWav } from './wav-reader';
import { Synthesizer } from "js-synthesizer";
import { createFonts } from "../shared/soundfont-engine";
import { SoundEngine } from "../shared/sound-engine";
import {
  beatSeconds,
  validateArrangement,
  ENGINE_VERSION,
  type SampleMap,
} from "../shared/arrangement";
import type { RenderInput } from "../shared/arrangement-operations";

const input = workerData as {
  document: unknown;
  input: RenderInput;
  samples: SampleMap;
  bank?: Uint8Array;
  outputs: { path: string; stem?: string; seed: number; name: string }[];
};
let cancelled = false;
parentPort!.on("message", (message) => {
  if (message === "cancel") cancelled = true;
});
const yieldWork = () => new Promise<void>((resolve) => setImmediate(resolve));
function header(frames: number, float: boolean): Buffer {
  const bytes = float ? 4 : 3,
    h = Buffer.alloc(56);
  h.write("RIFF");
  h.writeUInt32LE(48 + frames * 2 * bytes, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(float ? 3 : 1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(48000, 24);
  h.writeUInt32LE(48000 * 2 * bytes, 28);
  h.writeUInt16LE(2 * bytes, 32);
  h.writeUInt16LE(bytes * 8, 34);
  h.write("fact", 36);
  h.writeUInt32LE(4, 40);
  h.writeUInt32LE(frames, 44);
  h.write("data", 48);
  h.writeUInt32LE(frames * 2 * bytes, 52);
  return h;
}
function encode(channels: Float32Array[], float: boolean): Buffer {
  const b = Buffer.alloc(channels[0].length * 2 * (float ? 4 : 3));
  for (let i = 0; i < channels[0].length; i++)
    for (let ch = 0; ch < 2; ch++) {
      const value = channels[ch][i],
        at = (i * 2 + ch) * (float ? 4 : 3);
      if (float) b.writeFloatLE(value, at);
      else
        b.writeIntLE(
          Math.round(Math.max(-1, Math.min(1, value)) * 8388607),
          at,
          3,
        );
    }
  return b;
}
async function run() {
  const document = validateArrangement(input.document),
    options = input.input,
    rate = 48000;
  const section = options.sectionId
    ? document.sections.find((s) => s.id === options.sectionId)
    : undefined;
  if (options.sectionId && !section) throw new Error("Section not found.");
  const start = options.startBeat ?? section?.start ?? 0,
    end =
      options.endBeat ??
      (section ? section.start + section.length : document.length);
  if (end <= start || end > document.length)
    throw new Error("Invalid render interval.");
  const startFrame = Math.round(beatSeconds(document, start) * rate),
    endFrame = Math.round(beatSeconds(document, end) * rate),
    frames =
      endFrame -
      startFrame +
      (options.loop ? 0 : Math.round(options.tailSeconds * rate));
  let fontBytes: ArrayBuffer | undefined;
  if (input.bank) {
    const require = createRequire(__filename);
    Synthesizer.initializeWithFluidSynthModule(
      require("js-synthesizer/externals/libfluidsynth-2.4.6.js"),
    );
    fontBytes = input.bank.buffer.slice(
      input.bank.byteOffset,
      input.bank.byteOffset + input.bank.byteLength,
    ) as ArrayBuffer;
  }
  const results = [];
  for (let outputIndex = 0; outputIndex < input.outputs.length; outputIndex++) {
    const output = input.outputs[outputIndex],
      doc = structuredClone(document);
    doc.seed = output.seed;
    // Stop note scheduling at the requested endpoint, but process release/effect tails.
    for (const track of doc.tracks)
      track.clips = track.clips
        .filter((c) => c.start < end)
        .map((c) => ({ ...c, length: Math.min(c.length, end - c.start) }));
    const engine = new SoundEngine(
      doc,
      rate,
      input.samples,
      await createFonts(doc, rate, fontBytes),
    );
    const file = await open(output.path, "wx"),
      float = options.encoding === "float32";
    let peak = 0,
      sum = 0,
      clipped = 0,
      silent = 0,
      count = 0;
    try {
      await file.write(header(frames, float));
      const head: number[][] = [[], []],
        tail: number[][] = [[], []],
        cross = options.loop
          ? Math.min(
              Math.floor(frames / 2),
              Math.round((options.crossfadeMs * rate) / 1000),
            )
          : 0;
      while (engine.frame < startFrame + frames) {
        if (cancelled) throw new Error("Render cancelled.");
        const size = Math.min(
          128,
          startFrame + frames - engine.frame,
          engine.frame < startFrame ? startFrame - engine.frame : 128,
        );
        const before = engine.frame,
          block = engine.process(size, { stem: output.stem });
        if (before >= startFrame) {
          const offset = before - startFrame;
          if (cross)
            for (let i = 0; i < size; i++)
              for (let ch = 0; ch < 2; ch++) {
                if (offset + i < cross) head[ch].push(block[ch][i]);
                if (offset + i >= frames - cross) tail[ch].push(block[ch][i]);
              }
          for (let i = 0; i < size; i++)
            for (let ch = 0; ch < 2; ch++) {
              const sample = block[ch][i];
              if (!Number.isFinite(sample))
                throw new Error("Non-finite audio output.");
              peak = Math.max(peak, Math.abs(sample));
              sum += sample * sample;
              if (Math.abs(sample) >= 1) clipped++;
              if (Math.abs(sample) < 1e-6) silent++;
              count++;
            }
          await file.write(encode(block, float));
        }
        if (engine.frame % (128 * 256) === 0) {
          parentPort!.postMessage({
            progress:
              (outputIndex + engine.frame / (startFrame + frames)) /
              input.outputs.length,
          });
          await yieldWork();
        }
      }
      // Preserve exact musical length; taper both sides of the wrap to their shared midpoint.
      if (cross) {
        const beginning = [new Float32Array(cross), new Float32Array(cross)],
          ending = [new Float32Array(cross), new Float32Array(cross)];
        for (let ch = 0; ch < 2; ch++) {
          const seam = (head[ch][0] + tail[ch][cross - 1]) * 0.5;
          for (let i = 0; i < cross; i++) {
            const x = cross > 1 ? i / (cross - 1) : 0;
            beginning[ch][i] = seam * (1 - x) + head[ch][i] * x;
            ending[ch][i] = tail[ch][i] * (1 - x) + seam * x;
          }
        }
        await file.write(
          encode(beginning, float),
          0,
          cross * 2 * (float ? 4 : 3),
          56,
        );
        await file.write(
          encode(ending, float),
          0,
          cross * 2 * (float ? 4 : 3),
          56 + (frames - cross) * 2 * (float ? 4 : 3),
        );
      }
      results.push({
        ...output,
        duration: frames / rate,
        diagnostics: {
          peak,
          rms: Math.sqrt(sum / Math.max(1, count)),
          clippedSamples: clipped,
          nearSilentFraction: silent / Math.max(1, count),
          frames,
          sampleRate: rate,
          measurementStage: "before loop seam taper",
          loop: options.loop,
          crossfadeFrames: cross,
          engine: ENGINE_VERSION,
        },
      });
    } finally {
      await file.close();
      engine.close();
    }
  }
  for (const result of results) {
    const file = await open(result.path, "r"),
      hash = createHash("sha256");
    try {
      for await (const chunk of file.createReadStream()) hash.update(chunk);
    } finally {
      await file.close();
    }
    const digest = hash.digest('hex');
    Object.assign(result, { hash: digest });
    const analysis = await analyzeWav(result.path, { id: 'pending-render', hash: digest }, { bins: 1, ...(options.loop ? { seamProbe: {} } : {}) });
    Object.assign(result.diagnostics, { preEncodingPeak: result.diagnostics.peak, preEncodingClippedSamples: result.diagnostics.clippedSamples, ...analysis.summary, seam: analysis.seam, measurementStage: 'exported WAV after encoding and seam processing' });
  }
  parentPort!.postMessage({ done: results });
}
run()
  .catch(async (error) => {
    for (const output of input.outputs)
      await unlink(output.path).catch(() => {});
    parentPort!.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  })
  .finally(() => parentPort!.close());
