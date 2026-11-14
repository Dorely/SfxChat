import { Biquad, butterworthLowpass, fft, hann, kWeighting, pearson, yieldWork, type FrameSource } from './dsp';
import type { MusicalAnalysis } from '../shared/types';

/**
 * Whole-file musical features computed once per source hash: an onset envelope,
 * chroma, log band energies and level on a ~23 ms STFT grid of a mono analysis
 * signal, plus beat grid, key and BS.1770 loudness estimates. Everything here is
 * a measurement or statistical estimate; none of it is listening evidence.
 */
export const MUSIC_ANALYSIS_VERSION = 1;
export const MAX_ANALYSIS_SECONDS = 900;
export const BAND_COUNT = 24;
const TARGET_RATE = 22050;
const FFT_SIZE = 2048;
const HOP = 512;
const READ_BLOCK = 65536;
const MIN_BPM = 50;
const MAX_BPM = 220;
const CHROMA_MIN_HZ = 150;
const CHROMA_MAX_HZ = 5000;
const LOW_ONSET_HZ = 200;
// Calibrated on synthetic and library material: unpatterned envelopes stay below the floor.
const PERIODICITY_FLOOR = 0.08;
const PERIODICITY_SPAN = 0.25;
const PITCH_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Spread (in octaves) of the tempo prior around a caller's hint; wide enough for a few percent of drift. */
const HINT_PRIOR_OCTAVES = 0.15;
// Krumhansl-Kessler key profiles (C major / C minor), tonic first.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
/** Church modes by the major-scale degree they start on (ionian is major, aeolian natural minor). */
const MODES = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'] as const;
export type ScaleMode = 'major' | 'minor' | typeof MODES[number];
/** The seven pitch classes of a key or mode, tonic first. */
function scaleNotes(tonic: number, mode: ScaleMode): number[] {
  const degree = MODES.indexOf(mode === 'major' ? 'ionian' : mode === 'minor' ? 'aeolian' : mode);
  return Array.from({ length: 7 }, (_, n) => (tonic + MAJOR_STEPS[(degree + n) % 7] - MAJOR_STEPS[degree] + 12) % 12);
}
/** Every mode that uses exactly the notes of this key, e.g. B major = C# dorian = E lydian. */
function sameNoteModes(tonic: number, mode: 'major' | 'minor') {
  const parent = mode === 'major' ? tonic : (tonic + 3) % 12;
  return MODES.map((name, degree) => `${PITCH_NAMES[(parent + MAJOR_STEPS[degree]) % 12]} ${name}`);
}

export interface MusicFeatures {
  version: number;
  sourceRate: number; channels: number; frames: number; duration: number; decoder: string;
  rate: number; hop: number; frameRate: number; count: number;
  /** Normalized onset strength and its sub-200 Hz counterpart, one value per STFT frame. */
  onset: Float32Array; onsetLow: Float32Array;
  /** Frame-major chroma (12 per frame, raw magnitudes) and band energies (BAND_COUNT per frame, dB). */
  chroma: Float32Array; bands: Float32Array;
  rmsDb: Float32Array;
  loudness: { integratedLufs: number | null; samplePeak: number };
  tempo: { bpm: number; confidence: number; periodicity: number; steady: boolean; residualMs: number } | null;
  /** Expected tempo the caller supplied; it centers the tempo prior, so half/double/two-thirds readings lose. */
  tempoHint: number | null;
  /** Tracked beat times in seconds, and the estimated bar phase within them. */
  beats: Float64Array;
  beatsPerBar: number; downbeatPhase: number; downbeatConfidence: number;
  key: { tonic: number; mode: 'major' | 'minor'; correlation: number; confidence: number; profile: number[]; ranked: { tonic: number; mode: 'major' | 'minor'; correlation: number }[]; all: { tonic: number; mode: 'major' | 'minor'; correlation: number }[] } | null;
}

export const keyLabel = (tonic: number, mode: 'major' | 'minor') => `${PITCH_NAMES[tonic]} ${mode}`;
export const frameTime = (features: Pick<MusicFeatures, 'hop' | 'rate'>, frame: number) => frame * features.hop / features.rate;

