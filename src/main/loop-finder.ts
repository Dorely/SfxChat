import { BAND_COUNT, beatFrame, chromaMean, keyLabel, musicalSummary, type MusicFeatures } from './music-analysis';
import { yieldWork, type FrameSource } from './dsp';
import { loopCrossfadeSource, loopSample } from './audio';
import type { Asset, LoopCandidate, LoopSearchInput, LoopSearchResult, LoopSeamInput } from '../shared/types';

/**
 * Ranks loop points by asking: if playback jumped from the loop end back to its
 * start, how much would the music around the jump resemble the music around the
 * start? Music mode compares beat-synchronous harmony, timbre and level over a
 * two-bar context on each side and only proposes whole bars; texture mode uses
 * 100 ms units without a grid. A music loop's length is then re-measured as the
 * source's own repeat spacing (rhythm correlation within about half a beat of the
 * grid length), because tracked beats drift, and survivors are aligned to the
 * sample by waveform correlation. Scores rank candidates; they are not listening
 * judgments.
 */
const TEXTURE_UNIT_SECONDS = 0.1;
const TEXTURE_STEP_UNITS = 5;
const TEXTURE_SMOOTH_UNITS = 3;
const MIN_TEMPO_CONFIDENCE = 0.3;
const MAX_CANDIDATES = 12;
/** Repeat-spacing search: ± this fraction of a beat around the grid length, over ± this many bars of context. */
const SPACING_SEARCH_BEATS = 0.6;
const SPACING_CONTEXT_BARS = 2;
const SPACING_STEP_FRAMES = 0.25;

interface Units {
  /** Unit boundary times in seconds; unit u spans [times[u], times[u+1]). */
  times: number[];
  chroma: Float64Array[] | null; bands: Float64Array[]; level: number[];
}

function buildUnits(f: MusicFeatures, times: number[], withChroma: boolean): Units {
  const chroma: Float64Array[] = [], bands: Float64Array[] = [], level: number[] = [];
  for (let u = 0; u + 1 < times.length; u++) {
    const from = beatFrame(f, times[u]), to = Math.max(from + 1, beatFrame(f, times[u + 1]));
    if (withChroma) chroma.push(chromaMean(f, from, to));
    const band = new Float64Array(BAND_COUNT);
    let energy = 0;
    for (let t = from; t < to; t++) {
      for (let b = 0; b < BAND_COUNT; b++) band[b] += Math.max(-90, f.bands[t * BAND_COUNT + b]);
      energy += 10 ** (f.rmsDb[t] / 10);
    }
    for (let b = 0; b < BAND_COUNT; b++) band[b] /= to - from;
    bands.push(band); level.push(10 * Math.log10(energy / (to - from) + 1e-12));
  }
  return { times, chroma: withChroma ? chroma : null, bands, level };
}

/** Centered moving average so texture comparisons follow its statistics, not single events. */
function smoothUnits(units: Units, radius: number): Units {
  const n = units.bands.length, bands: Float64Array[] = [], level: number[] = [];
  for (let u = 0; u < n; u++) {
    const from = Math.max(0, u - radius), to = Math.min(n, u + radius + 1), band = new Float64Array(BAND_COUNT);
    let energy = 0;
    for (let v = from; v < to; v++) { for (let b = 0; b < BAND_COUNT; b++) band[b] += units.bands[v][b]; energy += 10 ** (units.level[v] / 10); }
    for (let b = 0; b < BAND_COUNT; b++) band[b] /= to - from;
    bands.push(band); level.push(10 * Math.log10(energy / (to - from) + 1e-12));
  }
  return { ...units, bands, level };
}

function similarity(units: Units, a: number, b: number) {
  let timbre = 0;
  const x = units.bands[a], y = units.bands[b];
  for (let i = 0; i < BAND_COUNT; i++) timbre += Math.abs(x[i] - y[i]);
  timbre = Math.exp(-(timbre / BAND_COUNT) / 6);
  const level = Math.exp(-Math.abs(units.level[a] - units.level[b]) / 3);
  let harmony: number | null = null;
  if (units.chroma) { harmony = 0; const p = units.chroma[a], q = units.chroma[b]; for (let i = 0; i < 12; i++) harmony += p[i] * q[i]; }
  const value = harmony === null ? 0.65 * timbre + 0.35 * level : 0.45 * harmony + 0.35 * timbre + 0.2 * level;
  return { value, harmony, timbre, level };
}

