# SfxChat architecture direction

## Status and provisional stack

Only documentation and inherited API knowledge exist. No runtime, public API, schema, authentication implementation, or storage backend has been created.

Electron with React/TypeScript is the likely desktop stack, subject to confirmation at implementation kickoff. A .NET host and Blazor UI are not planned. No bundler, application framework, dependency versions, packaging matrix, database engine, or IPC protocol is selected by this foundation.

The first feature session should choose those concrete runtime details and update this document with the resulting implementation and verified commands. These deferred implementation choices do not block this documentation milestone.

## Intended ownership and data flow

The UI and the assistant should request operations through shared application services. Those services own library changes, generation workflows, and revisions; provider adapters own external transport; persistence owns durable records and media references. Visible status and results flow back to both chat and the workbench.

- **UI:** conversation, provider settings, library browsing/search, playback, comparison, and manual corrections. Keep authoritative workflow behavior outside presentation components.
- **Assistant:** specialist guidance, tool orchestration, task context, and progress. Library management tools should perform the same operations available through manual controls.
- **Providers:** separate Codex chat authentication from ElevenLabs/Gemini audio capabilities. Resolve available models/capabilities through the owning adapter. Do not assume interchangeable payloads or that audio understanding implies music generation.
- **Background work:** own generation jobs and active assistant turns outside renderer lifetimes. Future implementation must account for cancellation, renderer reload, interrupted jobs, and uncertain provider outcomes without accidental duplicate billing.
- **Libraries:** preserve audio files and durable searchable metadata, including names, collections, traits/tags, original prompts, provider/model/request information, source hashes, derived versions, and review notes. Choose physical file layout, indexing, and persistence only when building this capability.
- **Knowledge:** the current Markdown bundle is developer/agent-accessible. Later runtime prompt composition or retrieval must deliberately load relevant expert guidance; copying documents alone does not make a runtime assistant knowledgeable.

## Credential and desktop boundaries

API keys should be entered through app settings and persisted using an OS-backed secure storage facility. OAuth tokens need the same protection. Keep secret resolution and external requests in privileged application code behind narrow operations; expose only readiness/masked status to normal UI reads and assistant tools. Credential entry is a transient save operation, not a reason to keep a key in browser storage.

Do not use plaintext SQLite rows, browser local storage, logs, manifests, or committed settings as the credential store. If OS-backed protection is unavailable, report the configuration problem instead of silently falling back to plaintext. Select and verify the actual platform mechanism when implementing settings.

If Electron is adopted, define a restricted preload/IPC boundary and renderer isolation when scaffolding it. Shell execution or unrestricted filesystem access is not an implied assistant capability.

## Reference applications

These are inspected precedents, not dependencies. Their local source locations and snapshot revisions are recorded in [sources](sources.md).

| Reference | Useful lessons | Boundary for reuse |
| --- | --- | --- |
| Lorekeeper | App-process chat turns, provider transport separation, streamed tool operations, operation-owned persistence, background jobs and recovery. | Learn the ownership and lifecycle patterns; do not copy its book domain, .NET host, or entire framework. |
| PixelChat | Creative asset workflows, generation provenance, review decisions, reusable guidance, and shared actions for UI and assistant tools. | Adapt the creative workflow to audio; avoid importing image editors, sprite models, or Blazor components. |
| Shellmate | Focused specialist chat, visible tool progress, and a turn runtime that survives UI navigation. | Use as a secondary comparison; shell/terminal access is not part of SfxChat's foundation. |

The inspected reference apps persist credential/token values in local database storage; their implementations do not establish OS-backed encryption. SfxChat must meet its secure-storage requirement independently.

Lorekeeper's inspected Codex integration uses account OAuth/PKCE and a Codex Responses transport. Record this as local implementation evidence, not an assurance that its endpoint/client configuration is a supported contract for a new app. Verify current authentication guidance before selecting SfxChat's integration; never copy an existing account's tokens or database.

## API handoff and next implementation work

The [knowledge index](knowledge/README.md) contains ElevenLabs SFX request/prompt handling and Gemini audio-input lessons. Music generation, broader expert sound-design knowledge, and up-to-date provider capability research remain future work.

Next: confirm the desktop runtime, establish an empty app with clear boundaries, then define a small vertical slice covering authenticated chat, securely configured provider access, one audio-generation workflow, audition, and searchable persisted results. This is a suggested sequence, not an authorization to implement it as part of the foundation.

## Verification now

For this milestone, check document links, file-map coverage, attribution, exact copies of the vendored skill/license, secret exclusion, and consistent status wording. There are no application build or runtime checks to run. Future integration claims require testing the actual provider and target platform; compilation alone will not prove login or secure storage.
