# ElevenLabs latest-model defaults (2026-11-01)

Effects, music, and voice default to `latest`; exact IDs stay selectable as pins.
No paid generation was run.

- Sources rechecked: the public `https://api.elevenlabs.io/openapi.json` was
  inspected with curl. `SFXModelId` lists `eleven_text_to_sound_v2` and
  `eleven_text_to_sound_v3`; `MusicModelID` lists `music_v1` (deprecated via
  `x-fern-enum`), `music_v2`, and `music_v2_5`.
- A temporary harness outside the repository was bundled with esbuild against the
  real `elevenlabs-models.ts` and `voice-models.ts`, run, then deleted:
  - Live discovery read both enums (`source:"live"`). Latest was
    `eleven_text_to_sound_v3` and `music_v2_5`; automatic order excluded deprecated
    `music_v1`.
  - Marking SFX v3 refused for one key made v2 latest for that key only; another key
    still resolved v3.
  - Voice latest resolved `eleven_v4`, skipping realtime-only and deprecated IDs.
  - Recency sorting put `eleven_v5` before `eleven_flash_v5` and `music_v2_5` before
    `music_v2`.
  - Model-refusal detection accepted 400/403/422 model-access errors and rejected an
    unrelated 422, a 500, and a 401.
- `npm run typecheck` and `npm run build` passed after the final edits.
- Browser check through `npm run dev:browser`, after the user closed the installed
  SfxChat; the host was stopped afterwards:
  - `listAudioModels` returned live catalogs: effect latest
    `eleven_text_to_sound_v3`, music latest `music_v2_5` with `music_v1` deprecated.
    `listVoiceModels` returned live `eleven_v4` as latest.
  - The Playground sound model select defaulted to "Latest (Sound Effects v3)" with
    v3 and v2 as pins.
  - In music settings, a new provider defaulted to "Latest (Music v2.5)"; the user's
    existing ElevenLabs entry showed as pinned to `music_v2_5`.
  - Voice settings showed the user's saved `eleven_v4` default as pinned, with the
    "Pinned: newer models will not be used" hint. Selecting "Latest (Eleven v4)"
    changed the hint to follow the newest model; it was reverted without saving.
  - `guidance` reported effects as `model:"latest"`. No console errors.
- Gaps: no paid generation, so the per-request resolution and the model-refusal
  fallback were not exercised against a real account. No native desktop check.

# Musical analysis and loop finder (2026-10-27)

Roadmap phases 1 and 2. Temporary harnesses outside the repository were bundled
with esbuild against the real `dsp.ts`, `music-analysis.ts`, and `loop-finder.ts`,
then deleted.

- Synthetic checks. On generated 128 and 92 BPM pieces, the top music candidates
  were exact whole-bar loops. A periodic noise texture gives a top texture candidate at a
  multiple of its period, labeled close, after adding ±3-unit smoothing and
  texture-specific labels (it had read weak before).
- Real library tracks.

  | Track | Analysis | Top candidates | Search time |
  |---|---|---|---|
  | kelp_shallows | 192 BPM (likely 96 felt), C major, −17.9 LUFS | Close bar loops, 5–10 ms crossfade | 87 ms |
  | sanctuary | 75.96 BPM | Partial | — |
  | glimmer | 59.88 BPM | Close or partial | — |
  | Rogue Frequency (240 s MP3) | 141.9 BPM, confidence 0.41, downbeat uncertain | Weak or partial | 163 ms (analysis 1.0 s) |
  | Ambiences | Automatic texture mode | Partial or close | — |
  | Conch hum | — | Weak | — |

  Two measurement fixes came out of these runs:
  - Level deltas were biased by up to −16 dB on sparse music. They now compare
    like-for-like windows and read about ±2 dB.
  - Texture search took about 3 s. Removing array copying in the alignment brought
    it to 0.3–0.6 s.
- Operations path through `window.sfx.operation`:
  - `find_loop_points` on an ambience returned texture mode in 464 ms; Rogue
    Frequency ran end to end in 1.5 s.
  - `mode:"music"` on the ambience returned the no-beat-grid error.
  - `analyze_audio` with `musical:true` returned tempo, key, loudness, and beats.
  - `audio_listen` with `loopSeam` returned a mono WAV and the seam position.
    Combining it with start/end was rejected with INVALID_ARGUMENTS.
- `npm run typecheck` and `npm run build` passed after the final edits.
- Browser check through `npm run dev:browser`. The installed SfxChat was closed
  with the user's approval and has not been reopened. The check used the
  kelp_shallows placeholder in "Nerissa's Mermaid Adventure":
  - Chips and the bar grid rendered.
  - Loop search listed 8 candidates with brackets. The top one was "Bars 9–16
    (8 bars, 10.0 s) after a 10.0 s intro; seam close match."
  - Selecting another candidate moved in/out and the crossfade, and reset previews.
  - Play seam ran a 3.995 s one-shot that ended without looping and reset its button.
  - The check exposed two pre-existing renderer bugs, now fixed: the CSP blocked
    spectrogram `blob:` images, and a toggle button overflowed the editor
    horizontally. After the rebuild, the spectrogram loaded (naturalWidth 768) and
    the editor had no horizontal scroll (743/743).
  - The active project was set back to Chimera, and the host was stopped through
    its shutdown endpoint.

Gaps:
- **Save loop as new asset** was not clicked, to avoid adding an asset to the
  user's library. It calls the existing `trim_asset loop:true` path.
- The in-app assistant tool path was not exercised by a live chat model.
- The native desktop was not checked.
- No paid calls were made. Nothing here is listening evidence: playback ran, but
  no one judged the seams by ear.

# Automatic cue-sheet presentation (2026-10-16)

History inspection confirmed that `review_create` only saved a board from its
introduction in `f39a176`; presentation required a separate `review_open` call.
Creation now defaults to opening through the same acknowledged renderer command,
with `open:false` for drafts and a separate UI outcome alongside the saved board.
The manual launcher retains its own selection. Updates do not navigate.

`npm run typecheck` passed. The full production build within `npm run dev:browser`
passed, including the agent/native helper build. Browser startup then refused the
existing installed library owner and exited; the user-owned desktop was left
running. Browser switching, cross-project presentation, unavailable/busy UI outcomes,
and native window focus were not live-verified. No provider calls or playback were
made, no temporary host remains, and the installed application was not updated.
`git diff --check` passed. Reviewed the shared operation callers, renderer command
acknowledgment, manual launcher selection, and MCP review-result/resource handling.

At the user's request, skipped the live UI check and installed the new build.
`npx electron-builder --win nsis --x64 --publish never` passed; the NSIS installer
completed with exit code 0. The installed and packaged `resources/app.asar` SHA-256
hashes both matched `42C4733C58A960A387A82DCB61811697AB9F67EC730D6C5F8CBF257300BB5B99`.
No SfxChat process was running before installation, so no forced shutdown was needed.

# Installed startup recovery (2026-10-15)

The installed app failed before creating its workbench window. Diagnostics recorded
`app.start_failed` with `This library was created by a newer SfxChat version.`
Read-only inspection confirmed library schema 6 and an installed main bundle that
rejected schemas above 5. Current source at `42240f6` supports schema 6; fetching
origin confirmed that checkout contains all remote main commits plus 39 local commits.

