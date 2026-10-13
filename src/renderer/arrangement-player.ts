import {
  sourceIds,
  type Arrangement,
  type SampleMap,
  secondsBeat,
  arrangementLimits,
} from "../shared/arrangement";

/** Transport state stays in the renderer; all composition/editing remains in shared operations. */
export class ArrangementPlayer {
  private worker?: Worker;
  private context?: AudioContext;
  private output?: AudioWorkletNode;
  private epoch = 0;
  constructor(
    private report: (state: {
      playing: boolean;
      beat?: number;
      error?: string;
    }) => void,
  ) {}
  stop() {
    this.epoch++;
    this.worker?.postMessage({ action: "stop" });
    this.worker?.terminate();
    this.worker = undefined;
    this.output?.disconnect();
    this.output = undefined;
    void this.context?.close();
    this.context = undefined;
    this.report({ playing: false });
  }
  update(document: Arrangement) {
    this.worker?.postMessage({ action: "update", document });
  }
  async play(document: Arrangement, startBeat: number, endBeat?: number) {
    this.stop();
    const epoch = this.epoch;
    const context = new AudioContext({ sampleRate: 48000 });
    this.context = context;
    await context.resume();
    const base = new URL("./", window.location.href);
    try {
      const samples: SampleMap = {};
      let sampleBytes = 0;
      for (const id of sourceIds(document)) {
        const response = await fetch(window.sfx.mediaUrl(`sample/${id}`));
        if (!response.ok) throw new Error("Source audio is unavailable.");
        const bytes = await response.arrayBuffer(), header = new DataView(bytes);
        sampleBytes += bytes.byteLength;
        if (sampleBytes > arrangementLimits.sampleBytes) throw new Error('Arrangement sample cache exceeds 256 MiB.');
        const rate = header.getUint32(0, true), channels = header.getUint32(4, true), frames = header.getUint32(8, true);
        if (!rate || channels < 1 || channels > 8 || bytes.byteLength !== 12 + channels * frames * 4) throw new Error('Invalid decoded sample.');
        samples[id] = {
          sampleRate: rate,
          channels: Array.from({ length: channels }, (_, i) => new Float32Array(bytes, 12 + i * frames * 4, frames)),
        };
      }
      let bank: ArrayBuffer | undefined;
      if (document.tracks.some((t) => t.instrument.type === "soundfont")) {
        if (!document.soundfontHash) throw new Error('Save the arrangement to pin its SoundFont before playback.');
        const response = await fetch(window.sfx.mediaUrl(`soundfont/${document.soundfontHash}`));
        if (!response.ok) throw new Error("SoundFont is unavailable.");
        bank = await response.arrayBuffer();
      }
      if (epoch !== this.epoch) return;
      await context.audioWorklet.addModule(
        new URL("arrangement-worklet.js", base).href,
      );
      if (epoch !== this.epoch) return;
      const node = new AudioWorkletNode(context, "sfx-arrangement", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.output = node;
      const worker = new Worker(new URL("arrangement-worker.js", base));
      this.worker = worker;
      const channel = new MessageChannel();
      node.port.postMessage(channel.port1, [channel.port1]);
      node.port.onmessage = (e) => {
        if (epoch !== this.epoch) return;
        if (e.data.ended) this.stop();
        else
          this.report({
            playing: true,
            beat: Math.min(endBeat ?? document.length, secondsBeat(document, e.data.frame / context.sampleRate)),
          });
      };
      worker.onerror = (e) => {
        this.stop();
        this.report({ playing: false, error: e.message });
      };
      worker.onmessage = (e) => {
        if (epoch !== this.epoch) return;
        if (e.data.error) {
          this.stop();
          this.report({ playing: false, error: e.data.error });
        } else if (e.data.ready) {
          node.connect(context.destination);
          this.report({ playing: true, beat: startBeat });
        }
      };
      worker.postMessage(
        {
          action: "start",
          document,
          sampleRate: context.sampleRate,
          startBeat,
          endBeat,
          samples,
          bank,
          libraryUrl: new URL("libfluidsynth-2.4.6.js", base).href,
          port: channel.port2,
        },
        [channel.port2],
      );
    } catch (error) {
      if (epoch === this.epoch) {
        this.stop();
        this.report({
          playing: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