export async function computeMusicFeatures(source: FrameSource, options: { signal?: AbortSignal; tempoHint?: number } = {}): Promise<MusicFeatures> {
  const { signal } = options, tempoHint = options.tempoHint ?? null;
  const duration = source.frames / source.sampleRate;
  if (duration > MAX_ANALYSIS_SECONDS) throw new Error(`Musical analysis supports up to ${MAX_ANALYSIS_SECONDS / 60} minutes of audio.`);
  const factor = Math.max(1, Math.floor(source.sampleRate / TARGET_RATE));
  const rate = source.sampleRate / factor;
  const mono = new Float32Array(Math.ceil(source.frames / factor));
  const [lp1, lp2] = butterworthLowpass(0.45 * rate, source.sampleRate);
  const lowpass = factor > 1 ? [new Biquad(lp1), new Biquad(lp2)] : null;
  const [k1, k2] = kWeighting(source.sampleRate);
  const weighting = Array.from({ length: source.channels }, () => [new Biquad(k1), new Biquad(k2)]);
  // BS.1770 gating uses 400 ms blocks every 100 ms: keep 100 ms sub-block energies.
  const subFrames = Math.max(1, Math.round(source.sampleRate * 0.1));
  const subEnergy: number[] = [];
  let subSum = 0, subCount = 0, peak = 0, written = 0;
  for (let start = 0; start < source.frames; start += READ_BLOCK) {
    signal?.throwIfAborted();
    const end = Math.min(source.frames, start + READ_BLOCK);
    const block = await source.read(start, end);
    for (let i = 0; i < end - start; i++) {
      let sum = 0, energy = 0;
      for (let c = 0; c < block.length; c++) {
        const x = block[c][i];
        sum += x;
        const ax = Math.abs(x); if (ax > peak) peak = ax;
        const weighted = weighting[c][1].process(weighting[c][0].process(x));
        energy += weighted * weighted;
      }
      subSum += energy;
      if (++subCount === subFrames) { subEnergy.push(subSum / subFrames); subSum = 0; subCount = 0; }
      let value = sum / block.length;
      if (lowpass) value = lowpass[1].process(lowpass[0].process(value));
      const frame = start + i;
      if (frame % factor === 0 && written < mono.length) mono[written++] = value;
    }
    await yieldWork();
  }
  const loudness = { integratedLufs: gatedLoudness(subEnergy), samplePeak: peak };
  const stft = await spectralFeatures(mono, rate, signal);
  const frameRate = rate / HOP;
  const base = { version: MUSIC_ANALYSIS_VERSION, sourceRate: source.sampleRate, channels: source.channels, frames: source.frames, duration, decoder: source.decoder, rate, hop: HOP, frameRate, loudness, ...stft };
  const period = estimatePeriod(stft.onset, frameRate, tempoHint);
  let tempo: MusicFeatures['tempo'] = null;
  let beats: Float64Array = new Float64Array(0);
  if (period) {
    beats = trackBeats(stft.onset, stft.rmsDb, period.lag, rate, HOP);
    if (beats.length >= 8) {
      const fit = regression(beats);
      const residualMs = fit.residual * 1000;
      const beatSeconds = fit.slope;
      const steady = residualMs < Math.max(15, beatSeconds * 1000 * 0.06);
      const regularity = Math.max(0, 1 - residualMs / Math.max(1, beatSeconds * 1000 * 0.15));
      tempo = { bpm: 60 / beatSeconds, confidence: clamp01(period.confidence * (0.4 + 0.6 * regularity)), periodicity: period.periodicity, steady, residualMs };
    } else beats = new Float64Array(0);
  }
  const downbeat = tempo ? estimateDownbeat({ ...base, beats } as MusicFeatures, 4) : { phase: 0, confidence: 0 };
  return { ...base, tempo, tempoHint, beats, beatsPerBar: 4, downbeatPhase: downbeat.phase, downbeatConfidence: downbeat.confidence, key: estimateKey(stft.chroma, stft.count) };
}

