# v0.1 verification

Checked on 2026-09-10 UTC on Windows x64. Automated checks, platform evidence,
and live-provider acceptance are recorded separately.

## Current evidence

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
