// Music provider kinds and their reviewed model catalogs. Model IDs, lengths, and
// notes were checked against official documentation on 2026-09-21; recheck them
// before changing this list. App-side caps also apply (validation.ts).
import type { MusicProviderKind } from './types';

export interface MusicModelOption {
  id: string;
  label: string;
  note: string;
  /** Longest length this model accepts, in milliseconds. */
  maxDurationMs: number;
  /** Set when the model always returns this exact length. */
  fixedDurationMs?: number;
}

export interface MusicProviderPreset {
  kind: MusicProviderKind;
  label: string;
  defaultModel: string;
  keyHint: string;
}

export const MUSIC_DURATION_MIN_MS = 3_000;
export const MUSIC_DURATION_MAX_MS = 600_000;

export const MUSIC_PROVIDER_PRESETS: MusicProviderPreset[] = [
  { kind: 'elevenlabs-music', label: 'ElevenLabs Music', defaultModel: 'music_v2_5', keyHint: 'ElevenLabs API key; the Music API needs a paid plan' },
  { kind: 'gemini-lyria', label: 'Gemini Lyria', defaultModel: 'lyria-3.5', keyHint: 'Google AI Studio (Gemini API) key' }
];

export const MUSIC_MODELS: Record<MusicProviderKind, MusicModelOption[]> = {
  'elevenlabs-music': [
    { id: 'music_v2_5', label: 'Music v2.5', note: 'Newest model: strongest prompt adherence and audio quality.', maxDurationMs: MUSIC_DURATION_MAX_MS },
    { id: 'music_v2', label: 'Music v2', note: 'Long-form sections, mid-track transitions, dense vocal delivery.', maxDurationMs: MUSIC_DURATION_MAX_MS },
    { id: 'music_v1', label: 'Music v1', note: 'Legacy transition default; narrower control than v2.', maxDurationMs: MUSIC_DURATION_MAX_MS }
  ],
  'gemini-lyria': [
    { id: 'lyria-3.5', label: 'Lyria 3.5', note: 'Full songs of a couple of minutes; length follows the prompt.', maxDurationMs: MUSIC_DURATION_MAX_MS },
    { id: 'lyria-3-clip-preview', label: 'Lyria 3 Clip', note: 'Always a 30-second clip; the cheapest way to explore a direction.', maxDurationMs: 30_000, fixedDurationMs: 30_000 },
    { id: 'lyria-3-pro-preview', label: 'Lyria 3 Pro', note: 'Legacy full-song model.', maxDurationMs: MUSIC_DURATION_MAX_MS }
  ]
};

export function musicModels(kind: MusicProviderKind): MusicModelOption[] {
  return MUSIC_MODELS[kind];
}

export function musicModel(kind: MusicProviderKind, id: string): MusicModelOption | undefined {
  return MUSIC_MODELS[kind].find(entry => entry.id === id);
}

export function isMusicModel(kind: MusicProviderKind, id: string): boolean {
  return MUSIC_MODELS[kind].some(entry => entry.id === id);
}

export function defaultMusicModel(kind: MusicProviderKind): string {
  return MUSIC_PROVIDER_PRESETS.find(preset => preset.kind === kind)?.defaultModel ?? MUSIC_MODELS[kind][0]!.id;
}

export function musicProviderLabel(kind: MusicProviderKind): string {
  return MUSIC_PROVIDER_PRESETS.find(preset => preset.kind === kind)?.label ?? kind;
}
