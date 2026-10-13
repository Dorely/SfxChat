# Local synthesis and sample transformation

Use `local_catalog` for available patches, parameters, and limits. Subtractive
synthesis filters a harmonically rich source; FM modulates a carrier; sampling
replays source audio; granular playback overlaps windowed fragments. Noise and
decaying resonant tones supply other ingredients. Choose by required behavior.

For “a rounded low tone with a little bite,” an original starting patch is a
subtractive saw with detune 3 cents, cutoff 900 Hz, attack 0.008 s, decay 0.15 s,
sustain 0.35, release 0.08 s, gain 0.2. Try short notes around MIDI 38–50. Raise
cutoff for brightness, shorten release if neighboring attacks blur. These numbers
are a starting experiment, not a rule for a style or register.

For metallic character try an inharmonic FM ratio and adjust index and decay
separately. For an evolving texture, render locally authored material and use its
asset in a granular track. Shorter grains can emphasize texture; longer grains
retain more of the source. Preserve source hashes, regions, envelopes, and seeds.
Do not replace missing sources silently. A sample-based source may serve an acoustic
brief better than trying to synthesize its every detail.

Clicks suggest discontinuities or very short envelopes. Harsh high notes may
expose aliasing. Too many grains can smear timing. Noise needs a temporal shape
to communicate an action. These focused algorithms are not physical-material or
analog-circuit simulations. A seed affects stochastic layers, not every sound.

Use short previews while choosing a patch; retain originals and exact revisions.
The engine uses float processing and 48 kHz production output. Shared scheduling
and DSP do not by themselves prove device playback equals exported samples.
Technical validation and listening judgments must stay separate.

Sources read 2026-10-13: [js-synthesizer](https://github.com/jet2jet/js-synthesizer)
for SoundFont lifecycle and worker/Node rendering; [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/)
for biquad low-pass coefficients. They do not validate all custom algorithms or
predict the quality of the resulting sound. Examples here are original.
