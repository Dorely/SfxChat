import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import type { Asset, GenerationInput } from '../shared/types';

export class MediaLibrary {
  constructor(readonly root: string) {}
  path(asset: Pick<Asset, 'id' | 'format'>) { return join(this.root, `${asset.id}.${asset.format}`); }
  async save(bytes: Buffer, format: 'mp3' | 'wav', fields: Partial<Asset>): Promise<Asset> {
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
    return { id, name: 'Untitled sound', description: '', tags: [], collections: [], review: 'unreviewed', feedback: '', source: 'imported', format, hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, duration, prompt: '', provider: null, model: null, requestId: null, request: null, usage: null, parentId: null, createdAt: new Date().toISOString(), ...fields };
  }
  async import(path: string): Promise<Asset> {
    const extension = extname(path).toLowerCase();
    if (extension !== '.mp3' && extension !== '.wav') throw new Error('Import a WAV or MP3 file.');
    const bytes = await readFile(path);
    const metadata = await parseBuffer(bytes, extension === '.mp3' ? 'audio/mpeg' : 'audio/wav', { duration: true });
    if (!metadata.format.codec || !metadata.format.duration) throw new Error('The file does not contain playable audio.');
    return this.save(bytes, extension.slice(1) as 'mp3' | 'wav', { name: basename(path, extension), source: 'imported' });
  }
  async export(asset: Asset, destination: string) {
    const original = await readFile(this.path(asset));
    if (createHash('sha256').update(original).digest('hex') !== asset.hash) throw new Error('Original file integrity check failed.');
    await copyFile(this.path(asset), destination, constants.COPYFILE_EXCL);
  }
}

export function generatedFields(input: GenerationInput): Partial<Asset> {
  return { source: 'generated', prompt: input.prompt, request: input, parentId: input.parentId ?? null, name: input.name ?? input.prompt.slice(0, 64), description: input.prompt };
}
