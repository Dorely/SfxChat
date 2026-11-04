import { installationSchema } from '../shared/workbench';
import { z } from 'zod';
import { MUSIC_DURATION_MAX_MS, MUSIC_DURATION_MIN_MS } from '../shared/music-models';
import { MIDI_BPM_MAX, MIDI_BPM_MIN, MIDI_MAX_NOTES_PER_TRACK, MIDI_MAX_PITCH, MIDI_MAX_TRACKS, MIDI_TIME_SIG_DENOMINATORS } from '../shared/midi';
export const idSchema = z.string().uuid();
export const providerKindSchema = z.enum(['chat-completions', 'responses', 'anthropic']);
export const musicProviderKindSchema = z.enum(['elevenlabs-music', 'gemini-lyria']);
export const audioProviderSchema = z.enum(['elevenlabs', 'gemini']);
export const assetKindSchema = z.enum(['effect', 'music', 'voice', 'midi']);
export const effortSchema = z.string().trim().regex(/^[a-zA-Z0-9._-]+$/).max(40);
export const effortsSchema = z.array(effortSchema).max(8);
export const trimSchema = z.object({
  startSeconds: z.number().finite().min(0), endSeconds: z.number().finite().positive(),
  fadeInMs: z.number().finite().min(0).max(10000).optional(),
  fadeOutMs: z.number().finite().min(0).max(10000).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  loop: z.boolean().optional().describe('Render a seamless-loop variant of the selection instead of a plain cut: the output keeps the exact selection length, and the seam crossfade blends the loop end into the audio just before the start (or the opening with the audio after the end when the loop starts at the file start). Cannot be combined with fades.'),
  crossfadeMs: z.number().finite().min(0).max(5000).optional().describe('Loop seam crossfade length in milliseconds (0-5000, default 0). A small value such as 5-20 ms usually removes the click at the seam; only used when loop is true.'),
  introStartSeconds: z.number().finite().min(0).optional().describe('Loop render only: also keep the source from this time up to startSeconds as an intro that plays once before the loop (0 keeps everything before the loop). The WAV carries the loop region in a smpl chunk, which Godot imports as a forward loop by default.')
}).strict();
const tempoHintSchema = z.number().finite().min(40).max(300).optional().describe('Musical analysis: the tempo you expect in BPM, for example the tempo requested from the music provider. It centers the tempo prior so half, double or two-thirds readings lose; the audio still decides the exact value, and providers often miss requested tempos.');
export const analysisSchema = z.object({
  startSeconds: z.number().finite().min(0).optional(), endSeconds: z.number().finite().positive().optional(),
  bins: z.number().int().min(1).max(512).optional(),
  events: z.boolean().optional().describe('Also run energy-based event detection over the interval and return candidate cut regions with exact frame boundaries. Candidates, not identified sounds.'),
  seamProbe: z.object({
    startSeconds: z.number().finite().min(0).optional(),
    endSeconds: z.number().finite().positive().optional()
  }).strict().optional().describe('Measure the loop seam where endSeconds wraps back to startSeconds: splice discontinuity, head/tail RMS, start/end correlation, and a suggested frame offset. Omit both fields to probe the whole asset as a loop.'),
  musical: z.boolean().optional().describe('Also estimate tempo, beat and bar grid, key and integrated loudness (LUFS) for the whole file, with beats/bars listed for the requested interval. Estimates with heuristic confidence, not listening evidence. Works on full-length tracks.'),
  tempoHint: tempoHintSchema,
  keyHint: z.string().trim().min(1).max(20).optional().describe('Musical analysis: the key you expect, such as "A minor". Reported as how well it fits the measured harmony (rank among 24 keys); it does not replace the estimate.')
}).strict();
export const loopSearchSchema = z.object({
  mode: z.enum(['auto', 'music', 'texture']).optional().describe('music: whole-bar loops on the detected beat grid; texture: grid-free loops for ambience, drones and noise beds; auto (default) uses music when a steady beat is found.'),
  startSeconds: z.number().finite().min(0).optional().describe('Search region start; candidates lie entirely inside the region.'),
  endSeconds: z.number().finite().positive().optional().describe('Search region end (default: end of file).'),
  minSeconds: z.number().finite().positive().max(900).optional().describe('Shortest loop length (default 4 s for music, 3 s for texture).'),
  maxSeconds: z.number().finite().positive().max(900).optional(),
  minBars: z.number().int().min(1).max(256).optional().describe('Music mode: fewest bars (default 4 unless minSeconds is given).'),
  maxBars: z.number().int().min(1).max(256).optional(),
  tempoHint: tempoHintSchema,
  barMultiple: z.number().int().min(1).max(64).optional().describe('Music mode: only offer lengths that are whole multiples of this many bars, for example 4 or 8 for phrase-length loops.'),
  lengthSeconds: z.number().finite().positive().max(900).optional().describe('Exact loop length in seconds, for example a repeat spacing you measured. Candidates differ only in where the loop starts; the length is not re-measured. Do not combine with min/max limits.'),
  allowIntro: z.boolean().optional().describe('true (default) lets the loop start after an intro that plays once; false requires the loop to start at the region start.'),
  count: z.number().int().min(1).max(12).optional().describe('Candidates to return (default 5, maximum 12).')
}).strict();
export const loopSeamSchema = z.object({
  startSeconds: z.number().finite().min(0), endSeconds: z.number().finite().positive(),
  crossfadeMs: z.number().finite().min(0).max(5000).optional().describe('Crossfade used by the loop render (trim_asset loop:true crossfadeMs).'),
  contextSeconds: z.number().finite().min(0.25).max(10).optional().describe('Audio on each side of the seam (default 2 s, at most 10).')
}).strict();
export const spectrogramSchema = z.object({
  startSeconds: z.number().finite().min(0).optional(),
  endSeconds: z.number().finite().positive().optional(),
  width: z.number().int().min(256).max(1024).optional().describe('Image width in pixels (256-1024, default 768).'),
  height: z.number().int().min(128).max(512).optional().describe('Image height in pixels (128-512, default 384).'),
  freqScale: z.enum(['log', 'linear']).optional().describe('Frequency axis: "log" (default) suits music and low-frequency detail; "linear" shows the full spectrum evenly for harmonic/tonal inspection.')
}).strict();
export const clipSchema = z.object({
  startSeconds: z.number().finite().min(0).optional(),
  endSeconds: z.number().finite().positive().optional(),
  loopSeam: loopSeamSchema.optional().describe('Instead of a plain window, hear a loop wrap exactly as trim_asset loop:true would play it: the end of the loop, the crossfaded seam, then its opening. Do not combine with startSeconds/endSeconds.')
}).strict();
const modelIdSchema = z.string().trim().regex(/^[a-zA-Z0-9._-]{1,120}$/);
export const generationSchema = z.object({
  prompt: z.string().trim().min(1).describe('Complete, concise description of the audible source, action and useful acoustic details; put connected events in order. For revisions, restate the sound with the requested changes. Sent as text without chat history or parent audio.'),
  count: z.number().int().positive().safe().optional().describe('Number of separate candidates using this same prompt. Defaults to 1; follow the user-requested scope.'),
  duration: z.number().min(0.5).max(30).nullable().optional().describe('Whole clip length in seconds, 0.5–30. Omit or use null for automatic duration. Does not specify exact event timestamps.'),
  loop: z.boolean().optional().describe('Request seamless repetition for a continuous sound bed; defaults to false. Use a matching continuous description. Does not extend the maximum clip length.'),
  influence: z.number().min(0).max(1).optional().describe('Prompt adherence, 0–1; omitted uses provider default 0.3. Higher follows the description more closely with less variation. Not volume or quality.'),
  model: modelIdSchema.optional().describe('Omit (or "latest") for the newest available ElevenLabs sound model. Pin an exact ID from list_audio_models kind "effect" only when the user deliberately wants that model.'),
  parentId: idSchema.nullable().optional().describe('Local revision lineage only. Does not send source audio or earlier prompts to the provider.'),
  name: z.string().trim().min(1).optional().describe('Library name, separate from the provider sound description.')
}).strict();
const musicInputFields = {
  prompt: z.string().trim().min(1).max(4100).describe('Complete musical direction: genre, mood, instrumentation, tempo, key, production era, vocal or instrumental intent, arrangement order, and any lyrics with section tags. For a revision, restate the whole direction with the requested change. Sent as text without chat history or source audio.'),
  count: z.number().int().positive().safe().optional().describe('Number of separately billed candidates using this prompt. Defaults to 1; follow the user-requested scope.'),
  durationMs: z.number().int().min(MUSIC_DURATION_MIN_MS).max(MUSIC_DURATION_MAX_MS).nullable().optional().describe('Whole track length in milliseconds, 3000-600000. Omit or use null to let the provider choose a length from the prompt. Not exact section timing, which belongs in the prompt text. Some models always return a fixed length.'),
  instrumental: z.boolean().optional().describe('Request a track without vocals. Defaults to false, and most prompts produce vocals without it.'),
  providerId: z.string().trim().min(1).max(80).nullable().optional().describe('Configured music provider to use for this request, copied exactly from the providerIds in your instructions. Never invent or abbreviate one. Omit or use null for the active provider in Settings.'),
  model: modelIdSchema.optional().describe('Omit for the saved provider model; ElevenLabs providers follow the newest model by default. "latest" requests the newest ElevenLabs model. Pin an exact ID (list_audio_models kind "music" for ElevenLabs) only when the user deliberately wants that model.'),
  parentId: idSchema.nullable().optional().describe('Local revision lineage only. Music providers receive no source audio and cannot continue an earlier generation.'),
  name: z.string().trim().min(1).optional().describe('Library name, separate from the provider music description.')
};
/** IPC/application schema: accepts the kind discriminant the renderer and service send. */
export const musicGenerationSchema = z.object({ kind: z.literal('music').optional(), ...musicInputFields }).strict();
/** Agent-facing tool schema: the kind is implied by the tool, so it is not exposed to the model. */
export const musicToolSchema = z.object(musicInputFields).strict();
const voiceInputFields = {
  text: z.string().min(1).max(64000).refine(value => !!value.trim(), 'Spoken text is required.').describe('Exact user script, preserved without trimming or rewriting. Spoken by one voice. For revisions keep the full script, not bare feedback.'),
  providerId: audioProviderSchema.optional().describe('elevenlabs or gemini. Omit to use the active voice provider; one shared API key serves each provider.'),
  model: modelIdSchema.optional().describe('Omit for the saved voice model, which follows the newest ElevenLabs model by default; "latest" requests the newest selectable model (list_voice_models latestModel). Pin an exact selectable ID only when deliberately choosing that model, and read its note, controls, language coverage and guidanceStatus.'),
  voiceId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional().describe('Exact voice ID from list_voices, or Gemini prebuilt name. Omit for the saved default voice.'),
  providerText: z.string().min(1).max(64000).refine(value => !!value.trim()).optional().describe('Optional prepared script, e.g. requested normalization or expressive tags. Original text stays separately preserved. Do not change user words unless authorized.'),
  style: z.string().max(1000).optional().describe('Gemini only: concise turn-level delivery such as restrained urgency. Keep stage directions out of spoken text. Empty means natural delivery.'),
  stability: z.number().min(0).max(1).optional().describe('Only when controls.stability is true in list_voice_models. Lower permits variation; higher steadies delivery. Respect stabilityValues when present (v3: 0, 0.5, 1). Omit for the voice setting.'),
  similarity: z.number().min(0).max(1).optional().describe('Only when controls.similarity is true in list_voice_models: reference-voice adherence, mapped to similarity_boost. v3 and unreviewed models reject it. Omit for the voice setting.'),
  speed: z.number().min(0.7).max(1.2).optional().describe('Only when list_voice_models reports controls.speed: speech speed, 1 is normal. v4, v3, unreviewed models and Gemini reject it.'),
  count: z.number().int().positive().safe().optional().describe('Separate billed candidates. Defaults to one; follow user scope.'),
  name: z.string().trim().min(1).max(200).optional(),
  parentId: idSchema.nullable().optional().describe('Local revision lineage only; no source audio or chat history is sent.')
};
export const voiceToolSchema = z.object(voiceInputFields).strict();
export const voiceGenerationSchema = z.object({ kind: z.literal('voice').optional(), ...voiceInputFields }).strict();
const midiNoteSchema = z.object({
  pitch: z.number().int().min(0).max(MIDI_MAX_PITCH),
  startBeat: z.number().finite().min(0),
  durationBeats: z.number().finite().positive(),
  velocity: z.number().int().min(1).max(127).optional()
}).strict();
const midiTrackSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  program: z.number().int().min(0).max(127).optional(),
  drums: z.boolean().optional(),
  notes: z.array(midiNoteSchema).max(MIDI_MAX_NOTES_PER_TRACK)
}).strict();
export const midiCompositionSchema = z.object({
  bpm: z.number().min(MIDI_BPM_MIN).max(MIDI_BPM_MAX),
  timeSig: z.object({ numerator: z.number().int().min(1).max(12), denominator: z.number().int().refine(value => MIDI_TIME_SIG_DENOMINATORS.includes(value), `Denominator must be one of ${MIDI_TIME_SIG_DENOMINATORS.join(', ')}.`) }).strict().optional(),
  tracks: z.array(midiTrackSchema).min(1).max(MIDI_MAX_TRACKS)
}).strict();
const midiInputFields = {
  prompt: z.string().trim().min(1).max(4100).describe('Short description of what this clip is meant to be, in musical terms: style, mood, tempo feel, key, and the role of each track. Kept as the clip prompt for search and later revision context.'),
  composition: midiCompositionSchema.describe('The music itself. Positions and lengths are in quarter-note beats (a quarter note is 1, an eighth is 0.5). Set drums on a rhythm track and a General MIDI program number (0-127) on each melodic track.'),
  name: z.string().trim().min(1).max(200).optional().describe('Library name for the clip.'),
  parentId: idSchema.nullable().optional().describe('Local revision lineage. Revising means sending a complete new composition that restates the intended music with the requested change; earlier clips are never modified.')
};
/** IPC/application schema: accepts the kind discriminant the renderer and service send. */
export const midiGenerationSchema = z.object({ kind: z.literal('midi').optional(), ...midiInputFields }).strict();
/** Agent-facing tool schema: the kind is implied by the tool name. */
export const midiToolSchema = z.object(midiInputFields).strict();
export const voiceListSchema = z.object({ providerId: audioProviderSchema, search: z.string().max(200).optional(), language: z.string().regex(/^[a-zA-Z0-9-]{1,40}$/).optional(), pageToken: z.string().max(2000).optional() }).strict();
export const audioModelListSchema = z.object({ kind: z.enum(['effect', 'music']), refresh: z.boolean().optional().describe('Fetch the ElevenLabs API schema again instead of using the up-to-six-hour cache. No generation or purchase.') }).strict();
export const voiceModelListSchema = z.object({ providerId: audioProviderSchema, refresh: z.boolean().optional().describe('Fetch a fresh ElevenLabs catalog instead of using the up-to-five-minute cache. No synthesis or purchase.') }).strict();
export const patchSchema = z.object({ name: z.string().trim().min(1).optional(), description: z.string().optional(), tags: z.array(z.string().trim().min(1)).optional(), collections: z.array(z.string().trim().min(1)).optional(), review: z.enum(['unreviewed','accepted','rejected']).optional(), feedback: z.string().optional() }).strict();
export const projectNameSchema = z.string().trim().min(1).max(60);
export const titleSchema = z.string().trim().min(1).max(70);
export const commandSchemas = {
  operation: z.tuple([z.string().min(1).max(80), z.unknown()]),
  installIntegration: z.tuple([installationSchema]), chooseDirectory: z.tuple([]), uiReady: z.tuple([]),
  uiAcknowledge: z.tuple([idSchema, z.string().max(2000).optional()]),
  playbackReport: z.tuple([idSchema, z.object({ status: z.enum(['stopped','playing','error']), assetId: idSchema.optional(), reviewId: idSchema.optional(), error: z.string().max(2000).optional(), updatedAt: z.string() }).strict()]),
  snapshot: z.tuple([]), createConversation: z.tuple([]), renameConversation: z.tuple([idSchema, titleSchema]),
  createProject: z.tuple([projectNameSchema]), renameProject: z.tuple([idSchema, projectNameSchema]), setActiveProject: z.tuple([idSchema]),
  chatContext: z.tuple([idSchema, z.string()]),
  openLogs: z.tuple([]),
  sendMessage: z.tuple([idSchema, z.string().trim().min(1)]), cancelTurn: z.tuple([idSchema]),
  generate: z.tuple([idSchema, generationSchema]), cancelJob: z.tuple([idSchema]),
  generateMusic: z.tuple([idSchema, musicGenerationSchema]),
  generateVoice: z.tuple([idSchema, voiceGenerationSchema]), listVoices: z.tuple([voiceListSchema]), listVoiceModels: z.tuple([voiceModelListSchema]), listAudioModels: z.tuple([audioModelListSchema]),
  saveVoiceProvider: z.tuple([z.object({ id: audioProviderSchema, model: z.string().min(1).max(120), voiceId: voiceInputFields.voiceId.unwrap() }).strict()]),
  setActiveVoice: z.tuple([audioProviderSchema]),
  saveProviderKey: z.tuple([audioProviderSchema, z.string().max(1000)]),
  selectProviderKey: z.tuple([audioProviderSchema, z.string().min(1).max(200)]),
  updateAsset: z.tuple([idSchema, patchSchema, idSchema.optional()]), setPlayground: z.tuple([idSchema, z.array(idSchema)]),
  analyzeAudio: z.tuple([idSchema, analysisSchema]), trimAsset: z.tuple([idSchema, idSchema, trimSchema]),
  previewTrim: z.tuple([idSchema, trimSchema]),
  findLoopPoints: z.tuple([idSchema, loopSearchSchema]),
  previewSeam: z.tuple([idSchema, loopSeamSchema]),
  spectrogram: z.tuple([idSchema, spectrogramSchema]),
  midiNotes: z.tuple([idSchema]),
  previewMidi: z.tuple([midiCompositionSchema]),
  saveMidiEdit: z.tuple([idSchema, idSchema.nullable(), midiCompositionSchema, z.string().trim().min(1).max(200).optional()]),
  soundfontInfo: z.tuple([]),
  importAudio: z.tuple([idSchema, assetKindSchema.optional()]), exportAsset: z.tuple([idSchema, z.enum(['original', 'wav', 'ogg']).optional()]), searchAssets: z.tuple([z.string()]),
  startLogin: z.tuple([]), cancelLogin: z.tuple([]), logout: z.tuple([]),
  saveModel: z.tuple([z.union([z.literal('backend default'), z.string().trim().regex(/^[a-zA-Z0-9._-]+$/)])]),
  saveChatProvider: z.tuple([z.object({ id: z.string().trim().min(1).max(80).optional(), label: z.string().trim().min(1).max(80), baseUrl: z.string().trim().min(1).max(500), kind: providerKindSchema, apiKey: z.string().max(500).optional() }).strict()]),
  deleteChatProvider: z.tuple([z.string().trim().min(1).max(80)]),
  listChatModels: z.tuple([z.string().trim().min(1).max(80)]),
  testChatModel: z.tuple([z.object({ providerId: z.string().trim().min(1).max(80), slug: z.string().trim().min(1).max(200), efforts: effortsSchema }).strict()]),
  saveChatModel: z.tuple([z.object({ id: z.string().trim().min(1).max(80).optional(), providerId: z.string().trim().min(1).max(80), slug: z.string().trim().min(1).max(200), efforts: effortsSchema }).strict()]),
  deleteChatModel: z.tuple([z.string().trim().min(1).max(80)]),
  setActiveChat: z.tuple([z.object({ modelId: z.string().trim().min(1).max(120), effort: z.string().trim().max(40) }).strict()]),
  saveMusicProvider: z.tuple([z.object({ id: z.string().trim().min(1).max(80).optional(), label: z.string().trim().min(1).max(80), kind: musicProviderKindSchema, model: z.string().trim().min(1).max(120) }).strict()]),
  deleteMusicProvider: z.tuple([z.string().trim().min(1).max(80)]),
  setActiveMusic: z.tuple([z.string().trim().min(1).max(80)])
};
