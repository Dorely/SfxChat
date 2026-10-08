import type { PlaybackState } from '../shared/workbench';

export interface AuditionRequest { sessionId: string; reviewId: string; assetId: string; gainDb: number; loop: boolean }
export interface AuditionState extends PlaybackState { position?: number; duration?: number }

/** One exclusive WebAudio owner; preview gain never alters originals. */
export class AuditionPlayer {
  constructor(private onState: (state: AuditionState) => void) {}
  private context: AudioContext | null = null;
  private sources = new Map<AudioBufferSourceNode, GainNode>();
  private epoch = 0;
  private sessionId: string | null = null;
  private active: { command: AuditionRequest; buffer: AudioBuffer; startedAt: number; offset: number } | null = null;
  private frame: number | null = null;
  private report(state: Omit<AuditionState, 'updatedAt'>) {
    const next = { ...state, updatedAt: new Date().toISOString() };
    this.onState(next);
    const { position: _position, duration: _duration, ...status } = next;
    if (this.sessionId) void window.sfx.playbackReport(this.sessionId, status).catch(() => {});
  }
  private clearSource() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const [source, gain] of this.sources) { source.onended = null; try { source.stop(); } catch { /* already ended */ } source.disconnect(); gain.disconnect(); }
    this.sources.clear();
  }
  stop() {
    this.epoch++;
    this.clearSource(); this.active = null; this.report({ status: 'stopped' });
  }
  private start(command: AuditionRequest, buffer: AudioBuffer, offset: number) {
    const context = this.context!, epoch = this.epoch;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.loop = command.loop;
    gain.gain.value = Math.pow(10, command.gainDb / 20);
    source.connect(gain).connect(context.destination); this.sources.set(source, gain);
    const startedAt = context.currentTime;
    source.onended = () => { if (this.epoch === epoch) this.stop(); };
    source.start(startedAt, offset);
    this.active = { command, buffer, startedAt, offset };
    this.report({ status: 'playing', assetId: command.assetId, reviewId: command.reviewId, position: offset, duration: buffer.duration });
    let lastUpdate = 0;
    const tick = (now: number) => {
      if (!this.active || this.epoch !== epoch) return;
      if (now - lastUpdate >= 33) {
        const elapsed = offset + Math.max(0, context.currentTime - startedAt);
        this.onState({ status: 'playing', assetId: command.assetId, reviewId: command.reviewId, position: command.loop ? elapsed % buffer.duration : Math.min(elapsed, buffer.duration), duration: buffer.duration, updatedAt: new Date().toISOString() });
        lastUpdate = now;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  seek(position: number) {
    if (!this.active || !Number.isFinite(position)) return;
    const { command, buffer } = this.active;
    const offset = Math.max(0, Math.min(position, buffer.duration));
    if (offset === buffer.duration && !command.loop) { this.stop(); return; }
    this.epoch++; this.clearSource();
    this.start(command, buffer, offset % buffer.duration);
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
      this.start(command, buffer, 0);
    } catch (e) {
      if (this.epoch === epoch) { this.stop(); this.report({ status: 'error', error: e instanceof Error ? e.message : 'Playback failed.' }); }
      throw e;
    }
  }
  dispose() { this.stop(); void this.context?.close(); this.context = null; }
}
