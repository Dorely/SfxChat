import { operationDefinitions } from './operations';
import { z } from 'zod';
import type { MusicProviderEntry } from '../shared/types';
import { musicProviderLabel } from '../shared/music-models';
import { analysisSchema, clipSchema, generationSchema, idSchema, musicToolSchema, patchSchema, spectrogramSchema, titleSchema, trimSchema } from './validation';

import { guidanceDocuments } from '../shared/guidance';
export const instructions = ['design.md', 'elevenlabs-sfx.md', 'workflow.md', 'editing.md'].map(name => guidanceDocuments[name]).join('\n\n') + '\nThe internal assistant cannot read arbitrary files or execute shell commands.';
const elevenlabsMusicInstructions = guidanceDocuments['elevenlabs-music.md'];
const lyriaMusicInstructions = guidanceDocuments['gemini-lyria.md'];

/**
 * Provider guidance for the configured music targets. The roster and the active
 * choice are resolved per turn, so this block follows whatever Settings holds.
 * Provider IDs appear here because a request may name one for a single generation;
 * the tool rejects an ID that does not match, and a guessed one is indistinguishable
 * from a deleted provider until the IDs are listed.
 */
export function musicInstructions(providers: MusicProviderEntry[], activeMusicId: string | null): string {
  if (!providers.length) return 'No music provider is configured, so generate_music cannot run. Tell the user to add a music provider and its API key in Settings, and keep working on sound effects in the meantime.';
  const active = providers.find(entry => entry.id === activeMusicId) ?? providers.find(entry => entry.ready) ?? providers[0]!;
  const name = (entry: MusicProviderEntry) => entry.label === musicProviderLabel(entry.kind) ? entry.label : `${entry.label} — ${musicProviderLabel(entry.kind)}`;
  const roster = providers.map(entry => `${name(entry)}, model ${entry.model}, ${entry.ready ? 'key saved' : 'no key yet'}, ${entry.id === active.id ? 'active, ' : ''}providerId "${entry.id}"`).join('; ');
  const header = `Active music provider: ${name(active)} (model ${active.model}). Configured music providers: ${roster}. To target another configured provider for one request, copy its providerId exactly as quoted; never shorten, rename, or invent an ID, and omit providerId to use the active provider. If the provider a request needs is not in this list, say so and ask instead of guessing.`;
  return `${header}\n${[...new Set(providers.map(p => p.kind))].map(kind => kind === 'elevenlabs-music' ? elevenlabsMusicInstructions : lyriaMusicInstructions).join('\n\n')}`;
}