function gatedLoudness(sub: number[]): number | null {
  if (sub.length < 4) return null;
  const blocks: number[] = [];
  for (let j = 0; j + 4 <= sub.length; j++) blocks.push((sub[j] + sub[j + 1] + sub[j + 2] + sub[j + 3]) / 4);
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const absolute = blocks.filter(z => z > 0 && lufs(z) > -70);
  if (!absolute.length) return null;
  const relative = lufs(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 10;
  const gated = absolute.filter(z => lufs(z) > relative);
  return gated.length ? lufs(gated.reduce((a, b) => a + b, 0) / gated.length) : null;
}

async function spectralFeatures(mono: Float32Array, rate: number, signal?: AbortSignal) {
  const count = Math.floor(mono.length / HOP) + 1, bins = FFT_SIZE / 2;
  const window = hann(FFT_SIZE), re = new Float32Array(FFT_SIZE), im = new Float32Array(FFT_SIZE);
  const binHz = rate / FFT_SIZE;
  const pitchClass = new Int8Array(bins).fill(-1);
  for (let k = 1; k < bins; k++) {
    const f = k * binHz;
    if (f >= CHROMA_MIN_HZ && f <= CHROMA_MAX_HZ) pitchClass[k] = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
  }
  const bandOf = new Int8Array(bins).fill(-1), low = 60, high = Math.min(11000, rate / 2);
  for (let k = 1; k < bins; k++) {
    const f = k * binHz;
    if (f >= low && f < high) bandOf[k] = Math.min(BAND_COUNT - 1, Math.floor(BAND_COUNT * Math.log(f / low) / Math.log(high / low)));
  }
  const lowBin = Math.ceil(LOW_ONSET_HZ / binHz);
  const flux = new Float32Array(count), fluxLow = new Float32Array(count);
  const chroma = new Float32Array(count * 12), bands = new Float32Array(count * BAND_COUNT), rmsDb = new Float32Array(count);
  let previous = new Float32Array(bins), current = new Float32Array(bins);
  const bandEnergy = new Float64Array(BAND_COUNT);
  for (let t = 0; t < count; t++) {
    if (t % 256 === 0) { signal?.throwIfAborted(); await yieldWork(); }
    const first = t * HOP - FFT_SIZE / 2;
    let energy = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const index = first + i, x = index >= 0 && index < mono.length ? mono[index] : 0;
      energy += x * x; re[i] = x * window[i]; im[i] = 0;
    }
    rmsDb[t] = 10 * Math.log10(energy / FFT_SIZE + 1e-12);
    fft(re, im);
    bandEnergy.fill(0);
    let sum = 0, sumLow = 0;
    for (let k = 1; k < bins; k++) {
      const amplitude = Math.hypot(re[k], im[k]) / (FFT_SIZE / 4);
      const log = Math.log10(1 + 100 * amplitude);
      current[k] = log;
      const rise = log - previous[k];
      if (rise > 0) { sum += rise; if (k < lowBin) sumLow += rise; }
      if (pitchClass[k] >= 0) chroma[t * 12 + pitchClass[k]] += amplitude;
      if (bandOf[k] >= 0) bandEnergy[bandOf[k]] += amplitude * amplitude;
    }
    for (let b = 0; b < BAND_COUNT; b++) bands[t * BAND_COUNT + b] = 10 * Math.log10(bandEnergy[b] + 1e-12);
    flux[t] = t ? sum : 0; fluxLow[t] = t ? sumLow : 0;
    [previous, current] = [current, previous];
  }
  return { count, onset: normalizeOnset(flux), onsetLow: normalizeOnset(fluxLow), chroma, bands, rmsDb };
}

/** Removes the local mean, half-wave rectifies and scales to unit standard deviation. */
function normalizeOnset(flux: Float32Array): Float32Array {
  const out = new Float32Array(flux.length), radius = 8;
  let running = 0;
  for (let i = 0; i < Math.min(flux.length, radius); i++) running += flux[i];
  for (let i = 0; i < flux.length; i++) {
    if (i + radius < flux.length) running += flux[i + radius];
    if (i - radius - 1 >= 0) running -= flux[i - radius - 1];
    const width = Math.min(flux.length - 1, i + radius) - Math.max(0, i - radius) + 1;
    out[i] = Math.max(0, flux[i] - running / width);
  }
  let mean = 0; for (const x of out) mean += x; mean /= Math.max(1, out.length);
  let variance = 0; for (const x of out) variance += (x - mean) ** 2;
  const std = Math.sqrt(variance / Math.max(1, out.length));
  if (std > 1e-9) for (let i = 0; i < out.length; i++) out[i] /= std;
  return out;
}

/**
 * Autocorrelation tempo with a log-normal prior around 120 BPM (one-octave
 * deviation), or narrowly around a caller's hint. The hint picks among the
 * envelope's own periodicity peaks; it never invents a tempo the audio lacks.
 */
