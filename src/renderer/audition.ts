import type { PlaybackState } from '../shared/workbench';

export interface AuditionRequest { sessionId: string; reviewId: string; assetId: string; gainDb: number; loop: boolean }

/** One exclusive WebAudio owner; preview gain never alters originals. */
export class AuditionPlayer {
  constructor(private onState: (state: PlaybackState) => void) {}
  private context: AudioContext | null = null;
  private sources = new Map<AudioBufferSourceNode, GainNode>();
  private epoch = 0;
  private sessionId: string | null = null;
  private report(state: Omit<PlaybackState, 'updatedAt'>) { const next = { ...state, updatedAt: new Date().toISOString() }; this.onState(next); if (this.sessionId) void window.sfx.playbackReport(this.sessionId, next).catch(() => {}); }
  stop() {
    this.epoch++;
    for (const [source, gain] of this.sources) { source.onended = null; try { source.stop(); } catch { /* already ended */ } source.disconnect(); gain.disconnect(); }
    this.sources.clear(); this.report({ status: 'stopped' });
  }
  async play(command: AuditionRequest) {
    this.stop(); this.sessionId = command.sessionId;
    const epoch = this.epoch;
    document.querySelectorAll('audio').forEach(audio => audio.pause());
    try {
      this.context ??= new AudioContext(); const context = this.context;
      await context.resume();
      if (context.state !== 'running') throw new Error('Audio output is blocked. Click a playback control in SfxChat first.');
      const response = await fetch(window.sfx.mediaUrl(`asset/${command.assetId}`));
      if (!response.ok) throw new Error('The selected audio is unavailable.');
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (this.epoch !== epoch) throw new Error('Playback was cancelled before decoding completed.');
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer; source.loop = command.loop;
      gain.gain.value = Math.pow(10, command.gainDb / 20);
      source.connect(gain).connect(context.destination); this.sources.set(source, gain);
      source.onended = () => { source.disconnect(); gain.disconnect(); this.sources.delete(source); if (this.epoch === epoch) this.report({ status: 'stopped' }); };
      source.start();
      this.report({ status: 'playing', assetId: command.assetId, reviewId: command.reviewId });
    } catch (e) {
      if (this.epoch === epoch) { this.stop(); this.report({ status: 'error', error: e instanceof Error ? e.message : 'Playback failed.' }); }
      throw e;
    }
  }
  dispose() { this.stop(); void this.context?.close(); this.context = null; }
}
