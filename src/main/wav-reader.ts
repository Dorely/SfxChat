import { open, type FileHandle } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { analyzeAudio, decodeAudio, MAX_AUDIO_BYTES, type DecodedAudio } from './audio';
import type { Asset, AudioAnalysis, AudioAnalysisInput } from '../shared/types';

/** Random-access RIFF reader. Decoding stays bounded even for a ten-minute mix. */
export class WavReader {
  private constructor(private file: FileHandle, private fmt: Buffer, private offset: number,
    readonly frames: number, readonly sampleRate: number, readonly channels: number, private align: number) {}
  static async open(path: string, expectedHash?: string) {
    if (expectedHash) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      if (hash.digest('hex') !== expectedHash) throw new Error('Original file integrity check failed.');
    }
    const file = await open(path, 'r');
    try {
      const size = (await file.stat()).size, h = Buffer.alloc(12);
      if ((await file.read(h, 0, 12, 0)).bytesRead !== 12 || h.toString('ascii', 0, 4) !== 'RIFF' || h.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid RIFF WAV.');
      const limit = h.readUInt32LE(4) + 8;
      if (limit > size || limit < 12) throw new Error('Truncated WAV.');
      let fmt: Buffer | undefined, data = -1, length = 0;
      for (let at = 12; at + 8 <= limit;) {
        const chunk = Buffer.alloc(8); await file.read(chunk, 0, 8, at);
        const n = chunk.readUInt32LE(4), start = at + 8;
        if (start + n > limit) throw new Error('Invalid WAV chunk.');
        const type = chunk.toString('ascii', 0, 4);
        if (type === 'fmt ') { if (fmt || n < 16 || n > 4096) throw new Error('Invalid WAV format.'); fmt = Buffer.alloc(n); await file.read(fmt, 0, n, start); }
        if (type === 'data') { if (data !== -1) throw new Error('Multiple WAV data chunks are unsupported.'); data = start; length = n; }
        at = start + n + n % 2;
      }
      if (!fmt || data < 0) throw new Error('Missing WAV format/data.');
      const align = fmt.readUInt16LE(12), channels = fmt.readUInt16LE(2), rate = fmt.readUInt32LE(4);
      if (!align || length % align || channels < 1 || channels > 8 || !rate || rate > 384000 || !length) throw new Error('Invalid WAV layout.');
      const reader = new WavReader(file, fmt, data, length / align, rate, channels, align);
      await reader.read(0, 1); // Reuse the canonical decoder's encoding/layout checks.
      return reader;
    } catch (error) { await file.close(); throw error; }
  }
  async read(start: number, end: number): Promise<DecodedAudio> {
    const frames = end - start;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > this.frames || frames <= 0 || frames * Math.max(this.align, this.channels * 4) + 8192 > MAX_AUDIO_BYTES) throw new Error('Choose a smaller WAV range (up to 64 MiB decoded).');
    const fmtLength = this.fmt.length + this.fmt.length % 2, bytes = Buffer.alloc(28 + fmtLength + frames * this.align);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(this.fmt.length, 16); this.fmt.copy(bytes, 20);
    bytes.write('data', 20 + fmtLength); bytes.writeUInt32LE(frames * this.align, 24 + fmtLength);
    const result = await this.file.read(bytes, 28 + fmtLength, frames * this.align, this.offset + start * this.align);
    if (result.bytesRead !== frames * this.align) throw new Error('WAV changed or was truncated during reading.');
    return decodeAudio(bytes, 'wav');
  }
  close() { return this.file.close(); }
}

