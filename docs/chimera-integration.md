# Chimera / card-merger migration

This is an integration recipe; Chimera files have not been changed. Its sound-design
skill, craft reference, batch preparation, HTML review generator and pick integration
were inspected at revision `02d925a78028558a9fea3b6efd5fbf59da40ce9c`.

Keep Chimera's game-specific briefs, cue IDs, authority rules, soundscape direction,
Godot import/in-game validation, and shipping paths. Replace the shared transport and
audition mechanics with SfxChat:

| Current workflow | Workbench workflow |
| --- | --- |
| Raw ElevenLabs HTTP calls / local output bookkeeping | `generate_sounds` using explicit project/session and retained request UUID; recover with `inspect_jobs` / `jobs_wait` |
| Temporary HTML booth from `build_review.py` | Persistent `review_create`, then `review_open` in the existing app |
| Cue groups, current reference and gain controls | Cue keys/briefs/candidates/reference IDs and separate preview gains |
| User audition / looping | Manual Play/Pause, Stop and Loop in review cards; agents open reviews without autoplay |
| Pick/reject JSON and candidate notes | Revisioned review decisions, `review_wait` and cue/candidate feedback |
| Hand-copied preview WAV picks | `export_review` with a complete manifest and chosen original/WAV/OGG encoding |

Install project guidance (optionally MCP) in the actual repository directory:

```powershell
sfxchat skill install --scope project --project C:\work\card-merger --target codex --target claude --mcp --dry-run
```

After reviewing the preview, repeat without `--dry-run`. Alternatively use `--scope
user` for harness-wide installation. Keep the Chimera skill as the project-specific
creative director: it should read SfxChat's installed design/provider references,
then apply its game constraints before asking SfxChat to generate. Do not copy
SfxChat's maintained provider instructions into Chimera.

For an existing batch, import its original WAV/MP3 files and current in-game
references into a dedicated Chimera project/session. Preserve original external
metadata/manifests alongside the imported files; imports cannot reconstruct missing
provider request records. Build a cue board with the original stable cue names and
candidate IDs returned by import. Read feedback before planning each revision, use
`parentId` for lineage, and keep rejection distinct from unfinished review.

The exported manifest is a new contract, not a drop-in input to
`tools/integrate-sfx-picks.py`. A future Chimera-side adapter should explicitly map
cue keys to Godot destinations, require `complete:true`, honor unresolved/rejected
cues, use the manifest's exported-file hash (different from source hash after
conversion), and preserve source records. Preview gains are not shipped. If a gain
change must become a production edit, make that deliberate in the game's audio
pipeline. Continue in-game listening and import checks after integration; playback
status, plots and model observations do not certify creative fit.
