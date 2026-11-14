# SfxChat agent guidelines

## First read

- Read [VISION.md](VISION.md), [FILEMAP.md](FILEMAP.md), and [docs/architecture.md](docs/architecture.md) before substantive work.
- Before provider, prompting, audio, or credential work, read the relevant [API knowledge](docs/knowledge/README.md) and [source provenance](docs/sources.md).
- Verify implementation from files and relevant checks. Vision and proposed architecture are intent, not evidence of working features.
- Keep this file focused on durable working practices. Product direction belongs in VISION, technical decisions in architecture, and navigation in FILEMAP.

## Repository workflow

- Inspect branch, working tree, index, and remotes before starting. Continue on the current branch.
- Start new work from a clean commit. When you find uncommitted work, analyze whether it is complete and coherent (code, contracts, docs, and checks agree). If it is and committing is safe, verify it, commit it on its own, and push it before beginning. If it is incomplete or ownership is unclear, ask for direction rather than overwriting or mixing it with new work.
- Preserve unrelated user changes. Do not discard work, rewrite history, force-push, or create remotes without authorization. Pushing verified commits to the current branch on the existing `origin` is authorized.
- Finish each feature with a reviewed, focused commit, push it to `origin`, and verify a clean working tree.

## Implementation practices

- Inspect callers and downstream effects before editing. Use `rg` for file and text discovery.
- Keep UI interaction state separate from library operations, assistant orchestration, provider transports, and background jobs. Manual UI actions and assistant tools should use the same owning operations.
- Preserve provider boundaries; do not spread provider-specific payloads or model names through the UI.
- Implement only what the current milestone needs. The desktop stack is Electron with React/TypeScript; keep privileged operations in the main process and the renderer isolated.
- Replace superseded runtime code and documentation coherently. Preserve necessary immutable history and unrelated work.
- This project deliberately carries no automated tests. Do not add or reintroduce
  unit, integration, or end-to-end suites (for example Vitest, Jest, or Playwright);
  `*.test.ts`, `*.spec.ts`, or any other test-only files; test runners, test
  dependencies, or CI test steps; test-only fixtures, mock providers, deterministic
  test modes, or harnesses built to exercise the app. Delete such scaffolding when you
  encounter it rather than extending it, and remove its configuration, scripts,
  dependencies, documentation, and CI usage in the same change so no dead test
  infrastructure remains.
- Verify work with `typecheck`, the production build, and live/manual checks instead,
  and record what was actually run. Temporary local helpers are allowed, but keep them
  outside the repository and delete them when the check is done.
- For manual UI verification, use `npm run dev:browser` and control the printed
  loopback URL with browser tools. This runs the real renderer against Electron's
  main-process operations, actual library, and OS-backed credentials; it is not a
  mock or an automated test mode. Keep paid calls within existing authorization.
  Use the native desktop only for desktop-specific integration checks. Do not
  repeatedly attempt native computer use for ordinary UI checks. Stop the browser
  development host after validation and record any browser/desktop coverage gaps.
  Use one-shot playback for verification, leave user Loop toggles off, and stop
  audio before leaving a page. Agent tools may open reviews but cannot play audio.
- Use UTF-8 and LF for authored text. Preserve third-party license notices and document changes to vendored material.

## Credentials and provider operations

- App-configured API keys and OAuth tokens must use OS-backed secure storage through a narrow privileged boundary. Never use plaintext database storage, browser local storage, committed configuration, prompts, or logs for secret values.
- The UI may accept a credential for saving; it should receive only readiness/masked status afterward. Resolve stored credentials inside provider operations, not assistant tool arguments.
- Never copy sibling-app databases, auth caches, real credentials, or account tokens into this repository. Reference code is not proof of secure storage or a supported authentication contract.
- Revalidate provider models, capabilities, request fields, limits, SDKs, terms, and pricing against official sources when implementing or invoking them. The bundled notes are historical handoff material.
- Keep paid work within the user's authorized scope and budget. An authorized batch does not require repeated permission; missing spending authority does. Never silently retry an uncertain billed generation or expand a batch indefinitely.

## Audio evidence

- Preserve original returned files and exact prompts, provider/model details, request identifiers when available, hashes, and edit lineage. Keep preview gain separate from originals.
- Distinguish technical validation, model observations, and actual listener decisions. Do not claim to have heard audio without an audio-understanding capability; file playback or waveform inspection alone is not listening evidence.
- Preserve uncertainty and rejection feedback. Model confidence and valid audio encoding do not establish creative quality.
- Retain source/license provenance. Skill code licensing does not determine rights to generated media.

## Documentation and verification

- Update FILEMAP whenever files are added, removed, renamed, or materially repurposed. Keep entries concise and exclude generated output.
- Keep architecture and README synchronized with implemented behavior and verified setup commands. Change VISION when accepted product direction changes.
- Validate documentation links, source attribution, licenses, and status claims for documentation-only work. Do not introduce a runtime or test project to verify prose.
- For implementation, run checks appropriate to the affected behavior and record actual evidence. Do not claim provider, login, secure-storage, or platform integration from compilation alone.
- Plan cleanup before starting temporary hosts or helpers and terminate those you start after validation. Never terminate a user-owned process without authorization.
