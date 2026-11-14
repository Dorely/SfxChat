import { access, mkdir, readFile, rename, stat, writeFile, unlink } from 'node:fs/promises';
import { isAbsolute, join, basename, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Asset } from '../shared/types';
import { WorkbenchError, type ReviewBoard } from '../shared/workbench';
import { loopRegion, type MediaLibrary } from './media';
import type { Store } from './store';

type Format = 'original' | 'wav' | 'ogg';

/**
 * Where an exported loop repeats, and how a game engine picks that up: a loop render's
 * region, or the asset's loop point. Any intro before the start plays once. Frames are
 * known for loop renders and conversions; an original's loop point is in seconds.
 */
function loopRecord(asset: Asset, embedded: boolean, decoded?: { sampleRate: number; frames: number }) {
  const region = loopRegion(asset, decoded), point = asset.loopPoint;
  if (!region && !point) return {};
  const startSeconds = region ? region.startFrame / region.sampleRate : point!.startSeconds;
  const endSeconds = region ? (decoded && region.endFrame >= decoded.frames ? null : region.endFrame / region.sampleRate) : point!.endSeconds;
  return { loop: {
    ...(region ? { startFrame: region.startFrame, endFrame: region.endFrame, sampleRate: region.sampleRate } : {}), startSeconds, endSeconds, introSeconds: startSeconds,
    source: point ? `asset loop point (${point.source === 'file' ? 'read from the imported file' : 'set by the user'})` : 'loop render',
    embedded: embedded ? 'smpl chunk: one forward loop, dwEnd exclusive (the first frame after the loop)' : null,
    godot: embedded
      ? 'Import with Loop Mode "Detect From WAV" (the default) to loop these exact frames.'
      : `Godot reads no loop metadata from this file: in the Import dock, enable Loop and set Loop Offset to ${startSeconds.toFixed(6)} s${endSeconds === null ? ' (the loop runs to the file end)' : `; the loop should end at ${endSeconds.toFixed(6)} s, but Godot Ogg/MP3 streams loop to the file end, so export WAV (which embeds it) or trim the tail`}.`
  } };
}
/** Frames in the data chunk of a PCM16 WAV. */
function pcmFrames(wav: Buffer) {
  for (let at = 12; at + 8 <= wav.length; at += 8 + wav.readUInt32LE(at + 4)) if (wav.toString('ascii', at, at + 4) === 'data') return wav.readUInt32LE(at + 4) / (wav.readUInt16LE(22) * 2);
  return 0;
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export class Exporter {
  constructor(private media: MediaLibrary, private store: Store, private encoder: string) {}
  private async render(asset: Asset, format: Format, oggQuality = 5) {
    if (format === 'original') {
      const bytes = await readFile(this.media.path(asset));
      if (hash(bytes) !== asset.hash) throw new WorkbenchError('INTEGRITY_ERROR', 'Original file integrity check failed.');
      // Version 2 loop renders carry their smpl chunk; version 1 renders predate it. An imported
      // file's own loop is embedded until the user moves the loop point.
      const smpl = asset.format === 'wav' && (asset.loopPoint ? asset.loopPoint.source === 'file' : asset.edit?.version === 2);
      return { bytes, format: asset.format, conversion: null, smpl, decoded: undefined };
    }
    const wav = await this.media.pcmWav(asset, format === 'wav');
    const bytes = format === 'wav' ? wav : await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(this.encoder, ['encode', String(oggQuality)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks: Buffer[] = []; let length = 0; let error = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Audio encoding timed out.')); }, 120000);
      child.stdout.on('data', (chunk: Buffer) => { length += chunk.length; if (length > 64 * 1024 * 1024) { child.kill(); reject(new Error('Encoded audio exceeds 64 MiB.')); } else chunks.push(chunk); });
      child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(0, 2000); });
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(error || 'Vorbis encoding failed.')); });
      child.stdin.on('error', () => {}); child.stdin.end(wav);
    });
    return { bytes, format, smpl: format === 'wav', conversion: { encoding: format === 'wav' ? 'pcm-s16le' : 'vorbis', quality: format === 'ogg' ? oggQuality : null, encoder: format === 'ogg' ? 'libvorbis-1.3.7/libogg-1.3.6' : 'SfxChat wav16 v1', sampleRate: wav.readUInt32LE(24), channels: wav.readUInt16LE(22), previewGainApplied: false }, decoded: { sampleRate: wav.readUInt32LE(24), frames: pcmFrames(wav) } };
  }
  private async absent(path: string, remedy: string) {
    if (!isAbsolute(path)) throw new WorkbenchError('INVALID_PATH', 'Export destination must be absolute.');
    try { await access(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    throw new WorkbenchError('DESTINATION_EXISTS', `Destination already exists: ${path}. ${remedy}`);
  }
  /** An overwrite may replace an existing file, never a directory. */
  private async replaceable(path: string) {
    if (!isAbsolute(path)) throw new WorkbenchError('INVALID_PATH', 'Export destination must be absolute.');
    try { if ((await stat(path)).isDirectory()) throw new WorkbenchError('DESTINATION_EXISTS', `Destination is a directory: ${path}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  private record(asset: Asset, path: string, rendered: Awaited<ReturnType<Exporter['render']>>) {
    const ancestors: Asset[] = []; let current = asset; const visited = new Set([asset.id]);
    while (current.parentId && !visited.has(current.parentId)) { current = this.store.asset(current.parentId, asset.projectId); visited.add(current.id); ancestors.push(current); }
    return { path, hash: hash(rendered.bytes), bytes: rendered.bytes.length, format: rendered.format, conversion: rendered.conversion, ...loopRecord(asset, rendered.smpl, rendered.decoded), source: asset, ancestors };
  }
  async asset(asset: Asset, destination: string, format: Format, overwrite = false, oggQuality = 5) {
    const manifestPath = destination + '.json', check = (path: string) => overwrite ? this.replaceable(path) : this.absent(path, 'Pass overwrite:true to replace it and its .json manifest, or choose another path.');
    await check(destination); await check(manifestPath);
    const rendered = await this.render(asset, format, oggQuality), record = this.record(asset, destination, rendered);
    const manifest = JSON.stringify({ version: 1, ...record }, null, 2) + '\n';
    await mkdir(dirname(destination), { recursive: true });
    if (overwrite) {
      // Complete both temporary files first, then rename each over its target.
      const suffix = `.sfxchat-${randomBytes(4).toString('hex')}.tmp`, temps = [destination + suffix, manifestPath + suffix];
      try { await writeFile(temps[0], rendered.bytes, { flag: 'wx' }); await writeFile(temps[1], manifest, { flag: 'wx' }); await rename(temps[0], destination); await rename(temps[1], manifestPath); }
      catch (e) { await Promise.all(temps.map(path => unlink(path).catch(() => {}))); throw e; }
      return { ...record, manifestPath };
    }
    // Exclusive creates handle races after preflight. Only remove files we created ourselves.
    await writeFile(destination, rendered.bytes, { flag: 'wx' });
    try { await writeFile(manifestPath, manifest, { flag: 'wx' }); }
    catch (e) { await unlink(destination); throw e; }
    return { ...record, manifestPath };
  }
  async review(board: ReviewBoard, destination: string, format: Format, oggQuality = 5) {
    await this.absent(destination, 'A cue pack needs a new directory; choose another path.');
    const selected = board.cues.filter(c => c.decision === 'selected').map(cue => ({ cue, asset: this.store.asset(cue.selectedAssetId!, board.projectId) }));
    // Verify all sources and names before creating the output directory; render serially to keep memory bounded.
    for (const { cue, asset } of selected) { if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(cue.key)) throw new WorkbenchError('INVALID_PATH', 'Cue key is a reserved Windows filename.'); const bytes = await readFile(this.media.path(asset)); if (hash(bytes) !== asset.hash) throw new WorkbenchError('INTEGRITY_ERROR', `Integrity check failed: ${asset.id}`); }
    await mkdir(dirname(destination), { recursive: true });
    await mkdir(destination);
    const files: unknown[] = [];
    try {
      for (const { cue, asset } of selected) {
        const filename = `${cue.key}.${format === 'original' ? asset.format : format}`;
        if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(filename)) throw new WorkbenchError('INVALID_PATH', 'Cue key is a reserved Windows filename.');
        const rendered = await this.render(asset, format, oggQuality);
        await writeFile(join(destination, filename), rendered.bytes, { flag: 'wx' });
        files.push({ cueKey: cue.key, ...this.record(asset, basename(filename), rendered) });
      }
      const manifestPath = join(destination, 'manifest.json');
      await writeFile(manifestPath, JSON.stringify({ version: 1, complete: true, review: board, files }, null, 2) + '\n', { flag: 'wx' });
      return { destination, manifestPath, files };
    } catch (e) {
      await writeFile(join(destination, 'incomplete.json'), JSON.stringify({ version: 1, complete: false, review: board, files }, null, 2) + '\n', { flag: 'wx' }).catch(() => {});
      throw new WorkbenchError('EXPORT_INCOMPLETE', `Export incomplete: ${e instanceof Error ? e.message : 'failed'}`, { destination, files });
    }
  }
}
