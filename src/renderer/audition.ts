import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Asset } from '../shared/types';
import type { PlaybackState } from '../shared/workbench';

/** The repeating part of a sound; an intro before startSeconds plays once. endSeconds defaults to the file end. */
export interface LoopRegion { startSeconds: number; endSeconds?: number }
export interface AuditionRequest {
  /** The card or preview that owns this playback; only one plays at a time. */
  key: string;
  /** An asset to fetch, or a ready URL (for example a rendered preview blob). */
  assetId?: string; url?: string;
  /** Set for review cards so the agent can read actual playback status. */
  sessionId?: string; reviewId?: string;
  gainDb: number; loop: boolean; region?: LoopRegion | null;
}
export interface AuditionState extends PlaybackState { key?: string; position?: number; duration?: number; loading?: boolean }

/** Where a sound repeats when looped: the asset's loop point, a loop render's recorded region, else the whole file. */
export function assetLoopRegion(asset: Asset): LoopRegion | null {
  if (asset.loopPoint) return { startSeconds: asset.loopPoint.startSeconds, ...(asset.loopPoint.endSeconds !== null ? { endSeconds: asset.loopPoint.endSeconds } : {}) };
  const loop = asset.edit?.loop;
  if (loop?.loopStartFrame === undefined || !asset.edit) return null;
  return { startSeconds: loop.loopStartFrame / asset.edit.sampleRate, ...(loop.loopEndFrame !== undefined ? { endSeconds: loop.loopEndFrame / asset.edit.sampleRate } : {}) };
}

interface Current { request: AuditionRequest; buffer: AudioBuffer | null; offset: number; startedAt: number | null }

