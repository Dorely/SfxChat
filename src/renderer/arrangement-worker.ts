import { Synthesizer } from "js-synthesizer";
import { SoundEngine } from "../shared/sound-engine";
import { createFonts } from "../shared/soundfont-engine";
import {
  beatSeconds,
  validateArrangement,
  type SampleMap,
} from "../shared/arrangement";

declare const self: {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  importScripts(url: string): void;
  close(): void;
};
let engine: SoundEngine | undefined,
  port: MessagePort | undefined,
  endFrame = 0,
  endBeat: number | undefined,
  stopped = false;
function playbackDocument(raw: unknown) {
  const doc = validateArrangement(raw);
  const end = Math.min(endBeat ?? doc.length, doc.length);
  for (const track of doc.tracks) track.clips = track.clips.filter(c => c.start < end).map(c => ({ ...c, length: Math.min(c.length, end - c.start) }));
  return doc;
}
const fail = (error: unknown) => {
  stopped = true;
  self.postMessage({
    error: error instanceof Error ? error.message : String(error),
  });
};
self.onmessage = (event) => {
  void (async () => {
    const message = event.data;
    if (message.action === "start") {
      endBeat = message.endBeat;
      const document = playbackDocument(message.document),
        rate: number = message.sampleRate;
      if (message.bank) {
        self.importScripts(message.libraryUrl);
        Synthesizer.initializeWithFluidSynthModule(
          (self as unknown as { Module: unknown }).Module,
        );
      }
      engine = new SoundEngine(
        document,
        rate,
        message.samples as SampleMap,
        await createFonts(document, rate, message.bank),
      );
      const startFrame = Math.round(
        beatSeconds(document, message.startBeat ?? 0) * rate,
      );
      while (engine.frame < startFrame) {
        engine.process(Math.min(128, startFrame - engine.frame));
        if (engine.frame % 32768 === 0)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
      endFrame = Math.round(
        (beatSeconds(document, message.endBeat ?? document.length) + 3) * rate,
      );
      port = message.port;
      port!.onmessage = () => fill();
      self.postMessage({ ready: true, frame: engine.frame });
      fill();
    } else if (message.action === "update") {
      const next = playbackDocument(message.document);
      engine?.update(next);
      if (engine) endFrame = Math.round((beatSeconds(next, Math.min(endBeat ?? next.length, next.length)) + 3) * engine.sampleRate);
    } else if (message.action === "stop") {
      stopped = true;
      engine?.close();
      port?.close();
      self.close();
    }
  })().catch(fail);
};
function fill() {
  if (!engine || !port || stopped) return;
  try {
    const size = Math.min(2048, endFrame - engine.frame);
    if (size <= 0) {
      port.postMessage({ end: true });
      return;
    }
    const left = new Float32Array(size),
      right = new Float32Array(size),
      start = engine.frame;
    for (let i = 0; i < size; i += 128) {
      const block = engine.process(Math.min(128, size - i));
      left.set(block[0], i);
      right.set(block[1], i);
    }
    port.postMessage({ left, right, start }, [left.buffer, right.buffer]);
  } catch (error) {
    fail(error);
  }
}
