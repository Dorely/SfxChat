import { access, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { isAbsolute, join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Asset } from '../shared/types';
import { WorkbenchError, type ReviewBoard } from '../shared/workbench';
import { loopRegion, type MediaLibrary } from './media';
import type { Store } from './store';

type Format = 'original' | 'wav' | 'ogg';

/**
 * Where an exported loop render repeats, and how a game engine picks that up. The
 * loop always ends at the file end; any intro before it plays once.
 */
function loopRecord(asset: Asset, embedded: boolean) {
  const region = loopRegion(asset);
  if (!region) return {};
  const startSeconds = region.startFrame / region.sampleRate;
  return { loop: {
    startFrame: region.startFrame, endFrame: region.endFrame, sampleRate: region.sampleRate, startSeconds, introSeconds: startSeconds,
    embedded: embedded ? 'smpl chunk: one forward loop, dwEnd exclusive (the first frame after the loop)' : null,
    godot: embedded
      ? 'Import with Loop Mode "Detect From WAV" (the default) to loop these exact frames.'
      : `Godot reads no loop metadata from this file: in the Import dock, enable Loop and set Loop Offset to ${startSeconds.toFixed(6)} s (the loop runs to the file end).`
  } };
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export class Exporter {
  constructor(private media: MediaLibrary, private store: Store, private encoder: string) {}
  private async render(asset: Asset, format: Format) {
    if (format === 'original') {
      const bytes = await readFile(this.media.path(asset));
      if (hash(bytes) !== asset.hash) throw new WorkbenchError('INTEGRITY_ERROR', 'Original file integrity check failed.');
      // Version 2 loop renders carry their smpl chunk; version 1 renders predate it.
      return { bytes, format: asset.format, conversion: null, smpl: asset.edit?.version === 2 && asset.format === 'wav' };
    }
    const wav = await this.media.pcmWav(asset);
    const bytes = format === 'wav' ? wav : await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(this.encoder, ['encode'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks: Buffer[] = []; let length = 0; let error = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Audio encoding timed out.')); }, 120000);
      child.stdout.on('data', (chunk: Buffer) => { length += chunk.length; if (length > 64 * 1024 * 1024) { child.kill(); reject(new Error('Encoded audio exceeds 64 MiB.')); } else chunks.push(chunk); });
      child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(0, 2000); });
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(error || 'Vorbis encoding failed.')); });
      child.stdin.on('error', () => {}); child.stdin.end(wav);
    });
    return { bytes, format, smpl: format === 'wav', conversion: { encoding: format === 'wav' ? 'pcm-s16le' : 'vorbis', quality: format === 'ogg' ? 5 : null, encoder: format === 'ogg' ? 'libvorbis-1.3.7/libogg-1.3.6' : 'SfxChat wav16 v1', sampleRate: wav.readUInt32LE(24), channels: wav.readUInt16LE(22), previewGainApplied: false } };
  }
  private async absent(path: string) {
    if (!isAbsolute(path)) throw new WorkbenchError('INVALID_PATH', 'Export destination must be absolute.');
    try { await access(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    throw new WorkbenchError('DESTINATION_EXISTS', `Destination already exists: ${path}`);
  }
  private record(asset: Asset, path: string, rendered: Awaited<ReturnType<Exporter['render']>>) {
    const ancestors: Asset[] = []; let current = asset; const visited = new Set([asset.id]);
    while (current.parentId && !visited.has(current.parentId)) { current = this.store.asset(current.parentId, asset.projectId); visited.add(current.id); ancestors.push(current); }
    return { path, hash: hash(rendered.bytes), bytes: rendered.bytes.length, format: rendered.format, conversion: rendered.conversion, ...loopRecord(asset, rendered.smpl), source: asset, ancestors };
  }
  async asset(asset: Asset, destination: string, format: Format) {
    const manifestPath = destination + '.json'; await this.absent(destination); await this.absent(manifestPath);
    const rendered = await this.render(asset, format), record = this.record(asset, destination, rendered);
    // Exclusive creates handle races after preflight. Only remove files we created ourselves.
    await writeFile(destination, rendered.bytes, { flag: 'wx' });
    try { await writeFile(manifestPath, JSON.stringify({ version: 1, ...record }, null, 2) + '\n', { flag: 'wx' }); }
    catch (e) { await unlink(destination); throw e; }
    return { ...record, manifestPath };
  }
  async review(board: ReviewBoard, destination: string, format: Format) {
    await this.absent(destination);
    const selected = board.cues.filter(c => c.decision === 'selected').map(cue => ({ cue, asset: this.store.asset(cue.selectedAssetId!, board.projectId) }));
    // Verify all sources and names before creating the output directory; render serially to keep memory bounded.
    for (const { cue, asset } of selected) { if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(cue.key)) throw new WorkbenchError('INVALID_PATH', 'Cue key is a reserved Windows filename.'); const bytes = await readFile(this.media.path(asset)); if (hash(bytes) !== asset.hash) throw new WorkbenchError('INTEGRITY_ERROR', `Integrity check failed: ${asset.id}`); }
    await mkdir(destination);
    const files: unknown[] = [];
    try {
      for (const { cue, asset } of selected) {
        const filename = `${cue.key}.${format === 'original' ? asset.format : format}`;
        if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(filename)) throw new WorkbenchError('INVALID_PATH', 'Cue key is a reserved Windows filename.');
        const rendered = await this.render(asset, format);
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