interface Pair { i: number; j: number; score: number; harmony: number | null; timbre: number; level: number; context: number }

function scorePair(units: Units, i: number, j: number, near: number, far: number): Pair | null {
  const count = units.bands.length;
  let total = 0, weights = 0, harmony = 0, timbre = 0, level = 0, used = 0;
  for (let k = -far; k < far; k++) {
    const a = i + k, b = j + k;
    if (a < 0 || b < 0 || a >= count || b >= count) continue;
    const w = k >= -near && k < near ? 1 : 0.5, s = similarity(units, a, b);
    total += w * s.value; weights += w; harmony += w * (s.harmony ?? 0); timbre += w * s.timbre; level += w * s.level; used++;
  }
  if (weights < 3) return null;
  // Shrink toward a neutral prior so one-sided context (file edges) cannot look perfect.
  return { i, j, score: (total + 0.5) / (weights + 1), harmony: units.chroma ? harmony / weights : null, timbre: timbre / weights, level: level / weights, context: used };
}

/**
 * Pearson correlation of the onset envelope around `startSeconds` with the envelope
 * `lagSeconds` later, over ±SPACING_CONTEXT_BARS bars (linear interpolation between
 * STFT frames). Null when too little context fits the file.
 */
function rhythmCorrelation(f: MusicFeatures, startSeconds: number, lagSeconds: number, contextSeconds: number): number | null {
  const lag = lagSeconds * f.frameRate, from = Math.max(0, Math.round((startSeconds - contextSeconds) * f.frameRate));
  const to = Math.min(Math.round((startSeconds + contextSeconds) * f.frameRate), Math.floor(f.count - 2 - lag));
  if (to - from < 2 * f.frameRate) return null;
  const whole = Math.floor(lag), frac = lag - whole;
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let t = from; t < to; t++) {
    const x = f.onset[t], y = f.onset[t + whole] * (1 - frac) + f.onset[t + whole + 1] * frac;
    sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; n++;
  }
  const den = (n * saa - sa * sa) * (n * sbb - sb * sb);
  return den > 1e-20 ? (n * sab - sa * sb) / Math.sqrt(den) : 0;
}

/**
 * The source's repeat spacing near a grid loop length: the lag within
 * ±SPACING_SEARCH_BEATS beats whose rhythm best matches the context around the
 * start. Keeps the grid length unless the measured spacing clearly fits better.
 */
function repeatSpacing(f: MusicFeatures, startSeconds: number, gridLength: number, maxLength: number) {
  const beat = f.tempo ? 60 / f.tempo.bpm : 0.5, context = SPACING_CONTEXT_BARS * f.beatsPerBar * beat;
  const grid = rhythmCorrelation(f, startSeconds, gridLength, context);
  let best = { length: gridLength, correlation: grid };
  if (grid === null) return { ...best, grid };
  const step = SPACING_STEP_FRAMES / f.frameRate;
  for (let length = gridLength - SPACING_SEARCH_BEATS * beat; length <= Math.min(maxLength, gridLength + SPACING_SEARCH_BEATS * beat); length += step) {
    const correlation = rhythmCorrelation(f, startSeconds, length, context);
    if (correlation !== null && correlation > (best.correlation ?? -1)) best = { length, correlation };
  }
  // A marginal gain is noise; keep the bar-grid length then.
  return best.correlation! >= 0.2 && best.correlation! >= grid + 0.03 ? { ...best, grid } : { length: gridLength, correlation: grid, grid };
}

function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; }

/** A coarse candidate before sample alignment: source times plus its context similarity. */
interface Seed {
  start: number; end: number; score: number; harmony: number | null; timbre: number; level: number; context: number;
  /** Beat indices nearest the start and end, for bar reporting (music mode). */
  beats: { i: number; j: number } | null;
  origin: 'grid' | 'repeat' | 'texture';
}

/** Penalizes seams inside fades (loop edges should sit near the track's typical level) and slightly favors longer loops. */
function adjustForLevel(pairs: Pair[], units: Units, edge: number, minSeconds: number) {
  const typical = median(units.level);
  const meanLevel = (from: number, to: number) => { const values = units.level.slice(Math.max(0, from), Math.max(from + 1, to)); return values.reduce((a, b) => a + b, 0) / values.length; };
  for (const pair of pairs) {
    const tail = meanLevel(pair.j - edge, pair.j), head = meanLevel(pair.i, pair.i + edge);
    pair.score -= Math.min(0.1, Math.max(0, typical - 6 - tail) * 0.01) + Math.min(0.1, Math.max(0, typical - 6 - head) * 0.01);
    pair.score += Math.min(0.04, 0.015 * Math.log2(Math.max(1, (units.times[pair.j] - units.times[pair.i]) / minSeconds)));
  }
}

