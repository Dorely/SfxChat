import { encodePng } from './png';

const yieldWork = () => new Promise<void>(resolve => setImmediate(resolve));

export interface SpectrogramOptions {
  width?: number;
  height?: number;
  freqScale?: 'log' | 'linear';
}
export interface SpectrogramMapping {
  startSeconds: number;
  endSeconds: number;
  sampleRate: number;
  width: number;
  height: number;
  freqScale: 'log' | 'linear';
  freqMin: number;
  freqMax: number;
  windowSamples: number;
  dbFloor: number;
}
export interface SpectrogramRender { png: Buffer; mapping: SpectrogramMapping }

const WIDTH_DEFAULT = 768;
const HEIGHT_DEFAULT = 384;
const WIDTH_MIN = 256;
const WIDTH_MAX = 1024;
const HEIGHT_MIN = 128;
const HEIGHT_MAX = 512;
const WINDOW_MAX = 2048;
const WINDOW_MIN = 256;
const DB_FLOOR = -80;
const GRID_TENTHS = 10;

const COLORMAP = (() => {
  // Dark-to-bright perceptual ramp so quiet energy stays legible on the dark shell.
  const anchors = [
    [2, 2, 8], [24, 12, 64], [66, 10, 110], [106, 23, 121], [147, 38, 109],
    [190, 55, 86], [224, 87, 55], [247, 133, 20], [253, 195, 63], [252, 255, 166]
  ];
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const position = (i / 255) * (anchors.length - 1);
    const low = Math.min(anchors.length - 1, Math.floor(position));
    const high = Math.min(anchors.length - 1, low + 1);
    const mix = position - low;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(anchors[low][c] + (anchors[high][c] - anchors[low][c]) * mix);
  }
  return lut;
})();

/** In-place iterative radix-2 FFT over Float32 arrays. */
function fft(re: Float32Array, im: Float32Array): void {
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

function hann(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return window;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Renders a one-sided STFT magnitude image over [startFrame, endFrame) as PNG.
 * Pure DSP over decoded samples; interval validation belongs to the caller.
 */
export async function renderSpectrogram(
  audio: { channels: Float32Array[]; sampleRate: number },
  startFrame: number,
  endFrame: number,
  options: SpectrogramOptions = {}
): Promise<SpectrogramRender> {
  const channels = audio.channels;
  const sampleRate = audio.sampleRate;
  const frames = endFrame - startFrame;
  if (!channels.length || frames < 1) throw new Error('A spectrogram needs at least one sample frame.');
  const width = Math.round(clamp(options.width ?? WIDTH_DEFAULT, WIDTH_MIN, WIDTH_MAX));
  const height = Math.round(clamp(options.height ?? HEIGHT_DEFAULT, HEIGHT_MIN, HEIGHT_MAX));
  const freqScale: 'log' | 'linear' = options.freqScale === 'linear' ? 'linear' : 'log';
  const nyquist = sampleRate / 2;
  const freqMin = freqScale === 'log' ? Math.min(40, nyquist / 10) : 0;
  const freqMax = nyquist;

  let windowSize = WINDOW_MAX;
  while (windowSize > WINDOW_MIN && windowSize > frames * 2) windowSize /= 2;
  const spectrumBins = windowSize / 2 + 1;
  const window = hann(windowSize);
  let windowSum = 0;
  for (const value of window) windowSum += value;
  const normalizer = windowSum / 2;

  const real = new Float32Array(windowSize);
  const imaginary = new Float32Array(windowSize);
  const magnitude = new Float32Array(spectrumBins);
  const pixels = new Uint8Array(width * height * 3);
  const gridStep = Math.max(1, Math.round(width / GRID_TENTHS));

  const frequencyAt = (u: number): number => {
    if (freqScale === 'linear') return freqMax * (1 - u);
    return freqMax * (freqMin / freqMax) ** u;
  };
  // Row bands: row 0 is the top (highest frequency); band edges sit halfway
  // between neighboring row centers so downsampling averages real bins.
  const bands = Array.from({ length: height }, (_, y) => {
    const upper = clamp((y - 0.5) / (height - 1), 0, 1);
    const lower = clamp((y + 0.5) / (height - 1), 0, 1);
    const lo = frequencyAt(lower);
    const hi = frequencyAt(upper);
    let lowBin = Math.ceil((lo * windowSize) / sampleRate);
    let highBin = Math.floor((hi * windowSize) / sampleRate);
    if (highBin < lowBin) {
      const center = Math.round((((lo + hi) / 2) * windowSize) / sampleRate);
      lowBin = center;
      highBin = center;
    }
    lowBin = clamp(lowBin, 0, spectrumBins - 1);
    highBin = clamp(highBin, 0, spectrumBins - 1);
    return { lowBin, highBin };
  });

  for (let column = 0; column < width; column++) {
    const center = startFrame + Math.floor(((column + 0.5) * frames) / width);
    real.fill(0);
    imaginary.fill(0);
    const first = center - windowSize / 2;
    for (let i = 0; i < windowSize; i++) {
      const index = first + i;
      if (index < startFrame || index >= endFrame) continue;
      let sample = 0;
      for (const channel of channels) sample += channel[index];
      real[i] = (sample / channels.length) * window[i];
    }
    fft(real, imaginary);
    for (let k = 0; k < spectrumBins; k++) {
      const amplitude = Math.hypot(real[k], imaginary[k]) / normalizer;
      magnitude[k] = 20 * Math.log10(Math.max(amplitude, 1e-10));
    }
    for (let row = 0; row < height; row++) {
      const { lowBin, highBin } = bands[row];
      let total = 0;
      for (let k = lowBin; k <= highBin; k++) total += magnitude[k];
      const db = total / (highBin - lowBin + 1);
      const level = clamp((db - DB_FLOOR) / -DB_FLOOR, 0, 1);
      const color = Math.round(level * 255);
      const offset = (row * width + column) * 3;
      pixels[offset] = COLORMAP[color * 3];
      pixels[offset + 1] = COLORMAP[color * 3 + 1];
      pixels[offset + 2] = COLORMAP[color * 3 + 2];
    }
    if (column > 0 && column % gridStep === 0) {
      for (let row = 0; row < height; row++) {
        const offset = (row * width + column) * 3;
        for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(pixels[offset + c] * 0.6 + 55 * 0.4);
      }
    }
    if (column % 32 === 0) await yieldWork();
  }

  return {
    png: encodePng(width, height, pixels),
    mapping: {
      startSeconds: startFrame / sampleRate,
      endSeconds: endFrame / sampleRate,
      sampleRate,
      width,
      height,
      freqScale,
      freqMin: freqScale === 'linear' ? 0 : freqMin,
      freqMax,
      windowSamples: windowSize,
      dbFloor: DB_FLOOR
    }
  };
}
