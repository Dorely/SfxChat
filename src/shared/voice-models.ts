import type { AudioProviderId, VoiceGenerationInput, VoiceModelOption, VoiceOption } from './types';
import { LATEST_MODEL, newestModels } from './elevenlabs-models';

// Reviewed prompting/control profiles, not an availability catalog. Live ElevenLabs
// discovery is authoritative; future TTS IDs use a conservative plain-text profile.
const legacyControls = { stability: true, similarity: true, speed: true };
const expressiveControls = { stability: true, similarity: true, speed: false };
function profile(id: string, label: string, note: string, maxCharacters: number | null, controls: VoiceModelOption['controls'] = expressiveControls): VoiceModelOption {
  return { id, label, note, maxCharacters, controls, guidanceStatus: 'reviewed', selectable: true, languages: [], description: '', requiresAlphaAccess: null };
}

export const VOICE_MODELS = {
  elevenlabs: [
    profile('eleven_v4', 'Eleven v4', 'Expressive acting and quality-first narration. Sparse auditory tags and slash IPA; no SSML or speed.', 10000),
    profile('eleven_v3', 'Eleven v3', 'Previous expressive model: auditory tags and punctuation, no SSML. Stability 0, 0.5 or 1; no similarity or speed. Prefer v4 for professional clones.', 5000, { stability: true, similarity: false, speed: false, stabilityValues: [0, 0.5, 1] }),
    profile('eleven_multilingual_v2', 'Multilingual v2', 'Steady long-form narration. Natural punctuation, sparse SSML breaks; no expressive tags or phoneme tags.', 10000, legacyControls),
    profile('eleven_flash_v2_5', 'Flash v2.5', 'Fast multilingual speech. Prepare ambiguous numbers and dates when authorized; sparse breaks, no expressive or phoneme tags.', 40000, legacyControls),
    profile('eleven_flash_v2', 'Flash v2', 'Fast English speech. Sparse breaks; word-level phoneme tags supported. No expressive audio tags.', 30000, legacyControls),
    { ...profile('eleven_turbo_v2_5', 'Turbo v2.5 (deprecated)', 'Deprecated: prefer Flash v2.5 for lower latency. Use legacy plain-script/break guidance.', 40000, legacyControls), deprecated: true, replacementModelId: 'eleven_flash_v2_5' },
    { ...profile('eleven_turbo_v2', 'Turbo v2 (deprecated)', 'Deprecated: prefer Flash v2 for lower latency. Use legacy plain-script/break guidance; phoneme support is not assumed.', 30000, legacyControls), deprecated: true, replacementModelId: 'eleven_flash_v2' }
  ],
  gemini: [
    profile('gemini-3.8-flash-tts', 'Gemini 3.8 Flash TTS', 'Detailed acting and vocal bursts; concise separate delivery style.', null, { stability: false, similarity: false, speed: false }),
    profile('gemini-3.8-flash-lite-tts', 'Gemini 3.8 Flash-Lite TTS', 'Faster everyday speech; concise separate delivery style.', null, { stability: false, similarity: false, speed: false })
  ]
} satisfies Record<AudioProviderId, VoiceModelOption[]>;

