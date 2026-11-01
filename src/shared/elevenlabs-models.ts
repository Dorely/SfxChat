import type { AudioModelKind } from './types';

/**
 * Saved or requested model choice meaning "the newest eligible ElevenLabs model".
 * It is resolved to an exact model ID per request; an exact ID is a deliberate pin.
 */
export const LATEST_MODEL = 'latest';

/** Version from an ElevenLabs model ID suffix: eleven_v4 → [4, 0], music_v2_5 → [2, 5]. */
export function modelVersion(id: string): [number, number] {
  const match = [...id.matchAll(/(?:^|_)v(\d+)(?:_(\d+))?(?=_|$)/g)].at(-1);
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : [0, 0];
}

/** Newest first; equal versions prefer the base family (eleven_v5 before eleven_flash_v5). */
export function compareModelRecency(a: string, b: string): number {
  const [aMajor, aMinor] = modelVersion(a), [bMajor, bMinor] = modelVersion(b);
  return bMajor - aMajor || bMinor - aMinor || a.split('_').length - b.split('_').length || a.localeCompare(b);
}

export function newestModels<T extends { id: string }>(models: T[], eligible: (model: T) => boolean = () => true): T[] {
  return models.filter(eligible).sort((a, b) => compareModelRecency(a.id, b.id));
}

export interface ReviewedAudioModel { id: string; label: string; note: string; deprecated?: boolean }

// Reviewed labels and notes, checked against official documentation and the public
// API schema on 2026-11-01. Live schema discovery decides which IDs exist.
export const REVIEWED_AUDIO_MODELS: Record<AudioModelKind, ReviewedAudioModel[]> = {
  effect: [
    { id: 'eleven_text_to_sound_v3', label: 'Sound Effects v3', note: 'Newest model. ElevenLabs limits access by account and region; an automatic Latest request rejected for model access falls back to the next model.' },
    { id: 'eleven_text_to_sound_v2', label: 'Sound Effects v2', note: 'Previous model and the provider API default; broadly available.' }
  ],
  music: [
    { id: 'music_v2_5', label: 'Music v2.5', note: 'Strongest prompt adherence and audio quality of the reviewed models.' },
    { id: 'music_v2', label: 'Music v2', note: 'Long-form sections, mid-track transitions, dense vocal delivery.' },
    { id: 'music_v1', label: 'Music v1', note: 'Deprecated by ElevenLabs; narrower control than v2.', deprecated: true }
  ]
};

export const UNREVIEWED_AUDIO_MODEL_NOTE = 'Newly listed by ElevenLabs and not yet reviewed in SfxChat. Use the general provider reference; do not assume new controls.';
