import { MPEGDecoder } from 'mpg123-decoder';
import { parseBuffer } from 'music-metadata';
import type { Asset, AudioAnalysis, AudioAnalysisInput, EventInterval, SeamProbe, TrimEdit, TrimInput } from '../shared/types';

// Bounds apply to editing/analysis, not importing or retaining originals.
export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
/** Attachment clips are bounded by duration and by encoded 16-bit mono WAV size. */
export const MAX_CLIP_SECONDS = 30;
export const MAX_CLIP_BYTES = 3 * 1024 * 1024;
const yieldWork = () => new Promise<void>(resolve => setImmediate(resolve));
export interface DecodedAudio { channels: Float32Array[]; sampleRate: number; decoder: string }
export interface ClipRender { bytes: Buffer; startFrame: number; endFrame: number; sampleRate: number }

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

export function interval(audio: DecodedAudio, start: number, end: number) {
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
  const analysis: AudioAnalysis = { version: 1, assetId: asset.id, sourceHash: asset.hash, sampleRate: audio.sampleRate, channels: audio.channels.length,
    totalFrames, duration, startFrame, endFrame, startSeconds: startFrame / audio.sampleRate, endSeconds: endFrame / audio.sampleRate,
    decoder: audio.decoder, bins,
    note: 'Absolute seconds in decoded source; frame intervals are [start,end). Linear full-scale amplitudes, no normalization. Min/max/peak span all channels; RMS includes every channel without downmix cancellation. Quiet bins do not establish silence or event identity. Zoom by requesting a smaller absolute interval. Measurements are not listening evidence.' };
  if (input.events) {
    const detected = await detectEvents(audio, startFrame, endFrame);
    analysis.events = detected.events;
    analysis.note += ' Event intervals come from an energy detector (5 ms RMS windows, adaptive threshold): candidate cut regions, not identified sounds.';
    if (detected.total > detected.events.length)
      analysis.note += ` Detected ${detected.total} intervals; only the ${detected.events.length} loudest are listed.`;
  }
  if (input.seamProbe) analysis.seam = await probeSeam(audio, input.seamProbe);
  return analysis;
}

const EVENT_MIN_SECONDS = 0.03;
const EVENT_GAP_SECONDS = 0.05;
const EVENT_MAX = 64;

/** Energy-based segmentation: exact-frame candidate regions, never semantic identity. */
async function detectEvents(audio: DecodedAudio, startFrame: number, endFrame: number): Promise<{ events: EventInterval[]; total: number }> {
  const rate = audio.sampleRate;
  const envelopeFrames = Math.max(1, Math.round(rate * 0.005));
  const levels: number[] = [];
  for (let start = startFrame; start < endFrame; start += envelopeFrames) {
    const end = Math.min(endFrame, start + envelopeFrames);
    let sum = 0, count = 0;
    for (const channel of audio.channels) {
      for (let i = start; i < end; i++) sum += channel[i] * channel[i];
      count += end - start;
    }
    levels.push(20 * Math.log10(Math.sqrt(sum / Math.max(1, count)) + 1e-12));
    if (levels.length % 64 === 0) await yieldWork();
  }
  if (!levels.length) return { events: [], total: 0 };
  const sorted = [...levels].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)];
  const onDb = Math.max(noiseFloor + 12, -60);
  const offDb = onDb - 3;
  const gapWindows = Math.max(1, Math.ceil(Math.round(rate * EVENT_GAP_SECONDS) / envelopeFrames));
  const minWindows = Math.max(1, Math.ceil(Math.round(rate * EVENT_MIN_SECONDS) / envelopeFrames));
  const spans: { start: number; end: number }[] = [];
  let active = false, onset = 0, below = 0;
  for (let i = 0; i < levels.length; i++) {
    if (!active) {
      if (levels[i] >= onDb) { active = true; onset = i; below = 0; }
    } else if (levels[i] < offDb) {
      below++;
      if (below >= gapWindows) { spans.push({ start: onset, end: i - below + 1 }); active = false; below = 0; }
    } else below = 0;
  }
  if (active) spans.push({ start: onset, end: levels.length });
  const candidates: EventInterval[] = [];
  for (const span of spans) {
    if (span.end - span.start < minWindows) continue;
    const frameStart = startFrame + span.start * envelopeFrames;
    const frameEnd = Math.min(endFrame, startFrame + span.end * envelopeFrames);
    let peak = 0, sum = 0, count = 0;
    for (let block = frameStart; block < frameEnd; block += 32768) {
      const blockEnd = Math.min(frameEnd, block + 32768);
      for (const channel of audio.channels) {
        for (let i = block; i < blockEnd; i++) {
          const value = Math.abs(channel[i]);
          if (value > peak) peak = value;
          sum += channel[i] * channel[i];
          count++;
        }
      }
      await yieldWork();
    }
    candidates.push({ startFrame: frameStart, endFrame: frameEnd,
      startSeconds: frameStart / rate, endSeconds: frameEnd / rate,
      peak, rms: Math.sqrt(sum / Math.max(1, count)) });
  }
  const total = candidates.length;
  const events = total > EVENT_MAX
    ? [...candidates].sort((a, b) => b.peak - a.peak).slice(0, EVENT_MAX).sort((a, b) => a.startFrame - b.startFrame)
    : candidates;
  return { events, total };
}

