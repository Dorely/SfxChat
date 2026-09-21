# v0.1 verification

## Music providers, libraries, and prompting guidance (2026-09-21)

Implemented ElevenLabs Music and Gemini Lyria as a separate asset kind with an
independent music provider registry, a `generate_music` tool, three workspace tabs, and
per-provider runtime prompting guidance. Researched guidance was written into
`src/main/assistant.ts` (shared music doctrine, an ElevenLabs Music block, a Lyria
block, and tool/field descriptions) and recorded with dated sources in
[knowledge/elevenlabs-music.md](knowledge/elevenlabs-music.md) and
[knowledge/gemini-lyria.md](knowledge/gemini-lyria.md).

- `npm run typecheck` (`npx tsc --noEmit`): passed.
- `npm run build`: passed (main 192 kB, renderer 747 kB, CSS 30 kB).
- Adapter behavior was exercised against a local stub HTTP server with a temporary
  harness. The harness was kept outside version control and deleted after the run, and
  nothing was added to the repository. It reported 21 passing checks over both adapters:
  the `/v1/music?output_format=auto` URL, `xi-api-key` header, the exact
  `prompt`/`model_id`/`music_length_ms`/`force_instrumental` body, omission of unset
  optional fields, `song-id` → requestId, byte preservation, the `bad_prompt` suggestion
  (message plus retained code/detail) with no credential in the error text, the local
  4100-character guard, the Interactions URL and `x-goog-api-key` header, the
  `{ model, input, store: false }` body with composed instrumental/length lines, the
  clip-model fixed-length rejection, base64 audio decoding, interleaved text blocks
  collected as lyrics, a no-audio response carrying the provider reason, and 400 mapping
  to a bounded provider error.
- Provider-selection wiring was checked in the running development app before the test
  suites were removed later the same day: saving a music provider wrote a
  `music-key-<id>` secret, generation created a `kind: music` asset with its provider,
  model, duration, and instrumental request recorded, the asset appeared only in the
  Music Library, and the instructions sent to the chat provider contained the active
  provider header plus its provider-specific block. That run used a temporary local
  profile and no provider credentials, so no paid request was made.
- A functional defect was found and fixed in secure storage: `SecureStore` names must
  match `[a-zA-Z0-9._-]+`, and both registries built names as `chat-key/<uuid>` /
  `music-key/<uuid>`, so `safeName` rejected every provider-key write and chat API keys
  could never be saved. Secret names are now built through `secretName()` and validated
  eagerly.
- Repository checks: `git diff --check` passed; relative Markdown links in the changed
  files resolve; the four vendored music-skill files match the SHA-256 values recorded
  in [sources](sources.md) for upstream revision
  `9edcbd4b80ed57b8e07a3f86ea520333969fbc3c` and are covered by the byte-preserving
  `.gitattributes` rule.

Not verified: no paid generation was made against either provider, so real ElevenLabs
Music and Lyria responses, their latency, their returned formats, SynthID watermark
presence, cost, and account/plan availability are unverified here. No listener judgment
is claimed, no audio was auditioned, and no rights review was performed. The Music API
requires a paid ElevenLabs plan; Lyria's WAV `response_format` path is unverified
because this app does not send it. Live acceptance remains: configure each provider with
a real key, generate one track, audition it, and record the outcome here.

## Test infrastructure removed (2026-09-21)

The project carries no automated tests. Removed: both Playwright Electron workflows
(`tests/workbench.spec.ts`, `tests/trim-editor.spec.ts`), the synthetic tone fixture,
`playwright.config.ts`, the installed-app smoke script, the `test:e2e` script, the
`@playwright/test` dependency, the CI step that ran it, the test-mode entry in the
TypeScript project, and the main-process mock port providers with their `SFXCHAT_TEST_*`
environment overrides. Verification is now `npm run typecheck`, `npm run build`, and
live/manual app runs, as required by [AGENTS.md](../AGENTS.md).

Two stale assertions in the removed suite had been repaired while updating it for music
(the chat-context workflow drove a `Chat model` picker that the generic-provider work had
already deleted, and asserted an unknown-model state the chat registry no longer
permits); both were pre-existing defects in the suite rather than product regressions.
The evidence those suites previously provided is historical: earlier entries below
describe checks that no longer exist in the repository and must not be re-run as written.

## Generic agentic chat providers (2026-09-21)