`npm run typecheck` and the production build inside `npm run dev:browser` passed.
The first browser launch correctly refused the existing installed owner. After
authorized shutdown (the stuck processes had no main window to close normally),
`node scripts/dev-browser.mjs` started the built app. Browser inspection showed
Connected, the existing project list, and the selected Mozart workspace with its
saved conversation and five Playground assets. No media playback or paid calls
were made. The browser host was shut down through its normal shutdown endpoint,
and its temporary browser tab was closed.

`npx electron-builder --win nsis --x64 --publish never` packaged the verified build.
The generated NSIS installer completed with exit code 0. SHA-256 hashes of the
installed and newly packaged `resources/app.asar` matched. The installed CLI's
`status` returned `ready:true`, and `projects_list` returned all 13 existing
projects. Launching the installed executable brought up a responding native
`SfxChat — Sound Workbench` window. Diagnostics recorded a packaged startup with
no subsequent startup failure. The installed app was left open for the user.
Native dialog, playback, and provider generation behavior were not revalidated.

The README now documents updating the installed build after development upgrades
the shared library, without deleting data or weakening the schema guard.

# Local workstation foundation (2026-10-13)

## Mozart benchmark and development-path repairs

Actual MCP reconstruction exposed two defects, fixed in this change:

- `npm run dev` cleaned away the offline worker written by the CLI prebuild.
  Worker generation now belongs to Electron Vite's main/renderer build lifecycles;
  the renderer dev server also serves its worker, worklet and FluidSynth URLs.
- A master-only settings edit populated omitted creation defaults and reset length
  to 32 beats, causing validation to reject the 108-beat score. Settings mutation
  fields now remove creation defaults. The failed edit left the stored revision intact.

Typecheck and production build passed. Actual `npm run dev` with browser mode
regenerated the offline worker after cleanup; both Mozart jobs completed through
MCP. Each of the three renderer dev audio URLs returned HTTP 200 JavaScript.
Two master-only edits preserved every unrelated document field byte-for-byte after
JSON serialization. Final production browser verification used `npm run dev:browser`.
The shared review opened both 51-second candidates. No paid operations or automated
test scaffolding were used. See [trial details](workstation-trials.md) for sources,
score/performance distinctions, measurements and listening limits.
User-requested one-shot playback of the shaped candidate reached the playing UI
and returned to stopped; Stop audio was then explicitly invoked, with Loop off.
Browser warning/error logs were empty. MIDI export/reparse matched all 788 pitches;
maximum onset/duration tick-rounding difference was 0.001041667 quarter-note beats.
Validation hosts/audio and temporary authoring clients were stopped/removed afterward.
The source/recipe scripts and user deliverables remain in the Music export folder.

## Subsequent creative trials and UI polish

See [trial inventory](workstation-trials.md) for actual MCP-created projects, renders,
revisions, package reopening, component alignment and pending listening decisions.
The final UI pass added descriptive parameter labels/units, integer MIDI controls,
automatic save after editing pauses, pointer-drag revision grouping, visible conflict
and export success feedback, named render progress, contextual technique help,
bounded exact-note pages and a playback sample-peak meter. Project drafts survive
panel navigation; project-keyed editors isolate asynchronous responses.

Manual browser evidence: Studio instrument and note panels were inspected at normal
width and 1100×800, with Studio and Daylight themes; original theme/viewport restored.
Live expression edits saved revisions 7/8 in the foundation arrangement. Nine-track
orchestral section playback advanced to beat 39.39 with sample peak 0.06012; Rewind
stopped it. Technique guide loaded the exact shared music-craft reference. MCP
review_open displayed initial/revised cards without playback; browser error/warning
logs were empty at those checks. Playback observations are not listening evidence.

Final rebuild/typecheck passed after the polish pass. The final browser host reopened
the saved orchestral revision with playback stopped; exact-note pagination displayed
its bounded page controls. The final MCP MIDI export produced nine format-1 files
and the explicit limitations manifest. All 206 relative links in changed Markdown
resolved. Final running/build/installed guidance SHA-256:
`f6b853bcf15fdb9d8459b69a5a2af192808c809e43e95de5cbac8c6ea6ccc1b1`.
Validation audio/hosts were stopped and task-owned temporary clients/exports removed.
User deliverables remain in the Music folder identified in the trial inventory.

Additional actual MCP checks:

- Local catalog enumerated 287 presets from the selected GeneralUser bank.
  An unavailable bank/program failed visibly with no published audio.
- Repeated PCM24 foundation render had identical SHA-256
  `4145d669197da2d590018007afb2c273c41aee4228859cff233e0cc356be8d72`.
  Replaying the exact request ID recovered the same completed job.
- Legacy MIDI creation and arrangement derivation preserved the original hash and
  four notes, including a 1/3-beat onset. No original MIDI was rewritten.
- Installed skill was refreshed through the supported installer, retaining backups.
  Running MCP, build and installed guidance hashes matched; topic-selective reads
  returned only requested references. General musical guidance was retrieved during
  every creative workflow. No hardcoded genre profiles were added.

Gaps: no recorded device-output comparison against offline WAV, no native packaged
desktop run of the new WASM path, no 32-SoundFont-track stress run, and no exhaustive
manual permutation of every editor/routing/automation control. The verified capacity
case was 32 subtractive tracks over ten minutes; live SoundFont evidence was nine
tracks. Human listening acceptance is pending. No automated test suites were run.

## Foundation evidence

Ran typecheck, production build, diff whitespace checks and the real browser host
against the existing library. No automated suites or test-only scaffolding added.
A temporary external stdio client initialized the newly built MCP server, discovered
its tools and called shared operations; stale installed definitions were not used.

- Project Local workstation trials / Engine foundation: eight-measure SoundFont
  arrangement `8516185e-8ba1-4b2a-9676-2efb67f34155`. Browser playback advanced,
  live expression controls saved revisions, Stop/natural completion worked without
  console errors. This is transport evidence, not listening or device-output capture.
- Restart preserved the document. Browser Undo created revision 5; Redo revision 6
  restored the prior intent. Stale MCP writes returned REVISION_CONFLICT.
- Ten-minute/32-track subtractive job `50ba4d41-5358-4637-a70e-8f66512a86b8`
  completed: 28,800,000 frames, 600 seconds, 48 kHz. Actual whole-WAV MCP analysis
  reported peak 0.11857318, RMS 0.00692081, zero clips with bounded memory reads.
- Package export included pinned GeneralUser and license. Reopened arrangement
  `16c7501e-7d63-4811-9217-fe51a3f3e9cf` retained the exact bank hash. PCM24
  mix/stem job `a770f3a2-acc7-413e-b412-54ad57886ae3` produced two aligned
  816,000-frame files (17 seconds), identical measured peak/RMS, zero clips.
  Measurements were taken after encoding.
- MCP rejected a self-sidechain cycle and missing sample. Job
  `6cf5414a-f58d-4486-b0ae-5fb36b0cf3dc` cancelled with no published assets.

Remaining at this stage: creative trials/reviews, UI polish and grouped continuous
edits, complete manual coverage, installed skill hash checks, numerical live/export
comparison, multi-track SoundFont capacity and packaged desktop validation. Human
acceptance remains pending. Validation hosts were stopped before the stage commit.

# Review completion and archiving (2026-10-12)

- `npm run typecheck` and `npm run build` passed. No automated test infrastructure
  was added. Modified Markdown links and `git diff --check` passed.
- `npm run dev:browser` ran the real renderer/main process and existing library.
  The schema v3 library opened after upgrading to v4; existing reviews remained active.
  A separate verification session reused one existing WAV, without paid generation
  or changes to existing review decisions. Its two verification reviews remain archived.
