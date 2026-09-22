## Multimodal assistant: spectrograms, listening clips, loops, clip spots (2026-09-22)

Added capability-gated `spectrogram_view` and `audio_listen` assistant tools with
labeled media parts in chat history and bounded eviction (newest 8 images / 3 audio
clips, older parts become re-attach markers), a self-contained STFT spectrogram
renderer (`png.ts` + `spectrogram.ts`, no new dependencies), energy event detection
and loop-seam probing in `analyze_audio`, wrap-crossfade loop rendering in
`trim_asset`, a spectrogram panel in the trim editor, media-aware context
estimates with `includesEstimatedMedia`, corrected capability probes (the
responses-kind audio probe now sends a real `input_audio` part; Anthropic records
`audio: false` deterministically), and media content mapping in the Chat
Completions and Anthropic adapters.

- `npm run typecheck` (`npx tsc --noEmit`): passed.
- `npm run build`: passed (main 234.42 kB, preload 2.57 kB, renderer 763.83 kB, CSS 33.71 kB).
- Two temporary harnesses outside the repository (esbuild bundles run under
  Electron's Node with `ELECTRON_RUN_AS_NODE`, deleted after the runs) reported
  65/65 checks in total. Harness 1 (53 checks): PNG encode/decode round-trip; a
  1 kHz sine rendering as a bright line at the mathematically expected row in
  both log (40 Hz–22 kHz) and linear scales, with the final 0.5 s silence gap and
  seven faint time-grid columns; both rendered PNGs then opened in an external
  image viewer showing the expected line position, gap, grid, and colormap;
  event detection returning exactly two synthesized bursts with <30 ms timing
  error and the correct peak; seam probing reporting small discontinuity, high
  correlation, and a zero suggested offset on an aligned periodic loop (the
  offset is only suggested when it improves correlation by at least 0.1) and a
  large discontinuity when the interval was half a period off; loop rendering
  with output shortened exactly by the crossfade, the first output sample landing
  on consecutive source frames across the wrap, fade-with-loop rejection, and
  byte-length-preserving plain trims; mono 16-bit clip WAV headers with exact
  window/downmix and over-limit guidance text; Chat Completions
  `image_url`/`input_audio` mapping preserving label-then-media order and
  unchanged plain-text items; Anthropic base64 `image` blocks plus the
  audio-omitted marker; context estimates (768×320 image = 328 tokens, 2 s WAV =
  64 tokens) with the flag set and no base64 tokenization; tool registration,
  capability gating (dropped for false flags, kept for unknown), schema bounds,
  and the new instruction sections; and media eviction keeping exactly the newest
  8 images / 3 clips with markers for the rest. Harness 2 (12 checks) drove the
  real `MediaLibrary` path on a synthesized WAV in a temporary directory:
  save → `spectrogram` (PNG magic bytes, mapping, option bounds honored) →
  `clip` (exact mono window) → `analyze` with events (one event covering the
  tone span) → `renderTrim` with a loop → SHA-256 integrity failure on a
  tampered original → `commandSchemas.spectrogram`/`analyzeAudio` accept/reject.
  Temporary directories and harness files were removed afterwards.
- Live launch of the production bundle (`npx electron out/main/index.js`, real
  profile, 15 s, then terminated): `app.started` recorded at
  2026-09-22T06:56:57Z with no `start_failed` and no `operation.failed` entries
  in the rotating diagnostics.
- Not verified: no live provider turn was made, so whether Codex and the
  configured generic providers accept `input_image`/`input_audio` parts in real
  traffic, whether a hosted model actually selects the new tools and reads the
  images/clips as described, and real vision acceptance of the rendered PNGs
  remain live acceptance checks — record outcomes here when exercised. The trim
  editor's spectrogram panel and its `spectrogram` IPC path were not driven in a
  running app (verified by typecheck and the shared renderer logic only). No
  generation was billed, no credential changed, and no listener judgment is
  claimed: pixel measurements and waveform checks are not audition evidence.

## Projects and session titles (2026-09-22)

Added schema v2 projects (conversations and assets scoped by a `project_id` column with one
persisted `project-active` setting), a project dropdown in the top bar next to the Workspace
label, in-place renaming of sessions (topbar and sidebar) and projects, a `rename_session`
assistant tool, and per-turn prompt text naming the project, the session title, and who set it.

- `npm run typecheck` (`npx tsc --noEmit`): passed.
- `npm run build`: passed (main 200.34 kB, preload 2.51 kB, renderer 754.31 kB, CSS 31.92 kB).
- Migration evidence against this app's own profile (`%APPDATA%/SfxChat/library.sqlite`): the
  file was copied to the session scratchpad before the first launch of the new build. A
  read-only inspection of that copy reported `user_version` 1, 4 conversations, 378 messages,
  75 assets (75 FTS rows), and no `projects` table. After the first launch the live file
  reported `user_version` 2, exactly one `projects` row (`Default`, created at migration time),
  `project-active` pointing at it, and all 4 conversations plus all 75 assets carrying that
  `project_id`; conversation, message, asset, and FTS counts were unchanged. Diagnostics
  recorded `app.started` with no `start_failed` and no `operation.failed` entries.
- Idempotency: a second launch of the production bundle (`npx electron out/main/index.js`)
  recorded another `app.started`; the database still reported `user_version` 2, exactly one
  project with its original `createdAt`, and unchanged counts, so the v1 to v2 block did not run
  again. Every process started for these checks was stopped afterwards.
- Inspection used a read-only `better-sqlite3` handle through Electron's own Node, from a
  temporary script kept outside the repository and deleted after the run. No repository-local
  harness, fixture, or test infrastructure was added.

Not verified: no UI interaction was driven, because this project carries no end-to-end test
suite. Project switching, creating, and renaming; topbar and sidebar session renaming
(Enter, blur, Escape); per-project scoping of the libraries, search, and playground in the UI;
playback, trim, and export of migrated assets; and assistant tool visibility for a
cross-project asset id were not exercised. No live chat turn was made, so whether the hosted
model calls `rename_session` early, keeps a user-chosen title, and stays scoped when the user
switches projects mid-turn remain acceptance checks. No generation, provider request, or
credential change was made, and no listener judgment is claimed.

## UI legibility and iconography pass (2026-09-22)

Presentation-only pass on the renderer: the Unicode glyph icon map was replaced by a shared
inline SVG set (`src/renderer/Icon.tsx`, paths drawn for this project, no new dependencies),
play/pause buttons grew from 31px/glyph to 40px with 18px SVG triangles and bars, the New
project and New conversation "+" buttons gained visible "New" labels and button chrome,
mini-buttons grew from 23x22 to 28px with expanded hit areas on icon buttons, review marks
became SVG check/x/dot shapes with text labels, and the type scale was raised (9px to 11px,
10px to 12px, 11px to 13px, 12px to 14px) with dark-background weight kept. `--quiet` text
moved from `#6d736d` (about 3.6:1 on the shell background, failing AA) to `#8d938a` (about
5.0:1 on the lightest small-text surface), and the darker hard-coded grays were raised to the
same token. Focus styling is now a global 2px `--lime` `:focus-visible` ring plus explicit
lime rings on the scrollable regions.

- `npm run typecheck` (`npx tsc --noEmit`): passed.
- `npm run build`: passed (main 200.34 kB, preload 2.51 kB, renderer 760.75 kB, CSS 33.21 kB).
- Live runs of the production bundle (`npx electron out/main/index.js`, real profile,
  several launches, each process tree stopped afterwards) with window captures reviewed at
  full resolution: effects and music libraries including an empty state, the playground with
  candidate cards in idle and playing states, the generation form, chat history and composer,
  tabs, project switcher, and sidebar. Play, pause (playing state), the labeled "+ New"
  buttons, move/remove arrows, and the settings/search/send icons were identified correctly
  at a glance in the captures.
- Keyboard focus was exercised with Tab and verified by pixel-sampling the captures rather
  than by eye: the scroll region's ring sampled as the platform amber (R229 G151 B0) before
  the focus rules existed and exactly `--lime` (R196 G242 B100) after; a temporary
  magenta `*:focus` diagnostic confirmed author CSS owns the ring and was then removed.
- Follow-up: the settings icon was restored to the original `⚙` text glyph after review
  feedback that the drawn gear read as a sun; `npm run typecheck` and `npm run build` were
  re-run, and a PrintWindow capture pixel-sampled the rendered glyph at 18px in `--muted`
  (R150 G153 B145 core color, subpixel antialiasing at the edges) on the topbar button.
- Not verified: no provider request, generation, playback audition, trim, or credential
  change was made and no listener judgment is claimed. The inspector, trim editor, settings
  dialogs, and project dialog were not opened during these runs, so their restyled text and
  controls were checked from the stylesheet values only, not visually.



## Music providerId mismatch fixed (2026-09-21)

A live chat turn failed with `Could not generate music: That music provider is no
longer configured. Choose another provider in Settings.` A read-only inspection of this
app's own profile (`%APPDATA%/SfxChat/library.sqlite`) showed the cause: the tool ledger
held two `generate_music` calls whose `providerId` was the guessed string `"gemini"`,
while the configured provider IDs are UUIDs (`30a36439-…` for ElevenLabs Music,
`58709c54-…` for Gemini Lyria). Nothing in the per-turn instructions supplied those IDs,
so the model invented one, and the rejection text implied a deleted provider. The
assistant then omitted `providerId`, the user set Gemini active in Settings, and the
retry generated the comparison track on `lyria-3.5` (recorded asset, `request.providerId`
null). No billed request was lost to the mismatch; `music-active` is now the Gemini entry.

- `musicInstructions` (`src/main/assistant.ts`) now takes the configured providers and the
  active ID, and the per-turn block lists every provider with its exact ID, model, key
  readiness, and active marker, with instructions to copy an ID verbatim or omit the field.
- The rejection in `WorkbenchService.generateMusic` and `MusicRegistry.resolve` now names
  the requested ID and lists the configured IDs instead of claiming the provider was
  removed. The `providerId` tool field description requires the copied ID.
- `npm run typecheck` (`npx tsc --noEmit`): passed.
- `npm run build`: passed (main 190.63 kB, renderer 747.08 kB, CSS 30.27 kB).
- Temporary harnesses outside the repository compiled `assistant.ts` and
  `music-registry.ts`, then checked the emitted header against the real provider records
  (both IDs present, active marker on the selected entry, Lyria/ElevenLabs block matching
  the active kind, empty-roster guidance unchanged) and the resolver (real UUID resolves;
  `"gemini"`, `"Gemini Lyria"`, and `"gemini-lyria"` are rejected with the listing; null
  and undefined fall back to the active provider). The harnesses were deleted after the run.

Not verified: the live assistant behavior after this change (whether the hosted model now
copies the ID) needs a real chat turn with a non-active provider. No paid generation was
made for this fix, and no listener judgment is claimed.

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
