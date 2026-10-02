import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import type { Asset, AssetKind, AudioAnalysisInput, AudioGenerationInput, SpectrogramInput, TrimInput } from '../shared/types';
import { analyzeAudio, decodeAudio, interval, renderClip, renderTrim, MAX_AUDIO_BYTES, type ClipRender, type DecodedAudio } from './audio';
import { renderSpectrogram, type SpectrogramRender } from './spectrogram';

export class MediaLibrary {
  private audioQueue: Promise<unknown> = Promise.resolve();
  private decoded: { hash: string; audio: DecodedAudio } | null = null;
  /** `root` holds immutable originals; `chatRoot` holds durable chat attachment media. */
  constructor(readonly root: string, readonly chatRoot: string) {}
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
  pcmWav(asset: Asset) {
    return this.withAudio(asset, async audio => {
      const channels = audio.channels.length, frames = audio.channels[0].length;
      const bytes = Buffer.alloc(44 + frames * channels * 2);
      bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
      bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
      bytes.writeUInt32LE(audio.sampleRate, 24); bytes.writeUInt32LE(audio.sampleRate * channels * 2, 28);
      bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
      for (let offset = 0; offset < frames; offset += 32768) {
        for (let frame = offset; frame < Math.min(frames, offset + 32768); frame++) for (let ch = 0; ch < channels; ch++) {
          const sample = Math.max(-1, Math.min(1, audio.channels[ch][frame]));
          bytes.writeInt16LE(Math.round(sample * (sample < 0 ? 32768 : 32767)), 44 + (frame * channels + ch) * 2);
        }
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      return bytes;
    });
  }
  renderTrim(asset: Asset, input: TrimInput) { return this.withAudio(asset, audio => renderTrim(audio, asset, input)); }
  clip(asset: Asset, input: { startSeconds?: number; endSeconds?: number }): Promise<ClipRender> {
    return this.withAudio(asset, audio => renderClip(audio, input));
  }
  spectrogram(asset: Asset, input: SpectrogramInput): Promise<SpectrogramRender> {
    return this.withAudio(asset, async audio => {
      const duration = audio.channels[0].length / audio.sampleRate;
      const { startFrame, endFrame } = interval(audio, input.startSeconds ?? 0, input.endSeconds ?? duration);
      return renderSpectrogram(audio, startFrame, endFrame, { width: input.width, height: input.height, freqScale: input.freqScale });
    });
  }
  async idle() { await this.audioQueue; }
  path(asset: Pick<Asset, 'id' | 'format'>) { return join(this.root, `${asset.id}.${asset.format}`); }
  chatAttachmentPath(id: string, format: 'png' | 'wav') { return join(this.chatRoot, `${id}.${format}`); }
  async saveChatAttachment(id: string, bytes: Buffer, format: 'png' | 'wav'): Promise<void> {
    await mkdir(this.chatRoot, { recursive: true });
    const path = this.chatAttachmentPath(id, format);
    const temp = path + '.partial';
    await writeFile(temp, bytes, { flag: 'wx' });
    await rename(temp, path);
  }
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

}

export function generatedFields(input: AudioGenerationInput, kind: AssetKind, projectId: string): Partial<Asset> & { projectId: string } {
  const prompt = input.kind === 'voice' ? input.text : input.prompt;
  return { projectId, source: 'generated', kind, prompt, request: input, parentId: input.parentId ?? null, name: input.name ?? prompt.slice(0, 64), description: prompt };
}