- Browser checks covered Done with pending candidate notes and with already-saved
  content, unresolved cues, active/archive selectors, explicit reopening, read-only
  editing controls, preserved drafts when an MCP client completes concurrently,
  discard/reload, archived one-shot playback (Loop off), and persistence after reload.
  Playback was stopped before navigation. These checks establish transport/UI behavior,
  not listening quality. Audio and the browser development host were stopped afterward.
- Live CLI/MCP checks covered empty-review completion, invalid final content without
  a revision change, completed-write rejection, stale-revision rejection, agent/user
  completion attribution, immutable history, active/archive lists, timeout state,
  completion waits waking on a UI click, and archived original export with a selected
  file and completion metadata in its manifest. Temporary export/helper files were removed.
- Manual stdio exchanges verified both 2025-11-25 `resources/subscribe` and
  2026-07-28 `subscriptions/listen`, resource reads, and update notifications after
  reopening/completion (including modern subscription IDs). Closing stdin after a
  resource read exited naturally with code 0 in 24 ms. Background watches did not
  relaunch the desktop after host shutdown; verification MCP clients were stopped.
- Limits: no claim that a particular agent host automatically wakes its model on a
  notification. Maximum-watch eviction, every historical schema upgrade path, and
  native playback were not manually exercised. Durable reads/waits remain the fallback.
- `npm run package` encountered Windows EBUSY/EPERM errors in Electron archive
  extraction. Packaging was retried with the already-installed, matching Electron
  44.3.0 distribution and an isolated release output directory.
- Final installer: `release/review-completion-final/SfxChat Setup 0.2.0.exe`, built
  with `npx electron-builder --win nsis --x64 --publish never
  --config.electronDist=node_modules/electron/dist
  --config.directories.output=release/review-completion-final`. Silent installation
  exited 0. Installed executable, app archive, CLI, runtime, helper, skill entry point,
  and workflow reference matched release SHA-256 hashes. Version remains 0.2.0.
- Updated both existing user-scope Codex and Claude skills with per-file backups;
  existing copies matched the prior source, and MCP registrations required no changes.
  All 28 integration entries report up-to-date. Installed CLI reopened the app and
  read persisted completion; installed MCP initialized with subscriptions enabled,
  read the completed resource, and exited normally. The installed desktop is left
  open. Old MCP connections were stopped to release installation files and need reconnecting.

# Installed speech discovery build and agent skills (2026-10-08)

- At the user's request, `npm run package` rebuilt commit `2ff1889` and produced
  the Windows NSIS installer. `npm run typecheck` passed. Closed the installed app
  normally after checking there were no queued/running generation jobs, and stopped
  its MCP process to release the installed runtime. Silent installation completed
  with exit code 0 at `%LOCALAPPDATA%/Programs/SfxChat`.
- Installed executable, app archive, icon, CLI, Node runtime, native helper, skill
  entry point, guidance hash and ElevenLabs voice reference matched release bytes
  by SHA-256. The package version remains 0.2.0; this is the updated local build.
- Installed the complete user-scope SfxChat skills under `~/.agents/skills/sfxchat`
  (Codex) and `~/.claude/skills/sfxchat`, plus both MCP registrations. These standard
  user-scope targets were previously absent. All 28 integration entries report
  up-to-date; every installed reference and guidance hash matches the running app.
- The installer's atomic rename of the Codex config failed with `EPERM`. Preserved
  its backup, confirmed the current file still matched that backup, wrote the exact
  installer-generated content in place and removed its temporary file. Rerunning
  installation completed the Claude registration and verified both configurations.
- The installed CLI reopened the app and refreshed the authenticated model catalog:
  nine speech models, seven selectable, with the saved v4 default preserved. No
  synthesis or paid generation was invoked. A manual installed MCP stdio exchange
  initialized successfully, listed `list_voice_models` and queried all nine models;
  its verification subprocess exited afterward. The app was left open as before;
  existing harness connections need reconnecting to use the updated MCP process.

# ElevenLabs speech model discovery (2026-10-08)

- `npm run typecheck`: passed. `npm run build` (via `npm run dev:browser`): passed
  for main, preload, renderer, CLI, packaged skill and native helper. The final
  implementation was rebuilt after review. Skill-creator `quick_validate.py`:
  passed for `resources/skill`. `git diff --check`: passed.
- Anonymous `GET /v1/models` failed with `workspace_not_found`. The authenticated
  request through the real app owner and its OS-backed saved key succeeded, returning
  nine TTS models: seven selectable REST speech models and two documented realtime
  variants explicitly marked unavailable. Metadata included language coverage,
  request bounds and alpha-access flags. No key was read into the renderer, CLI
  arguments, helper scripts, source, or returned catalog.
- Real bundled CLI `list_voice_models` calls verified refreshed ElevenLabs data and
  the labeled built-in Gemini catalog. A manual stdio MCP initialize, `tools/list`,
  and `tools/call` exchange verified the new operation's schema and successful live
  structured result, including selectable status and model-specific control flags.
- Browser verification used `npm run dev:browser` and the printed loopback URLs in
  the in-app browser. Settings and Playground loaded the live catalog; v4 showed
  stability/similarity without speed, v3 showed its stability presets without
  similarity/speed, and Flash v2.5 showed speed and its 40,000-character limit.
  Switching Flash → v4 → Flash cleared an incompatible speed value. Refresh updated
  the catalog time; switching to Gemini showed the built-in label and style control.
  No audio was played and all Loop toggles remained off.
- Privileged live settings requests rejected the realtime v4 Turbo ID and an absent
  model ID without changing defaults or admitting jobs. Saving Flash v2.5 succeeded
  and discovery returned it as the saved default; the original v4/voice default was
  restored immediately. Runtime guidance and packaged skill text/hash matched.
- No synthesis, paid model-quality comparison, login change, or installer deployment
  was performed. Native desktop coverage, future unreviewed model IDs, malformed
  provider catalogs, provider-outage UI, and new-model synthesis remain gaps. Shared
  guards were inspected; compilation is not evidence of those provider behaviors.
  Development hosts and the manual MCP subprocess were stopped after verification;
  no temporary helpers, fixtures, or automated suites were added to the repository.

# Review cue playback feedback (2026-10-08)

- Candidate and reference cards now show an elapsed/total time readout, a seek bar
  enabled during playback, and a playhead over the waveform or MIDI note roll.
  Review progress follows the WebAudio context clock and decoded duration; seeking
  retains preview gain and Loop, and stop/completion clear progress. Native audio
  cards reuse the transport and playhead presentation.
- `npm run typecheck`: passed. `npm run build`: passed for main, preload, renderer,
  agent and native helper. The first build encountered an ignored native CMake cache
  from Visual Studio 2026 while the available toolchain selected Visual Studio 2022;
  the old cache was preserved under the excluded native-build directory and a fresh
  cache built successfully. No build-script or dependency changes were needed.
- `npm run package`: passed, including a rebuild of the final renderer, agent and
  helper, and the Windows NSIS installer. The installer was built locally without
  publishing or installing it.
- Initial live checks were skipped at the user's request. On the follow-up request,
  `npm run dev:browser` rebuilt successfully and a brief in-app browser pass opened
  an existing review. With Loop off, a 24.9 s WAV candidate's elapsed time advanced
  from 0.18 s to 8.15 s and its waveform playhead moved. Keyboard seeking back to
  the start reset the position and continued playback; Stop reset the slider to 0,
  disabled seeking and removed the playhead. A separate 0.5 s candidate completed
  naturally and reset the same controls. The seek bar, readout and playhead were
  visually inspected. No review changes were saved and no provider calls were made.
