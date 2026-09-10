import { z } from 'zod';
export const idSchema = z.string().uuid();
export const generationSchema = z.object({
  prompt: z.string().trim().min(1), count: z.number().int().positive().safe().optional(),
  duration: z.number().min(0.5).max(30).nullable().optional(), loop: z.boolean().optional(),
  influence: z.number().min(0).max(1).optional(), parentId: idSchema.nullable().optional(), name: z.string().trim().min(1).optional()
}).strict();
export const patchSchema = z.object({ name: z.string().trim().min(1).optional(), description: z.string().optional(), tags: z.array(z.string().trim().min(1)).optional(), collections: z.array(z.string().trim().min(1)).optional(), review: z.enum(['unreviewed','accepted','rejected']).optional(), feedback: z.string().optional() }).strict();
export const commandSchemas = {
  snapshot: z.tuple([]), createConversation: z.tuple([]),
  sendMessage: z.tuple([idSchema, z.string().trim().min(1)]), cancelTurn: z.tuple([idSchema]),
  generate: z.tuple([idSchema, generationSchema]), cancelJob: z.tuple([idSchema]),
  updateAsset: z.tuple([idSchema, patchSchema, idSchema.optional()]), setPlayground: z.tuple([idSchema, z.array(idSchema)]),
  importAudio: z.tuple([idSchema]), exportAsset: z.tuple([idSchema]), searchAssets: z.tuple([z.string()]),
  startLogin: z.tuple([]), cancelLogin: z.tuple([]), logout: z.tuple([]),
  saveElevenLabsKey: z.tuple([z.string()]), saveModel: z.tuple([z.string().trim().regex(/^[a-zA-Z0-9._-]+$/)])
};
