import { MPEGDecoder } from 'mpg123-decoder';
import { parseBuffer } from 'music-metadata';
import type { Asset, AudioAnalysis, AudioAnalysisInput, TrimEdit, TrimInput } from '../shared/types';

// Bounds apply to editing/analysis, not importing or retaining originals.
export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const yieldWork = () => new Promise<void>(resolve => setImmediate(resolve));
export interface DecodedAudio { channels: Float32Array[]; sampleRate: number; decoder: string }

function checkSize(frames: number, channels: number) {
  if (!Number.isSafeInteger(frames) || frames <= 0 || channels < 1 || channels > 8 || frames * channels * 4 > MAX_AUDIO_BYTES)
    throw new Error('Editing supports up to 64 MiB of decoded audio and 1–8 channels.');
}

export async function decodeAudio(bytes: Buffer, format: Asset['format']): Promise<DecodedAudio> {
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error('Editing supports source files up to 64 MiB.');
  if (format === 'wav') return decodeWav(bytes);
  const metadata = await parseBuffer(bytes, 'audio/mpeg');
  const channels = metadata.format.numberOfChannels;
  if (channels !== 1 && channels !== 2) throw new Error('Unsupported MP3 channel layout.');
  const decoder = new MPEGDecoder({ enableGapless: true });
  await decoder.ready;
  try {
    const chunks: Float32Array[][] = [];
    let sampleRate = 0, frames = 0;
    // Decode in bounded chunks and yield so IPC and shutdown stay responsive.
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      const result = decoder.decode(bytes.subarray(offset, offset + 16384));
      if (result.errors.length) throw new Error('MP3 decoding reported damaged audio; a precise edit cannot be made.');
      if (result.samplesDecoded) {
        if (sampleRate && result.sampleRate !== sampleRate) throw new Error('MP3 sample-rate changes are unsupported for editing.');
        sampleRate = result.sampleRate;
        frames += result.samplesDecoded;
        checkSize(frames, 2); // mpg123 emits stereo, including duplicated mono.
        chunks.push(result.channelData);
      }
      await yieldWork();
    }
    checkSize(frames, channels);
    if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('Could not decode audio.');
    const output = Array.from({ length: channels }, () => new Float32Array(frames));
    let cursor = 0;
    for (const chunk of chunks) {
      for (let c = 0; c < channels; c++) output[c].set(chunk[c], cursor);
      cursor += chunk[0].length;
    }
    return { channels: output, sampleRate, decoder: 'mpg123-decoder@1.0.3; gapless=true' };
  } finally { decoder.free(); }
}

async function decodeWav(bytes: Buffer): Promise<DecodedAudio> {
  const bad = () => new Error('Unsupported or damaged WAV. Editing supports RIFF PCM 8/16/24/32-bit and IEEE float 32/64-bit WAV.');
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw bad();
  const limit = bytes.readUInt32LE(4) + 8;
  if (limit > bytes.length || limit < 12) throw bad();
  let fmt: Buffer | undefined, data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= limit;) {
    const length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length > limit) throw bad();
    const name = bytes.toString('ascii', offset, offset + 4);
    if (name === 'fmt ') { if (fmt) throw bad(); fmt = bytes.subarray(start, start + length); }
    if (name === 'data') { if (data) throw bad(); data = bytes.subarray(start, start + length); }
    offset = start + length + (length % 2);
  }
  if (!fmt || fmt.length < 16 || !data) throw bad();
  let encoding = fmt.readUInt16LE(0);
  const count = fmt.readUInt16LE(2), sampleRate = fmt.readUInt32LE(4), align = fmt.readUInt16LE(12), bits = fmt.readUInt16LE(14);
  if (encoding === 0xfffe) {
    if (fmt.length < 40 || fmt.readUInt16LE(16) < 22 || !fmt.subarray(26, 40).equals(Buffer.from('000000001000800000aa00389b71', 'hex'))) throw bad();
    // Reduced valid-bit and custom speaker layouts need explicit conversion support.
    if (fmt.readUInt16LE(18) !== bits) throw bad();
    const mask = fmt.readUInt32LE(20);
    if (mask !== 0 && !(count === 1 && mask === 4) && !(count === 2 && mask === 3))
      throw new Error('Editing this WAV speaker layout is unsupported. Export a standard mono/stereo WAV first.');
    encoding = fmt.readUInt16LE(24);
  }
  if (!sampleRate || sampleRate > 384000 || align !== count * bits / 8 || data.length % align ||
    !(encoding === 1 && [8,16,24,32].includes(bits) || encoding === 3 && [32,64].includes(bits))) throw bad();
  const frames = data.length / align;
  checkSize(frames, count);
  const output = Array.from({ length: count }, () => new Float32Array(frames));
  for (let block = 0; block < frames; block += 32768) {
    for (let i = block; i < Math.min(frames, block + 32768); i++) for (let c = 0; c < count; c++) {
      const p = i * align + c * bits / 8;
      const value = encoding === 3 ? (bits === 32 ? data.readFloatLE(p) : data.readDoubleLE(p))
        : bits === 8 ? (data[p] - 128) / 128 : data.readIntLE(p, bits / 8) / 2 ** (bits - 1);
      if (!Number.isFinite(value) || Math.abs(value) > 3.4028234663852886e38) throw bad();
      output[c][i] = value;
    }
    await yieldWork();
  }
  return { channels: output, sampleRate, decoder: 'sfxchat-wav@1' };
}