- Playback was stopped, the temporary browser tab closed, and the development host
  shut down. Reference playback, MIDI playback, loop wrapping and native desktop
  presentation were not separately checked. No listening judgment is claimed.
- After explicit approval, stopped the installed MCP server that held its runtime
  file open and ran the new NSIS installer silently (exit code 0). The installed
  executable, app archive, CLI, Node runtime, native helper and icon matched the
  release files by SHA-256. The updated app was left closed; the MCP connection
  needs reconnecting when used again.

# App icon (2026-10-05)

- Added the app icon: a lime speech bubble carrying a sound burst, centered on the
  Studio tile. An earlier four-point spark read too close to the Gemini logo, and sound
  arcs that replaced it were dropped for the plain bubble. `icon-small.svg` uses three
  pixel-aligned bars for 16-24 px. The ICO and PNG were rasterized from the SVGs with the
  project's Electron in a temporary helper outside the repository.
- Wired as the `BrowserWindow` icon (packaged builds read it from `resources/icon.ico`),
  the electron-builder Windows/installer icon, and the renderer favicon. The sidebar
  brand mark and chat welcome use a themed `mark` glyph of the same bubble; the brand
  subtitle rule no longer also restyled the mark as 11 px quiet text.
- `signAndEditExecutable` is now enabled so electron-builder embeds the icon in
  `SfxChat.exe`. No certificate is configured, so the executables remain unsigned.
- `npm run typecheck`, `npm run build`, and `npm run package` passed. .NET
  `ExtractAssociatedIcon` returned the new icon from `SfxChat.exe` and the installer.
  The redistributed Node runtime kept its pinned SHA-256 and its own valid signature.
  Electron's `nativeImage` loaded the ICO at 256x256. Rendered sizes 16-512 px were
  inspected on dark and light backgrounds.
- In the in-app browser via `npm run dev:browser`, the brand mark rendered the bubble at
  17 px in the accent color with the subtitle unchanged, and the favicon resolved. The
  host was shut down afterwards. No audio was played.
- At the user's request, stopped the installed MCP server another agent session was
  using, then silently updated `%LOCALAPPDATA%/Programs/SfxChat` (exit code 0). The
  installed executable, archive, icon, CLI, runtime, and helper matched the release files
  by SHA-256. Start menu and desktop shortcuts point at `SfxChat.exe,0`. The installed
  CLI's `--help` succeeded. The installed app was not launched.

# Review candidate card polish (2026-10-05)

- Reported: the Loop checkbox floated in the middle of review cards. Both control labels
  had `margin-left: auto`, which split the free space. The row is now a left-aligned
  Loop switch and a right-aligned `Preview [n] dB` field, shared by reference and
  candidate cards.
- MIDI cards (library, Playground, inspector, review) now draw a note roll from
  `midiNotes`, with pitched notes above a drum strip, instead of flat placeholder bars.
  The duplicate duration was dropped from the card footer, and MIDI subtitles add BPM and
  track count.
- `npm run typecheck` and `npm run build` (via `npm run dev:browser`) passed. In the
  in-app browser at 1500x950, opened the "Below the Blue" review: the roll drew 218 notes
  including 30 drum hits. Loop sat at the left and gain at the right; the switch turned
  on and back off without marking the review dirty. No audio was played and nothing was
  saved. The host was shut down afterwards.

# F5 renderer attach over IPv4 (2026-10-05)

- Reported: the "Cannot connect to the target at localhost:9222 … Socket closed before
  the connection was established" popup still appeared with no other SfxChat running.
- Reproduced by starting `Debug SfxChat` from VS Code's Run menu: Electron's DevTools
  endpoint answered `http://127.0.0.1:9222/json/version` within 3 s, yet js-debug 1.117
  (extension host Node 24) retried for the full 60 s and showed the popup. Its trace
  never recorded a `/json/version` result. Every attempt went through its `localhost`
  path, which races 127.0.0.1 against [::1] (Chromium listens on IPv4 only).
- The renderer attach now sets `"address": "127.0.0.1"`, so js-debug makes one IPv4
  lookup. Same launch from VS Code: "Discovered target URL from /json/version", the
  `http://localhost:5173/` page attached, and "Launched successfully" came about 2.3 s
  after the attach started. No popup appeared after the 60 s timeout. The debug app was
  then closed.

# MIDI drum lane labels (2026-10-05)

- Reported: a drum lane left key rows blank. Rows above 81 have no General MIDI drum
  name and were rendered empty. Drum lanes now always span the kit (35-81), extended to
  any out-of-kit notes; those keys show their note name dimmed and their notes are striped.
- `npm run typecheck` and `npm run build` (via `npm run dev:browser`) passed. In the in-app browser, a new
  unsaved draft with notes nudged above the kit and switched to Drums showed 73 rows with
  no blank labels and two striped out-of-kit notes. The draft was discarded; no audio was
  played and nothing was saved.

# UI pass: themes, composer model picker, settings, MIDI studio (2026-10-05)

- Renderer colors now come from theme tokens (`themes.css`); a top-bar palette popover
  and Settings → Appearance switch Studio, Midnight, Ember, and Daylight. The model and
  effort picker moved from the top bar into the chat composer. Settings became a
  two-pane dialog with per-page headers; Agent integrations and voice defaults use the
  shared form styles. The MIDI studio was rewritten (lanes with sticky headers and key
  gutters on one ruler, keyboard nudging, velocity, dirty-draft guard).
- `npm run typecheck` and `npm run build` passed. No automated test infrastructure was added.
- `npm run dev:browser` in the in-app browser at 1200x760 and 1680x1000: switched all
  four themes from the popover and Settings, confirmed the choice survived a reload, and
  inspected Effects, MIDI, and settings in each. Opened every settings page. The composer
  picker listed the configured models and efforts; it was not changed during the check.
- MIDI: opened the saved "Studio UI check" clip, drew a note, nudged it with the arrow
  keys, dragged it, deleted it with Delete, and confirmed the dirty badge and status bar.
  Started one-shot playback (Loop off): the render returned, the playhead advanced to
  bar 1 beat 4, and Stop halted it. Nothing was saved, so the library is unchanged.
  Audition and playback were checked as player state only, not by listening.
- Fixed during the check: icon spans that took the tab-count pill style, wrapping tab and
  settings-nav labels, a focus outline around the whole MIDI panel after a click, and
  low-contrast note labels in Daylight (new `--track-ink` token). No provider generation
  was run. Native desktop rendering was not separately checked.

# F5 debugger attach with a running owner (2026-10-05)

- Cause: VS Code's renderer attach reported "Socket closed before the connection was
  established" when another SfxChat (installed or CLI-started) held the library's
  single-instance lock. Reproduced: a second `electron . --remote-debugging-port`
  instance printed "DevTools listening" and then quit immediately on the lock.
- Unpackaged launches now prompt to close the running owner, which quits through its
  normal shutdown on a `takeover` second-instance message, and retry the lock for up to
  30 s. Packaged and browser-mode behavior is unchanged.
- `npm run typecheck` and `npm run build` passed. Live: started `electron .`, then the
  launch configuration's `REMOTE_DEBUGGING_PORT=9222 electron-vite --sourcemap`. The
  debug instance stayed alive showing the prompt; pressing "Close it and continue"
  (via Windows UI Automation) shut down the first owner, and `/json/list` on 9222 then
  listed the "SfxChat — Sound Workbench" page target. VS Code itself was not driven.

