# Local SoundFont engine sources

Retrieved 2026-10-13 from the upstream repositories identified in `sources.json`.
The npm dependency is exactly js-synthesizer 1.13.0 (BSD-3-Clause). Its unmodified
`externals/libfluidsynth-2.4.6.js` embeds FluidSynth WebAssembly (LGPL-2.1); the
with-libsndfile/SF3 variant is not loaded. License texts are retained here.

The source archives pin js-synthesizer v1.13.0 and fluidsynth-emscripten
v2.4.6-em-2. The latter contains upstream FluidSynth plus Emscripten build changes.
No source modification was made to either archive. See their READMEs and license
notices for full upstream information. SfxChat's wrapper/DSP is separately authored.

To rebuild the FluidSynth library, extract its source archive, install Emscripten,
create a build directory, and follow the upstream `emcmake cmake
-Denable-oss=off -Denable-libsndfile=off -DCMAKE_BUILD_TYPE=Release ..` and
`emmake make` instructions. The upstream README identifies Emscripten 3.1.10 as
tested. This project uses the npm-distributed binary; a byte-identical source
rebuild has not been established. The manifest independently pins its SHA-256.

The browser loads the engine as a separate JS resource, and the Node worker loads
the same dependency file. Users may rebuild/replace the LGPL engine and rebuild
SfxChat; update the recorded hash and engine version when doing so. Build-time
hash verification detects accidental mismatches, not a restriction on modification.
Packaged source archives and licenses accompany the application in `third-party`.
