import { BAND_COUNT, beatFrame, chromaMean, keyLabel, musicalSummary, type MusicFeatures } from './music-analysis';
import { yieldWork, type FrameSource } from './dsp';
import type { Asset, LoopCandidate, LoopSearchInput, LoopSearchResult, LoopSeamInput } from '../shared/types';

/**
 * Ranks loop points by asking: if playback jumped from the loop end back to its
 * start, how much would the music around the jump resemble the music around the
 * start? Music mode compares beat-synchronous harmony, timbre and level over a
 * two-bar context on each side and only proposes whole bars; texture mode uses
 * 100 ms units without a grid. Survivors are aligned to the sample by waveform
 * correlation. Scores rank candidates; they are not listening judgments.
 */
const TEXTURE_UNIT_SECONDS = 0.1;
const TEXTURE_STEP_UNITS = 5;
const TEXTURE_SMOOTH_UNITS = 3;
const MIN_TEMPO_CONFIDENCE = 0.3;
const MAX_CANDIDATES = 12;

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

function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; }

export async function findLoopPoints(source: FrameSource, f: MusicFeatures, asset: Pick<Asset, 'id' | 'hash'>, input: LoopSearchInput): Promise<LoopSearchResult> {
  const regionStart = Math.max(0, input.startSeconds ?? 0), regionEnd = Math.min(f.duration, input.endSeconds ?? f.duration);
  if (!(regionEnd > regionStart)) throw new Error(`Choose a search region within 0–${f.duration.toFixed(3)} seconds.`);
  const count = Math.min(MAX_CANDIDATES, input.count ?? 5);
  const musical = Boolean(f.tempo && f.tempo.confidence >= MIN_TEMPO_CONFIDENCE && f.beats.length >= 16);
  if (input.mode === 'music' && !musical) throw new Error('No steady beat grid was found for music mode. Use texture mode, or a region with a clearer pulse.');
  const mode: 'music' | 'texture' = input.mode === 'texture' || (input.mode !== 'music' && !musical) ? 'texture' : 'music';
  const minSeconds = input.minSeconds ?? (mode === 'music' ? 4 : 3), maxSeconds = input.maxSeconds ?? Infinity;
  const bpb = f.beatsPerBar, pairs: Pair[] = [];
  let units: Units, near: number, far: number, tolerance: number;
  if (mode === 'music') {
    units = buildUnits(f, Array.from(f.beats), true);
    near = bpb; far = 2 * bpb; tolerance = bpb;
    const phaseKnown = f.downbeatConfidence >= 0.15;
    const minBars = Math.max(1, input.minBars ?? (input.minSeconds === undefined ? 4 : 1)), maxBars = input.maxBars ?? Infinity;
    const eligible = units.times.map((t, i) => i).filter(i => units.times[i] >= regionStart - 1e-6 && units.times[i] <= regionEnd + 1e-6);
    const starts = eligible.filter(i => !phaseKnown || ((i - f.downbeatPhase) % bpb + bpb) % bpb === 0);
    const allowed = input.allowIntro === false ? starts.slice(0, 1) : starts;
    for (const [index, i] of allowed.entries()) {
      if (index % 16 === 0) await yieldWork();
      for (let bars = minBars; i + bars * bpb < units.times.length && bars <= maxBars; bars++) {
        const j = i + bars * bpb, length = units.times[j] - units.times[i];
        if (units.times[j] > regionEnd + 1e-6) break;
        if (length < minSeconds || length > maxSeconds) continue;
        const pair = scorePair(units, i, j, near, far);
        if (!pair) continue;
        pair.score += [4, 8, 16, 32].includes(bars) ? 0.02 : [2, 12, 24].includes(bars) ? 0.01 : 0;
        pairs.push(pair);
      }
    }
  } else {
    const times: number[] = [];
    for (let t = 0; t <= f.duration + 1e-9; t += TEXTURE_UNIT_SECONDS) times.push(Math.min(t, f.duration));
    units = smoothUnits(buildUnits(f, times, false), TEXTURE_SMOOTH_UNITS);
    near = 3; far = 10; tolerance = 10;
    const first = Math.ceil(regionStart / TEXTURE_UNIT_SECONDS), last = Math.floor(regionEnd / TEXTURE_UNIT_SECONDS);
    const minUnits = Math.ceil(minSeconds / TEXTURE_UNIT_SECONDS);
    const starts = input.allowIntro === false ? [first] : Array.from({ length: Math.max(0, Math.floor((last - first) / TEXTURE_STEP_UNITS) + 1) }, (_, n) => first + n * TEXTURE_STEP_UNITS);
    for (const [index, i] of starts.entries()) {
      if (index % 8 === 0) await yieldWork();
      for (let j = i + minUnits; j <= last; j += TEXTURE_STEP_UNITS) {
        if ((j - i) * TEXTURE_UNIT_SECONDS > maxSeconds) break;
        const pair = scorePair(units, i, j, near, far);
        if (pair) pairs.push(pair);
      }
    }
    // Refine the coarse grid to single units around the strongest pairs.
    pairs.sort((a, b) => b.score - a.score);
    const refined: Pair[] = [];
    for (const pair of pairs.slice(0, count * 8)) {
      let best = pair;
      for (let di = input.allowIntro === false ? 0 : -2; di <= (input.allowIntro === false ? 0 : 2); di++) for (let dj = -2; dj <= 2; dj++) {
        const i = pair.i + di, j = pair.j + dj;
        if (i < first || j > last || (j - i) < minUnits || (j - i) * TEXTURE_UNIT_SECONDS > maxSeconds) continue;
        const candidate = scorePair(units, i, j, near, far);
        if (candidate && candidate.score > best.score) best = candidate;
      }
      refined.push(best);
    }
    pairs.length = 0; pairs.push(...refined);
  }
  if (!pairs.length) throw new Error('No loop candidates fit the requested length and region. Widen the region or relax the length limits.');
  // Penalize seams inside fades: the loop edges should sit near the track's typical level.
  const typical = median(units.level), edge = mode === 'music' ? bpb : 10;
  const meanLevel = (from: number, to: number) => { const values = units.level.slice(Math.max(0, from), Math.max(from + 1, to)); return values.reduce((a, b) => a + b, 0) / values.length; };
  for (const pair of pairs) {
    const tail = meanLevel(pair.j - edge, pair.j), head = meanLevel(pair.i, pair.i + edge);
    pair.score -= Math.min(0.1, Math.max(0, typical - 6 - tail) * 0.01) + Math.min(0.1, Math.max(0, typical - 6 - head) * 0.01);
    pair.score += Math.min(0.04, 0.015 * Math.log2(Math.max(1, (units.times[pair.j] - units.times[pair.i]) / minSeconds)));
  }
  pairs.sort((a, b) => b.score - a.score);
  const chosen: Pair[] = [];
  for (const pair of pairs) {
    if (chosen.length >= count * 2) break;
    if (chosen.some(c => (Math.abs(c.i - pair.i) < tolerance && Math.abs(c.j - pair.j) < tolerance) || (c.j - c.i === pair.j - pair.i && Math.abs(c.i - pair.i) <= 2 * tolerance))) continue;
    chosen.push(pair);
  }
  const candidates: LoopCandidate[] = [];
  for (const pair of chosen) {
    await yieldWork();
    candidates.push(await refine(source, f, units, pair, mode, regionStart, regionEnd));
  }
  candidates.sort((a, b) => rankValue(b, mode) - rankValue(a, mode));
  const top = candidates.slice(0, count).map((c, index) => ({ ...c, rank: index + 1 }));
  const summary = musicalSummary(f);
  return {
    version: 1, assetId: asset.id, sourceHash: asset.hash, mode, sampleRate: source.sampleRate, duration: f.duration,
    tempo: summary.tempo, key: f.key ? keyLabel(f.key.tonic, f.key.mode) : null, beatsPerBar: mode === 'music' ? bpb : null,
    candidates: top,
    note: `${mode === 'music' ? `Music mode: whole-bar loops on an estimated ${summary.tempo?.bpm.toFixed(1)} BPM grid (4 beats per bar assumed${f.downbeatConfidence < 0.15 ? '; downbeat uncertain, so bar numbers may be offset' : ''}).` : 'Texture mode: no reliable beat grid, so candidates use 100 ms units and texture/level continuity only.'} score compares harmony/timbre/level around the jump with the music around the loop start; seam values come from sample-level waveform alignment (correlation of matching context windows, wrap step vs the source's own step). Frames are exact; ranking is heuristic. Audition the seam (audio_listen loopSeam, or Play seam in the editor) and let the user decide. Save with trim_asset loop:true and the recommended crossfadeMs.`
  };
}

