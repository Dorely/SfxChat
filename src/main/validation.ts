import { z } from 'zod';
import { MUSIC_DURATION_MAX_MS, MUSIC_DURATION_MIN_MS } from '../shared/music-models';
export const idSchema = z.string().uuid();
export const providerKindSchema = z.enum(['chat-completions', 'responses', 'anthropic']);
export const musicProviderKindSchema = z.enum(['elevenlabs-music', 'gemini-lyria']);
export const assetKindSchema = z.enum(['effect', 'music']);
export const effortSchema = z.string().trim().regex(/^[a-zA-Z0-9._-]+$/).max(40);
export const effortsSchema = z.array(effortSchema).max(8);
export const trimSchema = z.object({
  startSeconds: z.number().finite().min(0), endSeconds: z.number().finite().positive(),
  fadeInMs: z.number().finite().min(0).max(10000).optional(),
  fadeOutMs: z.number().finite().min(0).max(10000).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  loop: z.boolean().optional().describe('Render a seamless-loop variant of the selection instead of a plain cut: the tail crossfades into the head and the output is shortened by the crossfade length. Cannot be combined with fades.'),
  crossfadeMs: z.number().finite().min(0).max(5000).optional().describe('Loop seam crossfade length in milliseconds (0-5000, default 0). A small value such as 5-20 ms usually removes the click at the seam; only used when loop is true.')
}).strict();
export const analysisSchema = z.object({
  startSeconds: z.number().finite().min(0).optional(), endSeconds: z.number().finite().positive().optional(),
  bins: z.number().int().min(1).max(512).optional(),
  events: z.boolean().optional().describe('Also run energy-based event detection over the interval and return candidate cut regions with exact frame boundaries. Candidates, not identified sounds.'),
  seamProbe: z.object({
    startSeconds: z.number().finite().min(0).optional(),
    endSeconds: z.number().finite().positive().optional()
  }).strict().optional().describe('Measure the loop seam where endSeconds wraps back to startSeconds: splice discontinuity, head/tail RMS, start/end correlation, and a suggested frame offset. Omit both fields to probe the whole asset as a loop.')
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
  endSeconds: z.number().finite().positive().optional()
}).strict();
export const generationSchema = z.object({
  prompt: z.string().trim().min(1).describe('Complete, concise description of the audible source, action and useful acoustic details; put connected events in order. For revisions, restate the sound with the requested changes. Sent as text without chat history or parent audio.'),
  count: z.number().int().positive().safe().optional().describe('Number of separate candidates using this same prompt. Defaults to 1; follow the user-requested scope.'),
  duration: z.number().min(0.5).max(30).nullable().optional().describe('Whole clip length in seconds, 0.5–30. Omit or use null for automatic duration. Does not specify exact event timestamps.'),
  loop: z.boolean().optional().describe('Request seamless repetition for a continuous sound bed; defaults to false. Use a matching continuous description. Does not extend the maximum clip length.'),
  influence: z.number().min(0).max(1).optional().describe('Prompt adherence, 0–1; omitted uses provider default 0.3. Higher follows the description more closely with less variation. Not volume or quality.'),
  parentId: idSchema.nullable().optional().describe('Local revision lineage only. Does not send source audio or earlier prompts to the provider.'),
  name: z.string().trim().min(1).optional().describe('Library name, separate from the provider sound description.')
}).strict();
const musicInputFields = {
  prompt: z.string().trim().min(1).max(4100).describe('Complete musical direction: genre, mood, instrumentation, tempo, key, production era, vocal or instrumental intent, arrangement order, and any lyrics with section tags. For a revision, restate the whole direction with the requested change. Sent as text without chat history or source audio.'),
  count: z.number().int().positive().safe().optional().describe('Number of separately billed candidates using this prompt. Defaults to 1; follow the user-requested scope.'),
  durationMs: z.number().int().min(MUSIC_DURATION_MIN_MS).max(MUSIC_DURATION_MAX_MS).nullable().optional().describe('Whole track length in milliseconds, 3000-600000. Omit or use null to let the provider choose a length from the prompt. Not exact section timing, which belongs in the prompt text. Some models always return a fixed length.'),
  instrumental: z.boolean().optional().describe('Request a track without vocals. Defaults to false, and most prompts produce vocals without it.'),
  providerId: z.string().trim().min(1).max(80).nullable().optional().describe('Configured music provider to use for this request, copied exactly from the providerIds in your instructions. Never invent or abbreviate one. Omit or use null for the active provider in Settings.'),
  parentId: idSchema.nullable().optional().describe('Local revision lineage only. Music providers receive no source audio and cannot continue an earlier generation.'),
  name: z.string().trim().min(1).optional().describe('Library name, separate from the provider music description.')
};
/** IPC/application schema: accepts the kind discriminant the renderer and service send. */
export const musicGenerationSchema = z.object({ kind: z.literal('music').optional(), ...musicInputFields }).strict();
/** Agent-facing tool schema: the kind is implied by the tool, so it is not exposed to the model. */
export const musicToolSchema = z.object(musicInputFields).strict();
export const patchSchema = z.object({ name: z.string().trim().min(1).optional(), description: z.string().optional(), tags: z.array(z.string().trim().min(1)).optional(), collections: z.array(z.string().trim().min(1)).optional(), review: z.enum(['unreviewed','accepted','rejected']).optional(), feedback: z.string().optional() }).strict();
export const projectNameSchema = z.string().trim().min(1).max(60);
export const titleSchema = z.string().trim().min(1).max(70);
export const commandSchemas = {
  snapshot: z.tuple([]), createConversation: z.tuple([]), renameConversation: z.tuple([idSchema, titleSchema]),
  createProject: z.tuple([projectNameSchema]), renameProject: z.tuple([idSchema, projectNameSchema]), setActiveProject: z.tuple([idSchema]),
  chatContext: z.tuple([idSchema, z.string()]),
  openLogs: z.tuple([]),
  sendMessage: z.tuple([idSchema, z.string().trim().min(1)]), cancelTurn: z.tuple([idSchema]),
  generate: z.tuple([idSchema, generationSchema]), cancelJob: z.tuple([idSchema]),
  generateMusic: z.tuple([idSchema, musicGenerationSchema]),
  updateAsset: z.tuple([idSchema, patchSchema, idSchema.optional()]), setPlayground: z.tuple([idSchema, z.array(idSchema)]),
  analyzeAudio: z.tuple([idSchema, analysisSchema]), trimAsset: z.tuple([idSchema, idSchema, trimSchema]),
  previewTrim: z.tuple([idSchema, trimSchema]),
  spectrogram: z.tuple([idSchema, spectrogramSchema]),
  importAudio: z.tuple([idSchema, assetKindSchema.optional()]), exportAsset: z.tuple([idSchema]), searchAssets: z.tuple([z.string()]),
  startLogin: z.tuple([]), cancelLogin: z.tuple([]), logout: z.tuple([]),
  saveElevenLabsKey: z.tuple([z.string()]), saveModel: z.tuple([z.union([z.literal('backend default'), z.string().trim().regex(/^[a-zA-Z0-9._-]+$/)])]),
  saveChatProvider: z.tuple([z.object({ id: z.string().trim().min(1).max(80).optional(), label: z.string().trim().min(1).max(80), baseUrl: z.string().trim().min(1).max(500), kind: providerKindSchema, apiKey: z.string().max(500).optional() }).strict()]),
  deleteChatProvider: z.tuple([z.string().trim().min(1).max(80)]),
  listChatModels: z.tuple([z.string().trim().min(1).max(80)]),
  testChatModel: z.tuple([z.object({ providerId: z.string().trim().min(1).max(80), slug: z.string().trim().min(1).max(200), efforts: effortsSchema }).strict()]),
  saveChatModel: z.tuple([z.object({ id: z.string().trim().min(1).max(80).optional(), providerId: z.string().trim().min(1).max(80), slug: z.string().trim().min(1).max(200), efforts: effortsSchema }).strict()]),
  deleteChatModel: z.tuple([z.string().trim().min(1).max(80)]),
  setActiveChat: z.tuple([z.object({ modelId: z.string().trim().min(1).max(120), effort: z.string().trim().max(40) }).strict()]),
  saveMusicProvider: z.tuple([z.object({ id: z.string().trim().min(1).max(80).optional(), label: z.string().trim().min(1).max(80), kind: musicProviderKindSchema, model: z.string().trim().min(1).max(120), apiKey: z.string().max(500).optional() }).strict()]),
  deleteMusicProvider: z.tuple([z.string().trim().min(1).max(80)]),
  setActiveMusic: z.tuple([z.string().trim().min(1).max(80)])
};
