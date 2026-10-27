import type { DecodedAudio } from './audio';

/** Random-access sample frames shared by in-memory decodes and streamed WAV ranges. */
export interface FrameSource {
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: number;
  readonly decoder: string;
  /** Returns one array per channel covering [start,end). Callers must not mutate it. */
  read(start: number, end: number): Promise<Float32Array[]>;
}

export function decodedSource(audio: DecodedAudio): FrameSource {
  return {
    sampleRate: audio.sampleRate, channels: audio.channels.length, frames: audio.channels[0].length, decoder: audio.decoder,
    read: async (start, end) => audio.channels.map(channel => channel.subarray(start, end))
  };
}

export const yieldWork = () => new Promise<void>(resolve => setImmediate(resolve));

/** In-place iterative radix-2 FFT over Float32 arrays. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const vRe = re[b] * curRe - im[b] * curIm;
        const vIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - vRe;
        im[b] = im[a] - vIm;
        re[a] += vRe;
        im[a] += vIm;
        const nextRe = curRe * stepRe - curIm * stepIm;
        curIm = curRe * stepIm + curIm * stepRe;
        curRe = nextRe;
      }
    }
  }
}

export function hann(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return window;
}

export interface BiquadCoefficients { b0: number; b1: number; b2: number; a1: number; a2: number }

/** RBJ Audio EQ Cookbook designs, normalized so a0 = 1. */
export function biquadDesign(type: 'lowpass' | 'highpass' | 'highshelf', frequency: number, sampleRate: number, q: number, gainDb = 0): BiquadCoefficients {
  const w0 = 2 * Math.PI * frequency / sampleRate, cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'highshelf') {
    const a = 10 ** (gainDb / 40), root = 2 * Math.sqrt(a) * alpha;
    b0 = a * ((a + 1) + (a - 1) * cos + root); b1 = -2 * a * ((a - 1) + (a + 1) * cos); b2 = a * ((a + 1) + (a - 1) * cos - root);
    a0 = (a + 1) - (a - 1) * cos + root; a1 = 2 * ((a - 1) - (a + 1) * cos); a2 = (a + 1) - (a - 1) * cos - root;
  } else {
    const edge = type === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2;
    b0 = edge; b1 = type === 'lowpass' ? 1 - cos : -(1 + cos); b2 = edge;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Transposed direct form II state for one channel. */
export class Biquad {
  private z1 = 0; private z2 = 0;
  constructor(private c: BiquadCoefficients) {}
  process(x: number): number {
    const y = this.c.b0 * x + this.z1;
    this.z1 = this.c.b1 * x - this.c.a1 * y + this.z2;
    this.z2 = this.c.b2 * x - this.c.a2 * y;
    return y;
  }
}

/**
 * ITU-R BS.1770 K-weighting at any sample rate: the 4 dB high shelf and the
 * ~38 Hz high-pass realized as RBJ biquads (the pyloudnorm parameterization),
 * which reproduces the standard's published 48 kHz coefficients closely. The
 * standard's high-pass numerator is exactly [1, -2, 1], so it is rescaled to match.
 */
export function kWeighting(sampleRate: number): [BiquadCoefficients, BiquadCoefficients] {
  const highpass = biquadDesign('highpass', 38, sampleRate, 0.5);
  return [biquadDesign('highshelf', 1500, sampleRate, 1 / Math.SQRT2, 4), { ...highpass, b0: 1, b1: -2, b2: 1 }];
}

/** Fourth-order Butterworth low-pass as two cascaded biquads. */
export function butterworthLowpass(frequency: number, sampleRate: number): [BiquadCoefficients, BiquadCoefficients] {
  return [biquadDesign('lowpass', frequency, sampleRate, 0.5411961), biquadDesign('lowpass', frequency, sampleRate, 1.3065630)];
}

export function pearson(a: ArrayLike<number>, b: ArrayLike<number>, length = Math.min(a.length, b.length)): number {
  let meanA = 0, meanB = 0;
  for (let i = 0; i < length; i++) { meanA += a[i]; meanB += b[i]; }
  meanA /= length; meanB /= length;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < length; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    num += da * db; denA += da * da; denB += db * db;
  }
  if (denA <= 1e-20 || denB <= 1e-20) return 0;
  return num / Math.sqrt(denA * denB);
}