/**
 * Compares every coarse start with every later coarse end on fixed-length units,
 * then refines the strongest pairs to single units. `accept` filters lengths.
 */
async function searchUnits(units: Units, options: { first: number; last: number; fixedUnits: number | null; allowIntro: boolean; near: number; far: number; keep: number; accept: (i: number, j: number) => boolean }): Promise<Pair[]> {
  const { first, last, fixedUnits, near, far, accept } = options, pairs: Pair[] = [];
  const starts = options.allowIntro ? Array.from({ length: Math.max(0, Math.floor((last - first) / TEXTURE_STEP_UNITS) + 1) }, (_, n) => first + n * TEXTURE_STEP_UNITS) : [first];
  for (const [index, i] of starts.entries()) {
    if (index % 8 === 0) await yieldWork();
    const ends = fixedUnits !== null ? [i + fixedUnits] : Array.from({ length: Math.max(0, Math.floor((last - i) / TEXTURE_STEP_UNITS)) }, (_, n) => i + (n + 1) * TEXTURE_STEP_UNITS);
    for (const j of ends) {
      if (j > last || !accept(i, j)) continue;
      const pair = scorePair(units, i, j, near, far);
      if (pair) pairs.push(pair);
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const refined: Pair[] = [], reach = options.allowIntro ? 2 : 0;
  for (const pair of pairs.slice(0, options.keep)) {
    let best = pair;
    for (let di = -reach; di <= reach; di++) for (let dj = -2; dj <= 2; dj++) {
      if (fixedUnits !== null && dj !== di) continue;
      const i = pair.i + di, j = pair.j + dj;
      if (i < first || j > last || !accept(i, j)) continue;
      const candidate = scorePair(units, i, j, near, far);
      if (candidate && candidate.score > best.score) best = candidate;
    }
    refined.push(best);
  }
  return refined;
}

/** Keeps the best seeds, skipping near-duplicates (same start and end, or the same length nearby). */
function distinct(seeds: Seed[], limit: number, tolerance: number) {
  const chosen: Seed[] = [];
  for (const seed of [...seeds].sort((a, b) => b.score - a.score)) {
    if (chosen.length >= limit) break;
    if (chosen.some(c => (Math.abs(c.start - seed.start) < tolerance && Math.abs(c.end - seed.end) < tolerance) || (Math.abs((c.end - c.start) - (seed.end - seed.start)) < 0.05 && Math.abs(c.start - seed.start) <= 2 * tolerance))) continue;
    chosen.push(seed);
  }
  return chosen;
}

/** Index of the tracked beat nearest `seconds`. */
function nearestBeat(beats: Float64Array, seconds: number) {
  let lo = 0, hi = beats.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (beats[mid] < seconds) lo = mid + 1; else hi = mid; }
  return lo > 0 && Math.abs(beats[lo - 1] - seconds) <= Math.abs(beats[lo] - seconds) ? lo - 1 : lo;
}

export async function findLoopPoints(source: FrameSource, f: MusicFeatures, asset: Pick<Asset, 'id' | 'hash'>, input: LoopSearchInput): Promise<LoopSearchResult> {
  const regionStart = Math.max(0, input.startSeconds ?? 0), regionEnd = Math.min(f.duration, input.endSeconds ?? f.duration);
  if (!(regionEnd > regionStart)) throw new Error(`Choose a search region within 0–${f.duration.toFixed(3)} seconds.`);
  const count = Math.min(MAX_CANDIDATES, input.count ?? 5);
  const musical = Boolean(f.tempo && f.tempo.confidence >= MIN_TEMPO_CONFIDENCE && f.beats.length >= 16);
  if (input.mode === 'music' && !musical) throw new Error('No steady beat grid was found for music mode. Use texture mode, or a region with a clearer pulse.');
  const mode: 'music' | 'texture' = input.mode === 'texture' || (input.mode !== 'music' && !musical) ? 'texture' : 'music';
  const fixed = input.lengthSeconds;
  if (fixed !== undefined && [input.minSeconds, input.maxSeconds, input.minBars, input.maxBars, input.barMultiple].some(v => v !== undefined)) throw new Error('lengthSeconds sets the exact loop length; omit the length limits and barMultiple with it.');
  if (fixed !== undefined && fixed > regionEnd - regionStart) throw new Error(`lengthSeconds is longer than the ${(regionEnd - regionStart).toFixed(3)} s search region.`);
  if (mode === 'texture' && input.barMultiple !== undefined) throw new Error('barMultiple needs music mode; texture loops have no bars.');
  const minSeconds = input.minSeconds ?? (mode === 'music' ? 4 : 3), maxSeconds = input.maxSeconds ?? Infinity;
  const bpb = f.beatsPerBar, beat = f.tempo ? 60 / f.tempo.bpm : 0.5, barSeconds = bpb * beat;
  const multiple = input.barMultiple ?? 1;
  const minBars = Math.max(1, input.minBars ?? (input.minSeconds === undefined ? 4 : 1)), maxBars = input.maxBars ?? Infinity;
  const allowIntro = input.allowIntro !== false;
  const unitTimes = () => { const times: number[] = []; for (let t = 0; t <= f.duration + 1e-9; t += TEXTURE_UNIT_SECONDS) times.push(Math.min(t, f.duration)); return times; };
  const first = Math.ceil(regionStart / TEXTURE_UNIT_SECONDS - 1e-9), last = Math.floor(regionEnd / TEXTURE_UNIT_SECONDS + 1e-9);
  const fixedUnits = fixed === undefined ? null : Math.round(fixed / TEXTURE_UNIT_SECONDS);
  const toSeeds = (pairs: Pair[], units: Units, origin: Seed['origin']): Seed[] => pairs.map(p => {
    const start = units.times[p.i], end = units.times[p.j];
    const beats = origin === 'grid' ? { i: p.i, j: p.j } : mode === 'music' ? { i: nearestBeat(f.beats, start), j: nearestBeat(f.beats, end) } : null;
    return { start, end, score: p.score, harmony: p.harmony, timbre: p.timbre, level: p.level, context: p.context, beats, origin };
  });
  let seeds: Seed[];
  if (mode === 'music') {
    // Candidates on the bar grid.
    const units = buildUnits(f, Array.from(f.beats), true), near = bpb, far = 2 * bpb, pairs: Pair[] = [];
    const phaseKnown = f.downbeatConfidence >= 0.15;
    const eligible = units.times.map((t, i) => i).filter(i => units.times[i] >= regionStart - 1e-6 && units.times[i] <= regionEnd + 1e-6);
    const starts = eligible.filter(i => !phaseKnown || ((i - f.downbeatPhase) % bpb + bpb) % bpb === 0);
    for (const [index, i] of (allowIntro ? starts : starts.slice(0, 1)).entries()) {
      if (index % 16 === 0) await yieldWork();
      if (fixed !== undefined) {
        // The exact length comes from the caller; score the beat nearest the end.
        const target = units.times[i] + fixed;
        if (target > regionEnd + 1e-6) break;
        const pair = scorePair(units, i, Math.max(i + 1, nearestBeat(f.beats, target)), near, far);
        if (pair) pairs.push(pair);
        continue;
      }
      for (let bars = Math.ceil(minBars / multiple) * multiple; i + bars * bpb < units.times.length && bars <= maxBars; bars += multiple) {
        const j = i + bars * bpb, length = units.times[j] - units.times[i];
        if (units.times[j] > regionEnd + 1e-6) break;
        if (length < minSeconds || length > maxSeconds) continue;
        const pair = scorePair(units, i, j, near, far);
        if (!pair) continue;
        pair.score += [4, 8, 16, 32].includes(bars) ? 0.02 : [2, 12, 24].includes(bars) ? 0.01 : 0;
        pairs.push(pair);
      }
    }
    adjustForLevel(pairs, units, bpb, minSeconds);
    // Grid-free repeats: compare the track with itself on 100 ms units, so a
    // misread tempo or drifting beat grid cannot hide where the music repeats.
    const repeatUnits = buildUnits(f, unitTimes(), true), spanUnits = Math.round(SPACING_CONTEXT_BARS * barSeconds / TEXTURE_UNIT_SECONDS);
    const repeats = await searchUnits(repeatUnits, {
      first, last, fixedUnits, allowIntro, near: Math.max(5, Math.round(spanUnits / 2)), far: Math.max(10, spanUnits), keep: count * 8,
      accept: (i, j) => {
        if (fixed !== undefined) return true;
        const length = (j - i) * TEXTURE_UNIT_SECONDS, bars = length / barSeconds;
        if (length < minSeconds || length > maxSeconds || bars < minBars - 0.5 || bars > maxBars + 0.5) return false;
        return multiple === 1 || (Math.round(bars / multiple) > 0 && Math.abs(bars - Math.round(bars / multiple) * multiple) <= 0.25);
      }
    });
    adjustForLevel(repeats, repeatUnits, spanUnits, minSeconds);
    seeds = [...distinct(toSeeds(pairs, units, 'grid'), count, beat), ...distinct(toSeeds(repeats, repeatUnits, 'repeat'), count, beat)];
  } else {
    const units = smoothUnits(buildUnits(f, unitTimes(), false), TEXTURE_SMOOTH_UNITS), minUnits = Math.ceil(minSeconds / TEXTURE_UNIT_SECONDS);
    const pairs = await searchUnits(units, { first, last, fixedUnits, allowIntro, near: 3, far: 10, keep: count * 8, accept: (i, j) => fixedUnits !== null || ((j - i) >= minUnits && (j - i) * TEXTURE_UNIT_SECONDS <= maxSeconds) });
    adjustForLevel(pairs, units, 10, minSeconds);
    seeds = distinct(toSeeds(pairs, units, 'texture'), count * 2, 1);
  }
  if (!seeds.length) throw new Error('No loop candidates fit the requested length and region. Widen the region or relax the length limits.');
  const candidates: LoopCandidate[] = [];
  for (const seed of seeds) {
    await yieldWork();
    let plan: LengthPlan;
    if (fixed !== undefined) plan = { endSeconds: seed.start + fixed, source: 'requested', rhythm: mode === 'music' ? rhythmCorrelation(f, seed.start, fixed, SPACING_CONTEXT_BARS * barSeconds) : null };
    else if (mode === 'music') {
      const spacing = repeatSpacing(f, seed.start, seed.end - seed.start, Math.min(regionEnd, f.duration) - seed.start);
      plan = { endSeconds: seed.start + spacing.length, source: seed.origin === 'grid' && spacing.length === seed.end - seed.start ? 'beat-grid' : 'repeat-spacing', rhythm: spacing.correlation };
    } else plan = { endSeconds: seed.end, source: 'texture-units', rhythm: null };
    candidates.push(await refine(source, f, seed, mode, regionStart, regionEnd, plan));
  }
  candidates.sort((a, b) => rankValue(b, mode) - rankValue(a, mode));
  const top = distinctCandidates(candidates, count, mode === 'music' ? beat : 1).map((c, index) => ({ ...c, rank: index + 1 }));
  const summary = musicalSummary(f);
  return {
    version: 1, assetId: asset.id, sourceHash: asset.hash, mode, sampleRate: source.sampleRate, duration: f.duration,
    tempo: summary.tempo, key: f.key ? keyLabel(f.key.tonic, f.key.mode) : null, beatsPerBar: mode === 'music' ? bpb : null,
    candidates: top,
    note: `${mode === 'music' ? `Music mode: candidates come from bars of an estimated ${summary.tempo?.bpm.toFixed(1)} BPM grid (4 beats per bar assumed${f.downbeatConfidence < 0.15 ? '; downbeat uncertain, so bar numbers may be offset' : ''}) and from a grid-free comparison of the track with itself, so a misread tempo cannot hide a real repeat. Each length is re-measured as the source's repeat spacing within ±${SPACING_SEARCH_BEATS} beat (lengthSource, rhythmCorrelation) unless lengthSeconds fixes it; bars for grid-free candidates are approximate.` : 'Texture mode: no reliable beat grid, so candidates use 100 ms units and texture/level continuity only.'} startSeconds/endSeconds/frames are final: startShiftFrames/endShiftFrames report adjustments already applied, so pass the times to trim_asset unchanged. score compares harmony/timbre/level around the jump with the music around the loop start; seam values come from sample-level waveform alignment (correlation of matching context windows, wrap step vs the source's own step). Frames are exact; ranking is heuristic. Audition the seam (audio_listen loopSeam, or Play seam in the editor) and let the user decide. Save with trim_asset loop:true and the recommended crossfadeMs.`
  };
}

/** Grid and grid-free searches can converge on the same loop; keep the better-ranked one. */
function distinctCandidates(candidates: LoopCandidate[], limit: number, tolerance: number) {
  const chosen: LoopCandidate[] = [];
  for (const c of candidates) {
    if (chosen.length >= limit) break;
    if (!chosen.some(k => Math.abs(k.startSeconds - c.startSeconds) < tolerance && Math.abs(k.endSeconds - c.endSeconds) < tolerance)) chosen.push(c);
  }
  return chosen;
}

// Noise-like textures never correlate sample-for-sample, so texture ranking and
// labels lean on spectral context and level; the long crossfade hides the waveform.
// Music ranking adds rhythm agreement one loop length later, the strongest sign of a true repeat.
const rankValue = (c: LoopCandidate, mode: 'music' | 'texture') => mode === 'music'
  ? (c.rhythmCorrelation === null ? 0.75 * c.score : 0.55 * c.score + 0.2 * Math.max(0, c.rhythmCorrelation)) + 0.25 * Math.max(0, c.seam.correlation)
  : 0.9 * c.score + 0.1 * Math.max(0, c.seam.correlation) - 0.02 * Math.abs(c.seam.levelDeltaDb);

interface LengthPlan { endSeconds: number; source: LoopCandidate['lengthSource']; rhythm: number | null }

async function refine(source: FrameSource, f: MusicFeatures, pair: Seed, mode: 'music' | 'texture', regionStart: number, regionEnd: number, plan: LengthPlan): Promise<LoopCandidate> {
  const rate = source.sampleRate, total = source.frames;
  const window = Math.round(rate * (mode === 'music' ? 0.05 : 0.2)), radius = Math.round(rate * (mode === 'music' ? 0.03 : 0.06)), zero = Math.round(rate * 0.001);
  let start = Math.round(pair.start * rate), end = Math.round(plan.endSeconds * rate);
  const plannedStart = start, plannedEnd = end;
  const minFrame = Math.round(regionStart * rate), maxFrame = Math.round(regionEnd * rate);
  const read = async (center: number, half: number) => {
    const from = Math.max(0, center - half), to = Math.min(total, center + half);
    const channels = await source.read(from, to);
    const mono = new Float32Array(to - from);
    for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    return { from, to, mono, channels: channels.map(c => Float32Array.from(c)) };
  };
  const span = window + radius + zero + 2;
  const head = await read(start, span), tail = await read(end, span);
  const segment = (w: typeof head, from: number, to: number) => w.mono.subarray(from - w.from, to - w.from);
  const usable = (w: typeof head, from: number, to: number) => from >= w.from && to <= w.to;
  // Pearson correlation of the windows either side of the start against those either
  // side of the shifted end, accumulated without copying.
  const matchScore = (shift: number) => {
    const e = end + shift;
    let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    const add = (a: Float32Array, b: Float32Array) => {
      for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; }
      n += a.length;
    };
    if (usable(head, start - window, start) && usable(tail, e - window, e)) add(segment(head, start - window, start), segment(tail, e - window, e));
    if (usable(head, start, start + window) && usable(tail, e, e + window)) add(segment(head, start, start + window), segment(tail, e, e + window));
    if (!n) return null;
    const den = (n * saa - sa * sa) * (n * sbb - sb * sb);
    return den > 1e-20 ? (n * sab - sa * sb) / Math.sqrt(den) : 0;
  };
  // Align the end to the start: the planned end is only accurate to ~one STFT hop.
  // A requested length is kept exactly.
  let bestShift = 0, best = matchScore(0) ?? 0;
  const coarse = Math.max(1, Math.round(rate / 4000)), searchRadius = plan.source === 'requested' ? 0 : radius;
  for (let shift = -searchRadius; shift <= searchRadius; shift += coarse) {
    const score = matchScore(shift);
    if (score !== null && score > best && end + shift - start > 0) { best = score; bestShift = shift; }
  }
  for (let shift = bestShift - coarse; searchRadius && shift <= bestShift + coarse; shift++) {
    const score = matchScore(shift);
    if (score !== null && score > best) { best = score; bestShift = shift; }
  }
  end += bestShift;
  // Slide both points together (length preserved) so the sample played after the
  // wrap best matches the one the source itself would have played next.
  let bestSlide = 0, bestStep = Infinity;
  for (let slide = -zero; slide <= zero; slide++) {
    const s = start + slide, e = end + slide;
    if (s < Math.max(minFrame, head.from) || e > maxFrame || e >= tail.to || e - 1 < tail.from) continue;
    let step = 0;
    for (let c = 0; c < head.channels.length; c++) step += Math.abs(head.channels[c][s - head.from] - tail.channels[c][e - tail.from]);
    if (step < bestStep) { bestStep = step; bestSlide = slide; }
  }
  start += bestSlide; end += bestSlide;
  start = Math.max(minFrame, Math.min(start, total - 1)); end = Math.max(start + 1, Math.min(end, maxFrame, total));
  const wrapStep = Math.max(...head.channels.map((c, i) => Math.abs(c[start - head.from] - tail.channels[i][end - 1 - tail.from])));
  const naturalStep = end < tail.to ? Math.max(...tail.channels.map(c => Math.abs(c[end - tail.from] - c[end - 1 - tail.from]))) : Math.max(...head.channels.map(c => start - 1 >= head.from ? Math.abs(c[start - head.from] - c[start - 1 - head.from]) : 0));
  const levelAround = (seconds: number, before: boolean) => {
    const from = beatFrame(f, before ? seconds - 0.5 : seconds), to = Math.max(from + 1, beatFrame(f, before ? seconds : seconds + 0.5));
    let energy = 0; for (let t = from; t < to; t++) energy += 10 ** (f.rmsDb[t] / 10);
    return 10 * Math.log10(energy / (to - from) + 1e-12);
  };
  const startSeconds = start / rate, endSeconds = end / rate, lengthSeconds = endSeconds - startSeconds;
  // Compare like with like: the half-second before the end with the one before the
  // start, and (when the source continues) the half-second after each.
  const deltas: number[] = [];
  if (startSeconds >= 0.5) deltas.push(levelAround(endSeconds, true) - levelAround(startSeconds, true));
  if (endSeconds + 0.5 <= f.duration) deltas.push(levelAround(endSeconds, false) - levelAround(startSeconds, false));
  const levelDeltaDb = deltas.length ? deltas.reduce((x, y) => x + y, 0) / deltas.length : levelAround(endSeconds, true) - levelAround(startSeconds, false);
  const correlation = best;
  const crossfade = mode === 'music'
    ? (correlation >= 0.9 ? 5 : correlation >= 0.75 ? 10 : correlation >= 0.5 ? 30 : 60)
    : (correlation >= 0.8 ? 50 : correlation >= 0.5 ? 200 : 500);
  const recommendedCrossfadeMs = Math.max(0, Math.min(crossfade, Math.floor(lengthSeconds * 250)));
  const match = mode === 'music'
    // Context similarity, or rhythm plus harmony agreeing one loop length later (steady drums
    // alone correlate everywhere), with waveform continuity at the seam.
    ? ((pair.score >= 0.85 || ((plan.rhythm ?? 0) >= 0.8 && (pair.harmony ?? 0) >= 0.9)) && correlation >= 0.8 ? 'close'
      : (pair.score >= 0.72 || ((plan.rhythm ?? 0) >= 0.6 && (pair.harmony ?? 0) >= 0.8)) && correlation >= 0.4 ? 'partial' : 'weak')
    : (pair.score >= 0.85 && Math.abs(levelDeltaDb) <= 1.5 ? 'close' : pair.score >= 0.72 && Math.abs(levelDeltaDb) <= 3 ? 'partial' : 'weak');
  const bpb = f.beatsPerBar;
  const beatSpan = pair.beats ? (pair.beats.j - pair.beats.i) / bpb : null;
  const bars = beatSpan === null ? null : Math.round(beatSpan * 100) / 100, wholeBars = bars !== null && Number.isInteger(bars);
  const startBar = mode === 'music' && pair.beats && f.downbeatConfidence >= 0.15 ? Math.floor((pair.beats.i - f.downbeatPhase) / bpb) + 1 : null;
  const endBar = startBar !== null && wholeBars ? startBar + bars! : null;
  const impliedBpm = wholeBars ? bars! * bpb * 60 / lengthSeconds : null;
  const intro = startSeconds, outro = f.duration - endSeconds;
  const words = { close: 'close match', partial: 'partial match', weak: 'weak match' }[match];
  const gridLength = pair.origin === 'grid' ? pair.end - pair.start : null, gridDelta = gridLength === null ? 0 : (lengthSeconds - gridLength) * 1000;
  const lengthNote = plan.source === 'requested' ? ', requested length' : plan.source !== 'repeat-spacing' ? '' : gridLength === null ? ', length from where the music repeats' : `, length set by the measured repeat (${gridDelta >= 0 ? '+' : ''}${gridDelta.toFixed(0)} ms vs the beat grid)`;
  const barSpan = startBar !== null && endBar !== null ? `Bars ${startBar}–${endBar - 1}` : startBar !== null ? `From bar ${startBar}` : pair.beats ? `Beats ${pair.beats.i + 1}–${pair.beats.j}` : `${startSeconds.toFixed(2)}–${endSeconds.toFixed(2)} s`;
  const summary = mode === 'music'
    ? `${barSpan} (${wholeBars ? '' : '≈'}${bars} bar${bars === 1 ? '' : 's'}, ${lengthSeconds.toFixed(2)} s${lengthNote})${intro > 0.05 ? ` after a ${intro.toFixed(1)} s intro` : ' from the start'}; seam ${words}.`
    : `${lengthSeconds.toFixed(2)} s texture loop${intro > 0.05 ? ` from ${intro.toFixed(1)} s` : ' from the start'}${lengthNote}; seam ${words}.`;
  return {
    rank: 0, startSeconds, endSeconds, startFrame: start, endFrame: end, lengthSeconds,
    lengthSource: plan.source, gridLengthSeconds: gridLength, rhythmCorrelation: plan.rhythm, impliedBpm,
    bars, startBar, endBar, introSeconds: intro, outroSeconds: Math.max(0, outro),
    score: Math.max(0, Math.min(1, pair.score)), match,
    similarity: { harmony: pair.harmony, timbre: pair.timbre, level: pair.level, contextUnits: pair.context },
    seam: { correlation, step: wrapStep, naturalStep, levelDeltaDb, startShiftFrames: start - plannedStart, endShiftFrames: end - plannedEnd },
    recommendedCrossfadeMs, summary
  };
}

/**
 * Renders exactly what a loop render (trim_asset loop:true) plays across its wrap:
 * the last contextSeconds of the loop, the wrap, then its opening, with the seam
 * crossfade where the render places it.
 */
export async function renderSeam(source: FrameSource, input: LoopSeamInput): Promise<{ channels: Float32Array[]; sampleRate: number; seamFrame: number; crossfadeStartFrame: number; startFrame: number; endFrame: number; crossfadeFrames: number; crossfadeSource: 'before-start' | 'after-end' | null }> {
  const rate = source.sampleRate, total = source.frames;
  const start = Math.round(input.startSeconds * rate), end = Math.round(input.endSeconds * rate);
  if (!(start >= 0 && end > start && end <= total)) throw new Error(`Choose an ordered loop within 0–${(total / rate).toFixed(3)} seconds.`);
  const crossfade = Math.round((input.crossfadeMs ?? 0) * rate / 1000);
  if (crossfade >= end - start) throw new Error('The loop crossfade must be shorter than the loop.');
  const crossfadeSource = loopCrossfadeSource(start, end, total, crossfade);
  const context = Math.max(1, crossfade, Math.min(Math.round((input.contextSeconds ?? 2) * rate), end - start));
  // The loop's last and first `context` frames, plus the crossfade material beside them.
  const read = async (from: number, to: number) => ({ from, to, data: to > from ? await source.read(from, to) : [] });
  const windows = [
    await read(end - context, end), await read(start, start + context),
    await read(crossfadeSource === 'before-start' ? start - crossfade : 0, crossfadeSource === 'before-start' ? start : 0),
    await read(crossfadeSource === 'after-end' ? end : 0, crossfadeSource === 'after-end' ? end + crossfade : 0)
  ];
  const channels = Array.from({ length: source.channels }, (_, c) => {
    const at = (frame: number) => { const w = windows.find(w => frame >= w.from && frame < w.to)!; return w.data[c][frame - w.from]; };
    const out = new Float32Array(2 * context);
    for (let i = 0; i < context; i++) out[i] = loopSample(at, end - start - context + i, start, end, crossfade, crossfadeSource);
    for (let i = 0; i < context; i++) out[context + i] = loopSample(at, i, start, end, crossfade, crossfadeSource);
    return out;
  });
  const crossfadeStartFrame = crossfadeSource === 'before-start' ? context - crossfade : context;
  return { channels, sampleRate: rate, seamFrame: context, crossfadeStartFrame, startFrame: start, endFrame: end, crossfadeFrames: crossfade, crossfadeSource };
}
