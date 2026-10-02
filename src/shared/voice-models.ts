import type { AudioProviderId, VoiceGenerationInput, VoiceOption } from './types';

export const VOICE_MODELS = {
  elevenlabs: [
    { id: 'eleven_v4', label: 'Eleven v4', note: 'Expressive character speech; tags and IPA', maxCharacters: 10000 },
    { id: 'eleven_multilingual_v2', label: 'Multilingual v2', note: 'Consistent narration; speed control', maxCharacters: 10000 }
  ],
  gemini: [
    { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS', note: 'Detailed acting and vocal bursts', maxCharacters: null },
    { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS', note: 'Faster everyday speech', maxCharacters: null }
  ]
} satisfies Record<AudioProviderId, { id: string; label: string; note: string; maxCharacters: number | null }[]>;
export const VOICE_DEFAULTS = {
  elevenlabs: { model: 'eleven_v4', voiceId: 'JBFqnCBsd6RMkjVDRZzb' },
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
export function validateVoiceTarget(input: VoiceGenerationInput): void {
  const provider = input.providerId;
  if (!provider || !input.model || !VOICE_MODELS[provider].some(m => m.id === input.model)) throw new Error('Choose a supported voice model for this provider.');
  if (!input.voiceId || !/^[a-zA-Z0-9_-]{1,200}$/.test(input.voiceId)) throw new Error('Choose a voice or enter its exact provider voice ID.');
  const text = input.providerText ?? input.text;
  if (!text.trim()) throw new Error('Spoken text is required.');
  if (provider === 'elevenlabs') {
    if ([...text].length > 10000) throw new Error('This ElevenLabs model supports at most 10,000 characters per request. Shorten the script; it will not be split automatically.');
    if (input.style !== undefined) throw new Error('ElevenLabs has no separate style field. Use supported tags in providerText for v4.');
    if (input.model === 'eleven_v4' && input.speed !== undefined) throw new Error('Eleven v4 does not support the speed setting. Use tags and punctuation for pacing.');
    if (input.model === 'eleven_v4' && /<\s*\/?\s*(?:speak|break|phoneme|say-as|prosody|emphasis|sub|voice|lang|p|s|mark|audio)\b/i.test(text)) throw new Error('Eleven v4 does not support SSML. Use audio tags, punctuation, or slash-delimited IPA.');
    if (input.model === 'eleven_multilingual_v2' && /<\s*phoneme\b/i.test(text)) throw new Error('Multilingual v2 does not support phoneme tags. Use phonetic wording when requested.');
  } else {
    if (new TextEncoder().encode(text + (input.style ?? '')).length > 8000) throw new Error('This version accepts at most 8,000 UTF-8 bytes of Gemini script and style per clip. Shorten the script; it will not be split automatically.');
    if (input.stability !== undefined || input.similarity !== undefined || input.speed !== undefined) throw new Error('Gemini uses concise style instructions instead of ElevenLabs numeric voice controls.');
  }
}