export function voiceModelProfile(provider: AudioProviderId, id: string): VoiceModelOption {
  const known = VOICE_MODELS[provider].find(m => m.id === id);
  if (known) return known;
  const realtime = provider === 'elevenlabs' && ['eleven_v4_turbo', 'eleven_v3_conversational'].includes(id);
  return { ...profile(id, id, realtime
    ? 'Requires the realtime Text to Dialogue WebSocket, which SfxChat does not implement.'
    : 'New or unreviewed model: plain spoken text only; no tuning controls, tags, SSML or IPA claims. Read official model guidance before specialized prompting.', 10000, { stability: false, similarity: false, speed: false }), guidanceStatus: realtime ? 'unavailable' : 'generic', selectable: !realtime };
}
/** Newest selectable, non-deprecated ElevenLabs model; Gemini keeps its reviewed default. */
export function latestVoiceModel(provider: AudioProviderId, models: VoiceModelOption[] = VOICE_MODELS[provider]): string {
  if (provider === 'gemini') return VOICE_MODELS.gemini[0]!.id;
  return (newestModels(models, m => m.selectable && !m.deprecated && m.requiresAlphaAccess !== true)[0] ?? newestModels(VOICE_MODELS.elevenlabs, m => !m.deprecated)[0]!).id;
}
export const VOICE_DEFAULTS = {
  elevenlabs: { model: LATEST_MODEL, voiceId: 'JBFqnCBsd6RMkjVDRZzb' },
  gemini: { model: 'gemini-3.8-flash-tts', voiceId: 'Kore' }
};
export const providerLabel = (id: AudioProviderId) => id === 'elevenlabs' ? 'ElevenLabs' : 'Gemini';
export const GEMINI_VOICES: VoiceOption[] = [
  ['Zephyr', 'Bright'], ['Puck', 'Upbeat'], ['Charon', 'Informative'], ['Kore', 'Firm'], ['Fenrir', 'Excitable'], ['Leda', 'Youthful'],
  ['Orus', 'Firm'], ['Aoede', 'Breezy'], ['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'], ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'],
  ['Umbriel', 'Easy-going'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'], ['Erinome', 'Clear'], ['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'],
  ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'], ['Alnilam', 'Firm'], ['Schedar', 'Even'], ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'],
  ['Achird', 'Friendly'], ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'], ['Sadaltager', 'Knowledgeable'], ['Sulafat', 'Warm']
].map(([id, description]) => ({ id: id!, name: id!, description: description!, labels: {} }));

/** Shared by admission and transports; unsupported controls fail before purchase. */
export function validateVoiceTarget(input: VoiceGenerationInput, discovered?: VoiceModelOption): void {
  const provider = input.providerId;
  if (input.model === LATEST_MODEL) throw new Error('Resolve "latest" to an exact model before validation.');
  if (!provider || !input.model || !/^[a-zA-Z0-9._-]{1,120}$/.test(input.model) || (provider === 'gemini' && !VOICE_MODELS.gemini.some(m => m.id === input.model))) throw new Error('Choose a supported voice model for this provider.');
  const model = discovered ?? voiceModelProfile(provider, input.model);
  if (model.id !== input.model || !model.selectable) throw new Error(model.note);
  if (!input.voiceId || !/^[a-zA-Z0-9_-]{1,200}$/.test(input.voiceId)) throw new Error('Choose a voice or enter its exact provider voice ID.');
  const text = input.providerText ?? input.text;
  if (!text.trim()) throw new Error('Spoken text is required.');
  if (provider === 'elevenlabs') {
    if ([...text].length > (model.maxCharacters ?? 10000)) throw new Error(`This model accepts at most ${model.maxCharacters ?? 10000} characters per request. Shorten the script; it will not be split automatically.`);
    if (input.style !== undefined) throw new Error('ElevenLabs has no separate style field. Use supported tags in providerText for v4.');
    for (const field of ['stability', 'similarity', 'speed'] as const) {
      if (input[field] !== undefined && !model.controls[field]) throw new Error(`${model.label} does not support the ${field} control in SfxChat. ${model.note}`);
    }
    if (input.stability !== undefined && model.controls.stabilityValues && !model.controls.stabilityValues.includes(input.stability)) throw new Error(`${model.label} stability must be ${model.controls.stabilityValues.join(', ')}.`);
    const ssml = /<\s*\/?\s*(?:speak|break|phoneme|say-as|prosody|emphasis|sub|voice|lang|p|s|mark|audio)\b/i;
    if ((['eleven_v4', 'eleven_v3'].includes(input.model) || model.guidanceStatus === 'generic') && ssml.test(text)) throw new Error(`${model.label} does not support SSML in SfxChat. ${model.note}`);
    if (input.model !== 'eleven_flash_v2' && /<\s*phoneme\b/i.test(text)) throw new Error(`${model.label} has no reviewed phoneme-tag support. Use agreed phonetic wording.`);
    if (model.guidanceStatus === 'generic' && /\[[^\]]+\]/.test(text)) throw new Error('Unreviewed models accept plain spoken text only; audio-tag behavior is unknown.');
  } else {
    if (new TextEncoder().encode(text + (input.style ?? '')).length > 8000) throw new Error('This version accepts at most 8,000 UTF-8 bytes of Gemini script and style per clip. Shorten the script; it will not be split automatically.');
    if (input.stability !== undefined || input.similarity !== undefined || input.speed !== undefined) throw new Error('Gemini uses concise style instructions instead of ElevenLabs numeric voice controls.');
  }
}