// Noise-like textures never correlate sample-for-sample, so texture ranking and
// labels lean on spectral context and level; the long crossfade hides the waveform.
const rankValue = (c: LoopCandidate, mode: 'music' | 'texture') => mode === 'music'
  ? 0.75 * c.score + 0.25 * Math.max(0, c.seam.correlation)
  : 0.9 * c.score + 0.1 * Math.max(0, c.seam.correlation) - 0.02 * Math.abs(c.seam.levelDeltaDb);

async function refine(source: FrameSource, f: MusicFeatures, units: Units, pair: Pair, mode: 'music' | 'texture', regionStart: number, regionEnd: number): Promise<LoopCandidate> {
  const rate = source.sampleRate, total = source.frames;
  const window = Math.round(rate * (mode === 'music' ? 0.05 : 0.2)), radius = Math.round(rate * (mode === 'music' ? 0.03 : 0.06)), zero = Math.round(rate * 0.001);
  let start = Math.round(units.times[pair.i] * rate), end = Math.round(units.times[pair.j] * rate);
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
  // Align the end to the start: the beat grid is only accurate to ~one STFT hop.
  let bestShift = 0, best = matchScore(0) ?? 0;
  const coarse = Math.max(1, Math.round(rate / 4000));
  for (let shift = -radius; shift <= radius; shift += coarse) {
    const score = matchScore(shift);
    if (score !== null && score > best && end + shift - start > 0) { best = score; bestShift = shift; }
  }
  for (let shift = bestShift - coarse; shift <= bestShift + coarse; shift++) {
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
    ? (pair.score >= 0.85 && correlation >= 0.8 ? 'close' : pair.score >= 0.72 && correlation >= 0.4 ? 'partial' : 'weak')
    : (pair.score >= 0.85 && Math.abs(levelDeltaDb) <= 1.5 ? 'close' : pair.score >= 0.72 && Math.abs(levelDeltaDb) <= 3 ? 'partial' : 'weak');
  const bpb = f.beatsPerBar;
  const bars = mode === 'music' ? (pair.j - pair.i) / bpb : null;
  const startBar = mode === 'music' && f.downbeatConfidence >= 0.15 ? Math.floor((pair.i - f.downbeatPhase) / bpb) + 1 : null;
  const endBar = startBar !== null && bars !== null ? startBar + bars : null;
  const intro = startSeconds, outro = f.duration - endSeconds;
  const words = { close: 'close match', partial: 'partial match', weak: 'weak match' }[match];
  const summary = mode === 'music'
    ? `${startBar !== null ? `Bars ${startBar}–${endBar! - 1}` : `Beats ${pair.i + 1}–${pair.j}`} (${bars} bar${bars === 1 ? '' : 's'}, ${lengthSeconds.toFixed(1)} s)${intro > 0.05 ? ` after a ${intro.toFixed(1)} s intro` : ' from the start'}; seam ${words}.`
    : `${lengthSeconds.toFixed(1)} s texture loop${intro > 0.05 ? ` from ${intro.toFixed(1)} s` : ' from the start'}; seam ${words}.`;
  return {
    rank: 0, startSeconds, endSeconds, startFrame: start, endFrame: end, lengthSeconds,
    bars, startBar, endBar, introSeconds: intro, outroSeconds: Math.max(0, outro),
    score: Math.max(0, Math.min(1, pair.score)), match,
    similarity: { harmony: pair.harmony, timbre: pair.timbre, level: pair.level, contextUnits: pair.context },
    seam: { correlation, step: wrapStep, naturalStep, levelDeltaDb, alignmentShiftFrames: bestShift + bestSlide },
    recommendedCrossfadeMs, summary
  };
}

/**
 * Renders exactly what a loop render (trim_asset loop:true) plays across its wrap:
 * the last contextSeconds of the loop, the crossfaded seam, then its opening.
 */
export async function renderSeam(source: FrameSource, input: LoopSeamInput): Promise<{ channels: Float32Array[]; sampleRate: number; seamFrame: number; startFrame: number; endFrame: number; crossfadeFrames: number }> {
  const rate = source.sampleRate, total = source.frames;
  const start = Math.round(input.startSeconds * rate), end = Math.round(input.endSeconds * rate);
  if (!(start >= 0 && end > start && end <= total)) throw new Error(`Choose an ordered loop within 0–${(total / rate).toFixed(3)} seconds.`);
  const crossfade = Math.round((input.crossfadeMs ?? 0) * rate / 1000);
  if (crossfade >= end - start) throw new Error('The loop crossfade must be shorter than the loop.');
  const context = Math.max(1, Math.min(Math.round((input.contextSeconds ?? 2) * rate), end - start - crossfade));
  const tail = await source.read(end - context, end), head = await source.read(start, start + context);
  const frames = context - crossfade + context;
  const channels = tail.map((t, c) => {
    const out = new Float32Array(frames), h = head[c];
    out.set(t.subarray(0, context - crossfade));
    for (let i = 0; i < crossfade; i++) { const mix = i / crossfade; out[context - crossfade + i] = h[i] * mix + t[context - crossfade + i] * (1 - mix); }
    out.set(h.subarray(crossfade), context);
    return out;
  });
  return { channels, sampleRate: rate, seamFrame: context - crossfade, startFrame: start, endFrame: end, crossfadeFrames: crossfade };
}
