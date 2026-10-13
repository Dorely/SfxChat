# Local audio engine sources and limitations

Reviewed 2026-10-13. `js-synthesizer` is pinned to **1.13.0**, with its plain
FluidSynth **2.4.6** Emscripten engine (without libsndfile). Read upstream
[js-synthesizer documentation](https://github.com/jet2jet/js-synthesizer) for
initialization, worker/AudioWorklet and Node rendering, and
[fluidsynth-emscripten](https://github.com/jet2jet/fluidsynth-emscripten) for build
requirements and LGPL terms. Exact revisions, runtime/source SHA-256 hashes,
archives, licenses and rebuild directions are in
[wasm-synthesis](../../third-party/wasm-synthesis/README.md). No upstream sources
were modified. Legacy assets retain their separate native FluidSynth 2.6.1 path.

Read the [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/), normalized
biquad and low-pass equations. The filter effect uses those coefficients. The EQ
adds/subtracts a scaled low-pass component; it is not a full parametric equalizer.
Read John Chowning, *The Synthesis of Complex Audio Spectra by Means of Frequency
Modulation*, JAES 21(7), 1973, pp. 526–534, equations and ratio/index/dynamic spectra
discussion in the [original paper mirror](https://charlesames.net/pdf/JohnChowning/frequency-modulation.pdf)
(digital 2007 version, opening three PDF pages). The instrument uses a sine carrier,
integrated modulator phase, exponentially decaying index and amplitude envelope.
It does not implement all paper examples or guarantee alias-free FM.

Custom algorithms are original implementation choices: polynomial discontinuity
correction on saw/square oscillators; one-pole instrument filtering; linear ADSR;
windowed overlapping grains; noise plus decaying inharmonic tones; envelope-follower
compression; feedback delay; four short feedback lines for reverb; tanh saturation;
sample clamp limiting. These are focused building blocks, not physical models,
commercial reverbs, true-peak mastering, or complete analog emulation. Triangle/FM,
resonator, saturation and pitched samples may alias. No paper is cited as validation
for an algorithm it does not describe. An Aalto dissertation was located but its
relevant algorithm chapter was not read and is not used as evidence.

Float processing does not prevent audible clipping. Limiting bounds sample peaks,
not intersample peaks. PCM24 conversion does not add dither. Seeded noise/granular
positions are reproducible at a fixed recipe/version; seeds do not vary deterministic
notes automatically. Live playback and export share the block core; device output
and transport buffering still need separate verification.

Samples have a 256 MiB decoded cache and 64 MiB per-source file/decode bounds.
Long rendered WAVs are inspected via streaming ranges. Rendering is sequential by
mix/stem/variation rather than retaining every output track. Stems include track
inserts and separate bus returns but omit master processing: their sum is the
premaster signal, not the nonlinearly processed master. Exact loops omit tails and
optionally taper endpoints; measurements cannot establish perceptual seamlessness.