# Auditioning after candidate selection (2026-10-05)

- Source inspection traced the reported board-wide playback lock to candidate
  selection setting the review draft dirty, which disabled every candidate and
  reference Play button. Unsaved edits now leave playback available across cues;
  saving remains explicit and manual review navigation/export retain their draft
  guard. Draft preview gains must be finite and within -60 to +12 dB before playback.
- `npm run typecheck` and `npm run package` passed, including the production build
  and Windows NSIS installer. `npm run dev:browser` also built and launched the
  real Electron owner and renderer. No automated test infrastructure was added.
- In the in-app browser, selected a candidate in the existing multi-cue voice
  review, then started another candidate in that cue and a candidate in another
  cue without saving. Their controls reported playing and returned to Play after
  stopping/completion. Edited candidate notes and selected a second cue's candidate.
- A +13 dB draft gain produced the expected validation error without starting
  playback; changing it to -6 dB allowed playback without saving. An unsaved
  reference choice also played. Loop toggles stayed off throughout verification.
- Stopped audio and discarded all verification drafts. Concurrent external agent
  work updated the saved board from revision 2 to 3; discard loaded revision 3
  without overwriting it. No user decisions or feedback were saved by verification,
  and no provider generation was initiated by this check. External generation jobs
  completed before the owned browser host was stopped; the browser tab was closed.

Browser checks establish interaction and player state, not listening quality or
native desktop integration. The rebuilt installer was not published.

At the user's subsequent request, the rebuilt installer completed a silent update
of `%LOCALAPPDATA%/Programs/SfxChat` with exit code 0. The installed executable,
application archive, CLI, runtime, command shim and helper matched the release
files by SHA-256. The installed CLI's `--help` command succeeded without launching
the app. The archive contains the corrected renderer; native UI verification was
not repeated after installation.

# Voice, shared credentials, browser verification and manual playback (2026-10-02)

This entry describes the final behavior after the user's browser and playback changes.
Older entries below are historical evidence, including tests and playback tools that
have since been removed. No automated test infrastructure was added.

## Builds and guidance

- `npm run typecheck`, `npm run build`, and `npm run package` passed. The Windows
  NSIS installer was rebuilt without publishing or installing it.
- Skill format validation passed with the skill-creator validator. All eight canonical
  references and SKILL.md matched source, packaged files, runtime guidance, and temporary
  Codex/Claude project installations byte for byte. Guidance SHA-256:
  `138a93993999d4bb8e149e31e6df252fad14454572e832299a3e8afbd39fb74a`.
- Packaging and guidance registration include both voice references. The source turn
  instruction builder and compiled main bundle include the exact canonical voice text
  for configured providers. No live hosted assistant turn was used to establish routing.
- Manually reviewed all nine original JSON voice examples and both feedback revision
  recipes against the exposed fields: narration, character, urgency/whisper, pronunciation,
  requested normalization, non-English event tags, script/style separation, and parent
  lineage. Examples do not authorize a generation batch. Dated official sources and
  model-specific coverage are in [voice review](knowledge/voice-generation.md).

## Real provider attempts (two total, no retries)

| Provider | Actual outcome | Technical evidence |
| --- | --- | --- |
| ElevenLabs | One v4/George request for `The lantern is ready.` failed HTTP 401; no audio returned. | Stored key lacks `text_to_speech`; voice discovery separately reported missing `voices_read`. Generation request ID `58ee4fc3d8c7344da383c2534e87c9d8`. Enable these permissions on the same provider key; no voice-specific key is needed. |
| Gemini | One Flash TTS/Kore request completed through Interactions with `store:false`. | Original unmodified WAV: 109,748 bytes, 24 kHz mono, 2.16 seconds. Submitted script was exactly `  The lantern is ready.\n` (two leading spaces and a trailing newline); style was separate `calm, clear narration`. |

Gemini original SHA-256:
`35cdcdc11b27d784e15e5d005a326d57711ea149b0d87335742afd9ca9b994aa`.
Returned usage included 209 input and 70 output tokens (279 total); no interaction
ID/request header was available, so request ID remains null. The short completed
clip is estimated below $0.01 at the reviewed rates, within the authorized $1;
actual invoice accounting was not inspected. The failed ElevenLabs call was not
retried. There was no third synthesis attempt, hidden split, or fallback model.

The technical result is not a listening judgment. No audio-understanding capability
or human creative approval was recorded. The verification review remains unreviewed.

## Jobs, records and operations

- Replayed each admitted request with its same UUID/input and recovered the same
  completed/failed job IDs, without additional provider requests.
- Original export matched the Gemini source hash. A local 0–1 second trim retained
  voice kind, exact 0–24,000 sample-frame lineage, and the original as parent; its
  float32 WAV hash is `1b7e1f9d670f24f08bb83d2b357a2899fd36d7f49043d6430bbcb2e1ad7c1e4b`.
- Transcript search found the original and derivative. Cross-project asset inspection
  was refused. Restart preserved the assets, request history, jobs and shared keys.
  Cancel on a completed job was idempotent. Queued/running voice cancellation and
  interrupted billed-job recovery were source-reviewed, not exercised with extra
  paid requests after the two-attempt limit.
- Real encrypted legacy music credentials consolidated into one ElevenLabs key and
  one Gemini key; only readiness returned to clients. Differing-key retention and
  corrupt-storage failure paths were source-reviewed, not simulated with real secrets.
  Settings prevents replacement/removal until a saved-key conflict is resolved.

## Browser manual verification

`npm run dev:browser` served the real renderer from a loopback-only Electron owner
without a native window. The Codex in-app browser loaded it successfully; Chrome's
extension blocked local navigation, so verification continued in the in-app browser.
This mode now is the default in [AGENTS](../AGENTS.md). Native screenshot/input
attempts had failed before the user requested this workflow; native visual coverage
is not claimed.

- Checked shared vendor key panels, secure-storage readiness, independent model/voice
  defaults, and hiding the separate generic chat key field for an official Gemini URL.
  Saved Flash-Lite voice defaults and restored Flash/Kore without changing credentials.
- Checked Voice Library counts/search, inspector immutable script/hash/settings,
  editable regeneration, clearing prepared text on wording edits, and ancestor model/
  voice/style inheritance on a trimmed voice. No regeneration button was submitted.
- Checked Playground voice routing and v4 numeric controls without speed, v2 with speed,
  Gemini separate style/prebuilt selection, and regional `en-US` discovery with pagination.
- Original playback decoded successfully; a 1.2-second trim preview rendered through
  the bounded byte-array RPC and played with measured waveform and spectrogram visible.
  This establishes encoding/player state, not perceptual quality.
- Exported the derivative through the browser's app path dialog, verified its hash,
  and imported it as voice into the isolated verification project. Native text prompts
  are unsupported by the in-app browser; app dialogs replace them. Import/export still
  use the owning scoped operations and refuse overwrite.
- Opening a review through the CLI bridge acknowledged stopped state and did not autoplay.
  Manual single playback ended naturally. User Loop remains available and defaults off;
  checkbox selection was checked without looped playback. Timed repeat scheduling was
  removed. Browser host disconnect stops native/review playback and displays an error.
- A real MCP initialize/tools-list exchange returned 36 tools, including `generate_voice`
  and `list_voices`; its only playback-related tool is read-only `playback_status`.
  CLI `playback_play` now returns UNKNOWN_OPERATION. Internal assistant tool registration
  likewise has no play/stop controls. Agents may open reviews; users control playback.