function estimatePeriod(onset: Float32Array, frameRate: number, hint: number | null): { lag: number; periodicity: number; confidence: number } | null {
  const minLag = Math.floor(60 * frameRate / MAX_BPM), maxLag = Math.ceil(60 * frameRate / MIN_BPM);
  if (onset.length < maxLag * 4) return null;
  const acf = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = lag; i < onset.length; i++) sum += onset[i] * onset[i - lag];
    acf[lag] = sum / (onset.length - lag);
  }
  // Normalized autocorrelation: 0 for an unpatterned envelope, 1 for perfect repetition.
  let mean = 0; for (const x of onset) mean += x; mean /= onset.length;
  let variance = 0; for (const x of onset) variance += (x - mean) ** 2; variance /= onset.length;
  if (variance <= 1e-12) return null;
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) acf[lag] = (acf[lag] - mean * mean) / variance;
  let best = -1, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * frameRate / lag, prior = Math.exp(-0.5 * (Math.log2(bpm / (hint ?? 120)) / (hint ? HINT_PRIOR_OCTAVES : 1)) ** 2);
    const score = acf[lag] * prior;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  if (best < 0 || acf[best] <= 0) return null;
  const a = acf[best - 1], b = acf[best], c = acf[best + 1], denominator = a - 2 * b + c;
  const offset = Math.abs(denominator) > 1e-12 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denominator)) : 0;
  return { lag: best + offset, periodicity: b, confidence: clamp01((b - PERIODICITY_FLOOR) / PERIODICITY_SPAN) };
}

/** Ellis (2007) dynamic-programming beat tracker over the onset envelope. */
function trackBeats(onset: Float32Array, rmsDb: Float32Array, period: number, rate: number, hop: number): Float64Array {
  const n = onset.length, score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const tightness = 100, lo = Math.round(period / 2), hi = Math.round(2 * period);
  for (let t = 0; t < n; t++) {
    let best = 0, from = -1;
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue;
      const candidate = score[tau] - tightness * Math.log((t - tau) / period) ** 2;
      if (from < 0 || candidate > best) { best = candidate; from = tau; }
    }
    score[t] = onset[t] + (from >= 0 ? Math.max(0, best) : 0);
    back[t] = from >= 0 && best > 0 ? from : -1;
  }
  let last = Math.max(0, n - Math.round(period));
  for (let t = last; t < n; t++) if (score[t] > score[last]) last = t;
  const frames: number[] = [];
  for (let t = last; t >= 0; t = back[t]) frames.push(t);
  frames.reverse();
  // Drop beats tracked through silence at either edge.
  const sorted = Array.from(rmsDb).sort((x, y) => x - y), floor = Math.max(-60, sorted[Math.floor(sorted.length * 0.5)] - 30);
  let first = 0, end = frames.length;
  while (first < end && rmsDb[frames[first]] < floor) first++;
  while (end > first && rmsDb[frames[end - 1]] < floor) end--;
  return Float64Array.from(frames.slice(first, end), t => t * hop / rate);
}

function regression(beats: Float64Array) {
  const n = beats.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += beats[i]; sxx += i * i; sxy += i * beats[i]; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), intercept = (sy - slope * sx) / n;
  let squares = 0; for (let i = 0; i < n; i++) squares += (beats[i] - (intercept + slope * i)) ** 2;
  return { slope, intercept, residual: Math.sqrt(squares / n) };
}

export function beatFrame(features: Pick<MusicFeatures, 'rate' | 'hop' | 'count'>, seconds: number) {
  return Math.max(0, Math.min(features.count - 1, Math.round(seconds * features.rate / features.hop)));
}

/** Mean chroma over [from,to) STFT frames, L2-normalized. */
export function chromaMean(features: Pick<MusicFeatures, 'chroma'>, from: number, to: number, out = new Float64Array(12)) {
  out.fill(0);
  for (let t = from; t < Math.max(to, from + 1); t++) for (let p = 0; p < 12; p++) out[p] += features.chroma[t * 12 + p] ?? 0;
  let norm = 0; for (let p = 0; p < 12; p++) norm += out[p] ** 2;
  norm = Math.sqrt(norm) || 1; for (let p = 0; p < 12; p++) out[p] /= norm;
  return out;
}

