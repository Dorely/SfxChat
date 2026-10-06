# MIDI synthesis and SoundFont playback

Composition and playback for the MIDI creator. Playback renders note data through
[FluidSynth](https://www.fluidsynth.org/) and a bundled General MIDI SoundFont bank so each
track sounds like its chosen instrument. This note records the pinned versions, build recipe,
licensing, and exactly what was run during the risk-first build spike (**2026-10-06 UTC**).

## Decision context

The initial plan proposed a small self-authored oscillator synth. That was rejected once the
user clarified the goal is the classic General MIDI sound-canvas experience — choose notes and
instruments and hear them played back as written — because an oscillator synth cannot produce
recognizable instrument timbres. A SoundFont engine plus a sampled GM bank is required, not
polish.

FluidSynth was chosen over TinySoundFont for Full GM semantics, reverb/chorus, and the 2.6
quality work (Dattorro plate reverb default, higher-order sinc interpolation, GM2 bank select).
FluidSynth is LGPL-2.1; the vendored `mpg123-decoder` precedent already establishes the
project's LGPL bookkeeping (pinned upstream sources + build materials shipped with the app).

## Pinned artifacts

| Artifact | Version / revision | SHA-256 | License |
| --- | --- | --- | --- |
| FluidSynth source | 2.6.1, tag commit `71e85b2ca6bf48641ba7e2261d8f2640ae473773`, released 2026-09-19 | `3d258a3bf97cc20c59eeebfe62c2432fae88adda74d3ad098681c76e0ebf446b` | LGPL-2.1 |
| gcem (FluidSynth's only required dependency) | commit `012ae73c6d0a2cb09ffe86475f5c6fba3926e200` | `28159274c54e9640354852e172d10d88eb159f4e7f2fea42edbcd20105ed3526` | Apache-2.0 |
| GeneralUser GS SoundFont | v2.0.3, 32,319,396 bytes | `9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cf` | GeneralUser GS License v2.0 |

Sources: [FluidSynth releases](https://github.com/FluidSynth/fluidsynth/releases/tag/v2.6.1) and
[tag archive](https://codeload.github.com/FluidSynth/fluidsynth/tar.gz/refs/tags/v2.6.1);
[gcem](https://github.com/kthohr/gcem/tree/012ae73c6d0a2cb09ffe86475f5c6fba3926e200);
[GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS). Upstream's own pinned gcem hash
(`cmake_admin/FindGCEM.cmake`) is `28159274…`, which the vendored zip matches — an independent
provenance check. The FluidSynth and gcem archives are GitHub-generated and can be regenerated
by GitHub; `scripts/build-agent.mjs` re-verifies every hash and fails loudly on mismatch.

FluidSynth 2.4.8 (the first candidate) still required GLib unconditionally
(`find_package ( GLib2 ... REQUIRED )`). GLib was made optional in 2.5.0 (`-Dosal=cpp11
-Denable-libinstpatch=0`) and **removed entirely in 2.6.0** ("Remove GLib and libInstPatch",
#1799). 2.6.1 is therefore the first release needing no GLib; its `osal=cpp11` abstraction is
the default and requires only a C++11 compiler. Vendor GLib was never required.

## Build recipe

`scripts/build-agent.mjs` extracts `third-party/synthesis/sources.json` archives into
`out/native-sources` (hash-verified; the gcem zip's revision-named directory is renamed to
`gcem`). `native/CMakeLists.txt` then points `GCEM_INCLUDE_DIR` at the vendored
`out/native-sources/gcem/include`, which is where FluidSynth's `FindGCEM.cmake` looks, so GCEM
is found locally and its download-from-GitHub fallback never runs. All FluidSynth drivers and
optional features (ALSA, DSound, WASAPI, CoreAudio, JACK, PipeWire, PulseAudio, SDL2/3,
libsndfile, libinstpatch, LADSPA, D-Bus, network, readline, systemd) are forced off; only
offline rendering is needed. `BUILD_SHARED_LIBS=OFF` yields a static `libfluidsynth` linked
into `sfxchat-helper`.

Verified locally: MSVC from Visual Studio 18 (Community), CMake 4.1.1-msvc1, Windows SDK
10.0.26100. Configure reported `Found GCEM: .../out/native-sources/gcem/include`, `OS
abstraction: cpp11`, `Support for DLS files: yes`, and built `libfluidsynth-3.lib` +
`sfxchat-helper.exe`.

Helper command:

```
sfxchat-helper render-midi <input.mid> <bank.sf2> <output.wav> [gain]
```

Settings: 44.1 kHz stereo 16-bit output; `synth.gain` 0.5 by default (the 2.6 limiter is
unavailable — see below); reverb and chorus on; `player.timing-source=sample` so rendering runs
faster than realtime; ~12-minute render cap; a 2-second tail is rendered after the last note so
reverb/chorus decays are not cut off. FluidSynth's informational logging is silenced for
`WARN`/`INFO`/`DBG` so helper stderr stays clean.

## Evidence from the spike (2026-10-06)

- **Build:** full agent build succeeded end to end; static FluidSynth linked; helper produced.
- **Render:** GeneralUser GS demo `Dance.mid` (multi-instrument, 28,307 bytes) rendered to
  22,462,508 bytes / **127.34 s** of 44.1 kHz stereo 16-bit WAV in **1.38 s** (~92× realtime,
  so per-render latency is dominated by bank loading, not synthesis). Measured RMS 3933 with a
  full-scale peak and 210 clipped samples out of 11,231,232 (0.002%) — a dense master at the
  demo's own level, not representative of sparse composed clips.
- **Regression:** the existing Vorbis `encode` command still produces valid Ogg (`OggS`,
  5,040 bytes for 0.5 s mono 440 Hz) after the new static link.

## Findings and limits

- **Signalsmith Audio Basics is not vendored.** FluidSynth 2.6's automatic gain control /
  output limiter and its optional Signalsmith reverb engine are therefore disabled (configure
  reports `Limiter: no`). The Dattorro, FDN, Lexverb and Freeverb engines remain. Clipping
  headroom is currently handled by a conservative default gain; denser MIDI can still reach
  full scale. Revisit by vendoring signalsmith-audio/basics (MIT, header-only, has its own
  submodules) or adding a soft limiter in the helper.
- **No listening evidence.** Peak, RMS, and clipping counts are measurements. Timbre quality of
  the bank or reverb has not been perceptually validated, and nothing here claims a listener
  evaluation.
- **LGPL obligations.** FluidSynth is statically linked. Its pinned source archive, license,
  and this reproducible build recipe ship with the app (as with the vendored `mpg123-decoder`);
  the corresponding upstream sources under `third-party/synthesis/` satisfy the relinking
  requirement. If that proves insufficient, shipping `libfluidsynth-3.dll` instead is the
  fallback.
- **GeneralUser GS sample provenance.** The bank's own license permits unrestricted use
  "in your software projects", but honestly notes that some contained samples came from
  third-party banks of imperfectly documented origin. This is recorded rather than glossed in
  `THIRD_PARTY_NOTICES.md`; the bank can be swapped without code changes.
- **Deferred:** SF3 (Ogg-compressed) banks (needs libsndfile), Signalsmith limiter/reverb, and
  SF2 preset enumeration for the studio's instrument picker are not part of this spike.

## Sources

- FluidSynth [release notes / changelog](https://www.fluidsynth.org/wiki/ChangeLog/),
  [building with CMake](https://www.fluidsynth.org/wiki/BuildingWithCMake/),
  [download](https://www.fluidsynth.org/wiki/Download), [reverbators](https://www.fluidsynth.org/wiki/reverbators/).
- GeneralUser GS [repository](https://github.com/mrbumpy409/GeneralUser-GS),
  [license v2.0.3](https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt).
- gcem [commit `012ae73`](https://github.com/kthohr/gcem/tree/012ae73c6d0a2cb09ffe86475f5c6fba3926e200).
