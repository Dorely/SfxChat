/**
 * Renders MIDI clips to audio through the native helper and FluidSynth. Renders are serialized
 * and cached on disk, keyed by the clip bytes, the bank, and the render settings, because a clip
 * is immutable and the same bytes always render identically.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SoundfontInfo } from './soundfont';

const RENDER_TIMEOUT_MS = 120_000;
const CACHE_ENTRIES = 32;
const CACHE_BYTES = 512 * 1024 * 1024;
/** Decay tail the helper appends after the musical length, in seconds. */
export const MIDI_TAIL_SECONDS = 2;

export interface MidiRenderSettings { seconds: number; gain?: number }

export class MidiRenderer {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private helperPath: string, private cacheRoot: string) {}

  private key(midi: Buffer, soundfont: SoundfontInfo, settings: MidiRenderSettings) {
    return createHash('sha256').update(midi).update('\0').update(soundfont.hash).update(`\0${settings.seconds}\0${settings.gain ?? 0.5}`).digest('hex');
  }
  private cachePath(key: string) { return join(this.cacheRoot, `${key}.wav`); }

  /** Rendered WAV bytes for a clip, reused from the cache when the same clip was rendered before. */
  async renderClip(midi: Buffer, soundfont: SoundfontInfo, settings: MidiRenderSettings): Promise<Buffer> {
    const key = this.key(midi, soundfont, settings);
    const target = this.cachePath(key);
    try { if ((await stat(target)).size > 44) return await readFile(target); } catch { /* not cached */ }
    const midiPath = join(this.cacheRoot, `${key}.mid`);
    const temporary = `${target}.partial`;
    await mkdir(this.cacheRoot, { recursive: true });
    await writeFile(midiPath, midi);
    try {
      await this.serialize(() => this.spawnHelper(midiPath, soundfont.path, temporary, settings));
      await rename(temporary, target);
    } finally { await unlink(midiPath).catch(() => undefined); await unlink(temporary).catch(() => undefined); }
    await this.prune();
    return await readFile(target);
  }

  /** Renders straight to `destination` for exports, without touching the cache. */
  async renderClipToFile(midi: Buffer, soundfont: SoundfontInfo, settings: MidiRenderSettings, destination: string): Promise<void> {
    await mkdir(this.cacheRoot, { recursive: true });
    const midiPath = join(this.cacheRoot, `${createHash('sha256').update(midi).digest('hex')}.export.mid`);
    await writeFile(midiPath, midi);
    try { await this.serialize(() => this.spawnHelper(midiPath, soundfont.path, destination, settings)); }
    finally { await unlink(midiPath).catch(() => undefined); }
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(run);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  private spawnHelper(midiPath: string, soundfontPath: string, output: string, settings: MidiRenderSettings): Promise<void> {
    return new Promise((resolve, reject) => {
      const helper = spawn(this.helperPath, ['render-midi', midiPath, soundfontPath, output, String(settings.seconds), String(settings.gain ?? 0.5)], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let detail = '';
      const timer = setTimeout(() => { helper.kill(); reject(new Error('MIDI rendering timed out.')); }, RENDER_TIMEOUT_MS);
      helper.stderr?.on('data', chunk => { if (detail.length < 2000) detail += String(chunk); });
      helper.on('error', error => { clearTimeout(timer); reject(error); });
      helper.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(detail.trim() || `MIDI rendering failed (exit ${code}).`));
      });
    });
  }
  /** Keeps the render cache bounded by entry count and total size, oldest first. */
  private async prune() {
    const names = (await readdir(this.cacheRoot).catch(() => [] as string[])).filter(name => name.endsWith('.wav'));
    const entries: { path: string; size: number; at: number }[] = [];
    for (const name of names) {
      const path = join(this.cacheRoot, name);
      const info = await stat(path).catch(() => null);
      if (info) entries.push({ path, size: info.size, at: info.mtimeMs });
    }
    entries.sort((first, second) => second.at - first.at);
    let total = 0;
    for (const [index, entry] of entries.entries()) {
      total += entry.size;
      if (index < CACHE_ENTRIES && total <= CACHE_BYTES) continue;
      await unlink(entry.path).catch(() => undefined);
    }
  }
}