function interval(audio: DecodedAudio, start: number, end: number) {
  const total = audio.channels[0].length;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > total / audio.sampleRate)
    throw new Error(`Choose an ordered interval within 0–${total / audio.sampleRate} seconds (decoded audio).`);
  const startFrame = Math.round(start * audio.sampleRate), endFrame = Math.round(end * audio.sampleRate);
  if (startFrame >= endFrame || endFrame > total) throw new Error('The interval must contain at least one sample frame.');
  return { startFrame, endFrame };
}

export async function analyzeAudio(audio: DecodedAudio, asset: Asset, input: AudioAnalysisInput): Promise<AudioAnalysis> {
  const totalFrames = audio.channels[0].length, duration = totalFrames / audio.sampleRate;
  const { startFrame, endFrame } = interval(audio, input.startSeconds ?? 0, input.endSeconds ?? duration);
  const count = Math.min(input.bins ?? 96, endFrame - startFrame);
  const bins: AudioAnalysis['bins'] = [];
  for (let bin = 0; bin < count; bin++) {
    const a = startFrame + Math.floor(bin * (endFrame - startFrame) / count);
    const b = startFrame + Math.floor((bin + 1) * (endFrame - startFrame) / count);
    let min = Infinity, max = -Infinity, sum = 0;
    for (let block = a; block < b; block += 32768) {
      for (let i = block; i < Math.min(b, block + 32768); i++) for (const channel of audio.channels) {
        const value = channel[i]; min = Math.min(min, value); max = Math.max(max, value); sum += value * value;
      }
      await yieldWork();
    }
    bins.push({ startFrame: a, endFrame: b, startSeconds: a / audio.sampleRate, endSeconds: b / audio.sampleRate,
      min, max, peak: Math.max(Math.abs(min), Math.abs(max)), rms: Math.sqrt(sum / ((b - a) * audio.channels.length)) });
  }
  return { version: 1, assetId: asset.id, sourceHash: asset.hash, sampleRate: audio.sampleRate, channels: audio.channels.length,
    totalFrames, duration, startFrame, endFrame, startSeconds: startFrame / audio.sampleRate, endSeconds: endFrame / audio.sampleRate,
    decoder: audio.decoder, bins,
    note: 'Absolute seconds in decoded source; frame intervals are [start,end). Linear full-scale amplitudes, no normalization. Min/max/peak span all channels; RMS includes every channel without downmix cancellation. Quiet bins do not establish silence or event identity. Zoom by requesting a smaller absolute interval. Measurements are not listening evidence.' };
}

export async function renderTrim(audio: DecodedAudio, asset: Asset, input: TrimInput): Promise<{ bytes: Buffer; edit: TrimEdit }> {
  const { startFrame, endFrame } = interval(audio, input.startSeconds, input.endSeconds);
  const frames = endFrame - startFrame, channels = audio.channels.length;
  const fadeInFrames = Math.round((input.fadeInMs ?? 0) * audio.sampleRate / 1000);
  const fadeOutFrames = Math.round((input.fadeOutMs ?? 0) * audio.sampleRate / 1000);
  if (fadeInFrames + fadeOutFrames > frames) throw new Error('Combined fades cannot exceed the selection duration.');
  const bytes = Buffer.alloc(56 + frames * channels * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(audio.sampleRate, 24); bytes.writeUInt32LE(audio.sampleRate * channels * 4, 28);
  bytes.writeUInt16LE(channels * 4, 32); bytes.writeUInt16LE(32, 34);
  bytes.write('fact', 36); bytes.writeUInt32LE(4, 40); bytes.writeUInt32LE(frames, 44);
  bytes.write('data', 48); bytes.writeUInt32LE(frames * channels * 4, 52);
  for (let block = 0; block < frames; block += 32768) {
    for (let i = block; i < Math.min(frames, block + 32768); i++) {
      const gainIn = fadeInFrames && i < fadeInFrames ? (fadeInFrames === 1 ? 0 : i / (fadeInFrames - 1)) : 1;
      const gainOut = fadeOutFrames && frames - i <= fadeOutFrames ? (fadeOutFrames === 1 ? 0 : (frames - 1 - i) / (fadeOutFrames - 1)) : 1;
      for (let c = 0; c < channels; c++) bytes.writeFloatLE(audio.channels[c][startFrame + i] * gainIn * gainOut, 56 + (i * channels + c) * 4);
    }
    await yieldWork();
  }
  return { bytes, edit: { kind: 'trim', version: 1, sourceHash: asset.hash, sampleRate: audio.sampleRate,
    startFrame, endFrame, fadeInFrames, fadeOutFrames, requested: { ...input }, decoder: audio.decoder, outputEncoding: 'float32-wav' } };
}