export async function analyzeWav(path: string, asset: Pick<Asset, 'id' | 'hash'>, input: AudioAnalysisInput): Promise<AudioAnalysis> {
  const reader = await WavReader.open(path, asset.hash);
  try {
    const rate = reader.sampleRate, duration = reader.frames / rate;
    const range = (start: number, end: number) => {
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration + 1e-7 || end <= start) throw new Error('Invalid absolute WAV range.');
      const a = Math.round(start * rate), b = Math.min(reader.frames, Math.round(end * rate));
      if (b <= a) throw new Error('WAV range must contain at least one sample frame.');
      return [a, b];
    };
    const [startFrame, endFrame] = range(input.startSeconds ?? 0, input.endSeconds ?? duration);
    const count = Math.min(input.bins ?? 96, endFrame - startFrame), bins: AudioAnalysis['bins'] = [];
    let totalSum = 0, clipped = 0, silentFrames = 0, totalPeak = 0;
    for (let bin = 0; bin < count; bin++) {
      const a = startFrame + Math.floor(bin * (endFrame - startFrame) / count), b = startFrame + Math.floor((bin + 1) * (endFrame - startFrame) / count);
      let min = Infinity, max = -Infinity, sum = 0;
      for (let at = a; at < b; at += 32768) {
        const audio = await reader.read(at, Math.min(b, at + 32768));
        for (let i = 0; i < audio.channels[0].length; i++) {
          let silent = true;
          for (const channel of audio.channels) { const x = channel[i]; min = Math.min(min, x); max = Math.max(max, x); sum += x * x; if (Math.abs(x) >= 1) clipped++; if (Math.abs(x) >= 1e-6) silent = false; }
          if (silent) silentFrames++;
        }
      }
      const peak = Math.max(Math.abs(min), Math.abs(max)); totalSum += sum; totalPeak = Math.max(totalPeak, peak);
      bins.push({ startFrame: a, endFrame: b, startSeconds: a / rate, endSeconds: b / rate, min, max, peak, rms: Math.sqrt(sum / ((b - a) * reader.channels)) });
    }
    const result: AudioAnalysis = { version: 1, assetId: asset.id, sourceHash: asset.hash, sampleRate: rate, channels: reader.channels, totalFrames: reader.frames, duration, startFrame, endFrame, startSeconds: startFrame / rate, endSeconds: endFrame / rate, decoder: 'sfxchat-wav@1; bounded ranges', bins,
      summary: { peak: totalPeak, rms: Math.sqrt(totalSum / ((endFrame - startFrame) * reader.channels)), clippedSamples: clipped, nearSilentFrames: silentFrames, silenceThreshold: 1e-6 },
      note: 'Absolute source frames, [start,end). Streaming sample-peak/RMS measurements across all channels. Near silence means every channel below 0.000001 amplitude. Clipping counts samples at or beyond full scale; no true-peak or creative-quality score.' };
    if (input.events) {
      const audio = await reader.read(startFrame, endFrame);
      const local = await analyzeAudio(audio, asset, { events: true, bins: 1 });
      result.events = local.events?.map(e => ({ ...e, startFrame: e.startFrame + startFrame, endFrame: e.endFrame + startFrame, startSeconds: e.startSeconds + startFrame / rate, endSeconds: e.endSeconds + startFrame / rate }));
      result.note += ' Event detection requires a bounded range; intervals are energy detections, not identified sounds.';
    }
    if (input.seamProbe) {
      const [a, b] = range(input.seamProbe.startSeconds ?? 0, input.seamProbe.endSeconds ?? duration), n = Math.min(Math.round(rate * 0.1), Math.floor((b - a) / 2));
      if (!n) throw new Error('Loop probe needs at least two sample frames.');
      const head = await reader.read(a, a + n), tail = await reader.read(b - n, b);
      const audio = { ...head, channels: head.channels.map((c, i) => { const values = new Float32Array(n * 2); values.set(c); values.set(tail.channels[i], n); return values; }) };
      const local = await analyzeAudio(audio, asset, { bins: 1, seamProbe: {} });
      result.seam = { ...local.seam!, startFrame: a, endFrame: b, startSeconds: a / rate, endSeconds: b / rate, note: 'Bounded head/tail comparison at the requested endpoints. No endpoint-offset search. Correlation and amplitude continuity do not establish perceptual seamlessness.' };
    }
    return result;
  } finally { await reader.close(); }
}