Implemented generic Chat Completions, generic Responses, and Anthropic Messages
adapters behind the existing `ServicePorts.chat` contract, plus per-model effort
lists, test-gated model saves, vision/audio capability flags, and Anthropic
max-tokens discovery (8192 floor). Codex keeps its OAuth transport and gains
`reasoning.effort` from the selected effort. Settings store providers/models in
SQLite; keys stay in OS-backed `SecureStore` and are never echoed to the UI.

- `npm run typecheck` (`npx tsc --noEmit`): passed.
- `npm run build`: passed.
- Live/manual checks only: unit tests were removed from the project at this
  stage of development, so no `npm test` evidence is claimed here. No live
  provider calls, keys, or billed generations were made for this entry. No
  sibling-app credentials were read or copied.

Pending live acceptance: hosted Command Code/DeepSeek/OpenRouter/Gemini entries,
local Ollama no-key entry (tool-capable and non-tool models), and Anthropic
native messages — each verified via Test-then-Save, combined dropdown + effort
switching, send/tool-call/cancel, and vision/audio badges. Record outcomes here.

## ElevenLabs prompting review and regeneration (2026-09-10)

Reviewed the official SFX documentation listed in the
[prompting guide](knowledge/elevenlabs.md), traced assistant/tool fields through
the service and HTTP adapter, and corrected manual regeneration's use of bare
feedback as the provider prompt.

- `npm run typecheck`: passed after the code and test changes.
- `npm test`: 69 tests across 10 files passed before adding three focused transport
  cases. `npm test -- tests/providers.test.ts`: all 19 provider tests then passed,
  including omission/null auto duration, explicit looping with zero influence,
  exact model/query/body mapping, and exclusion of app metadata.
- `npm run test:e2e -- --grep 'complete creative workbench flow'`: production build
  and the selected Electron workflow passed. It verifies prompt prefill, feedback
  independence, empty-prompt blocking, explicit replacement prompt persistence,
  parent preservation, and reuse of requested generation settings. The first run
  exposed a test assumption about library order; the assertion now uses the actual
  selected asset ID. Test-owned app instances and temporary profiles were cleaned up.
- Relative links in changed Markdown resolve; `git diff --check` passed. The
  vendored skill and license hashes still match the original provenance record.

All generation in these checks used synthetic provider responses. No paid provider
calls, real audio inspection, listening evaluation, or installed-app update was
performed. Documentation and deterministic tests do not establish that the hosted
assistant will always follow the guidance or that resulting sounds meet creative
intent; those remain live user-audition checks.

## Initial verification

Checked on 2026-09-10 UTC on Windows x64. Automated checks, platform evidence,
and live-provider acceptance are recorded separately.

## Current evidence

Token counter follow-up (2026-09-10): type checking, the production build, and all
69 unit tests passed. The new mocked Electron context test passed, exercising
real local tokenization of a 275,000-word draft, threshold styling, draft removal,
conversation switching, all three configured models, backend default, and unknown
model limits. The existing trimming and full workbench Electron tests also passed.
Visual review at 1000×650 confirmed the counter and composer remain visible.
Initial context-test failures were assertion whitespace/selector issues, corrected
before the passing rerun. No live provider calls or billed generations were made.
The updated source/build was not installed or packaged during this follow-up.

- `npm run typecheck`: passed.
- `npm test`: 32 passing tests under Electron's Node (9 runtime, 16 provider,
  and 7 lifecycle checks). Coverage includes OAuth state expiry/replay, refresh
  serialization/rotation, logout races, unavailable encryption, redacted errors,
  fragmented/interleaved streams, incomplete responses, malformed/duplicate tools,
  generation outcomes, cancellation, recovery, search, metadata, revision links,
  immutable hashes, imports, and exact-byte export.
- `npm run test:e2e`: one full mocked Electron workflow passed. It exercises chat
  generation, both workspace views, comparison ordering/removal, playback/seek/loop,
  one-player switching, metadata/search, regeneration lineage, import/export,
  collision errors, and persistence after restart. It also verifies renderer
  isolation and Windows `safeStorage` encryption with a synthetic secret.
- Exact dependencies and lockfile installed; npm reported zero known vulnerabilities.
- Electron-native SQLite rebuild succeeded.
- `npm run package`: produced `release/SfxChat Setup 0.1.0.exe` (121,781,074 bytes).
  Windows reports the installer signature status as `NotSigned`, as intended.
- Silent installation completed with exit code 0. The installed executable at
  `%LOCALAPPDATA%/Programs/SfxChat/SfxChat.exe` launched successfully.