- Checked the host bound to `127.0.0.1`, and rejected wrong Host, cross-origin JSON RPC,
  simple POST, and cross-site media requests with HTTP 403. No browser credential store
  or mock services were introduced.

The isolated verification project retains the original, trim, imported derivative,
failed/completed jobs and unreviewed cue board as evidence. Voice defaults and the
previous active project were restored. Owned hosts were stopped after verification. Command policy rejected deletion of
the temporary `sfxchat-voice-c49c851b-a66f-4baf-ad86-da9d16153a37` directory; its
exports and temporary skill installations remain outside the repository. The browser capture is a task artifact,
not a committed fixture. Remaining live gaps: ElevenLabs synthesis/discovery permissions,
alternative-model synthesis, distinct-key conflict migration, active voice cancellation,
and hosted assistant creative routing. Browser checks do not establish native dialogs,
fresh installer installation, or subjective voice quality.

# Review card alignment (2026-10-02)

- The supplied screenshot showed the reference card above adjacent candidates.
  Source inspection traced this to the reference label lacking the candidates'
  28px remove button. All review slot labels now reserve the same 36px minimum
  height (button plus 8px bottom padding), aligning the card starts and shared
  playback sections without adding a dummy control.
- `npm run typecheck` and `npm run package` passed, including the production
  build and Windows installer. Post-fix visual alignment has not been verified
  in the running desktop.

# Playground review cards (2026-10-02)

- `npm run typecheck` and `npm run build` passed after the card extraction and
  Playground results integration, including the final native-preview reset on
  view/review changes. No automated test infrastructure was added.
- `npm run package` rebuilt the production app and Windows NSIS installer with
  the revised cards. Nothing was published.
- A fresh development desktop was started through the bundled CLI. A temporary
  project/session imported a locally synthesized calibration WAV and opened a cue
  review. Playback status remained stopped on open.
- The live accessibility tree showed a single Playground heading and audition
  results group, with a shared sound-card article (name, format, duration, kind,
  date, play control), candidate notes/selection and cue feedback controls. The
  existing generation form followed those results in the same Playground.
- Explicit CLI repeat playback changed the card action to Stop; explicit stop
  restored Play. Saving a selected cue through the CLI updated the card to
  “Selected for this cue”. Editing candidate notes through accessibility enabled
  Save review and Discard/reload and disabled navigation/play until saved.
- Screenshot capture failed with `FrameArrived timed out`; direct card clicks
  failed with `coordinate input geometry is unavailable`. Visual appearance,
  responsive layout, UI save/export clicks and the return-to-all-sounds click are
  therefore not manually verified. Accessibility structure and player status are
  not listening or creative-quality evidence. No provider generation was invoked.
- The validation desktop was closed, its temporary records/audio/input directory
  removed, and the original active project restored.

# Agent workbench (2026-10-02)

SfxChat 0.2 was verified without adding automated test infrastructure or invoking
paid generation. Temporary inputs/exports and scoped harness directories were created
outside the repository; checks used the actual CLI, named-pipe owner and renderer.
The app instances started for validation were closed, temporary projects/media and
exports were removed, and the previously active project was restored.

- `npm run typecheck`: passed, including the final review-revision stop change.
- `npm run package`: production main/preload/renderer, bundled CLI and pinned runtime,
  native helper and Windows NSIS installer built successfully. Source archives and
  runtime SHA-256 pins were checked by the build. Unsigned output is
  `release/SfxChat Setup 0.2.0.exe`; nothing was published.
- CLI cold-started the development build, then the packaged `win-unpacked` desktop
  after closing development. Each served status through encrypted discovery. The
  discovery directory has a protected DACL with two rules; discovery is encrypted
  and an invalid token returned `UNAUTHORIZED`.
- Twenty-two live CLI checks passed: review persistence across restart, rejection,
  stale revision conflict, six concurrent readers, bounded feedback wait waking on
  change, decision attribution surviving unrelated edits, revision history, project/
  session and asset isolation, absolute import-path enforcement, failed-admission
  replay without jobs, conflicting request-ID reuse, no provider dispatch, review
  opening without autoplay, explicit repeat/stop, complete selected-cue OGG manifest,
  preview-gain exclusion, destination collision refusal, exact original hash, and
  runtime/packaged/canonical guidance agreement.
- Final packaged follow-up: saving a new review revision stopped scheduled playback.
  Local analysis returned the source rate/channels, and a loop trim through the registry
  retained its parent lineage.
- Real MCP stdio initialization returned 36 tools; review inspection returned the
  saved revision. Spectrogram and bounded clip calls returned native image/png and
  audio/wav blocks plus structured results. The guidance resource returned all six
  documents. Stderr was empty. Disconnecting MCP left the desktop available.
- Scoped installations for Codex and Claude passed in temporary project and temporary
  user-home roots. Checked dry-run with no writes, 18-file combined installation,
  identical no-op, unrelated JSON/TOML configuration preservation, conflict refusal,
  forced replacement with backup, and uninstall retaining unrelated entries. No real
  personal harness configuration was changed by these checks.
- A locally synthesized 0.5-second stereo 44.1 kHz calibration WAV was imported.
  Original export retained SHA-256
  `b658e6a715519733b87c408995282e5aa92c107039a57227524a40bf8c46e1ca`.
  WAV and OGG metadata both retained 44.1 kHz, two channels and 0.5-second duration;
  the OGG codec was Vorbis I. The encoder refused unsupported multichannel input with
  its explicit limit. Actual renderer repeat/stop was checked on the WAV; container
  inspection alone is not OGG playback or listening evidence.
- The packaged review UI's accessibility tree contained the saved cue, preview gain,
  revision, agent attribution, notes, decision controls, ordered-cue controls and
  export controls. Setting cue feedback through accessibility made Save review
  enabled. Direct clicks were blocked by the computer-control tool's unavailable
  coordinate geometry; screenshots also timed out. UI save/export, visual layout,
  native hide/minimize cancellation and Settings installation clicks remain unverified.
- Compared all three old assistant instruction blocks against canonical references.
  All quoted examples survived. Five paragraphs differ only for the reviewed
  interface/modality adaptations and narrower app-provider editing claim. Complete
  design, SFX, music, provider, editing, evidence and session-label guidance remains.
  Package resources contain SKILL.md, guidance.json and all six references. Runtime
  guidance hash and each returned document matched the source/build snapshot.
- Documentation links and UTF-8 were checked; `git diff --check` passed. Production
  dependency audit reported zero vulnerabilities. No provider/login success, semantic
  audio quality or human selection approval is inferred from these checks.

Remaining live coverage: paid generation completion, cancellation/recovery of actual
provider jobs, partial large-batch admission under shutdown, uncertain billed outcomes,
fresh NSIS install/uninstall and its PATH hook, consumption/trust by running Codex or
Claude harnesses, and the UI gaps above. Replay was exercised with a nonexistent
provider ID that failed before dispatch; it is evidence of durable request identity,
not a billed-provider retry exercise. Existing queued/running recovery code was
preserved and reviewed. Skill/media rights are not established by software licensing.

## Chat transcript media cards (2026-09-22)

