import { mkdir, readFile, writeFile, rename, copyFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import type { Asset, AssetKind, AudioAnalysisInput, GenerationInput, MusicGenerationInput, TrimInput } from '../shared/types';
import { analyzeAudio, decodeAudio, renderTrim, MAX_AUDIO_BYTES, type DecodedAudio } from './audio';

export class MediaLibrary {
  private audioQueue: Promise<unknown> = Promise.resolve();
  private decoded: { hash: string; audio: DecodedAudio } | null = null;
  constructor(readonly root: string) {}
  private withAudio<T>(asset: Asset, operation: (audio: DecodedAudio) => Promise<T>): Promise<T> {
    const pending = this.audioQueue.then(async () => {
      if ((await stat(this.path(asset))).size > MAX_AUDIO_BYTES) throw new Error('Editing supports source files up to 64 MiB.');
      const bytes = await readFile(this.path(asset));
      if (createHash('sha256').update(bytes).digest('hex') !== asset.hash) throw new Error('Original file integrity check failed.');
      if (this.decoded?.hash !== asset.hash) {
        this.decoded = null;
        this.decoded = { hash: asset.hash, audio: await decodeAudio(bytes, asset.format) };
      }
      return operation(this.decoded.audio);
    });
    this.audioQueue = pending.catch(() => undefined);
    return pending;
  }
  analyze(asset: Asset, input: AudioAnalysisInput) { return this.withAudio(asset, audio => analyzeAudio(audio, asset, input)); }
  renderTrim(asset: Asset, input: TrimInput) { return this.withAudio(asset, audio => renderTrim(audio, asset, input)); }
  async idle() { await this.audioQueue; }
  path(asset: Pick<Asset, 'id' | 'format'>) { return join(this.root, `${asset.id}.${asset.format}`); }
  async save(bytes: Buffer, format: 'mp3' | 'wav', fields: Partial<Asset> & { projectId: string }): Promise<Asset> {
    await mkdir(this.root, { recursive: true });
    const id = randomUUID();
    // Preserve bytes even if probing fails. Such output remains inspectable but the
    // generation is marked failed by the caller rather than presenting invalid audio.
    const path = this.path({ id, format });
    const temp = path + '.partial';
    await writeFile(temp, bytes, { flag: 'wx' });
    await rename(temp, path);
    let duration: number | null = null;
    try { const metadata = await parseBuffer(bytes, format === 'mp3' ? 'audio/mpeg' : 'audio/wav', { duration: true }); duration = metadata.format.duration ?? null; } catch { /* originals still preserved */ }
    return { id, name: 'Untitled sound', description: '', tags: [], collections: [], review: 'unreviewed', feedback: '', source: 'imported', kind: 'effect', format, hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, duration, prompt: '', provider: null, model: null, requestId: null, request: null, usage: null, parentId: null, createdAt: new Date().toISOString(), ...fields };
  }
  async import(path: string, projectId: string, kind: AssetKind = 'effect'): Promise<Asset> {
    const extension = extname(path).toLowerCase();
    if (extension !== '.mp3' && extension !== '.wav') throw new Error('Import a WAV or MP3 file.');
    const bytes = await readFile(path);
    const metadata = await parseBuffer(bytes, extension === '.mp3' ? 'audio/mpeg' : 'audio/wav', { duration: true });
    if (!metadata.format.codec || !metadata.format.duration) throw new Error('The file does not contain playable audio.');
    return this.save(bytes, extension.slice(1) as 'mp3' | 'wav', { projectId, name: basename(path, extension), source: 'imported', kind });
  }
  async export(asset: Asset, destination: string) {
    const original = await readFile(this.path(asset));
    if (createHash('sha256').update(original).digest('hex') !== asset.hash) throw new Error('Original file integrity check failed.');
    await copyFile(this.path(asset), destination, constants.COPYFILE_EXCL);
  }
}

export function generatedFields(input: GenerationInput | MusicGenerationInput, kind: AssetKind, projectId: string): Partial<Asset> & { projectId: string } {
  return { projectId, source: 'generated', kind, prompt: input.prompt, request: input, parentId: input.parentId ?? null, name: input.name ?? input.prompt.slice(0, 64), description: input.prompt };
}
