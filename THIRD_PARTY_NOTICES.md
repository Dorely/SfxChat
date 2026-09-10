# Third-party notices

SfxChat is MIT licensed; see [LICENSE](LICENSE). The vendored ElevenLabs skill
retains its separate [MIT license](.agents/skills/elevenlabs-sound-effects/LICENSE),
copyright 2024 ElevenLabs; its files are unchanged.

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

`tests/fixtures/tone.mp3` is a synthetic 440 Hz sine tone, 0.3 seconds, generated
locally with FFmpeg, mono 22050 Hz MP3 at 32 kbps. It contains no recorded or
provider-generated media and is excluded from the installer.

Generated audio is governed by the provider's terms and the user's account.
SfxChat's software license does not assign an MIT license to that audio.
