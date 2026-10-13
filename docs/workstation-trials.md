# Local workstation creative trials — 2026-10-13

All work used the actual newly built stdio MCP server and the running application.
An external temporary client initialized MCP, discovered tools, read topic-selective
guidance, and created project/session/arrangement records through shared operations.
Scores were added incrementally by pattern and track, rendered, inspected, revised,
and placed into shared reviews. No paid generation or third-party plugin was used.
Original score/patch choices are stored in each portable recipe; GeneralUser keeps
its own license. These are technical demonstrations awaiting human listening.

Exports are under `%USERPROFILE%/Music/SfxChat-workstation-2026-10-13`.
Each folder has initial/revised WAVs, provenance sidecars, a portable arrangement,
and listening notes. The top-level trial-summary records IDs and full diagnostics.
Reopening every package through MCP succeeded, including remapping sample assets.

| Folder / project name | Final deliverable | Revision and preservation |
| --- | --- | --- |
| orchestra / Local — Lanterns at the Crossing | 123 s, 9 tracks; 23 s eight-measure preview including tail; isolated theme; MIDI tracks | Arrangement r13. Oboe development changes to clarinet; every stored note pattern remains byte-identical. Rising D–F–A identity, descending answer, sequential development, contrasting register/harmony, return and coda. |
| house / Local — Afterglow Circuit | 126.871 s, 8 tracks | r13. Shorter bass release and stronger kick sidechain preserve all note onsets. Pulse, bass, syncopated stabs, restrained hook, sparse break and return are deliberate choices for this brief. |
| trance / Local — Glass Horizon | 142.130 s, 8 tracks | r14. Less detune/delay and brighter return preserve all hook notes and section timing. Distinct hook, repetition/ending variation, breakdown, build and return. |
| stone / Local — Basalt Gate | 9 s with tail; three variations, 15 mix/component files | r7. Weight changes retain timing; friction becomes granular playback of its own locally synthesized source. Separate weight, friction, debris and space return. |
| machine / Local — Clockwork Ventilator | Exact 8 s sustain; three variations, 15 mix/component files; separate attack/release | r7. Clatter texture changes retain pulse spacing; later export uses a warmed-up sustain cycle. Separate motor, clatter, airflow and space return. |
| magic / Local — Prismatic Collision | 7 s with tail; three variations, 18 mix/component files | r8. More low weight retains impact timing; a region of the locally authored ring is reversed with the sampler before contact. Separate weight, ring, air, reverse preparation and space return. |

The first revision of each deliverable preserved all stored pattern hashes. Further
effect revisions stayed within three creative rounds. A too-long final note in the
first trance request was rejected by validation and corrected before rendering.
The initial reverse sample placement addressed the source's silent tail; the final
recipe uses a bounded sampler region. This was a source-selection correction, not
a listening judgment. All initial candidates and revisions remain available.

## Technical observations

- Final mix sample peaks: orchestra 0.154860, house 0.448815, trance 0.448027,
  stone 0.370425, machinery 0.098335, magic 0.397278. No clipped samples were
  reported. These values do not judge loudness, timbre, memorability or production quality.
- All outputs are 48 kHz float WAV. Effect components share exact frame counts:
  stone 432,000; machinery 384,000; magic 336,000. Direct exported-file summation
  of variant-1 track and return stems differed from the mix by at most 5.28e-8
  amplitude. The limiter was inactive at these levels; nonlinear master processing
  generally prevents stems from reproducing a mastered mix without reapplying it.
- The final machinery seam has zero endpoint jump after the 20 ms taper. Head/tail
  RMS improved from 0.02863/0.01172 to 0.02339/0.02246. Correlation remains low
  because the texture includes noise; neither statistic proves perceptual seamlessness.
- Each package was exported and reopened through MCP. Original source metadata,
  hashes and exact bank are retained. Orchestra MIDI export includes notes,
  tempo/meter and controller data with an explicit audio-only limitations manifest.
- The eight-measure arranged theme and theme-alone candidates make the general
  guidance's identity-versus-masking comparison available to the user.

## Listening reviews

All decisions remain unreviewed. Reviews contain initial and revised candidates,
plain-language changes and, where relevant, preview/variant/component candidates.

| Project | Review ID |
| --- | --- |
| Lanterns at the Crossing | b9d31815-7bf3-4a46-8ec2-62365adc2769 |
| Afterglow Circuit | 0ee44ba3-928b-4dc7-a73a-929308a4b45d |
| Glass Horizon | 90e4429e-94a6-4cce-972e-d6d0b51104c3 |
| Basalt Gate | c1d20c0e-dad8-47cf-ab5e-37ff93357c90 |
| Clockwork Ventilator | f665a940-422e-422b-a0cf-7c74cc195828 |
| Prismatic Collision | c03cf611-9fd3-4b5a-8528-0fa9d5626ef2 |

Actual MCP `review_open` displayed the orchestral comparison without starting audio.
No model audio understanding was available or claimed. The remaining taste questions
are theme recognition/development, groove and return impact, material character,
repetition fatigue, and whether the loop feels continuous in use. The skills do not
encode these demonstrations as genre profiles.

## Mozart score reconstruction — subsequent benchmark

User feedback on the original examples was that they were recognizable music/effects
but not impressive. The next benchmark fixes the composition: Mozart, K.525,
movement I, measures 1–27, using the four printed parts in Mutopia-2018/08/04-2230.
This is a string-serenade excerpt, not a complete symphony or a matched recording.

Project `92084779-b95e-4d6b-af6b-fe8093bf5cd9`, review
`097485b7-a1b8-4dad-ae1a-5c9dc0520a0f`. Exports are in
`%USERPROFILE%/Music/SfxChat-Mozart-K525`, including `expressive.wav`, `baseline.wav`,
standard MIDI, per-track performance MIDI, source PDFs/LilyPond/MIDI and the portable
editable performance. Source/license details and SHA-256 values are in its manifest.

The typesetter MIDI was read as note data; printed sixteenth-note tremolos omitted
by that MIDI were expanded, and short printed trills were given explicit realizations.
The source's grace timing was retained. Both final arrangements contain the same
788 pitches/onsets (190/300/157/141 by part), 132 quarter notes/minute and 108 beats.
Baseline has uniform velocity/full durations/dry quartet programs 40/40/41/42.
Performance adds score-informed dynamics, note separation/slurs/dots, phrase expression
and a restrained shared room. These are approximations, not recorded bow articulations.

Final renders have 2,452,364 frames at 48 kHz (51.091 s including two-second tail),
RMS 0.065 after linear level matching, zero clips, peaks 0.712861/0.827662. The limiter
was inactive. RMS matching is not perceptual loudness matching or musical approval.
Both source projects/exports and initial quieter renders remain available. Decisions
remain unreviewed; no model hearing or acoustic-quality assessment is claimed.