/** Picks the bar phase whose beats carry the most low-band onsets and harmonic change. */
function estimateDownbeat(features: MusicFeatures, beatsPerBar: number) {
  const beats = features.beats;
  if (beats.length < beatsPerBar * 4) return { phase: 0, confidence: 0 };
  const low: number[] = [], change: number[] = [];
  const before = new Float64Array(12), after = new Float64Array(12);
  for (let k = 0; k < beats.length; k++) {
    const t = beatFrame(features, beats[k]);
    let strength = 0;
    for (let d = -2; d <= 2; d++) strength = Math.max(strength, features.onsetLow[t + d] ?? 0);
    low.push(strength);
    const previous = k ? beatFrame(features, beats[k - 1]) : Math.max(0, t - 20), next = k + 1 < beats.length ? beatFrame(features, beats[k + 1]) : Math.min(features.count, t + 20);
    chromaMean(features, previous, t, before); chromaMean(features, t, next, after);
    let cosine = 0; for (let p = 0; p < 12; p++) cosine += before[p] * after[p];
    change.push(1 - cosine);
  }
  const z = (values: number[]) => { const mean = values.reduce((a, b) => a + b, 0) / values.length; const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1; return values.map(v => (v - mean) / std); };
  const zLow = z(low), zChange = z(change);
  const scores = Array.from({ length: beatsPerBar }, (_, phase) => {
    let sum = 0, n = 0;
    for (let k = phase; k < beats.length; k += beatsPerBar) { sum += zLow[k] + zChange[k]; n++; }
    return sum / Math.max(1, n);
  });
  const order = scores.map((score, phase) => ({ score, phase })).sort((a, b) => b.score - a.score);
  return { phase: order[0].phase, confidence: clamp01((order[0].score - order[1].score) / 0.6) };
}

function estimateKey(chroma: Float32Array, count: number): MusicFeatures['key'] {
  const total = new Float64Array(12);
  for (let t = 0; t < count; t++) for (let p = 0; p < 12; p++) total[p] += chroma[t * 12 + p];
  if (total.every(v => v <= 1e-9)) return null;
  const ranked: { tonic: number; mode: 'major' | 'minor'; correlation: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) for (const mode of ['major', 'minor'] as const) {
    const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
    const rotated = Array.from({ length: 12 }, (_, p) => profile[(p - tonic + 12) % 12]);
    ranked.push({ tonic, mode, correlation: pearson(total, rotated) });
  }
  ranked.sort((a, b) => b.correlation - a.correlation);
  const [best, second] = ranked, loudest = Math.max(...total);
  // Relative note strengths (loudest 1), so a caller can check which of two candidate scales is sounding.
  const profile = Array.from(total, value => Math.round(value / loudest * 100) / 100);
  return { ...best, confidence: clamp01((best.correlation - 0.4) / 0.4) * clamp01((best.correlation - second.correlation) / 0.1), profile, ranked: ranked.slice(0, 4), all: ranked };
}

/**
 * How the caller's expected key or mode fits the measured note strengths: the share of
 * chroma on its seven notes beside the estimate's share, its weak scale notes and strong
 * notes outside it, and (major/minor only) its rank among the 24 profile keys. It never
 * replaces the estimate.
 */
