declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;
class ArrangementOutput extends AudioWorkletProcessor {
  private input?: MessagePort;
  private queue: { left: Float32Array; right: Float32Array; start: number }[] =
    [];
  private offset = 0;
  private ended = false;
  private consumed = 0;
  private waiting = false;
  private peak = 0;
  constructor() {
    super();
    this.port.onmessage = (event) => {
      this.input = event.data;
      this.input!.onmessage = (e) => {
        this.waiting = false;
        if (e.data.end) this.ended = true;
        else this.queue.push(e.data);
      };
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const output = outputs[0];
    if (!output?.[0]) return true;
    for (let i = 0; i < output[0].length; i++) {
      const block = this.queue[0];
      if (!block) break;
      output[0][i] = block.left[this.offset];
      this.peak = Math.max(this.peak, Math.abs(block.left[this.offset]), Math.abs(block.right[this.offset]));
      if (output[1]) output[1][i] = block.right[this.offset];
      this.consumed = block.start + this.offset;
      this.offset++;
      if (this.offset >= block.left.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    if (this.queue.length < 2 && !this.waiting && !this.ended && this.input) {
      this.waiting = true;
      this.input.postMessage("more");
    }
    if (this.consumed % 2048 < 128 || (this.ended && !this.queue.length)) {
      this.port.postMessage({
        frame: this.consumed,
        peak: this.peak,
        ended: this.ended && !this.queue.length,
      });
      this.peak = 0;
    }
    return !(this.ended && !this.queue.length);
  }
}
registerProcessor("sfx-arrangement", ArrangementOutput);
