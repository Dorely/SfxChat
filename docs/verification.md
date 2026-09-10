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