function keyHintFit(key: NonNullable<MusicFeatures['key']>, hinted: { tonic: number; mode: ScaleMode }) {
  const sum = key.profile.reduce((a, b) => a + b, 0), share = (notes: number[]) => Math.round(notes.reduce((a, p) => a + key.profile[p], 0) / sum * 1000) / 1000;
  const notes = scaleNotes(hinted.tonic, hinted.mode), estimate = scaleNotes(key.tonic, key.mode);
  const rank = hinted.mode === 'major' || hinted.mode === 'minor' ? key.all.findIndex(k => k.tonic === hinted.tonic && k.mode === hinted.mode) : -1;
  return {
    label: `${PITCH_NAMES[hinted.tonic]} ${hinted.mode}`, scale: notes.map(p => PITCH_NAMES[p]),
    correlation: rank >= 0 ? key.all[rank].correlation : null, rank: rank >= 0 ? rank + 1 : null, ofKeys: key.all.length,
    matchesEstimate: rank === 0, sameNotesAsEstimate: notes.every(p => estimate.includes(p)),
    inScaleShare: share(notes), estimateInScaleShare: share(estimate),
    weakScaleNotes: notes.filter(p => key.profile[p] < 0.25).map(p => PITCH_NAMES[p]),
    strongOutsideNotes: key.profile.flatMap((strength, p) => !notes.includes(p) && strength >= 0.5 ? [PITCH_NAMES[p]] : [])
  };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** Agent/UI view of the cached features, with beat and bar lists bounded to an interval. */
/** Parses "A minor", "Am", "F# major", "E dorian" or "Bb" (major when no mode is given). */
export function parseKey(label: string): { tonic: number; mode: ScaleMode } | null {
  const match = /^\s*([A-Ga-g])\s*([#b♯♭]?)\s*(major|minor|maj|min|m|ionian|dorian|phrygian|lydian|mixolydian|aeolian|locrian)?\s*$/i.exec(label);
  if (!match) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase() as 'C'];
  const accidental = match[2] === '#' || match[2] === '♯' ? 1 : match[2] === 'b' || match[2] === '♭' ? -1 : 0;
  const word = match[3]?.toLowerCase() ?? '';
  const mode: ScaleMode = (MODES as readonly string[]).includes(word) ? word as ScaleMode : match[3] && /^(minor|min|m)$/i.test(match[3]) && match[3] !== 'M' ? 'minor' : 'major';
  return { tonic: (base + accidental + 12) % 12, mode };
}

export function musicalSummary(features: MusicFeatures, startSeconds = 0, endSeconds = features.duration, keyHint?: string): MusicalAnalysis {
  const beats: number[] = [], bars: { number: number; seconds: number }[] = [];
  let truncated = false;
  features.beats.forEach((seconds, index) => {
    if (seconds < startSeconds || seconds >= endSeconds) return;
    if (beats.length < 512) beats.push(seconds); else truncated = true;
    if ((index - features.downbeatPhase) % features.beatsPerBar === 0) {
      const number = Math.floor((index - features.downbeatPhase) / features.beatsPerBar) + 1;
      if (number >= 1) { if (bars.length < 256) bars.push({ number, seconds }); else truncated = true; }
    }
  });
  const key = features.key, hinted = keyHint === undefined ? null : parseKey(keyHint);
  if (keyHint !== undefined && !hinted) throw new Error('keyHint must name a key or mode such as "A minor", "Am", "F# major" or "E dorian".');
  const tempoHint = features.tempoHint;
  return {
    version: MUSIC_ANALYSIS_VERSION,
    tempo: features.tempo ? { bpm: features.tempo.bpm, confidence: features.tempo.confidence, steady: features.tempo.steady, beatResidualMs: features.tempo.residualMs, ...(tempoHint ? { hint: tempoHint, hintDeviationPercent: (features.tempo.bpm / tempoHint - 1) * 100 } : {}) } : null,
    meter: { beatsPerBar: features.beatsPerBar, assumed: true, downbeatConfidence: features.downbeatConfidence },
    key: key ? { label: keyLabel(key.tonic, key.mode), tonic: PITCH_NAMES[key.tonic], mode: key.mode, correlation: key.correlation, confidence: key.confidence, alternatives: key.ranked.slice(1).map(k => ({ label: keyLabel(k.tonic, k.mode), correlation: k.correlation })), scale: scaleNotes(key.tonic, key.mode).map(p => PITCH_NAMES[p]), sameNotes: sameNoteModes(key.tonic, key.mode), pitchClasses: key.profile.map((strength, p) => ({ note: PITCH_NAMES[p], strength })), ...(hinted ? { hint: keyHintFit(key, hinted) } : {}) } : null,
    loudness: { integratedLufs: features.loudness.integratedLufs, samplePeakDbfs: features.loudness.samplePeak > 0 ? 20 * Math.log10(features.loudness.samplePeak) : null },
    beats, bars, truncated,
    note: 'Whole-file estimates from a mono analysis signal: tempo from onset autocorrelation and dynamic-programming beat tracking (it may read at half or double the felt tempo); bars assume 4 beats with a statistically estimated downbeat; key from Krumhansl-Kessler profile correlation with summed chroma (no tuning correction; relative major/minor is often ambiguous; only major and minor are scored, so a modal piece reads as a key sharing its notes, listed in sameNotes; pitchClasses gives the relative strength of each note, and a keyHint key or mode is checked against them note by note); loudness is ITU-R BS.1770 gated integrated loudness and sample (not true) peak. Beat and bar lists cover only the requested interval. Confidence values are heuristics, not probabilities, and none of this is listening evidence.'
  };
}
