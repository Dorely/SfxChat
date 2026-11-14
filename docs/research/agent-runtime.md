# Agent runtime and encoding provenance

Reviewed 2026-10-02; Linux added 2026-11-14. The Windows and Linux packages add a
pinned console runtime and a small native helper; there is no FFmpeg distribution. The
helper contains SfxChat-authored PCM16-to-Vorbis, Vorbis decoding, and MIDI rendering
code, plus Windows-only DPAPI, private-directory ACL, and user-PATH registration.

## Sources and rebuild

Unmodified upstream source archives and SHA-256 pins live in
[third-party/encoding/sources.json](../../third-party/encoding/sources.json).
The official release checksum listings are retained beside them. Versions are
libogg 1.3.6 and libvorbis 1.3.7, both BSD licensed with their notices preserved.
Sources: [Xiph Ogg releases](https://downloads.xiph.org/releases/ogg/),
[Xiph Vorbis releases](https://downloads.xiph.org/releases/vorbis/), and
[Vorbis project](https://xiph.org/vorbis/).

The bundled Node runtime is 24.21.0 from the official distribution, checked against
[official checksums](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt): Windows x64 uses
[`win-x64/node.exe`](https://nodejs.org/dist/v24.21.0/win-x64/node.exe), SHA-256
`ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32`; Linux x64 extracts
`bin/node` from
[`node-v24.21.0-linux-x64.tar.xz`](https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz),
archive SHA-256 `fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6`.
Its upstream license bundle is [preserved](../../third-party/node-LICENSE.txt).
Runtime version and hash are written to the package's `agent/runtime.json`.

Prerequisites for source builds: Windows x64 or Linux x64, Node 22.12+ in the 22 line
(or the pinned Node 24 runtime), and npm. Windows needs Visual Studio C++ Build Tools
with the Windows SDK and CMake; CMake may be on PATH, selected by `CMAKE`, or discovered
in Visual Studio with `vswhere`. Linux needs a C/C++ toolchain, CMake 3.15+ on PATH or
in `CMAKE`, and `tar` with xz support. The build checks every archive hash before
unpacking, statically links the codec libraries (and the CRT on Windows, the C++
runtime on Linux), and builds only the helper target. No test target
is built or installed. C++ source and CMake configuration are under `native/`.

```powershell
npm ci
npm run build:agent
npm run build
npm run package
```

`build:agent` bundles the CLI using esbuild, downloads/verifies the pinned runtime
if absent (Linux keeps the verified archive in `out/native-sources`), copies the canonical skill snapshot, and builds the helper in ignored
`out/native-build`. Extracted dependencies live in ignored `out/native-sources`.
Delete those generated directories for a clean source rebuild. Release output is
in `out/agent`, `out/skill`, and `release`; none is source-controlled. Toolchain
versions affect binary hashes; these instructions reproduce the source build, not
an assertion of byte-identical binaries across different compilers.

## Integration precedents and contracts

ImageGenCli revision `e4e3debd45ec50ab23d493fe6c72af28fb334803` supplied the
installation precedent (`apps/cli/src/skill.ts`, `skill/SKILL.md`): project/user
scope, Codex and Claude targets, explicit custom directory, no-op identical files,
and explicit replacement. The SfxChat implementation is authored for this app and
additionally provides MCP registration, backups, uninstall, and Settings controls.
No sibling database, account token, credential cache or media was copied.

The stdio adapter uses the official
[MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/), pinned as
`@modelcontextprotocol/server` 2.2.0. Harness paths follow
[Codex skills](https://learn.chatgpt.com/docs/build-skills),
[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[Claude Code skills](https://code.claude.com/docs/en/skills), and
[Claude Code MCP](https://code.claude.com/docs/en/mcp).
Harness consumption is subject to its own trust and reload behavior.

## Guidance extraction and provider review

Canonical references were extracted from `src/main/assistant.ts` at SfxChat
`7f0038d7a821a1649b3c932f6baf1fb2d9ce0d52`. The source remains in Git history.
The extraction retains substantive paragraphs and all examples. Changes adapt
job waits, filesystem/shell access and modality checks to external harnesses;
provider selection loads all configured provider blocks. The claim that no music
provider can edit a song was corrected to the narrower implemented contract: these
SfxChat adapters expose no song editing/source-audio requests.

Official provider facts were rechecked against
[ElevenLabs SFX convert](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert),
[Music compose](https://elevenlabs.io/docs/api-reference/music/compose),
[Gemini music generation](https://ai.google.dev/gemini-api/docs/music-generation),
and [Lyria prompting](https://ai.google.dev/gemini-api/docs/lyria-prompt-guide).
SFX remains 0.5–30 seconds, v2 looping, default influence 0.3; Music supports the
app's model roster, 4100-character prompt, 3–600 second length, and instrumental
field. Lyria remains single-turn with the app's full-song/30-second model mapping.
Composition plans, inpainting and other provider features are not new app controls.
The dated provider notes remain the fuller evidence trail. No paid generation or
new claim about media rights is established by extraction or packaging.
