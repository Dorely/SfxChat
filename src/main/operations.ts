import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { WorkbenchService } from './service';
import { analysisSchema, assetKindSchema, clipSchema, loopSearchSchema, generationSchema, idSchema, midiToolSchema, musicToolSchema, voiceToolSchema, voiceListSchema, voiceModelListSchema, audioModelListSchema, patchSchema, projectNameSchema, spectrogramSchema, titleSchema, trimSchema } from './validation';
import { boardInputSchema, WorkbenchError, type UiCommand, type PlaybackState } from '../shared/workbench';
import { guidanceDocuments, selectGuidance } from '../shared/guidance';
import type { Exporter } from './exporter';
import { arrangementOperationDefinitions } from '../shared/arrangement-operations';
import { Arrangements } from './arrangements';
import type { SoundfontInfo } from './soundfont';

const project = { projectId: idSchema };
const session = { ...project, sessionId: idSchema };
const board = { ...project, reviewId: idSchema };
const wait = { timeoutMs: z.number().int().min(0).max(30000).default(10000) };
const generation = { ...session, requestId: z.string().uuid().describe('Keep this ID to recover the same request without purchasing another batch.') };
const obj = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const exportFields = { destination: z.string().min(1), format: z.enum(['original', 'wav', 'ogg']).default('original') };
export const operationDefinitions = {
  ...arrangementOperationDefinitions,
  status: { schema: obj({}), description: 'App readiness and provider status, without secrets.' },
  guidance: { schema: obj({ topics: z.array(z.string().min(1)).min(1).max(24).optional() }), description: 'Read shared guidance by topic filename (music-craft, arranging, synthesis, mixing, local-workflow, editing, or provider references). Omit topics for the compatible complete response. Hash always covers the complete guidance manifest.' },
  projects_list: { schema: obj({}), description: 'List workbench projects.' },
  project_create: { schema: obj({ name: projectNameSchema }), description: 'Create a project without changing the visible project.' },
  project_delete: { schema: obj(project), description: 'Permanently delete a project and its conversations, reviews and library records. Original media files remain on disk. Requires explicit user intent.' },
  session_delete: { schema: obj(session), description: 'Permanently delete a conversation and its messages/job history. Project audio, reviews and Playground remain. Requires explicit user intent.' },
  project_get: { schema: obj(project), description: 'Inspect a project.' },
  project_rename: { schema: obj({ ...project, name: projectNameSchema }), description: 'Rename a project.' },
  sessions_list: { schema: obj(project), description: 'List sessions in an explicit project.' },
  session_create: { schema: obj({ ...project, title: titleSchema }), description: 'Create and label a session in a project.' },
  session_get: { schema: obj(session), description: 'Inspect a session, its Playground and jobs.' },
  rename_session: { schema: obj({ ...session, title: titleSchema }), description: 'Keep a session label specific to the current work.' },
  generate_sounds: { schema: obj({ ...generation, input: generationSchema }), description: 'Queue paid provider sound-effect candidates when provider generation is intended. Editable local effects use arrangement operations. Omitted model uses the newest available ElevenLabs sound model. Respect requested count; never retry uncertain work with a new request ID.' },
  generate_music: { schema: obj({ ...generation, input: musicToolSchema }), description: 'Queue paid music candidates on a configured provider when that route is intended. Local editable instrumental music uses arrangement operations without a provider. Read the selected provider guidance. Omitted model uses the saved provider model, which follows the newest ElevenLabs model by default.' },
  generate_voice: { schema: obj({ ...generation, input: voiceToolSchema }), description: 'Queue single-speaker speech from an exact script. Query list_voice_models, choose a selectable model ID in input.model, follow its guidance and supported controls, and discover voice IDs with list_voices. Omitted model uses the saved default, which follows the newest ElevenLabs model unless pinned. Returns durable job IDs; never retry uncertain work.' },
  compose_midi: { schema: obj({ ...generation, input: midiToolSchema }), description: 'Compose a MIDI clip from note data into a Standard MIDI File that plays through the bundled General MIDI bank. No provider, key, or spend. Returns durable job IDs immediately.' },
  list_voices: { schema: voiceListSchema, description: 'Discover provider voice IDs, descriptions and language/accent labels. Read successive pages with the same filters. Uses the shared saved key, without synthesis.' },
  list_voice_models: { schema: voiceModelListSchema, description: 'Query available TTS models before choosing input.model in generate_voice. ElevenLabs uses its saved key and live /v1/models (five-minute cache; refresh:true bypasses it); Gemini returns a labeled built-in catalog. Returns exact IDs, selectable status, model-specific prompting notes, controls, limits, languages, access flags and saved defaults. Generic guidance means plain text only. Realtime-only models are unavailable in this workbench. latestModel is what "latest" resolves to; defaultFollowsLatest reports whether the saved default tracks it. Discovery makes no purchase and does not change defaults.' },
  list_audio_models: { schema: audioModelListSchema, description: 'List ElevenLabs sound-effect (kind "effect") or music (kind "music") model IDs from the official public API schema (six-hour cache; refresh:true bypasses it), with reviewed notes, deprecation and availability for the saved key. latestModel is used when model is omitted or "latest". Pin an older ID only when the user deliberately chooses it. source "built-in" means discovery failed and reviewed IDs are shown. No purchase.' },
  inspect_jobs: { schema: obj(session), description: 'Inspect this session’s jobs and resulting asset IDs.' },
  jobs_wait: { schema: obj({ ...session, jobIds: z.array(idSchema).min(1), ...wait }), description: 'Bounded wait for specified jobs; timeout does not cancel generation.' },
  cancel_job: { schema: obj({ ...session, id: idSchema }), description: 'Cancel queued work or stop a running request with uncertain provider outcome.' },
  search_assets: { schema: obj({ ...project, query: z.string().default('') }), description: 'Search assets, prompts, traits and feedback in a project.' },
  inspect_asset: { schema: obj({ ...project, id: idSchema }), description: 'Read immutable provenance and current asset metadata.' },
  update_asset: { schema: obj({ ...session, id: idSchema, patch: patchSchema }), description: 'Name, tag, organize, and review an asset without changing its bytes.' },
  import_audio: { schema: obj({ ...session, paths: z.array(z.string().min(1)).min(1).max(128), kind: assetKindSchema.default('effect') }), description: 'Import WAV/MP3 files using absolute paths into this project/session.' },
  set_playground: { schema: obj({ ...project, assetIds: z.array(idSchema) }), description: 'Arrange the project’s shared comparison board.' },
  analyze_audio: { schema: obj({ ...project, id: idSchema, input: analysisSchema.default({}) }), description: 'Measure exact sample-frame amplitude, events and seam data; musical:true adds tempo, beat/bar grid, key and LUFS estimates. Not semantic listening.' },
  find_loop_points: { schema: obj({ ...project, id: idSchema, input: loopSearchSchema.default({}) }), description: 'Rank loop-point candidates for music (whole bars on the beat grid, optional intro) or ambience/texture, refined to exact frames with seam metrics and a recommended crossfade. Heuristic ranking; audition with audio_listen loopSeam, save with trim_asset loop:true.' },
  trim_asset: { schema: obj({ ...session, id: idSchema, input: trimSchema }), description: 'Save a trim or loop derivative with exact lineage; original unchanged.' },
  spectrogram_view: { schema: obj({ ...project, id: idSchema, input: spectrogramSchema.default({}) }), description: 'Return a PNG spectrogram and exact mapping. Cut points must come from sample measurements.' },
  audio_listen: { schema: obj({ ...project, id: idSchema, input: clipSchema.default({}) }), description: 'Return a bounded WAV clip, or with input.loopSeam the wrap of a loop exactly as a loop render plays it. Hearing requires a capable calling model/harness; playback is not hearing.' },
  review_list: { schema: obj({ ...project, status: z.enum(['active', 'completed', 'all']).default('active') }), description: 'List review boards. Defaults to active; completed finds archived reviews, all includes both.' },
  review_create: { schema: obj({ ...project, content: boardInputSchema, open: z.boolean().default(true) }), description: 'Create a cue sheet and open it in the UI without autoplay. Use open:false while preparing a draft, then review_open when ready. Returns the saved review plus ui.status (opened, skipped, or failed). If opening fails, retry review_open with the returned ID, never recreate the saved sheet.' },
  review_get: { schema: obj(board), description: 'Read a review revision, selections, rejected cues and notes.' },
  review_history: { schema: obj(board), description: 'Inspect saved review revisions and decision/feedback attribution.' },
  review_update: { schema: obj({ ...board, expectedRevision: z.number().int().positive(), content: boardInputSchema }), description: 'Save review content only if its revision still matches. Reconcile conflicts with current feedback.' },
  review_complete: { schema: obj({ ...board, expectedRevision: z.number().int().positive(), content: boardInputSchema.optional() }), description: 'Save optional final content and mark the review completed/archived atomically. Locks edits until explicitly reopened. Unreviewed cues are allowed; completion does not imply acceptance. Records agent or user attribution.' },
  review_reopen: { schema: obj({ ...board, expectedRevision: z.number().int().positive() }), description: 'Explicitly restore a completed review to active and editable, preserving completion history.' },
  review_wait: { schema: obj({ ...board, afterRevision: z.number().int().min(0), condition: z.enum(['revision', 'completed']).default('revision'), ...wait }), description: 'Wait up to 30 seconds for a revision change or completed status. Always returns current review; inspect status/revision to distinguish timeout. Completion does not imply all cues were accepted.' },
  review_open: { schema: obj(board), description: 'Show and focus this review in SfxChat without autoplay.' },
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
  readonly arrangements: Arrangements;
  constructor(private service: WorkbenchService, private ui: UiPort, private exporter: Exporter, font: () => Promise<SoundfontInfo>) { this.arrangements = new Arrangements(service, font); }
  async close() { this.stopped = true; await Promise.allSettled([...this.pending]); await this.arrangements.close(); }
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
    if (Object.hasOwn(arrangementOperationDefinitions, name)) return this.arrangements.call(name, a, origin);
    const review = () => store.review(a.reviewId, a.projectId);
    const sessionJobs = () => store.jobs(a.projectId).filter(j => j.conversationId === a.sessionId);
    const getJobs = () => a.jobIds.map((id: string) => { const job = sessionJobs().find(j => j.id === id); if (!job) throw new WorkbenchError('NOT_FOUND', 'Job not found in session.'); return job; });
    switch (name) {
      case 'status': { const settings = await s.settings(); return { version: 1, ready: true, elevenLabsReady: settings.elevenLabsReady, musicProviders: settings.musicProviders, activeMusicId: settings.activeMusicId, voiceProviders: settings.voiceProviders, activeVoiceId: settings.activeVoiceId, providerKeys: settings.providerKeys }; }
      case 'guidance': { const settings = await s.settings(); return { version: 1, hash: createHash('sha256').update(JSON.stringify(guidanceDocuments)).digest('hex'), topics: Object.keys(guidanceDocuments), documents: selectGuidance(a.topics), providers: { effects: { kind: 'elevenlabs', model: 'latest', latestModel: (await s.listAudioModels({ kind: 'effect' })).latestModel, ready: settings.elevenLabsReady }, music: settings.musicProviders, activeMusicId: settings.activeMusicId, voiceProviders: settings.voiceProviders, activeVoiceId: settings.activeVoiceId, providerKeys: settings.providerKeys }, controls: { effects: z.toJSONSchema(generationSchema), music: z.toJSONSchema(musicToolSchema), voice: z.toJSONSchema(voiceToolSchema), midi: z.toJSONSchema(midiToolSchema) } }; }
      case 'projects_list': return store.projects();
      case 'project_delete': s.deleteWorkspace(a.projectId); return { deleted: true };
      case 'session_delete': s.deleteWorkspace(a.projectId, a.sessionId); return { deleted: true };
      case 'project_get': return store.project(a.projectId);
      case 'project_create': return store.createProject(a.name);
      case 'project_rename': return store.renameProject(a.projectId, a.name);
      case 'sessions_list': return store.conversations(a.projectId);
      case 'session_create': return store.renameConversation(store.createConversation(a.projectId), a.title, origin === 'user' ? 'user' : 'assistant');
      case 'session_get': return { session: store.conversation(a.sessionId), playground: store.playground(a.projectId)[a.projectId] ?? [], jobs: sessionJobs() };
      case 'rename_session': return store.renameConversation(a.sessionId, a.title, origin === 'user' ? 'user' : 'assistant');
      case 'list_voices': return s.listVoices(a as unknown as import('../shared/types').VoiceListInput);
      case 'list_voice_models': return s.listVoiceModels(a as unknown as import('../shared/types').VoiceModelListInput);
      case 'list_audio_models': return s.listAudioModels(a as unknown as import('../shared/types').AudioModelListInput);
      case 'generate_sounds': case 'generate_music': case 'generate_voice': case 'compose_midi': {
        const id = `external:${a.requestId}`;
        if (store.beginExternal(id, a.projectId, a.sessionId, name, canonical(a.input))) {
          try {
            if (name === 'generate_sounds') await s.generate(a.sessionId, a.input, id);
            else if (name === 'generate_music') await s.generateMusic(a.sessionId, { ...a.input, kind: 'music' }, id);
            else if (name === 'compose_midi') await s.generateMidi(a.sessionId, { ...a.input, kind: 'midi' }, id);
            else await s.generateVoice(a.sessionId, { ...a.input, kind: 'voice' }, id);
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
      case 'set_playground': store.setProjectPlayground(a.projectId, a.assetIds); return { assetIds: store.playground(a.projectId)[a.projectId] };
      case 'analyze_audio': return s.analyzeAudio(a.id, a.input, a.projectId);
      case 'find_loop_points': return s.findLoopPoints(a.id, a.input, a.projectId);
      case 'trim_asset': return s.trimAsset(a.sessionId, a.id, a.input);
      case 'spectrogram_view': { const { png, mapping } = await s.media.spectrogram(store.asset(a.id, a.projectId), a.input); return { mapping, media: { type: 'image', mimeType: 'image/png', data: png.toString('base64') } }; }
      case 'audio_listen': {
        const asset = store.asset(a.id, a.projectId);
        if (a.input.loopSeam) {
          if (a.input.startSeconds !== undefined || a.input.endSeconds !== undefined) throw new WorkbenchError('INVALID_ARGUMENTS', 'Pass either loopSeam or startSeconds/endSeconds, not both.');
          const { bytes, sampleRate, seam } = await s.seamClip(asset, a.input.loopSeam);
          return { clip: { duration: seam.duration, seamAtSeconds: seam.seamAtSeconds, sampleRate, channels: 1 }, loop: { startFrame: seam.startFrame, endFrame: seam.endFrame, crossfadeFrames: seam.crossfadeFrames }, media: { type: 'audio', mimeType: 'audio/wav', data: bytes.toString('base64') } };
        }
        const { bytes, ...clip } = asset.format === 'mid' ? await s.midiClip(a.id, a.input, a.projectId) : await s.media.clip(asset, a.input);
        return { clip, media: { type: 'audio', mimeType: 'audio/wav', data: bytes.toString('base64') } };
      }
      case 'review_list': return store.reviews(a.projectId, a.status);
      case 'review_get': return review();
      case 'review_history': review(); return store.reviewHistory(a.reviewId, a.projectId);
      case 'review_create': {
        const created = store.saveReview(a.projectId, a.content, origin);
        if (!a.open) return { ...created, ui: { status: 'skipped' } };
        // Persistence succeeded even if the renderer cannot accept the navigation.
        // Return its identity so callers can retry opening without duplicating it.
        try {
          await this.ui.send({ action: 'open', projectId: a.projectId, sessionId: store.ensureConversation(a.projectId), reviewId: created.id });
          return { ...created, ui: { status: 'opened' } };
        } catch (error) {
          return { ...created, ui: { status: 'failed', code: error instanceof WorkbenchError ? error.code : 'UI_FAILED', message: error instanceof Error ? error.message : 'Could not open review.' } };
        }
      }
      case 'review_update': review(); return store.saveReview(a.projectId, a.content, origin, a.reviewId, a.expectedRevision);
      case 'review_complete': review(); return store.saveReview(a.projectId, a.content, origin, a.reviewId, a.expectedRevision, 'completed');
      case 'review_reopen': review(); return store.saveReview(a.projectId, undefined, origin, a.reviewId, a.expectedRevision, 'active');
      case 'review_wait': { await this.waitUntil(() => a.condition === 'completed' ? review().status === 'completed' : review().revision > a.afterRevision, a.timeoutMs); return review(); }
      case 'review_open': review(); return this.ui.send({ action: 'open', projectId: a.projectId, sessionId: store.ensureConversation(a.projectId), reviewId: a.reviewId });
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