Every spectrogram image and listening clip the assistant attaches is now an
inspectable transcript record: the tool activity message carries `ChatAttachment`
metadata (id, kind, label, media type, size, interval) and the chat history renders
it as a card — image preview or playable clip with its label. Bytes live at
`chat-media/<attachment-id>.<png|wav>` (unique-temp rename) and serve through
`sfx-media://chat/<message-id>/<attachment-id>`, which resolves only attachments
recorded on a message in the active project and supports byte ranges (seeking);
snapshots carry metadata only. Transcript attachments deliberately persist after
model-context eviction.

- `npm run typecheck` (`npx tsc --noEmit`): passed.
- `npm run build`: passed (main 237.19 kB, preload 2.57 kB, renderer 764.47 kB, CSS 34.10 kB).
- A third temporary harness outside the repository (esbuild bundle under Electron's
  Node with `ELECTRON_RUN_AS_NODE`, deleted after the run) reported 9/9 checks:
  messages without attachments keep their exact JSON shape; an attachment
  round-trips through `addMessage` to the project-scoped `store.message` lookup;
  cross-project and unknown lookups fail exactly like missing; `saveChatAttachment`
  writes `chat-media/<id>.<ext>` with bytes intact and both PNG/WAV paths resolve;
  and snapshots carry the attachment metadata.
- Live launch of the production bundle (`npx electron out/main/index.js`, real
  profile, 15 s, then terminated): `app.started` at 2026-09-22T15:11:01Z with no
  `start_failed` and no `operation.failed` entries in the rotating diagnostics.
- Not verified: card rendering in the chat sidebar, image display, and audio
  playback/seeking over `sfx-media://chat/...` were not driven in a running app
  (covered by typecheck and the store/media harness only). No live provider turn
  was made and no listener judgment is claimed.

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

## GPT-6 Sol and Luna built-in choices (2026-09-22)

OpenAI's Codex model documentation confirms `gpt-6-sol` and `gpt-6-luna` as
selectable IDs, subject to account availability. The local non-secret Codex
model catalog (fetched 2026-09-23 UTC, client 0.155.0) reports a 272,000 default
context window for each; details are in [chat-context research](research/chat-context.md).
Both were added to the built-in picker. The existing `gpt-5.6-sol` fallback was
left unchanged.

- `npm run typecheck`: passed.
- `npm run build`: passed for main, preload, and renderer.
- No live Codex turn or account-access check was run for either new model.

## MIDI creator (2026-10-06)

Built and committed in reviewable steps: FluidSynth 2.6.1 with the GeneralUser GS bank in the native
helper, the beat-based model and SMF codec, MIDI assets with rendered playback, the `compose_midi`
operation and assistant tool, the composing guidance, and the MIDI studio workspace. Synthesis pins,
hashes, and the build recipe are in [research/midi.md](research/midi.md); composing-guidance
provenance is in [research/music-composition.md](research/music-composition.md).

Run and passed:

- `npm run typecheck` and `npm run build` (electron-vite main/preload/renderer plus the agent and
  native helper) after each step. The packaged skill now contains the three MIDI references and the
  guidance hash moved accordingly.
- `render-midi` exercised directly with the built helper against the real bank: a missing or
  non-`MThd` MIDI file fails without leaving an output file; renders are exactly `seconds + 2` long;
  gain is honoured (peak 22,708 at gain 0.25 against 32k at 0.5); the Vorbis `encode` path still
  emits valid Ogg after the new static link.
- SMF codec round-trip (compiled standalone, 11 assertions): track count, drum flags, programs,
  labels, note pitch/start/duration, default velocity, tempo, meter, and duration preserved; a
  hand-built format-0 file splits into two tracks; malformed and out-of-bounds input rejected; the
  generated SMF renders in FluidSynth with the last sound at the expected time.
- Bank and renderer modules (12 assertions): 261 presets and 13 drum kits parsed from the bundled
  bank, bank identity hashed, non-SF2 input rejected, an exact 4.000 s render for a 2 s clip,
  identical cache reuse, a single cache file, working file export, and non-silent audio.

Browser UI pass (2026-10-06, `npm run dev:browser` on a freed single-instance lock, driven with
the agent-browser CLI; no provider or chat call was made):

- The MIDI Studio tab opens the studio: clip rail, transport (Play/Stop, Loop, tempo, meter, snap,
  zoom, add track, save, clip name), and a track block whose instrument picker is populated from
  the real bank ("0 · Grand Piano" through "127 · Gun Shot").
- Drawing works: four synthetic and one real click on the roll produced five notes and updated the
  summary to "7.50 beats · 3.75s · 1 track".
- Playback works: Play switched the transport to "Stop" and the playhead advanced to 152 px; Stop
  reset it to 0. The player is a detached `Audio` element, so the clock-driven playhead is the
  visible evidence rather than a DOM `<audio>` node.
- The instrument picker applies: selecting program 40 changed the note label to
  "Violin · beat 1 · velocity 100".
- Saving works: "Save clip" wrote the clip (railed as "Studio UI check — 5 notes · 3.8s"), moved
  the tab counts to "MIDI Studio 1" and "Playground 56", and switched the action to "Save as new
  clip" (derivative mode). A screenshot was captured during the pass.
- The pass created one 5-note clip ("Studio UI check") in the selected project's MIDI library and
  playground. It is left in place because no asset-delete operation exists.

MCP server check (bundled CLI `sfxchat mcp`, stdio JSON-RPC handshake):

- `initialize` returned protocol `2024-11-05` and server `sfxchat@0.2.0`.
- `tools/list` returned 37 tools, including `compose_midi`, `generate_music`, `audio_listen`,
  `guidance`, `set_playground`, and `export_asset`.
- `resources/list` exposed `sfxchat://guidance`. The process exited 0 with empty stderr.

Still not run (coverage gaps):

- **No live assistant turn** composing a clip; the model-driven path is exercised through the
  registered operation and tool schema, not a hosted turn.
- **No listening evidence.** No model listened to a render, and no claim is made about the
  perceptual quality of the bank, the synthesis, or any composed clip.

## GPT-6.1 Sol built-in choice (2026-10-05)

OpenAI's Codex model page confirms `gpt-6.1-sol`, subject to plan and rollout. The
local non-secret Codex model catalog (fetched 2026-10-06 UTC, client 0.160.0)
reports a 272,000 default context window; details are in
[chat-context research](research/chat-context.md). It was added to the built-in
picker; the `gpt-5.6-sol` default was left unchanged.

- `npm run typecheck`: passed.
- `npm run build`: passed for main, preload, renderer, agent, and native helper.
- No live Codex turn or account-access check was run for the new model.

## Immediate cue decision saves (2026-10-08)

Candidate selection, Reject all, and Unreviewed now submit the current review draft
immediately through `review_update`, including pending notes and other edits. Save
review remains available for edits made independently of a decision. Pending
operations disable decision controls; failed saves retain the draft. Successful
responses preserve edits made in flight on the new revision and cannot be replaced
automatically by an older snapshot.

- `npm run typecheck`: passed.
- Production build (run by `npm run dev:browser`): passed for main, preload,
  renderer, agent, and native helper.
- `git diff --check`: passed.
- Browser host launch was refused because an existing SfxChat owner was running.
  The user requested continuing without live verification. No existing process
  was terminated, and the attempted development host exited.
- Follow-up browser verification ran after the user closed the existing owner:
  `npm run dev:browser` built and opened the real renderer/library on loopback.
  A separate `Cue save verification - 2026-10-08` board used the existing
  `ui_move` and `ui_accept` candidates; original review choices were unchanged.
