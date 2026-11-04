import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseBuffer } from 'music-metadata';
import type { Asset, AssetKind, AudioAnalysis, AudioAnalysisInput, AnyGenerationInput, LoopSearchInput, LoopSeamInput, SpectrogramInput, TrimInput } from '../shared/types';
import { analyzeAudio, decodeAudio, interval, renderClip, renderTrim, MAX_AUDIO_BYTES, type ClipRender, type DecodedAudio } from './audio';
import { renderSpectrogram, type SpectrogramRender } from './spectrogram';
import { midiFileDurationSeconds } from './midi';
import { analyzeWav, WavReader } from './wav-reader';
import { decodedSource, type FrameSource } from './dsp';
import { computeMusicFeatures, musicalSummary, type MusicFeatures } from './music-analysis';
import { findLoopPoints, renderSeam } from './loop-finder';

export class MediaLibrary {
  private audioQueue: Promise<unknown> = Promise.resolve();
  private decoded: { hash: string; audio: DecodedAudio } | null = null;
  /** Musical features by source hash and tempo hint, most recent last; originals are immutable. */
  private features: { hash: string; tempoHint: number | null; features: MusicFeatures }[] = [];
  /** `root` holds immutable originals; `chatRoot` holds durable chat attachment media. */
  constructor(readonly root: string, readonly chatRoot: string) {}
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const pending = this.audioQueue.then(job);
    this.audioQueue = pending.catch(() => undefined);
    return pending;
  }
  private async loadDecoded(asset: Asset): Promise<DecodedAudio> {
    if (asset.format === 'mid') throw new Error('MIDI clips are edited as notes in the MIDI studio, not trimmed, analyzed, or listened to as decoded audio.');
    if ((await stat(this.path(asset))).size > MAX_AUDIO_BYTES) throw new Error('Editing supports source files up to 64 MiB.');
    const bytes = await readFile(this.path(asset));
    if (createHash('sha256').update(bytes).digest('hex') !== asset.hash) throw new Error('Original file integrity check failed.');
    if (this.decoded?.hash !== asset.hash) {
      this.decoded = null;
      this.decoded = { hash: asset.hash, audio: await decodeAudio(bytes, asset.format) };
    }
    return this.decoded.audio;
  }
  private withAudio<T>(asset: Asset, operation: (audio: DecodedAudio) => Promise<T>): Promise<T> {
    return this.enqueue(async () => operation(await this.loadDecoded(asset)));
  }
  /** WAV streams bounded ranges at any length; MP3 uses the cached whole-file decode. Call inside the queue. */
  private async openSource(asset: Asset): Promise<{ source: FrameSource; close: () => Promise<void> }> {
    if (asset.format !== 'wav') return { source: decodedSource(await this.loadDecoded(asset)), close: async () => undefined };
    const reader = await WavReader.open(this.path(asset), asset.hash);
    return {
      source: { sampleRate: reader.sampleRate, channels: reader.channels, frames: reader.frames, decoder: 'sfxchat-wav@1; bounded ranges', read: async (start, end) => (await reader.read(start, end)).channels },
      close: () => reader.close()
    };
  }
  private async musicFeatures(asset: Asset, source: FrameSource, tempoHint?: number): Promise<MusicFeatures> {
    const cached = this.features.find(entry => entry.hash === asset.hash && entry.tempoHint === (tempoHint ?? null));
    if (cached) return cached.features;
    const features = await computeMusicFeatures(source, { tempoHint });
    this.features = [...this.features.slice(-3), { hash: asset.hash, tempoHint: tempoHint ?? null, features }];
    return features;
  }
  private withMusic<T>(asset: Asset, tempoHint: number | undefined, operation: (source: FrameSource, features: MusicFeatures) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const { source, close } = await this.openSource(asset);
      try { return await operation(source, await this.musicFeatures(asset, source, tempoHint)); } finally { await close(); }
    });
  }
  analyze(asset: Asset, input: AudioAnalysisInput): Promise<AudioAnalysis> {
    return this.enqueue(async () => {
      const result = asset.format === 'wav' ? await analyzeWav(this.path(asset), asset, input) : await analyzeAudio(await this.loadDecoded(asset), asset, input);
      if (!input.musical) return result;
      const { source, close } = await this.openSource(asset);
      try { return { ...result, musical: musicalSummary(await this.musicFeatures(asset, source, input.tempoHint), result.startSeconds, result.endSeconds, input.keyHint) }; } finally { await close(); }
    });
  }
  findLoops(asset: Asset, input: LoopSearchInput) {
    return this.withMusic(asset, input.tempoHint, (source, features) => findLoopPoints(source, features, asset, input));
  }
  /** Float channels across a loop's wrap exactly as a loop render plays it. */
  loopSeam(asset: Asset, input: LoopSeamInput) {
    return this.enqueue(async () => {
      const { source, close } = await this.openSource(asset);
      try { return await renderSeam(source, input); } finally { await close(); }
    });
  }
  samplePcm(asset: Asset) {
    return this.withAudio(asset, async audio => {
      const frames = audio.channels[0].length, bytes = Buffer.alloc(12 + frames * audio.channels.length * 4);
      bytes.writeUInt32LE(audio.sampleRate, 0); bytes.writeUInt32LE(audio.channels.length, 4); bytes.writeUInt32LE(frames, 8);
      for (let ch = 0; ch < audio.channels.length; ch++) for (let i = 0; i < frames; i++) bytes.writeFloatLE(audio.channels[ch][i], 12 + (ch * frames + i) * 4);
      return bytes;
    });
  }
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
    if (asset.format === 'wav') {
      const pending = this.audioQueue.then(async () => {
        const reader = await WavReader.open(this.path(asset), asset.hash);
        try {
          const startFrame = Math.round((input.startSeconds ?? 0) * reader.sampleRate), endFrame = Math.round((input.endSeconds ?? reader.frames / reader.sampleRate) * reader.sampleRate);
          if (endFrame - startFrame > reader.sampleRate * 60) throw new Error('Listening clips are limited to 60 seconds. Choose a narrower range.');
          const clip = await renderClip(await reader.read(startFrame, endFrame), {});
          return { ...clip, startFrame, endFrame };
        } finally { await reader.close(); }
      });
      this.audioQueue = pending.catch(() => undefined);
      return pending;
    }
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
  async save(bytes: Buffer, format: 'mp3' | 'wav' | 'mid', fields: Partial<Asset> & { projectId: string }): Promise<Asset> {
    await mkdir(this.root, { recursive: true });
    const id = randomUUID();
    // Preserve bytes even if probing fails. Such output remains inspectable but the
    // generation is marked failed by the caller rather than presenting invalid audio.
    const path = this.path({ id, format });
    const temp = path + '.partial';
    await writeFile(temp, bytes, { flag: 'wx' });
    await rename(temp, path);
    let duration: number | null = null;
    try {
      if (format === 'mid') duration = midiFileDurationSeconds(bytes);
      else { const metadata = await parseBuffer(bytes, format === 'mp3' ? 'audio/mpeg' : 'audio/wav', { duration: true }); duration = metadata.format.duration ?? null; }
    } catch { /* originals still preserved */ }
    return { id, name: 'Untitled sound', description: '', tags: [], collections: [], review: 'unreviewed', feedback: '', source: 'imported', kind: 'effect', format, hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, duration, prompt: '', provider: null, model: null, requestId: null, request: null, usage: null, parentId: null, createdAt: new Date().toISOString(), ...fields };
  }
  async import(path: string, projectId: string, kind: AssetKind = 'effect'): Promise<Asset> {
    const extension = extname(path).toLowerCase();
    if (extension === '.mid' || extension === '.midi') {
      const bytes = await readFile(path);
      midiFileDurationSeconds(bytes);
      return this.save(bytes, 'mid', { projectId, name: basename(path, extension), source: 'imported', kind: 'midi' });
    }
    if (extension !== '.mp3' && extension !== '.wav') throw new Error('Import a WAV, MP3, or MIDI file.');
    const bytes = await readFile(path);
    const metadata = await parseBuffer(bytes, extension === '.mp3' ? 'audio/mpeg' : 'audio/wav', { duration: true });
    if (!metadata.format.codec || !metadata.format.duration) throw new Error('The file does not contain playable audio.');
    return this.save(bytes, extension.slice(1) as 'mp3' | 'wav', { projectId, name: basename(path, extension), source: 'imported', kind });
  }

}

export function generatedFields(input: AnyGenerationInput, kind: AssetKind, projectId: string): Partial<Asset> & { projectId: string } {
  const prompt = input.kind === 'voice' ? input.text : input.prompt;
  return { projectId, source: 'generated', kind, prompt, request: input, parentId: input.parentId ?? null, name: input.name ?? prompt.slice(0, 64), description: prompt };
}