const SEAM_SEARCH_SECONDS = 0.05;
const SEAM_WINDOW_SECONDS = 0.05;
const SEAM_OFFSET_MIN_GAIN = 0.1;

function correlate(a: Float32Array, b: Float32Array): number {
  let meanA = 0, meanB = 0;
  for (let i = 0; i < a.length; i++) { meanA += a[i]; meanB += b[i]; }
  meanA /= a.length; meanB /= b.length;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    num += da * db; denA += da * da; denB += db * db;
  }
  if (denA <= 1e-20 || denB <= 1e-20) return 0;
  return num / Math.sqrt(denA * denB);
}

/** Measures how the end of a candidate loop interval wraps back to its start. */
async function probeSeam(audio: DecodedAudio, input: { startSeconds?: number; endSeconds?: number }): Promise<SeamProbe> {
  const rate = audio.sampleRate;
  const totalFrames = audio.channels[0].length;
  const { startFrame, endFrame } = interval(audio, input.startSeconds ?? 0, input.endSeconds ?? totalFrames / rate);
  const frames = endFrame - startFrame;
  const window = Math.min(Math.round(rate * SEAM_WINDOW_SECONDS), Math.floor(frames / 4));
  if (window < Math.round(rate * 0.005)) throw new Error('seamProbe needs a loop interval of at least 20 milliseconds.');
  const search = Math.max(0, Math.min(
    Math.round(rate * SEAM_SEARCH_SECONDS),
    startFrame,
    totalFrames - endFrame,
    totalFrames - window - startFrame
  ));
  const regionStart = startFrame - search;
  const regionEnd = endFrame + search;
  const mono = new Float32Array(regionEnd - regionStart);
  for (let i = 0; i < mono.length; i++) {
    let value = 0;
    for (const channel of audio.channels) value += channel[regionStart + i];
    mono[i] = value / audio.channels.length;
    if (i % 32768 === 0) await yieldWork();
  }
  const headOffset = startFrame - regionStart;
  const tailOffset = endFrame - regionStart;
  const correlation = correlate(mono.subarray(headOffset, headOffset + window), mono.subarray(tailOffset - window, tailOffset));
  // A shift is only suggested when it meaningfully beats the seam at zero:
  // tiny gains are phase noise and must not nudge a beat-aligned loop.
  let maxCorrelation = correlation;
  let maxShift = 0;
  for (let shift = -search; shift <= search; shift++) {
    const head = mono.subarray(headOffset + shift, headOffset + shift + window);
    const tail = mono.subarray(tailOffset + shift - window, tailOffset + shift);
    const score = correlate(head, tail);
    if (score > maxCorrelation) { maxCorrelation = score; maxShift = shift; }
    if ((shift + search) % 512 === 0) await yieldWork();
  }
  const suggestedOffset = maxCorrelation >= correlation + SEAM_OFFSET_MIN_GAIN ? maxShift : 0;
  const windowRms = async (from: number, to: number): Promise<number> => {
    let sum = 0, count = 0;
    for (const channel of audio.channels) {
      for (let i = from; i < to; i++) { sum += channel[i] * channel[i]; count++; }
    }
    await yieldWork();
    return Math.sqrt(sum / Math.max(1, count));
  };
  const headRms = await windowRms(startFrame, startFrame + window);
  const tailRms = await windowRms(endFrame - window, endFrame);
  const crossing = (from: number, to: number, backwards: boolean): number | null => {
    let found: number | null = null;
    for (let i = from + 1; i < to; i++) {
      const previous = mono[i - 1 - regionStart], current = mono[i - regionStart];
      if ((previous < 0 && current >= 0) || (previous >= 0 && current < 0)) {
        found = i;
        if (!backwards) break;
      }
    }
    return found;
  };
  const afterStart = crossing(startFrame, startFrame + window, false);
  const beforeEnd = crossing(endFrame - window, endFrame, true);
  return {
    startSeconds: startFrame / rate,
    endSeconds: endFrame / rate,
    startFrame,
    endFrame,
    windowSamples: window,
    discontinuity: Math.abs(mono[headOffset] - mono[tailOffset - 1]),
    rmsHead: headRms,
    rmsTail: tailRms,
    correlation,
    suggestedOffsetFrames: suggestedOffset,
    bestCorrelation: maxCorrelation,
    searchFrames: search,
    zeroCrossAfterStart: afterStart === null ? null : afterStart - startFrame,
    zeroCrossBeforeEnd: beforeEnd === null ? null : endFrame - 1 - beforeEnd,
    note: 'Seam metrics describe the wrap from the interval end back to its start. discontinuity is the single-sample step across that seam; correlation compares the last window with the first (1 = similar texture, 0 = unrelated); suggestedOffsetFrames slides both endpoints together (length preserved) within ±searchFrames frames and is only reported when it improves the seam correlation by at least 0.1, so noise never nudges an aligned loop. These are measurements, not musical judgment; audition any loop you design.'
  };
}

