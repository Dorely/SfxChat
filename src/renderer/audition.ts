import type { UiCommand, PlaybackState } from '../shared/workbench';

/** One exclusive WebAudio owner; preview gain never alters originals. */
export class AuditionPlayer {
  private context: AudioContext | null = null;
  private sources = new Map<AudioBufferSourceNode, GainNode>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private epoch = 0;
  private sessionId: string | null = null;
  private report(state: Omit<PlaybackState, 'updatedAt'>) { if (this.sessionId) void window.sfx.playbackReport(this.sessionId, { ...state, updatedAt: new Date().toISOString() }).catch(() => {}); }
  stop() {
    this.epoch++;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    for (const [source, gain] of this.sources) { source.onended = null; try { source.stop(); } catch { /* already ended */ } source.disconnect(); gain.disconnect(); }
    this.sources.clear(); this.report({ status: 'stopped' });
  }
  async play(command: UiCommand) {
    this.stop(); this.sessionId = command.sessionId;
    const epoch = this.epoch;
    document.querySelectorAll('audio').forEach(audio => audio.pause());
    try {
      this.context ??= new AudioContext(); const context = this.context;
      await context.resume();
      if (context.state !== 'running') throw new Error('Audio output is blocked. Click a playback control in SfxChat first.');
      const response = await fetch(`sfx-media://asset/${command.assetId}`);
      if (!response.ok) throw new Error('The selected audio is unavailable.');
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (this.epoch !== epoch) throw new Error('Playback was cancelled before decoding completed.');
      let next = context.currentTime + 0.02;
      const interval = (command.repeatIntervalMs ?? 0) / 1000;
      const schedule = () => {
        while (next < context.currentTime + 0.1 && this.sources.size < 32) {
          const source = context.createBufferSource(), gain = context.createGain(); source.buffer = buffer;
          gain.gain.value = Math.pow(10, (command.gainDb ?? 0) / 20); source.connect(gain).connect(context.destination);
          this.sources.set(source, gain);
          source.onended = () => { source.disconnect(); gain.disconnect(); this.sources.delete(source); if (!interval && this.epoch === epoch) this.report({ status: 'stopped' }); };
          source.start(next);
          if (interval && command.singleVoice) source.stop(next + interval);
          if (!interval) break;
          next += interval;
        }
        // Bound polyphony without accumulating late scheduled starts.
        if (next < context.currentTime) next = context.currentTime + interval;
      };
      schedule(); if (interval) this.timer = setInterval(schedule, 25);
      this.report({ status: 'playing', assetId: command.assetId, reviewId: command.reviewId });
    } catch (e) {
      if (this.epoch === epoch) { this.stop(); this.report({ status: 'error', error: e instanceof Error ? e.message : 'Playback failed.' }); }
      throw e;
    }
  }
  dispose() { this.stop(); void this.context?.close(); this.context = null; }
}
