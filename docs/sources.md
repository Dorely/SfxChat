# Source provenance

Extracted on **2026-09-10 UTC** (2026-09-09 America/Los_Angeles). This foundation uses local source snapshots, not new provider research. Historical model IDs, parameters, limits, pricing estimates, SDK signatures, and account terms must be checked before future implementation or use.

## Source roots and revisions

These original absolute locations are optional provenance/navigation references. The copied skill and distilled notes are self-contained; SfxChat has no runtime dependency on these directories.

| Source | Original root | Inspected HEAD |
| --- | --- | --- |
| Chimera | `C:/Users/jonth/Source/gamedev/card-merger` | `aac79d2d37efc9d4e362782103dbec33024e93ba` |
| Lorekeeper | `C:/Users/jonth/Source/repos/Lorekeeper` | `ae6087b2e0458cb18b7784b70c41b31e0a37e7f4` |
| PixelChat | `C:/Users/jonth/Source/repos/PixelChat` | `8f2eb708794f2857fd1d2910e19fd86b25f0d4cf` |
| Shellmate | `C:/Users/jonth/Source/repos/Shellmate` | `63bd45a133623ebbbf59d6af95529b5aece2cd01` |
| Installed ElevenLabs skill | `C:/Users/jonth/.codex/skills/elevenlabs-sound-effects` | Upstream revision recorded by Chimera: `82f6b49dce482ff9e9fee57ce5bed8bf42f8ab8f`; not independently fetched in this handoff. |
| ElevenLabs music skill (upstream) | `https://github.com/elevenlabs/skills` `music/` | `9edcbd4b80ed57b8e07a3f86ea520333969fbc3c`, fetched 2026-09-21 for the vendored copy. |

HEAD identifies the inspected repository context. The hashes below identify actual file bytes read for the handoff, including any working-copy differences in reference applications.

## What was retained

- **Exact copy:** installed ElevenLabs `SKILL.md`, `references/installation.md`, and `LICENSE` under the repository-local [.agents/skills/elevenlabs-sound-effects](../.agents/skills/elevenlabs-sound-effects/SKILL.md) directory. Preserve their bytes and license. The skill's frontmatter name remains `sound-effects`.
- **Adapted knowledge:** API-handling and prompt lessons from Chimera's provider/craft references and ElevenLabs batch utility, distilled into [ElevenLabs notes](knowledge/elevenlabs.md). No batch script, manifest, or generated audio was copied.
- **Adapted knowledge:** Gemini request/response and calibration lessons from Chimera's audio evaluator and observability report, distilled into [Gemini notes](knowledge/gemini-audio.md). The report's 2026-09-09 pilot failed the byte-identical control in both attachment orders. That observation is a limitation of the tested workflow, not a general model benchmark.
- **Adapted architecture:** ownership and workflow patterns from the three sibling apps, summarized in [architecture](architecture.md). Their code and databases were not copied. No credential/token values were accessed.
- **New project intent:** the user's accepted SfxChat brief and clarifications define the documentation-only scope, API-focused carryover, and provisional Electron/React direction.