const additionalTools = ['guidance', 'review_list', 'review_create', 'review_get', 'review_history', 'review_update', 'review_wait', 'review_open', 'playback_play', 'playback_stop', 'playback_status', 'export_asset', 'export_review', 'import_audio', 'cancel_job'] as const;
const additionalSchemas = Object.fromEntries(additionalTools.map(name => [name, z.object(Object.fromEntries(Object.entries(operationDefinitions[name].schema.shape).filter(([key]) => key !== 'projectId' && key !== 'sessionId'))).strict()]));
export const toolSchemas = {
  ...additionalSchemas,
  generate_sounds: generationSchema,
  generate_music: musicToolSchema,
  search_assets: z.object({ query: z.string() }).strict(),
  inspect_asset: z.object({ id: idSchema }).strict(),
  analyze_audio: analysisSchema.extend({ id: idSchema }),
  trim_asset: trimSchema.extend({ id: idSchema }),
  spectrogram_view: spectrogramSchema.extend({ id: idSchema }),
  audio_listen: clipSchema.extend({ id: idSchema }),
  update_asset: z.object({ id: idSchema, patch: patchSchema }).strict(),
  rename_session: z.object({ title: titleSchema.describe('Short, specific session title of about 3-7 words in sentence case, naming the subject and deliverable; no greeting, no generic label, no trailing period.') }).strict(),
  set_playground: z.object({ assetIds: z.array(idSchema) }).strict(),
  inspect_jobs: z.object({}).strict()
};
const descriptions: Record<keyof typeof toolSchemas, string> = {
  generate_sounds: 'Generate ElevenLabs sound effects from a complete audible description. Each candidate receives the same prompt with no chat history or reference audio. Use the fields for duration, looping and adherence; inspect field descriptions. Waits for results and returns jobs and assets to organize; results appear automatically in the effects library and playground.',
  generate_music: 'Generate music on the configured music provider. Use it for songs, tracks, background beds, loops, jingles, scores, themes, and anything with musical structure or lyrics; isolated musical sounds stay with generate_sounds. The prompt is the complete musical direction, including arrangement and lyrics, and the same wording behaves differently on different providers, so follow the active provider block in your instructions. Each candidate is a separate billed generation and tracks are slower than sound effects, so respect the requested count. durationMs sets whole-track length, instrumental leaves vocals out, and providerId targets another configured provider for one request instead of the active one. Waits for results and returns jobs and assets to organize; results appear automatically in the music library and playground.',
  search_assets: 'Search names, descriptions, tags, collections, original prompts, and feedback across the effects and music libraries. An empty query lists everything.',
  inspect_asset: 'Get immutable generation provenance and editable metadata for one asset, whether a sound effect or a music track.',
  analyze_audio: 'Measure decoded audio locally. Returns absolute seconds, sample frames, sample rate, channel count and linear full-scale min/max/peak/RMS bins across all channels. Default 96 bins, maximum 512. Optional startSeconds/endSeconds zoom into a smaller absolute source interval. events:true also returns energy-based event intervals (exact frames) as candidate cut regions. seamProbe measures how the interval end wraps back to its start for loop design. Source files and decoded audio are bounded to 64 MiB. These measurements are not semantic hearing.',
  trim_asset: 'Create a new trimmed float32 WAV from a known asset, preserving the original and exact source lineage. startSeconds/endSeconds use the decoded source timeline from analyze_audio; end is exclusive. Optional fadeInMs/fadeOutMs are linear edge fades (default 0, combined length must fit selection). loop:true instead renders a seamless loop of the selection: the tail crossfades into the head over crossfadeMs (try 5-20 ms for a click-free seam), fades are not allowed with it, and the output is shortened by the crossfade length; the edit record carries the seam. name is optional. Returns the new asset and adds it to the current playground; uses no audio-generation provider.',
  spectrogram_view: 'Render a spectrogram of a library asset interval and attach it as a PNG image you can see. Returns the exact time/frequency mapping for the image plus the attachment reference. Use log frequency (default) for music and low-frequency structure, linear for harmonic detail; request a smaller absolute interval to zoom. The image is a secondary view of measured energy: read structure and boundaries from it, but take exact cut points from analyze_audio sample frames, never from pixel positions. Withheld automatically when the active model cannot view images.',
  audio_listen: 'Attach a bounded audio clip (mono 16-bit WAV, at most 30 seconds) of a library asset interval so you can actually hear it. Omit the interval to hear a whole asset that is within the limit; a longer asset requires an explicit startSeconds/endSeconds window. Use it to confirm what an interval contains, compare regions, check a loop seam, and verify a trim before reporting it. Report listening impressions as observations at the provider model fidelity; approval and creative judgment stay with the user audition. Withheld automatically when the active model cannot receive audio.',
  update_asset: 'Rename, tag, organize into collections, record feedback, or set review status. Does not change original bytes.',
  rename_session: 'Rename this chat session so it stays well labeled with the subject and deliverable of the current work. Call it once early in a session and again when the subject changes materially. Renames only the title; it never changes the library, jobs, or history.',
  set_playground: 'Set the current conversation comparison board to these asset IDs in the requested order. Membership changes do not delete assets.',
  inspect_jobs: 'Read current conversation generation progress and resulting asset IDs. Do not repeatedly poll unfinished jobs.'
};
export const tools = Object.entries(toolSchemas).map(([name, schema]) => ({ type: 'function', name, description: descriptions[name as keyof typeof descriptions] ?? operationDefinitions[name as keyof typeof operationDefinitions]?.description, parameters: z.toJSONSchema(schema, { target: 'draft-7' }), strict: false }));