- `node scripts/smoke-installed.mjs <installed-executable>` confirmed packaged mode,
  native SQLite initialization, and available Windows secure storage. Packaged code
  ignored development-only mock/profile environment variables. The actual library
  profile is `%APPDATA%/SfxChat`.
- Playback was checked in the Electron workflow with the synthetic fixture;
  playback of a real generated sound in the installed app remains a live check.

## Live acceptance

On 2026-09-10 the user reported successful live chat and a first ElevenLabs sound,
followed by a Codex HTTP 400 during the assistant follow-up. A read-only inspection
of this app's library confirmed one completed job and an orphaned function-call
output in wire history. The original provider error body was discarded by the old
adapter and cannot be recovered retrospectively.

The follow-up fix preserves streamed calls when terminal output is empty/partial,
repairs affected histories from the completed tool ledger, and saves diagnostics.
Validation: type checking, 54 unit tests, and the Electron workflow test passed.
Regression tests use the actual Codex adapter with synthetic responses and confirm
matching calls/results, one generation, persisted history, detailed HTTP errors,
redaction, log references, and repair without generation. The Electron test also
checks opening the logs folder and written diagnostics.

Pending: live follow-up after this fix, token persistence after reopening, and
packaged-app playback. No additional paid generation was made while debugging.
No sibling-app credentials were read or copied. No actual listener judgment has
been recorded; decoding, waveform display, and hashes do not establish creative quality.

## Window-height layout check (2026-09-10)

After the conversation overflow fix, `npm run build` passed. An isolated Electron
layout check injected 200 long messages, 30 conversation rows, and tall workspace
content. At 1440×940 and 1000×650 content sizes, document height matched window
height, message history scrolled internally, and the composer remained visible.
The temporary app and profile were closed and removed after validation.

Chat auto-scroll validation: type checking and the production build passed. An
isolated Electron check with 60 long messages and incremental text updates confirmed
following at the bottom, preservation of a manual wheel-scroll position, resuming
after scrolling back down, and jumping to the latest content on send. The outer
document stayed at scroll position zero; the temporary app/profile were cleaned up.

## Trimming and assistant audio evidence (2026-09-10)

- `npm run typecheck`: passed.
- `npm test`: 64 tests across 9 files passed, including 10 new audio-editing tests.
  These cover per-channel amplitude/RMS measurements and sample-level zoom,
  exact retained PCM, identical preview/saved bytes, optional fades, MP3 decoding,
  PCM bit depths, extensible WAV layouts, malformed inputs, immutable originals,
  chained provenance, assistant tool replay, and shutdown cleanup.
- `npm run test:e2e`: both Electron workflows passed. The trim workflow imports
  the synthetic MP3, checks measured waveform/zoom, numeric and keyboard range
  controls, Blob WAV readiness/playback, preview invalidation after fade changes,
  derived asset selection/lineage, and persistence after reopening. The existing
  creative workbench and renderer-isolation workflow also passed.
- Visually reviewed editor screenshots at normal and 1000×650 viewport sizes.
  Waveform, selected range, times, and save/preview actions fit; smaller windows
  scroll fields inside the modal while keeping its footer visible.
- `npm run package`: Windows NSIS installer built. The packaged decoder loaded
  through the app's ASAR using Electron's Node runtime and decoded the synthetic
  MP3 to 6,615 sample frames at 22,050 Hz without decoder errors. This exercises
  packaged dependency resolution, not a fresh installed-app end-to-end trim.
  Unpacked decoder replacement files, notices, license text, and corresponding
  source archives were verified in the package. Nothing was published/installed.
- Local links in changed documentation were validated. Research findings and
  source provenance are under [research](research/agentic-audio-editing.md).

No paid generation or audio-analysis provider was invoked. Assistant tools were
exercised with local/synthetic calls; live hosted-model tool selection remains a
user acceptance check. Playback state and PCM checks do not establish perceptual
quality, and no listener judgment is claimed. Temporary test apps/profiles were
closed/removed. Existing user audio and credentials were not read for this work.

## Direct trim selection playback (2026-09-10)

Type checking, the production build, and both Electron workflows passed after
adding Play/Stop selection. The trim regression now clicks the actual play button
instead of invoking `audio.play()` from the test. It verifies playback of the
selected duration, stop/reset, replay, natural completion, and a new selected
duration after changing the in point and fades. Tests used only the synthetic
fixture; temporary app instances and profiles were closed/removed.
