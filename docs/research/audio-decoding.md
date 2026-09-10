# Local MP3 decoding and licensing evidence

Research date: 2026-09-10. SfxChat pins `mpg123-decoder` 1.0.3 for local MP3
decoding. The npm registry reports git head
`8f2428c1cd96b54dab74836c8471ff75fe35cbee`, package license MIT, and source
repository `eshaz/wasm-audio-decoders`.

The upstream package README documents that the decoder returns per-channel
`Float32Array` PCM, sample count, sample rate, and structured decode errors. It
also says decoding continues after errors and that errors may result in gaps.
`enableGapless` defaults to true; the decoder reads XING/LAME delay and padding
metadata and trims those samples. Callers should retain decoder errors in
diagnostics and use decoded sample count/rate as the authoritative PCM timeline.

Sources: [pinned package metadata](https://raw.githubusercontent.com/eshaz/wasm-audio-decoders/8f2428c1cd96b54dab74836c8471ff75fe35cbee/src/mpg123-decoder/package.json)
and [pinned README](https://raw.githubusercontent.com/eshaz/wasm-audio-decoders/8f2428c1cd96b54dab74836c8471ff75fe35cbee/src/mpg123-decoder/README.md),
accessed 2026-09-10.

The npm git head's `modules/mpg123` gitlink resolves to submodule commit
`08247b317163175e62035893af3ff9e71a5dfefd`. The repository preserves the exact
source inputs needed for review/rebuild in `third-party/source/`: the mpg123
submodule archive (SHA-256
`B624F4A779202BF0B5FC0BA5C3C89C85C8B64FC71FBAB8754D600961F91052C4`) and a
small archive containing the wrapper's `Makefile`, package metadata, submodule
map, and `src/mpg123-decoder` sources at npm git head (SHA-256
`783A7163FA7EB7067BB8D8CE08E35A84DB1D5865CD714C3AB6BE6E50A13BF55C`). The
archives were created/accessed 2026-09-10 from these exact commits. The wrapper
archive omits unrelated decoders and generated dependency trees; the mpg123
archive is the complete submodule source at its recorded commit.

## License boundary

The package's JavaScript/WASM wrapper is MIT licensed. The upstream project
explicitly warns that external source compiled into distribution files can have
different terms. Its Makefile builds the decoder from the `modules/mpg123`
submodule and embeds that result into the generated bundle.

The embedded `libmpg123` library is LGPL version 2.1. The upstream mpg123
`COPYING` file identifies copyright Michael Hipp and others, states LGPL v2.1,
and contains the complete license text. The repository's
`third-party/mpg123-decoder.NOTICE.txt` records both license boundaries and
canonical source/license links. Packaging should ship that notice and the
complete unmodified text in `third-party/LGPL-2.1-mpg123.txt` with the
installer/source distribution. Because the WASM library is embedded, the
corresponding exact source/build archives are also preserved. Release review
should verify that the shipped package exposes these materials and satisfies
the applicable LGPL relinking terms for the exact bundle. This note makes no
broad legal conclusion about the final distribution.

The pinned upstream snapshot has no standalone MIT license file even though npm
metadata and the project README identify the wrapper as MIT. For clarity, the
repository includes the standard MIT terms in
`third-party/mpg123-decoder-MIT.txt`, marked as a reproduction rather than an
upstream file. The wrapper source archive now includes `build.js`, `src/common`,
the decoder sources, Makefile, package metadata, and submodule map needed to
reconstruct the generated module when the recorded toolchain and submodule
source are supplied.

Source locations: [pinned decoder tree](https://github.com/eshaz/wasm-audio-decoders/tree/8f2428c1cd96b54dab74836c8471ff75fe35cbee),
[submodule map](https://github.com/eshaz/wasm-audio-decoders/blob/8f2428c1cd96b54dab74836c8471ff75fe35cbee/.gitmodules),
and [pinned mpg123 source](https://github.com/madebr/mpg123/tree/08247b317163175e62035893af3ff9e71a5dfefd).
The selected wrapper archive additionally contains `build.js` and `src/common`,
including the bundled puff source and its notices; those files are unchanged.
SfxChat does not claim to have reproduced the WASM build bit-for-bit.

Packaging includes these materials under
`resources/app.asar.unpacked/third-party/`. The decoder's JavaScript and embedded
WASM live separately under `resources/app.asar.unpacked/node_modules/mpg123-decoder/`,
where a compatible rebuilt version can replace them. Source archives contain the
upstream build rules; the decoder target is `mpg123-decoder` in the Makefile and
uses the recorded `mpg123-configure` step, Emscripten, and npm build dependencies.
Package inspection and a decoder load test are recorded in
[verification](../verification.md).

The application uses the decoder only to obtain local PCM for analysis,
waveform data, playback, and derived WAV writing. The local edit engine writes
WAV PCM/float output; it does not add an FFmpeg runtime dependency. Assistant
analysis currently receives only bounded amplitude min/max/peak/RMS summaries
with seconds and sample-frame coordinates. Waveform images, silence/onset
detection, and semantic audio “hearing” remain future work. A trim requested by
the user or assistant is applied directly as a new derived asset, preserving the
original and recording the source interval; the current flow does not require a
separate approval step.