/** Renders a bounded mono 16-bit PCM WAV window for attachment to a chat model. */
export async function renderClip(audio: DecodedAudio, input: { startSeconds?: number; endSeconds?: number }): Promise<ClipRender> {
  const totalFrames = audio.channels[0].length;
  const { startFrame, endFrame } = interval(audio, input.startSeconds ?? 0, input.endSeconds ?? totalFrames / audio.sampleRate);
  const frames = endFrame - startFrame;
  const maxFrames = Math.min(Math.floor(MAX_CLIP_SECONDS * audio.sampleRate), Math.floor(MAX_CLIP_BYTES / 2));
  if (frames > maxFrames) {
    const limit = Math.max(0.1, Math.floor((maxFrames / audio.sampleRate) * 100) / 100);
    throw new Error(`Audio clips are limited to ${limit} seconds at this sample rate. Pass a narrower startSeconds/endSeconds window (the asset is ${(totalFrames / audio.sampleRate).toFixed(1)} s).`);
  }
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(audio.sampleRate, 24); bytes.writeUInt32LE(audio.sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let block = 0; block < frames; block += 32768) {
    const blockEnd = Math.min(frames, block + 32768);
    for (let i = block; i < blockEnd; i++) {
      let sample = 0;
      for (const channel of audio.channels) sample += channel[startFrame + i];
      const mono = Math.max(-1, Math.min(1, sample / audio.channels.length));
      bytes.writeInt16LE(Math.round(mono * 32767), 44 + i * 2);
    }
    await yieldWork();
  }
  return { bytes, startFrame, endFrame, sampleRate: audio.sampleRate };
}

export async function renderTrim(audio: DecodedAudio, asset: Asset, input: TrimInput): Promise<{ bytes: Buffer; edit: TrimEdit }> {
  const { startFrame, endFrame } = interval(audio, input.startSeconds, input.endSeconds);
  const frames = endFrame - startFrame, channels = audio.channels.length;
  const loop = input.loop === true;
  const crossfadeFrames = loop ? Math.round((input.crossfadeMs ?? 0) * audio.sampleRate / 1000) : 0;
  const fadeInFrames = Math.round((input.fadeInMs ?? 0) * audio.sampleRate / 1000);
  const fadeOutFrames = Math.round((input.fadeOutMs ?? 0) * audio.sampleRate / 1000);
  if (loop && (fadeInFrames || fadeOutFrames)) throw new Error('A looping trim cannot also take fades; the seam must stay continuous.');
  if (!loop && fadeInFrames + fadeOutFrames > frames) throw new Error('Combined fades cannot exceed the selection duration.');
  if (crossfadeFrames >= frames) throw new Error('The loop crossfade must be shorter than the selection.');
  // A looped output drops the crossfade length so the wrapped end lands on the
  // crossfaded start: playback continues at consecutive source frames.
  const outputFrames = loop ? frames - crossfadeFrames : frames;
  const bytes = Buffer.alloc(56 + outputFrames * channels * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(audio.sampleRate, 24); bytes.writeUInt32LE(audio.sampleRate * channels * 4, 28);
  bytes.writeUInt16LE(channels * 4, 32); bytes.writeUInt16LE(32, 34);
  bytes.write('fact', 36); bytes.writeUInt32LE(4, 40); bytes.writeUInt32LE(outputFrames, 44);
  bytes.write('data', 48); bytes.writeUInt32LE(outputFrames * channels * 4, 52);
  for (let block = 0; block < outputFrames; block += 32768) {
    for (let i = block; i < Math.min(outputFrames, block + 32768); i++) {
      const gainIn = !loop && fadeInFrames && i < fadeInFrames ? (fadeInFrames === 1 ? 0 : i / (fadeInFrames - 1)) : 1;
      const gainOut = !loop && fadeOutFrames && outputFrames - i <= fadeOutFrames ? (fadeOutFrames === 1 ? 0 : (outputFrames - 1 - i) / (fadeOutFrames - 1)) : 1;
      for (let c = 0; c < channels; c++) {
        let value = audio.channels[c][startFrame + i];
        if (loop && crossfadeFrames && i < crossfadeFrames) {
          const mix = i / crossfadeFrames;
          value = value * mix + audio.channels[c][startFrame + frames - crossfadeFrames + i] * (1 - mix);
        }
        bytes.writeFloatLE(value * gainIn * gainOut, 56 + (i * channels + c) * 4);
      }
    }
    await yieldWork();
  }
  return { bytes, edit: { kind: 'trim', version: 1, sourceHash: asset.hash, sampleRate: audio.sampleRate,
    startFrame, endFrame, fadeInFrames: loop ? 0 : fadeInFrames, fadeOutFrames: loop ? 0 : fadeOutFrames,
    requested: { ...input }, decoder: audio.decoder, outputEncoding: 'float32-wav',
    ...(loop ? { loop: { crossfadeFrames, outputFrames } } : {}) } };
}