- Selecting a candidate with pending cue feedback saved revision 2 without
  clicking Save review. Reject all saved revision 3. Both decisions and the
  feedback survived leaving and reopening the board. Unreviewed saved revision 4;
  a full browser reload and reopening retained the selected/unreviewed states and
  feedback. Save review was disabled after successful saves.
- An empty review title made a decision save fail with `INVALID_ARGUMENTS`.
  The decision draft and unsaved banner remained, and Save review was enabled.
  Correcting the title and clicking the decision again saved revision 5 and
  cleared the error/draft banner. Pending operations visibly disabled decisions.
- Verification ended with both cues unreviewed at revision 7. The separate board
  remains as a manual verification record, explicitly labeled as having no
  listening decision. Stop audio was clicked before leaving; the browser tab was
  closed and the development host shut down gracefully with exit code 0.
- Coverage gap: edits during an in-flight request, external revision conflicts,
  and playback interactions were not exercised. No provider calls, paid
  generation, or audio playback were performed.
- Installer build: `npm run package` compiled successfully but packaging failed
  with `EPERM` renaming Electron's extracted directory under `release/`; retrying
  in a new directory under `release/` had the same result. Packaging succeeded
  with `npx electron-builder --win nsis --x64 --publish never` and an output
  override to `%LOCALAPPDATA%/Temp/SfxChat-cue-review-release-20261008`.
- The new 0.2.0 NSIS installer completed `/S` installation with exit code 0 at
  `%LOCALAPPDATA%/Programs/SfxChat`. SHA-256 comparisons matched the built package
  for `SfxChat.exe`, `resources/app.asar`, the agent CLI, native helper, and bundled
  Node runtime. The installer and its block map/update metadata were copied back
  to `release/`; nothing was published.
- The installed CLI's `status` returned ready, the installed executable launched,
  and `review_get` read revision 7 with both verification cues unreviewed and the
  retained feedback. The installed app was left running for the user. Native UI
  behavior was not separately exercised.


## 2026-10-12 — Project-wide reviews/Playground and workspace deletion

- Typecheck and production build passed. Real `npm run dev:browser` used the existing
  profile. Schema v4→v5 preserved all 22 existing reviews except obsolete session scope;
  SHA-256 of ordered immutable history rows was unchanged. All five project Playground
  unions matched their old conversation lists, including 1,029 unique candidates in the
  largest project. SQLite foreign_key_check returned no rows.
- Browser: the same archived review list and 1,029 candidates remained available after
  conversation switches; paging showed pages 1 and 2 of 43. Existing archived review
  stayed selected across a switch and remained readable after reload.
- A disposable project imported one existing WAV, with no provider calls. Creating a
  review from conversation B included audio imported in A. Unsaved candidate feedback
  survived a switch to A/B and Done saved it at revision 2 with user attribution.
  Reopening through the CLI advanced revision 3 and restored editing in the UI.
- Project and conversation confirmation dialogs named the target, described deletion,
  and Cancel preserved the record. Actual deletion was exercised through the same owning
  operations via CLI: deleting B retained review, notes, asset and shared Playground;
  deleting the last conversation created an empty replacement. Deleting the disposable
  project removed conversation/review/history/asset/search/Playground records and selected
  an existing project. Wrong-project review lookup and deleted-project lookup failed.
  All original reviews, history, and merged Playground lists remained unchanged afterward.
- Legacy MCP stdio initialized/subscribed/read a project-only review URI. Reopen emitted
  notifications/resources/updated with that URI; reading returned active status. Closing
  stdin exited with code 0. No claim is made that a host automatically wakes an agent.
- One-shot Play and Stop controls were invoked with Loop off; playback quality was not
  assessed. No paid generation or auth changes. Browser host and temporary helpers were
  stopped after validation. Temporary verification records and imported copy were removed.
- Gaps: native-window deletion confirmation, the confirmation dialog's final submit click,
  last-project fallback in a one-project library, deletion during real paid jobs/imports,
  modern MCP notification routing, and fresh/pre-v4 schema migration were not exercised
  in this change. Busy guards and persisted model-history cleanup were inspected in code.

- Packaged NSIS using the installed Electron distribution (the existing extraction-lock
  workaround), installed silently with exit 0, and matched installed executable, app.asar,
  CLI and skill files to the release hashes. Installed CLI listed 19 reviews in the main
  project without session fields and opened an archived review with stopped playback.
  Codex/Claude user skills updated with backups; all 28 skill/config entries are current.
  No MCP registration changes. Reconnect existing MCP clients for the new operation schemas.


## 2026-10-12 — Large review Play responsiveness

- Typecheck and production build passed; verification used the real browser host and
  the existing active Barnaby stage-2 review (58 cues, 116 reference/candidate cards,
  1,387 project assets). No provider calls or saved review edits were made.
- Source inspection found ~30Hz clock updates flowing through App into the entire
  review, plus two full-library selects per cue (~161,000 option nodes for this review).
  The revised DOM had 182 options at rest. Focusing Add candidate populated 1,387 options;
  blurring returned that control to one option. Two nearby waveforms had loaded while
  off-screen cards remained deferred. All 58 cues remained present; no review pagination.
- User-driven browser clicks reached visible playing state in 359 ms (first reference),
  318 ms (first candidate), and 308 ms (last-cue candidate). These are tool-observed
  click-to-UI timings, not audio-output latency or a controlled before/after benchmark.
  Position advanced; seeking Home returned to zero. Done remained enabled during playback.
- Immediate Play/Stop left no playing or loading buttons. A temporary unsaved note
  survived playback, and Discard / reload restored the original text. Loop stayed off;
  audio was stopped after each check. Browser console reported no errors.
- Progress is now subscribed per active card; the app/board no longer receive clock
  ticks. Loading uses a cancellable fetch and keeps review persistence submission separate.
  Source review covered cancellation after resume/fetch/decode and stale-load suppression.
- Gaps: no native audio latency measurement, acoustic evaluation, paid generation,
  MIDI playback, slow-network failure injection, or exhaustive keyboard-picker coverage.
  The development host and temporary browser were closed after checks.

- NSIS packaging and silent installation completed with exit 0. Installed executable,
  app.asar and CLI hashes matched release/review-playback-final. The installed app reopened
  the same 58-cue review with playback stopped. Skills needed no changes for this renderer fix.

## 2026-11-03 — review_wait matches PixelChat

- `npm run typecheck` and `npm run build` passed. `npm run dev:browser` ran on the real
  profile with the installed app closed, in a scratch project with two imported 0.5 s
  local tones (no provider calls); the project was deleted afterwards.
- `review_wait` with `wait: 0` returned no events, cursor 1, `timedOut: true`; the old
  `timeoutMs` argument returned INVALID_ARGUMENTS; `from: "any"` after revision 0
  returned the agent's `created` event. A 75 s wait completed with `timedOut: true`,
  confirming the bridge no longer drops authenticated requests at 60 s.
- A waiting call ignored an agent `review_update` (revision 2) and woke about 0.2 s after
  a browser click selected a candidate, returning only the user's revision 3 (`saved`,
  cue `tone`). With `until: "completed"`, pressing Done woke it about 0.15 s later with a
  user `completed` event and `completedBy: "user"`.
- `sfxchat watch-review` on the completed review printed `watch.started` then
  `watch.ended` (completed) and exited 0; a missing review ID printed the usage error.
- Gaps: MCP resource notifications on the new wait shape, a Codex client holding a long
  wait, and the in-app assistant without `review_wait` were not exercised. The
  development host and browser tab were closed after checks.
