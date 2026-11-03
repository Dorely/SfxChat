import { z } from 'zod';

export const cueSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
  label: z.string().trim().min(1).max(200), brief: z.string().max(10000).default(''),
  candidates: z.array(z.object({ assetId: z.string().uuid(), label: z.string().max(200).default(''), notes: z.string().max(10000).default(''), gainDb: z.number().min(-60).max(12).default(0) }).strict()).max(128),
  referenceId: z.string().uuid().nullable().default(null), referenceGainDb: z.number().min(-60).max(12).default(0),
  decision: z.enum(['unreviewed', 'selected', 'rejected']).default('unreviewed'), selectedAssetId: z.string().uuid().nullable().default(null),
  notes: z.string().max(10000).default('')
}).strict().superRefine((cue, ctx) => {
  if (new Set(cue.candidates.map(c => c.assetId)).size !== cue.candidates.length) ctx.addIssue({ code: 'custom', message: 'Candidate IDs must be unique.' });
  if (cue.decision === 'selected' ? !cue.candidates.some(c => c.assetId === cue.selectedAssetId) : cue.selectedAssetId !== null)
    ctx.addIssue({ code: 'custom', message: 'Only a selected decision may name one of this cue’s candidates.' });
});
export const boardInputSchema = z.object({ title: z.string().trim().min(1).max(200), cues: z.array(cueSchema).max(128) }).strict().superRefine((board, ctx) => {
  if (new Set(board.cues.map(c => c.key.toLowerCase())).size !== board.cues.length) ctx.addIssue({ code: 'custom', message: 'Cue keys must be unique (case insensitive).' });
});
export type ReviewCue = z.infer<typeof cueSchema>;
export type ReviewContent = z.infer<typeof boardInputSchema>;
export interface ReviewStamp { origin: 'user' | 'agent'; at: string; revision: number }
export interface CueAudit { decision: ReviewStamp; notes: ReviewStamp; candidates: Record<string, ReviewStamp> }
export interface ReviewBoard extends ReviewContent {
  status: 'active' | 'completed'; completedAt: string | null; completedBy: 'user' | 'agent' | null;
  cueAudit: Record<string, CueAudit>;
  id: string; projectId: string; revision: number; createdAt: string; updatedAt: string; origin: 'user' | 'agent';
}
/** One saved review revision as review_wait reports it; cues lists keys whose decision or notes changed. */
export interface ReviewEvent { revision: number; origin: 'user' | 'agent'; at: string; kind: 'created' | 'saved' | 'completed' | 'reopened'; status: 'active' | 'completed'; cues: string[] }
/** What review_wait returns: revisions after the cursor, the review as it is now, and whether the wait ran out. */
export interface ReviewWait { review: ReviewBoard; events: ReviewEvent[]; cursor: number; timedOut: boolean }
export interface PlaybackState { status: 'stopped' | 'playing' | 'error'; assetId?: string; reviewId?: string; error?: string; updatedAt: string }
export interface UiCommand { id: string; action: 'open' | 'stop'; projectId: string; sessionId: string; reviewId?: string }
export interface OperationResponse { ok: boolean; result?: unknown; error?: { code: string; message: string; details?: unknown } }
export class WorkbenchError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}
export const installationSchema = z.object({
  action: z.enum(['install', 'uninstall', 'status']).default('install'), scope: z.enum(['project', 'user']),
  targets: z.array(z.enum(['codex', 'claude'])).default([]), projectDirectory: z.string().optional(), directory: z.string().optional(),
  skill: z.boolean().default(true), mcp: z.boolean().default(false), dryRun: z.boolean().default(false), force: z.boolean().default(false)
}).strict();
export type InstallationInput = z.infer<typeof installationSchema>;
