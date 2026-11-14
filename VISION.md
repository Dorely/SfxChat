# SfxChat vision

SfxChat is an assistant-led local music and sound-design workstation, with optional provider generation, for turning an idea into editable music, usable game audio, and voice, then keeping the results organized and easy to find.

Its assistant should combine sound-design knowledge with skill in prompting AI audio services. Users should be able to describe a need, explore alternatives, audition results, give feedback, refine a sound, and save it into a useful library without manually coordinating disconnected tools.

The desktop remains the distribution target, published as Windows and Linux builds
that people outside the project can download and install. Development should also run the real
workbench in a local browser so agents can verify ordinary UI behavior reliably,
using the same privileged operations, library, and secure credentials. Browser
verification should be the default; native checks cover desktop-specific behavior.

## Creative workflow

- Start from a description, a reference, an imported sound, or an existing library item.
- Help translate intent into a clear brief and effective provider-specific prompts. Use small, informative sets of alternatives and preserve useful feedback between iterations.
- Generate and refine sound effects, music, and voice through suitable provider capabilities. Let the assistant select and switch between configured services according to the task, available capabilities, and authorized spending. Model targets and voice defaults are chosen separately from credentials, and shared guidance covers every configured provider, including per-request overrides.
- Compose music symbolically as well as generating audio: the assistant writes notes into standard MIDI Files that play through a bundled General MIDI sound bank, and users refine those notes by hand in a piano-roll studio. Composing is local and needs no provider or credential.
- A request to create sounds should lead directly to generation, without separate spending approvals or app-imposed generation allowances.
- Make audition and comparison central: playback, repeated-use testing, useful technical checks, and listener decisions should inform revisions.
- Preserve originals, derived versions, exact generation prompts, provenance, and feedback so users can understand how a result was made and repeat useful workflows.

## Assistant and providers

The intended chat assistant supports Codex account login. ElevenLabs and Gemini API access are part of the product direction, with credentials configured inside the app and saved securely. Chat authentication and audio-provider credentials are separate concerns. Model and default-voice selections remain independent, while every capability of a vendor shares one API key. Voice generation supports existing voices and single-speaker scripts; cloning, voice creation, multi-speaker dialogue, and real-time voice chat are outside this milestone.

Provider roles must follow verified capabilities. Sound-effect prompting and endpoints are documented in [docs/knowledge](docs/knowledge/README.md), as are the music providers implemented so far: ElevenLabs Music and Google's Lyria models. Neither note establishes perceptual quality, and unverified provider behavior stays marked as such. Extend the same research practice — dated official sources, recorded request mapping, explicit evidence limits — when adding another provider.

Speech model selection uses the current provider catalog where available, with
model-specific prompting and supported controls shared across the UI, assistant,
and agent tools. New model IDs can be discovered without changing saved defaults;
specialized behavior needs reviewed guidance, and availability never establishes
listener quality or permission to generate additional candidates.

The assistant should explain consequential choices, show progress and results, and acknowledge uncertainty. Automated measurements and model observations support the workflow; actual listening remains important for deciding whether a sound fits.

## Libraries the assistant maintains

Generated sound effects, music, and voice should become first-class library assets, not attachments lost in chat history. The assistant should name assets, add useful traits and tags, group them into collections, and keep their organization current as the library grows. Sound effects, music, and voice are kept in separate libraries so each stays easy to scan.

Users should be able to search by traits, tags, descriptions, initial generation prompts, and spoken transcripts; inspect source and revision history; and manually correct the assistant's organization. Assistant actions should be visible and understandable. Organizing a sound must preserve its original generation record and file identity.

## Projects

Work is organized into projects. A project holds its own conversations and its own effects,
music, and voice libraries, so unrelated briefs, assets, and comparisons stay separate, and the top
bar switches between them. Reviews and the Playground are shared by every conversation
in the project. Users can delete conversations without losing project audio or reviews,
and delete a project through an explicit confirmation. Provider configuration and credentials stay app-level because
they belong to the account rather than to the work. Sessions stay labeled: the assistant
names a session as soon as the goal is clear and renames it when the subject materially
changes, and the user can rename any session or project in place.

## Agent sound workbench

The desktop also serves local agents through a bundled CLI and stdio MCP. Agents
should reuse its provider operations, durable projects/sessions, library and jobs,
then open the same audition UI instead of building temporary audition apps. Explicit
user-controlled playback, cue-specific selections, rejection and notes make human decisions available
to the agent without conflating playback with listening evidence. Reviews use the
Playground results themselves: familiar sound cards grouped by cue, with additional
controls and notes underneath or alongside them.

Installable skills support project and harness-wide scopes and contain the complete
sound-design guidance used by the app assistant. One maintained source covers design,
provider prompting, revisions, analysis, trimming, loops and evidence limits. Agents
can discover current guidance/capabilities and export originals or converted selected
cue packs with provenance. Local agents on Windows and Linux come first; remote services and a
remote collaboration are outside this milestone. A local arrangement timeline,
instruments, effects, routing and automation belong to the workstation. Every
creative agent operation must also have a manual UI path. Playback is user-controlled.

Music guidance teaches general composition, arranging, synthesis and revision
principles. Genre profiles and style conventions belong to user project briefs,
not hardcoded skills. Local creation must be a deliberate first-class option.
The acceptance examples are an orchestral miniature and preview, separate house
and trance arrangements, and layered game-effect families. These are demonstrations,
not product-wide style defaults. Human acceptance follows listening. Plugin hosting
and microphone/hardware MIDI input are candidate workstation features, not exclusions.
Direct game-engine integration remains outside scope for now; exports stay engine-neutral.

## Product character

Agent-created cue sheets should switch the workspace to the new sheet when ready,
without starting playback. Agents may prepare drafts before presenting them.

Reviews have an explicit Done action: completion archives and freezes the review,
retains its decisions and unresolved cues, and makes completion visible to agents.
Users and agents can explicitly reopen a completed review for further editing;
completion preserves whether the user or an agent performed it.

SfxChat is a focused creative tool for building, testing, and managing audio. It should make iteration approachable while retaining enough provenance and control for serious production work. Library management is a core assistant responsibility.

Chat is optional and stays secondary to the audio workspace. Without a configured chat provider the chat panel stays hidden; once one is configured it opens as a resizable left sidebar of roughly one third of the window, and users can hide or show it from the top bar, a choice the app remembers. The right side switches between the library and a playground for comparing sounds. Users and the assistant can arrange candidates in the playground and carry useful feedback into the next iteration.

PixelChat provides a useful precedent for creative iteration and asset review. Lorekeeper provides technical lessons for persistent chat, tool execution, and background work. Their product domains and .NET/Blazor implementations are not SfxChat requirements.
