# Third-party notices

SfxChat is MIT licensed; see [LICENSE](LICENSE). The vendored ElevenLabs skills retain
their separate [sound-effects MIT license](.agents/skills/elevenlabs-sound-effects/LICENSE)
and [music MIT license](.agents/skills/elevenlabs-music/LICENSE), copyright 2024
ElevenLabs; their files are unchanged.

Dependencies retain their licenses in their installed packages. Electron includes
its Chromium and third-party license notices. No sibling-app binaries, databases,
or credentials are distributed.

`js-tiktoken` 1.0.21 provides local text-token estimates with bundled `o200k_base`
ranks. It is MIT licensed; the unmodified package and its license are distributed
as an application dependency. See [upstream](https://github.com/dqbd/tiktoken/tree/main/js)
and [counter provenance](docs/research/chat-context.md).

`mpg123-decoder` 1.0.3 is used for local MP3-to-PCM decoding. Its JavaScript/WASM
wrapper is MIT licensed; its embedded libmpg123 code is LGPL-2.1. The pinned
attribution, source links, decoder caveats, and packaging details are recorded
in [third-party/mpg123-decoder.NOTICE.txt](third-party/mpg123-decoder.NOTICE.txt)
and [docs/research/audio-decoding.md](docs/research/audio-decoding.md). The
LGPL text and exact wrapper/mpg123 source archives are under
[third-party](third-party/) and ship under `resources/app.asar.unpacked/third-party/`.
The decoder is unpacked separately for replacement with a compatible rebuilt version.

Generated audio is governed by the provider's terms and the user's account.
SfxChat's software license does not assign an MIT license to that audio.

The agent command redistributes Node.js 24.21.0 for Windows x64 under its upstream
[license bundle](third-party/node-LICENSE.txt). The CLI includes the MIT-licensed
MCP TypeScript SDK and Zod, and ISC-licensed @iarna/toml; their notices also remain
with application dependencies. Bundled skill guidance is SfxChat-authored material
extracted from the app's assistant instructions, under the project's MIT license.

The native encoder statically links unmodified libogg 1.3.6 and libvorbis 1.3.7,
copyright Xiph.Org Foundation and contributors, under their preserved
[libogg](third-party/encoding/libogg-LICENSE.txt) and
[libvorbis](third-party/encoding/libvorbis-LICENSE.txt) BSD license notices.
Pinned source archives, hashes and upstream checksum listings are retained under
`third-party/encoding` and shipped with the app. [Build/provenance instructions](docs/research/agent-runtime.md)
describe the helper and runtime; this bookkeeping does not license generated media.

The native helper also statically links unmodified FluidSynth 2.6.1, copyright Peter Hanappe
and others, under the GNU Lesser General Public License 2.1 — its preserved
[license](third-party/synthesis/fluidsynth-LICENSE.txt) — together with Apache-2.0-licensed
[gcem](third-party/synthesis/gcem-LICENSE.txt). Pinned source archives, hashes and the rebuild
recipe are retained under `third-party/synthesis` and shipped with the app; see
[MIDI synthesis provenance](docs/research/midi.md). The bundled General MIDI bank is
[GeneralUser GS v2.0.3](https://github.com/mrbumpy409/GeneralUser-GS) by S. Christian Collins,
distributed under its own [license](resources/soundfonts/GeneralUser-GS-LICENSE.txt), which
permits unrestricted use in music creation and in software projects. That license also records
that some contained samples originate from third-party banks of imperfectly documented
provenance. The bank and engine are runtime resources, not SfxChat-authored material, and this
bookkeeping does not license generated audio.