Excluded: game rules and taste, cue selections, audio/media files, audition pages, local model installations, private account state, raw API results, and unrelated scripts. The music-generation research that was excluded from the initial handoff was performed during the music feature work; see [music provider research](#music-provider-research-2026-09-21).

## Original references retained for later verification

These links were present in the inherited material. They were not fetched or verified as part of this documentation-only setup.

- ElevenLabs [upstream sound-effects skill](https://github.com/elevenlabs/skills/tree/82f6b49dce482ff9e9fee57ce5bed8bf42f8ab8f/sound-effects), [SFX API reference](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert), [sound-effects capabilities and prompting](https://elevenlabs.io/docs/overview/capabilities/sound-effects), and [prompt guide](https://help.elevenlabs.io/hc/en-us/articles/25735604945041-How-do-I-prompt-for-sound-effects).
- ElevenLabs [terms](https://elevenlabs.io/terms-of-use) and [use policy](https://elevenlabs.io/use-policy): generated-output rights are distinct from the skill's MIT license. Do not infer media redistribution rights from copied code licensing.
- Google [Gemini audio input](https://ai.google.dev/gemini-api/docs/audio), [thinking controls](https://ai.google.dev/gemini-api/docs/thinking), and [pricing](https://ai.google.dev/gemini-api/docs/pricing).

## v0.1 implementation verification (2026-09-10 UTC)

The user selected the local Lorekeeper/PixelChat implementations as technical
guidance for the direct Codex integration. SfxChat independently implements their
OAuth/PKCE flow, account headers, Responses request/tool exchange, and streamed
events in TypeScript. Their .NET code, databases, and credentials are not runtime
dependencies. The original fingerprint table below remains historical provenance.

Re-read the current local `Lorekeeper/Llm/CodexAuthService.cs`, `CodexChatClient.cs`,
and `CodexProvider.cs`; and PixelChat's `Llm/OpenAIAccountAuthService.cs`,
`OpenAIAccountChatClient.cs`, `OpenAIAccountProvider.cs`, and `Secrets/SqliteSecretStore.cs`.
The chat default follows Lorekeeper's `gpt-5.6-sol` configuration. SfxChat implements
OS-backed encrypted storage independently of the reference apps' database storage.

Rechecked official ElevenLabs [SFX API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert),
[capabilities](https://elevenlabs.io/docs/overview/capabilities/sound-effects),
[terms](https://elevenlabs.io/terms-of-use), and [API pricing](https://elevenlabs.io/pricing/api).
The API documents `eleven_text_to_sound_v2`, optional 0.5–30 second duration,
v2 looping, influence 0–1, and the `character-cost` response header. The adapter
requests `mp3_44100_128` and preserves original bytes. No dollar cost guarantee or
media-license grant is inferred; pricing/rights depend on the provider and account.

Build sources: [electron-vite guide](https://electron-vite.org/guide/),
[electron-builder](https://www.electron.build/), Electron
[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) and
[security](https://www.electronjs.org/docs/latest/tutorial/security). Dependencies
are pinned in the lockfile; Vite 7 is used to satisfy electron-vite 5's peer range.

## Sound-effects prompting review (2026-09-10)

The [ElevenLabs knowledge note](knowledge/elevenlabs.md) supersedes its inherited
request/prompt guidance with a dated review of the official documentation index,
endpoint reference (including Markdown), capabilities/prompting overview, product
guide/FAQ, developer quickstart, and Help Center prompt guidance. It records links
and the duration-minimum discrepancy, distinguishes website behavior from the API,
and maps findings to the running assistant and manual regeneration. The vendored
skill and license remain byte-identical historical snapshots. New prompt examples
are authored illustrations, not returned audio or listening evidence. Pricing,
terms, SDK versions, and output rights were not re-audited by this review.

## Follow-up debugging (2026-09-10)

Re-read PixelChat's
`OpenAIAccountChatClient.cs` function-call/result reconstruction and Lorekeeper's
`CodexChatClient.cs` streaming handling. Inspected only the shape of SfxChat's own
persisted wire history and job states to diagnose the reported HTTP 400. No real
conversation payloads or generated audio were copied into tests or source control.
The synthetic regression covers streamed items followed by an empty terminal
output; the original HTTP error body was not available.

## Music provider research (2026-09-21)

Music generation was researched from official sources and then implemented. The dated
reviews, request mappings, documented limits and discrepancies, and evidence boundaries
are recorded in the [ElevenLabs Music](knowledge/elevenlabs-music.md) and
[Gemini Lyria](knowledge/gemini-lyria.md) notes. Their runtime form is the music
instruction block in [assistant.ts](../src/main/assistant.ts), which is selected per turn
from the active music provider; the notes are provenance rather than runtime input.

Sources consulted: ElevenLabs [Music capabilities](https://elevenlabs.io/docs/overview/capabilities/music),
[best practices](https://elevenlabs.io/docs/overview/capabilities/music/best-practices),
[POST /v1/music](https://elevenlabs.io/docs/api-reference/music/compose),
[POST /v1/music/detailed](https://elevenlabs.io/docs/api-reference/music/compose-detailed),
[composition plans](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans),
[Music quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/music), and
[API pricing](https://elevenlabs.io/pricing/api); Google
[music generation](https://ai.google.dev/gemini-api/docs/music-generation),
[Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview),
[Lyria prompt guide](https://ai.google.dev/gemini-api/docs/lyria-prompt-guide), and
[pricing](https://ai.google.dev/gemini-api/docs/pricing).

No paid generation, listener evaluation, or rights review was performed. Listed prices
are provider-published figures from that date and are not a cost guarantee.

## Historical source-file fingerprints

Token-counter research, sibling reference revisions, model-catalog metadata, and
official documentation checks are recorded in [chat context](research/chat-context.md).

Trimming research and implementation evidence (2026-09-10) is documented separately
in [agentic audio editing](research/agentic-audio-editing.md) and
[local decoding](research/audio-decoding.md). Those Markdown notes record findings,
primary-source links, limitations, selected representations, pinned decoder/source
revisions, and corresponding license/source material under `third-party/`.

SHA-256 values below were computed during extraction. Paths are relative to the named source root above. For vendored files the destination bytes match the installed source bytes; other files are attribution for summarized material, not copied payloads.

| Source | Relative path | SHA-256 |
| --- | --- | --- |
| ElevenLabs | `SKILL.md` | `e4b87f43220ef2992cc30a16b8f12500e2dbc613a0de814ca58dff946c25e966` |
| ElevenLabs | `references/installation.md` | `58724eebca1477e889a13d8a5cb9956b95f6b0269b3ecb16e5a74b1a57034522` |
| ElevenLabs | `LICENSE` | `4ab5e9af2296f748eefa6c0696667f83aa9c0edda7b6972785966b60644b3da6` |
| ElevenLabs music skill | `music/SKILL.md` | `647dcdcc634277763d06e3d7697263b0e49c256f51f26da7bf3f989d9723085c` |
| ElevenLabs music skill | `music/references/installation.md` | `2ef32cf83d7f14131335621d88fcd816fba9746ae90b8deccb5865743239d59b` |
| ElevenLabs music skill | `music/references/api_reference.md` | `feafd13ff2e20a1831b056b3d08a42c11439c04b126f8400a3557ef130a06af3` |
| ElevenLabs music skill | `LICENSE` | `4ab5e9af2296f748eefa6c0696667f83aa9c0edda7b6972785966b60644b3da6` |
| Chimera | `.agents/skills/chimera-sound-design/SKILL.md` | `5f79a073a41ffe96a163d9b4e655651d1f69e6c6e3ce2c422fbc33bf00cda8ad` |
| Chimera | `.agents/skills/chimera-sound-design/references/providers.md` | `3b7f9af325e8b09beddb590a91b6f393659d4ae3a342375d11227dbf98a32a01` |
| Chimera | `.agents/skills/chimera-sound-design/references/craft.md` | `7391d2fde3164ca9247380fee9914cbd35bf594b96768351c45fe5cafd7a913b` |
| Chimera | `tools/prepare-sfx-batch.py` | `350c8af8341126334511881f26944dede1b93880b4f73e0cf5a0535537230202` |
| Chimera | `tools/evaluate-audio.py` | `78269b151b78c4ccaefd1a6e142d3c7b7645ffcee0ffda4d2fdbe8441ad0de42` |
| Chimera | `docs/audio-observability.md` | `5fb5a44be137569230ae5ab6d948d8427a94dff5c0dfa0a10abde3a4098c6344` |
| Lorekeeper | `docs/architecture.md` | `8975cb50e14c5c909ed49c67dcb0394262d828b36302fb13621bd87383043278` |
| Lorekeeper | `docs/architecture/providers-background.md` | `13588851b6e6bde67161a0a85aa661ba88dbee9a57dc3ae59b5cc1021d49f87d` |
| Lorekeeper | `docs/architecture/runtime-host.md` | `1100ede690d357c35c52d24657b66c7d2795656609cdbeeb1fe99f30d930f07b` |
| Lorekeeper | `docs/architecture/persistence-migrations-import.md` | `d792f364cc3e04166234c62b0d8e582cbf637037adfa0a98dfb05d196d8e15d7` |
| Lorekeeper | `Lorekeeper/Llm/CodexAuthService.cs` | `abac54fc6ca6c8883e5533edf1cfc38616505ec14727d71cfd9bf1857b7385fc` |
| Lorekeeper | `Lorekeeper/Llm/CodexProvider.cs` | `1cffdb3e63285e8bc34dead52328d192df151e27238ab9d97ddfc7421462162e` |
| Lorekeeper | `Lorekeeper/Models/OAuthToken.cs` | `49c23befd622d3bd3a8c8e9818bbde310ad8b4a216af6e7c8c9799cdfdd54022` |
| Lorekeeper | `Lorekeeper/ChatTurns/ChatTurnRuntime.cs` | `b85268c175219f60501ecf2b13ff5b5489e6300bfba9551e94668a399901d98a` |
| PixelChat | `docs/architecture.md` | `d4d307ca31091affbe08a1a0f9a1572a3101258aada3e72ddbd7de6d05f8ce9a` |
| PixelChat | `VISION.md` | `1d1fd1be27a63cd7bc82fc4c1ede8f2cf4630cc514a98d9d88acfa46c1dd4a60` |
| PixelChat | `AGENTS.md` | `534973ae479f47d119a7c86bab236640ab230bfc1b3c81e4a4e57890ab53011c` |
| Shellmate | `FILEMAP.md` | `090e155e82e8dc75afff1c9443816b9a458f95bd36201ed7943117101dfd692b` |
| Shellmate | `AGENTS.md` | `80aeeaa6573018a210ef17261a03bde86b7c76c5a308ff83e53af2445b9a5f65` |

## Agent workbench (2026-10-02)

The full assistant design/prompting/editing guidance was extracted to canonical
[packaged references](../resources/skill/references/) from SfxChat commit
`7f0038d7a821a1649b3c932f6baf1fb2d9ce0d52`. Those references now feed both runtime
instructions and the installable skill. The earlier active-provider-only description
above is historical; current turns include every configured provider-kind block.

[Agent runtime provenance](research/agent-runtime.md) records official provider fact
revalidation, pinned Node/codec sources and licenses, MCP/harness documentation, and
ImageGenCli's installation precedent. [Chimera migration](chimera-integration.md)
records the source revision and workflow mapping. Sibling project files, credentials,
account caches and databases were not copied or modified.


## Voice integration and guidance — 2026-10-02

The [voice generation review](knowledge/voice-generation.md) records official ElevenLabs
TTS overview/best practices/v4/models/voice search/settings/convert and Gemini 3.8
TTS prompting/models/voice API/Interactions sources, plus dated pricing and terms.
Its coverage table maps recommendations to canonical references, implemented controls,
or explicitly unsupported features. The v4 HTML page was unavailable through the web
reader; its official `.md` representation was fetched and read directly.

[ElevenLabs voice](../resources/skill/references/elevenlabs-voice.md) and
[Gemini voice](../resources/skill/references/gemini-voice.md) are original SfxChat
syntheses and worked scripts. They are registered in shared guidance and the packaging
list; build/install hashes cover the exact texts. Vendored ElevenLabs skills and
licenses remain unchanged historical snapshots. No sibling credentials, databases,
media, or audition decisions were copied. Provider terms determine generated-media
rights independently of source/skill licensing.

## MIDI synthesis and SoundFont playback (2026-10-06)

The MIDI creator renders note data through FluidSynth and a bundled General MIDI bank. The
dated reviews, pins, build recipe, licensing, and spike evidence are recorded in
[MIDI synthesis](research/midi.md); this section records the provenance decisions.

Sources consulted: FluidSynth [release notes](https://www.fluidsynth.org/wiki/ChangeLog/),
[building with CMake](https://www.fluidsynth.org/wiki/BuildingWithCMake/),
[download](https://www.fluidsynth.org/wiki/Download), and
[reverbators](https://www.fluidsynth.org/wiki/reverbators/); [gcem](https://github.com/kthohr/gcem);
[GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) and its
[license v2.0.3](https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt).

FluidSynth 2.4.8 still required GLib; 2.5.0 made GLib optional and 2.6.0 removed it entirely, so
2.6.1 was pinned as the first GLib-free release. Its required `gcem` dependency is vendored
rather than downloaded during the build. Pinned SHA-256 values:

| Artifact | URL | SHA-256 |
| --- | --- | --- |
| FluidSynth 2.6.1 | `https://codeload.github.com/FluidSynth/fluidsynth/tar.gz/refs/tags/v2.6.1` | `3d258a3bf97cc20c59eeebfe62c2432fae88adda74d3ad098681c76e0ebf446b` |
| gcem `012ae73` | `https://github.com/kthohr/gcem/archive/012ae73c6d0a2cb09ffe86475f5c6fba3926e200.zip` | `28159274c54e9640354852e172d10d88eb159f4e7f2fea42edbcd20105ed3526` |
| GeneralUser GS v2.0.3 | `https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2` | `9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cf` |

The runtime form is the helper's `render-midi` command and the packaged sound font, not these
notes. No listening evaluation or timbre-quality claim was made; engine and bank licensing,
including the bank's sample-provenance caveat, are recorded in
[third-party notices](../THIRD_PARTY_NOTICES.md).