/** One exclusive WebAudio owner for every card and preview; preview gain never alters originals. */
export class AuditionPlayer {
  private snapshot: AuditionState = { status: 'stopped', updatedAt: '' };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: AuditionState) {
    this.snapshot = state;
    for (const listener of this.listeners) listener();
  }
  private context: AudioContext | null = null;
  private source: { node: AudioBufferSourceNode; gain: GainNode } | null = null;
  private epoch = 0;
  private loading: AbortController | null = null;
  private sessionId: string | null = null;
  private current: Current | null = null;
  /** The last decoded file, so replaying or restarting the same sound skips the fetch. */
  private cache: { url: string; buffer: AudioBuffer } | null = null;
  private frame: number | null = null;
  private state(status: AuditionState['status'], extra: Partial<AuditionState> = {}): AuditionState {
    const current = this.current;
    return { status, ...(current ? { key: current.request.key, assetId: current.request.assetId, reviewId: current.request.reviewId, position: this.position(), duration: current.buffer?.duration ?? 0 } : {}), ...extra, updatedAt: new Date().toISOString() };
  }
  private report(state: AuditionState) {
    this.publish(state);
    const { position: _position, duration: _duration, loading: _loading, key: _key, ...status } = state;
    if (this.sessionId) void window.sfx.playbackReport(this.sessionId, status).catch(() => {});
  }
  private region(current: Current) {
    const duration = current.buffer?.duration ?? 0, region = current.request.region;
    const start = Math.max(0, Math.min(region?.startSeconds ?? 0, duration));
    const end = Math.max(start, Math.min(region?.endSeconds ?? duration, duration));
    return end - start > 0.001 ? { start, end } : { start: 0, end: duration };
  }
  /** The playhead: linear until the loop end, then wrapping within the loop region. */
  private position() {
    const current = this.current;
    if (!current?.buffer) return current?.offset ?? 0;
    const elapsed = current.startedAt === null || !this.context ? current.offset : current.offset + Math.max(0, this.context.currentTime - current.startedAt);
    if (!current.request.loop) return Math.min(elapsed, current.buffer.duration);
    const { start, end } = this.region(current);
    return elapsed < end ? elapsed : start + (elapsed - start) % (end - start);
  }
  private clearSource() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!this.source) return;
    const { node, gain } = this.source;
    node.onended = null; try { node.stop(); } catch { /* already ended */ }
    node.disconnect(); gain.disconnect(); this.source = null;
  }
  private applyLoop(node: AudioBufferSourceNode, current: Current) {
    const { start, end } = this.region(current);
    node.loop = current.request.loop; node.loopStart = start; node.loopEnd = end;
  }
  private start(offset: number) {
    const current = this.current!, buffer = current.buffer!, context = this.context!, epoch = this.epoch;
    this.clearSource();
    const node = context.createBufferSource(), gain = context.createGain();
    node.buffer = buffer; this.applyLoop(node, current);
    gain.gain.value = Math.pow(10, current.request.gainDb / 20);
    node.connect(gain).connect(context.destination); this.source = { node, gain };
    const position = Math.max(0, Math.min(offset, buffer.duration - 0.001));
    node.onended = () => { if (this.epoch === epoch) this.stop(); };
    current.startedAt = context.currentTime; current.offset = position;
    node.start(current.startedAt, position);
    this.report(this.state('playing'));
    let lastUpdate = 0;
    const tick = (now: number) => {
      if (this.epoch !== epoch || this.current?.startedAt === null) return;
      if (now - lastUpdate >= 33) { this.publish(this.state('playing')); lastUpdate = now; }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  isCurrent(key: string) { return this.current?.request.key === key; }
  /** Stop and forget the position; the next play starts from the beginning. */
  stop() {
    this.epoch++; this.loading?.abort(); this.loading = null;
    this.clearSource(); this.current = null; this.report({ status: 'stopped', updatedAt: new Date().toISOString() });
  }
  /** Pause, keeping the position for resume. */
  pause() {
    const current = this.current;
    if (!current) return;
    if (!current.buffer) { this.stop(); return; }
    if (current.startedAt === null) return;
    current.offset = this.position(); this.epoch++; this.clearSource(); current.startedAt = null;
    this.report(this.state('paused'));
  }
  resume() {
    const current = this.current;
    if (current?.buffer && current.startedAt === null) this.start(current.offset);
  }
  /** Play/pause for one control: pauses while playing, resumes while paused, otherwise plays from the start. */
  toggle(request: AuditionRequest) {
    const current = this.current;
    if (current?.request.key === request.key) {
      if (!current.buffer) { this.stop(); return Promise.resolve(); }
      if (current.startedAt === null) { this.resume(); return Promise.resolve(); }
      this.pause(); return Promise.resolve();
    }
    return this.play(request);
  }
  /** Move the playhead; while paused it stays paused at the new position. */
  seek(key: string, position: number) {
    const current = this.current;
    if (!current || current.request.key !== key || !Number.isFinite(position)) return;
    if (!current.buffer) { current.offset = Math.max(0, position); return; }
    const offset = Math.max(0, Math.min(position, current.buffer.duration - 0.001));
    if (current.startedAt === null) { current.offset = offset; this.publish(this.state('paused')); return; }
    this.epoch++; this.start(offset);
  }
  /** Change looping live, without restarting the sound. */
  setLoop(key: string, loop: boolean, region?: LoopRegion | null) {
    const current = this.current;
    if (!current || current.request.key !== key) return;
    const position = this.position();
    current.request = { ...current.request, loop, ...(region !== undefined ? { region } : {}) };
    current.offset = position;
    if (current.startedAt !== null && this.source && this.context) { current.startedAt = this.context.currentTime; this.applyLoop(this.source.node, current); }
    this.publish(this.state(current.startedAt === null ? 'paused' : 'playing'));
  }
  setGain(key: string, gainDb: number) {
    const current = this.current;
    if (!current || current.request.key !== key || !Number.isFinite(gainDb)) return;
    current.request = { ...current.request, gainDb };
    if (this.source) this.source.gain.gain.value = Math.pow(10, gainDb / 20);
  }
  /** Start from offset (or resume when this key is already paused at the same request). */
  async play(request: AuditionRequest, offset = 0) {
    this.stop(); this.sessionId = request.sessionId ?? null;
    const url = request.url ?? (request.assetId ? window.sfx.mediaUrl(`asset/${request.assetId}`) : '');
    const epoch = this.epoch, loading = new AbortController(); this.loading = loading;
    this.current = { request, buffer: null, offset, startedAt: null };
    this.report(this.state('stopped', { loading: true }));
    document.querySelectorAll('audio').forEach(audio => audio.pause());
    try {
      this.context ??= new AudioContext(); const context = this.context;
      await context.resume();
      if (this.epoch !== epoch) return;
      if (context.state !== 'running') throw new Error('Audio output is blocked. Click a playback control in SfxChat first.');
      if (!url) throw new Error('The selected audio is unavailable.');
      let buffer = this.cache?.url === url ? this.cache.buffer : null;
      if (!buffer) {
        const response = await fetch(url, { signal: loading.signal });
        if (!response.ok) throw new Error('The selected audio is unavailable.');
        const bytes = await response.arrayBuffer();
        if (this.epoch !== epoch) return;
        buffer = await context.decodeAudioData(bytes);
        if (this.epoch !== epoch) return;
        this.cache = { url, buffer };
      }
      this.current.buffer = buffer;
      this.start(this.current.offset);
    } catch (e) {
      if (this.epoch !== epoch) return;
      this.stop(); this.report({ status: 'error', error: e instanceof Error ? e.message : 'Playback failed.', updatedAt: new Date().toISOString() });
      throw e;
    } finally { if (this.loading === loading) this.loading = null; }
  }
  /** Drop a cached decode, for example when a preview blob URL is revoked. */
  forget(url: string) { if (this.cache?.url === url) this.cache = null; }
  dispose() { this.stop(); this.cache = null; void this.context?.close(); this.context = null; }
}

export const PlayerContext = createContext<AuditionPlayer | null>(null);
export function usePlayer() {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('PlayerContext is missing.');
  return player;
}
/** Subscribe to the shared clock only for the control that owns key; other cards stay still. */
export function usePlayback(player: AuditionPlayer, key: string) {
  return useSyncExternalStore(player.subscribe, () => {
    const current = player.getSnapshot();
    return current.key === key ? current : null;
  });
}
