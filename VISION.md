# SfxChat vision

SfxChat is a specialist AI sound workbench for turning an idea into usable sound effects and music, then keeping the resulting audio organized and easy to find.

Its assistant should combine sound-design knowledge with skill in prompting AI audio services. Users should be able to describe a need, explore alternatives, audition results, give feedback, refine a sound, and save it into a useful library without manually coordinating disconnected tools.

## Creative workflow

- Start from a description, a reference, an imported sound, or an existing library item.
- Help translate intent into a clear brief and effective provider-specific prompts. Use small, informative sets of alternatives and preserve useful feedback between iterations.
- Generate and refine sound effects and music through suitable provider capabilities. Let the assistant select and switch between configured services according to the task, available capabilities, and authorized spending. Music providers are configured separately from chat providers, and the assistant's runtime guidance follows whichever music provider is active.
- A request to create sounds should lead directly to generation, without separate spending approvals or app-imposed generation allowances.
- Make audition and comparison central: playback, repeated-use testing, useful technical checks, and listener decisions should inform revisions.
- Preserve originals, derived versions, exact generation prompts, provenance, and feedback so users can understand how a result was made and repeat useful workflows.

## Assistant and providers

The intended chat assistant supports Codex account login. ElevenLabs and Gemini API access are part of the product direction, with credentials configured inside the app and saved securely. Chat authentication and audio-provider credentials are separate concerns. Music providers are configured separately from chat providers, so the same vendor can serve different roles without sharing configuration.

Provider roles must follow verified capabilities. Sound-effect prompting and endpoints are documented in [docs/knowledge](docs/knowledge/README.md), as are the music providers implemented so far: ElevenLabs Music and Google's Lyria models. Neither note establishes perceptual quality, and unverified provider behavior stays marked as such. Extend the same research practice — dated official sources, recorded request mapping, explicit evidence limits — when adding another provider.

The assistant should explain consequential choices, show progress and results, and acknowledge uncertainty. Automated measurements and model observations support the workflow; actual listening remains important for deciding whether a sound fits.

## Libraries the assistant maintains

Generated sound effects and music should become first-class library assets, not attachments lost in chat history. The assistant should name assets, add useful traits and tags, group them into collections, and keep their organization current as the library grows. Sound effects and music are kept in separate libraries so each stays easy to scan.

Users should be able to search by traits, tags, descriptions, and initial generation prompts; inspect source and revision history; and manually correct the assistant's organization. Assistant actions should be visible and understandable. Organizing a sound must preserve its original generation record and file identity.

## Projects

Work is organized into projects. A project holds its own conversations and its own effects
and music libraries, so unrelated briefs, assets, and comparisons stay separate, and the top
bar switches between them. Provider configuration and credentials stay app-level because
they belong to the account rather than to the work. Sessions stay labeled: the assistant
names a session as soon as the goal is clear and renames it when the subject materially
changes, and the user can rename any session or project in place.

## Product character

SfxChat is a focused creative tool for building, testing, and managing audio. It should make iteration approachable while retaining enough provenance and control for serious production work. Library management is a core assistant responsibility.

Chat lives alongside the audio workspace: a resizable left sidebar takes roughly one third of the window, while the right side switches between the library and a playground for comparing sounds. Users and the assistant can arrange candidates in the playground and carry useful feedback into the next iteration.

PixelChat provides a useful precedent for creative iteration and asset review. Lorekeeper provides technical lessons for persistent chat, tool execution, and background work. Their product domains and .NET/Blazor implementations are not SfxChat requirements.
