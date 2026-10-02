import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { WorkbenchService } from './service';
import { analysisSchema, clipSchema, generationSchema, idSchema, musicToolSchema, patchSchema, projectNameSchema, spectrogramSchema, titleSchema, trimSchema } from './validation';
import { boardInputSchema, WorkbenchError, type UiCommand, type PlaybackState } from '../shared/workbench';
import { guidanceDocuments } from '../shared/guidance';
import type { Exporter } from './exporter';

const project = { projectId: idSchema };
const session = { ...project, sessionId: idSchema };
const board = { ...session, reviewId: idSchema };
const wait = { timeoutMs: z.number().int().min(0).max(30000).default(10000) };
const generation = { ...session, requestId: z.string().uuid().describe('Keep this ID to recover the same request without purchasing another batch.') };
const obj = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const exportFields = { destination: z.string().min(1), format: z.enum(['original', 'wav', 'ogg']).default('original') };
export const operationDefinitions = {
  status: { schema: obj({}), description: 'App readiness and provider status, without secrets.' },
  guidance: { schema: obj({}), description: 'Complete current sound-design guidance, version/hash, configured providers and generation controls.' },
  projects_list: { schema: obj({}), description: 'List workbench projects.' },
  project_create: { schema: obj({ name: projectNameSchema }), description: 'Create a project without changing the visible project.' },
  project_get: { schema: obj(project), description: 'Inspect a project.' },
  project_rename: { schema: obj({ ...project, name: projectNameSchema }), description: 'Rename a project.' },
  sessions_list: { schema: obj(project), description: 'List sessions in an explicit project.' },
  session_create: { schema: obj({ ...project, title: titleSchema }), description: 'Create and label a session in a project.' },
  session_get: { schema: obj(session), description: 'Inspect a session, its Playground and jobs.' },
  rename_session: { schema: obj({ ...session, title: titleSchema }), description: 'Keep a session label specific to the current work.' },
  generate_sounds: { schema: obj({ ...generation, input: generationSchema }), description: 'Queue sound-effect candidates. Returns durable IDs immediately. Respect requested count; never retry uncertain work with a new request ID.' },
  generate_music: { schema: obj({ ...generation, input: musicToolSchema }), description: 'Queue music candidates on a configured provider. Returns durable IDs immediately; read guidance for the selected provider.' },
  inspect_jobs: { schema: obj(session), description: 'Inspect this session’s jobs and resulting asset IDs.' },
  jobs_wait: { schema: obj({ ...session, jobIds: z.array(idSchema).min(1), ...wait }), description: 'Bounded wait for specified jobs; timeout does not cancel generation.' },
  cancel_job: { schema: obj({ ...session, id: idSchema }), description: 'Cancel queued work or stop a running request with uncertain provider outcome.' },
  search_assets: { schema: obj({ ...project, query: z.string().default('') }), description: 'Search assets, prompts, traits and feedback in a project.' },
  inspect_asset: { schema: obj({ ...project, id: idSchema }), description: 'Read immutable provenance and current asset metadata.' },
  update_asset: { schema: obj({ ...session, id: idSchema, patch: patchSchema }), description: 'Name, tag, organize, and review an asset without changing its bytes.' },
  import_audio: { schema: obj({ ...session, paths: z.array(z.string().min(1)).min(1).max(128), kind: z.enum(['effect', 'music']).default('effect') }), description: 'Import WAV/MP3 files using absolute paths into this project/session.' },
  set_playground: { schema: obj({ ...session, assetIds: z.array(idSchema) }), description: 'Arrange the session’s existing comparison board.' },
  analyze_audio: { schema: obj({ ...project, id: idSchema, input: analysisSchema.default({}) }), description: 'Measure exact sample-frame amplitude, events and seam data; not semantic listening.' },
  trim_asset: { schema: obj({ ...session, id: idSchema, input: trimSchema }), description: 'Save a trim or loop derivative with exact lineage; original unchanged.' },
  spectrogram_view: { schema: obj({ ...project, id: idSchema, input: spectrogramSchema.default({}) }), description: 'Return a PNG spectrogram and exact mapping. Cut points must come from sample measurements.' },
  audio_listen: { schema: obj({ ...project, id: idSchema, input: clipSchema.default({}) }), description: 'Return a bounded WAV clip. Hearing requires a capable calling model/harness; playback is not hearing.' },
  review_list: { schema: obj(session), description: 'List cue-based review boards in a session.' },
  review_create: { schema: obj({ ...session, content: boardInputSchema }), description: 'Prepare named cues, candidates, references and preview settings without autoplay.' },
  review_get: { schema: obj(board), description: 'Read a review revision, selections, rejected cues and notes.' },
  review_history: { schema: obj(board), description: 'Inspect saved review revisions and decision/feedback attribution.' },
  review_update: { schema: obj({ ...board, expectedRevision: z.number().int().positive(), content: boardInputSchema }), description: 'Save review content only if its revision still matches. Reconcile conflicts with current feedback.' },
  review_wait: { schema: obj({ ...board, afterRevision: z.number().int().min(0), ...wait }), description: 'Wait up to 30 seconds for a saved review revision change.' },
  review_open: { schema: obj(board), description: 'Show and focus this review in SfxChat without autoplay.' },
  playback_play: { schema: obj({ ...board, assetId: idSchema, repeat: z.boolean().default(false), cueKey: z.string().min(1) }), description: 'Explicitly play a candidate/reference using its saved preview gain and optional repeat cadence.' },
  playback_stop: { schema: obj(session), description: 'Stop playback belonging to this session.' },
  playback_status: { schema: obj(session), description: 'Read actual renderer playback status. Does not imply listening approval.' },
  export_asset: { schema: obj({ ...project, id: idSchema, ...exportFields }), description: 'Export an original, PCM WAV or Ogg Vorbis plus provenance; refuses existing files.' },
  export_review: { schema: obj({ ...board, expectedRevision: z.number().int().positive(), ...exportFields }), description: 'Export selected cues and a manifest of choices, unresolved cues, feedback and provenance into a new directory.' }
};
export type OperationName = keyof typeof operationDefinitions;
export type OperationArgs<N extends OperationName> = z.infer<(typeof operationDefinitions)[N]['schema']>;
export interface UiPort { send(command: Omit<UiCommand, 'id'>): Promise<unknown>; state(sessionId: string): PlaybackState }
export function operationCatalog() {
  return Object.entries(operationDefinitions).map(([name, value]) => ({ name, description: value.description, inputSchema: z.toJSONSchema(value.schema) }));
}
export class Operations {
  private pending = new Set<Promise<unknown>>();
  private stopped = false;
  constructor(private service: WorkbenchService, private ui: UiPort, private exporter: Exporter) {}
  async close() { this.stopped = true; await Promise.allSettled([...this.pending]); }
  call(name: string, raw: unknown, origin: 'user' | 'agent' = 'agent'): Promise<unknown> {
    if (this.stopped) return Promise.reject(new WorkbenchError('CLOSING', 'SfxChat is closing.'));
    if (!Object.hasOwn(operationDefinitions, name)) return Promise.reject(new WorkbenchError('UNKNOWN_OPERATION', 'Unknown workbench operation.'));
    const promise = this.execute(name as OperationName, raw, origin);
    this.pending.add(promise); void promise.finally(() => this.pending.delete(promise)).catch(() => {}); return promise;
  }
  private async execute(name: OperationName, raw: unknown, origin: 'user' | 'agent'): Promise<unknown> {
    const definition = operationDefinitions[name];
    const parsed = definition.schema.safeParse(raw);
    if (!parsed.success) throw new WorkbenchError('INVALID_ARGUMENTS', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    const a = parsed.data as Record<string, any>;
    const s = this.service, store = s.store;
    if (a.projectId) store.project(a.projectId);
    if (a.sessionId && store.conversation(a.sessionId).projectId !== a.projectId) throw new WorkbenchError('NOT_FOUND', 'Session not found in project.');
    const review = () => { const r = store.review(a.reviewId, a.projectId); if (r.sessionId !== a.sessionId) throw new WorkbenchError('NOT_FOUND', 'Review not found in session.'); return r; };
    const sessionJobs = () => store.jobs(a.projectId).filter(j => j.conversationId === a.sessionId);
    const getJobs = () => a.jobIds.map((id: string) => { const job = sessionJobs().find(j => j.id === id); if (!job) throw new WorkbenchError('NOT_FOUND', 'Job not found in session.'); return job; });
    switch (name) {
      case 'status': { const settings = await s.settings(); return { version: 1, ready: true, elevenLabsReady: settings.elevenLabsReady, musicProviders: settings.musicProviders, activeMusicId: settings.activeMusicId }; }
      case 'guidance': { const settings = await s.settings(); return { version: 1, hash: createHash('sha256').update(JSON.stringify(guidanceDocuments)).digest('hex'), documents: guidanceDocuments, providers: { effects: { kind: 'elevenlabs', model: 'eleven_text_to_sound_v2', ready: settings.elevenLabsReady }, music: settings.musicProviders, activeMusicId: settings.activeMusicId }, controls: { effects: z.toJSONSchema(generationSchema), music: z.toJSONSchema(musicToolSchema) } }; }
      case 'projects_list': return store.projects();
      case 'project_get': return store.project(a.projectId);
      case 'project_create': return store.createProject(a.name);
      case 'project_rename': return store.renameProject(a.projectId, a.name);
      case 'sessions_list': return store.conversations(a.projectId);
      case 'session_create': return store.renameConversation(store.createConversation(a.projectId), a.title, origin === 'user' ? 'user' : 'assistant');
      case 'session_get': return { session: store.conversation(a.sessionId), playground: store.playground(a.projectId)[a.sessionId] ?? [], jobs: sessionJobs() };
      case 'rename_session': return store.renameConversation(a.sessionId, a.title, origin === 'user' ? 'user' : 'assistant');
      case 'generate_sounds': case 'generate_music': {
        const id = `external:${a.requestId}`;
        if (store.beginExternal(id, a.projectId, a.sessionId, name, canonical(a.input))) {
          try {
            if (name === 'generate_sounds') await s.generate(a.sessionId, a.input, id);
            else await s.generateMusic(a.sessionId, { ...a.input, kind: 'music' }, id);
            store.finishExternal(id);
          } catch (e) { store.finishExternal(id, e instanceof Error ? e.message : 'Admission failed.'); }
        }
        const result = store.externalRequest(id);
        return { requestId: a.requestId, ...result, jobs: result.jobIds.map(id => store.job(id)) };
      }
      case 'inspect_jobs': return sessionJobs();
      case 'jobs_wait': { await this.waitUntil(() => getJobs().every((j: { status: string }) => !['queued', 'running'].includes(j.status)), a.timeoutMs); return { jobs: getJobs() }; }
      case 'cancel_job': { if (!sessionJobs().some(j => j.id === a.id)) throw new WorkbenchError('NOT_FOUND', 'Job not found in session.'); s.cancelJob(a.id); return store.job(a.id); }
      case 'search_assets': return store.search(a.query, a.projectId);
      case 'inspect_asset': return store.asset(a.id, a.projectId);
      case 'update_asset': s.updateAsset(a.id, a.patch, a.sessionId); return store.asset(a.id, a.projectId);
      case 'import_audio': { if (a.paths.some((path: string) => !isAbsolute(path))) throw new WorkbenchError('INVALID_PATH', 'Import paths must be absolute.'); return s.importFiles(a.sessionId, a.paths, a.kind); }
      case 'set_playground': store.setPlayground(a.sessionId, a.assetIds); return { assetIds: store.playground(a.projectId)[a.sessionId] };
      case 'analyze_audio': return s.analyzeAudio(a.id, a.input, a.projectId);
      case 'trim_asset': return s.trimAsset(a.sessionId, a.id, a.input);
      case 'spectrogram_view': { const { png, mapping } = await s.media.spectrogram(store.asset(a.id, a.projectId), a.input); return { mapping, media: { type: 'image', mimeType: 'image/png', data: png.toString('base64') } }; }
      case 'audio_listen': { const { bytes, ...clip } = await s.media.clip(store.asset(a.id, a.projectId), a.input); return { clip, media: { type: 'audio', mimeType: 'audio/wav', data: bytes.toString('base64') } }; }
      case 'review_list': return store.reviews(a.projectId, a.sessionId);
      case 'review_get': return review();
      case 'review_history': review(); return store.reviewHistory(a.reviewId, a.projectId);
      case 'review_create': return store.saveReview(a.projectId, a.sessionId, a.content, origin);
      case 'review_update': review(); return store.saveReview(a.projectId, a.sessionId, a.content, origin, a.reviewId, a.expectedRevision);
      case 'review_wait': { await this.waitUntil(() => review().revision > a.afterRevision, a.timeoutMs); return review(); }
      case 'review_open': review(); return this.ui.send({ action: 'open', projectId: a.projectId, sessionId: a.sessionId, reviewId: a.reviewId });
      case 'playback_play': {
        const r = review(), cue = r.cues.find(c => c.key === a.cueKey), candidate = cue?.candidates.find(c => c.assetId === a.assetId);
        if (!cue || (!candidate && cue.referenceId !== a.assetId)) throw new WorkbenchError('NOT_FOUND', 'Sound not found in cue.');
        return this.ui.send({ action: 'play', projectId: a.projectId, sessionId: a.sessionId, reviewId: r.id, assetId: a.assetId, gainDb: candidate?.gainDb ?? cue.referenceGainDb, ...(a.repeat ? { repeatIntervalMs: cue.repeatIntervalMs, singleVoice: cue.singleVoice } : {}) });
      }
      case 'playback_stop': return this.ui.send({ action: 'stop', projectId: a.projectId, sessionId: a.sessionId });
      case 'playback_status': return this.ui.state(a.sessionId);
      case 'export_asset': return this.exporter.asset(store.asset(a.id, a.projectId), a.destination, a.format);
      case 'export_review': { const r = review(); if (r.revision !== a.expectedRevision) throw new WorkbenchError('REVISION_CONFLICT', 'Read the current review before exporting.'); return this.exporter.review(r, a.destination, a.format); }
    }
  }
  private async waitUntil(done: () => boolean, timeout: number) {
    const until = Date.now() + timeout;
    while (!this.stopped && !done() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, Math.min(250, until - Date.now())));
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
