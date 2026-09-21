import { z } from 'zod';
export const idSchema = z.string().uuid();
export const providerKindSchema = z.enum(['chat-completions', 'responses', 'anthropic']);
export const effortSchema = z.string().trim().regex(/^[a-zA-Z0-9._-]+$/).max(40);
export const effortsSchema = z.array(effortSchema).max(8);
export const trimSchema = z.object({
  startSeconds: z.number().finite().min(0), endSeconds: z.number().finite().positive(),
  fadeInMs: z.number().finite().min(0).max(10000).optional(),
  fadeOutMs: z.number().finite().min(0).max(10000).optional(),
  name: z.string().trim().min(1).max(200).optional()
}).strict();
export const analysisSchema = z.object({
  startSeconds: z.number().finite().min(0).optional(), endSeconds: z.number().finite().positive().optional(),
  bins: z.number().int().min(1).max(512).optional()
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
export const patchSchema = z.object({ name: z.string().trim().min(1).optional(), description: z.string().optional(), tags: z.array(z.string().trim().min(1)).optional(), collections: z.array(z.string().trim().min(1)).optional(), review: z.enum(['unreviewed','accepted','rejected']).optional(), feedback: z.string().optional() }).strict();
export const commandSchemas = {
  snapshot: z.tuple([]), createConversation: z.tuple([]),
  chatContext: z.tuple([idSchema, z.string()]),
  openLogs: z.tuple([]),
  sendMessage: z.tuple([idSchema, z.string().trim().min(1)]), cancelTurn: z.tuple([idSchema]),
  generate: z.tuple([idSchema, generationSchema]), cancelJob: z.tuple([idSchema]),
  updateAsset: z.tuple([idSchema, patchSchema, idSchema.optional()]), setPlayground: z.tuple([idSchema, z.array(idSchema)]),
  analyzeAudio: z.tuple([idSchema, analysisSchema]), trimAsset: z.tuple([idSchema, idSchema, trimSchema]),
  previewTrim: z.tuple([idSchema, trimSchema]),
  importAudio: z.tuple([idSchema]), exportAsset: z.tuple([idSchema]), searchAssets: z.tuple([z.string()]),
  startLogin: z.tuple([]), cancelLogin: z.tuple([]), logout: z.tuple([]),
  saveElevenLabsKey: z.tuple([z.string()]), saveModel: z.tuple([z.union([z.literal('backend default'), z.string().trim().regex(/^[a-zA-Z0-9._-]+$/)])]),
  saveChatProvider: z.tuple([z.object({ id: z.string().trim().min(1).max(80).optional(), label: z.string().trim().min(1).max(80), baseUrl: z.string().trim().min(1).max(500), kind: providerKindSchema, apiKey: z.string().max(500).optional() }).strict()]),
  deleteChatProvider: z.tuple([z.string().trim().min(1).max(80)]),
  listChatModels: z.tuple([z.string().trim().min(1).max(80)]),
  testChatModel: z.tuple([z.object({ providerId: z.string().trim().min(1).max(80), slug: z.string().trim().min(1).max(200), efforts: effortsSchema }).strict()]),
  saveChatModel: z.tuple([z.object({ id: z.string().trim().min(1).max(80).optional(), providerId: z.string().trim().min(1).max(80), slug: z.string().trim().min(1).max(200), efforts: effortsSchema }).strict()]),
  deleteChatModel: z.tuple([z.string().trim().min(1).max(80)]),
  setActiveChat: z.tuple([z.object({ modelId: z.string().trim().min(1).max(120), effort: z.string().trim().max(40) }).strict()])
};
