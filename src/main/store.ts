import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { WorkbenchError, type ReviewBoard, type ReviewContent } from '../shared/workbench';
import type { Asset, AssetKind, AssetPatch, ChatAttachment, Conversation, AnyGenerationInput, Job, Message, Project, TitleSource } from '../shared/types';

const now = () => new Date().toISOString();
const decode = <T>(row: unknown): T => JSON.parse((row as { json: string }).json) as T;
// Records written before music existed carry no kind; they are sound effects.
const normalizeAsset = (asset: Asset): Asset => asset.kind ? asset : { ...asset, kind: 'effect' };
const normalizeJob = (job: Job): Job => job.kind ? job : { ...job, kind: 'effect' };
// The project_id column is authoritative; JSON written by an older version may not carry it.
const decodeConversation = (row: unknown): Conversation => {
  const record = row as { json: string; project_id: string };
  return { ...JSON.parse(record.json) as Conversation, projectId: record.project_id };
};
const decodeAsset = (row: unknown): Asset => {
  const record = row as { json: string; project_id: string };
  return normalizeAsset({ ...JSON.parse(record.json) as Asset, projectId: record.project_id });
};

const ACTIVE_PROJECT_KEY = 'project-active';
const DEFAULT_PROJECT_NAME = 'Default';
const PROJECT_NAME_MAX = 60;
const TITLE_MAX = 70;
const IN_PROJECT = 'conversation_id IN (SELECT id FROM conversations WHERE project_id=?)';

export class Store {
  readonly db: Database.Database;
  constructor(filename: string, private changed: () => void = () => {}) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > 4) { this.db.close(); throw new Error('This library was created by a newer SfxChat version.'); }
    if (version === 0) this.db.transaction(() => {
      // Fresh library gets the complete v2 shape. project_id carries no REFERENCES clause so a
      // fresh and an upgraded database stay structurally identical; projects are never deleted.
      this.db.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE conversations (id TEXT PRIMARY KEY, json TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '');
        CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), json TEXT NOT NULL);
        CREATE TABLE assets (id TEXT PRIMARY KEY, json TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '');
        CREATE VIRTUAL TABLE asset_search USING fts5(id UNINDEXED, text, tokenize='unicode61');
        CREATE TABLE jobs (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), status TEXT NOT NULL, json TEXT NOT NULL);
        CREATE TABLE playground (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), json TEXT NOT NULL);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE tool_calls (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), name TEXT NOT NULL, args TEXT NOT NULL, status TEXT NOT NULL, result TEXT);
        CREATE TABLE turns (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), status TEXT NOT NULL);
        PRAGMA user_version = 2;
      `);
      const project: Project = { id: randomUUID(), name: DEFAULT_PROJECT_NAME, createdAt: now() };
      this.db.prepare('INSERT INTO projects (id,json) VALUES (?,?)').run(project.id, JSON.stringify(project));
      this.db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(ACTIVE_PROJECT_KEY, project.id);
    })();
    if (version === 1) this.db.transaction(() => {
      // v2 adds projects. Every existing conversation and asset joins one default project.
      this.db.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, json TEXT NOT NULL);
        ALTER TABLE conversations ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
        ALTER TABLE assets ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
        PRAGMA user_version = 2;
      `);
      const project: Project = { id: randomUUID(), name: DEFAULT_PROJECT_NAME, createdAt: now() };
      this.db.prepare('INSERT INTO projects (id,json) VALUES (?,?)').run(project.id, JSON.stringify(project));
      this.db.prepare('UPDATE conversations SET project_id=?').run(project.id);
      this.db.prepare('UPDATE assets SET project_id=?').run(project.id);
      this.db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(ACTIVE_PROJECT_KEY, project.id);
    })();
    if (version < 3) this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE reviews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES conversations(id), revision INTEGER NOT NULL, json TEXT NOT NULL);
        CREATE TABLE review_history (review_id TEXT NOT NULL REFERENCES reviews(id), revision INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(review_id,revision));
        CREATE TABLE external_requests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES conversations(id), operation TEXT NOT NULL, args TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL);
        PRAGMA user_version = 3;
      `);
    })();
    if (version < 4) this.db.transaction(() => {
      this.db.exec(`UPDATE reviews SET json=json_set(json, '$.status', 'active', '$.completedAt', NULL, '$.completedBy', NULL); PRAGMA user_version = 4;`);
    })();
  }
  reviews(projectId: string, sessionId?: string, status: 'active' | 'completed' | 'all' = 'all'): ReviewBoard[] {
    return (sessionId ? this.db.prepare('SELECT json FROM reviews WHERE project_id=? AND session_id=? ORDER BY rowid DESC').all(projectId, sessionId)
      : this.db.prepare('SELECT json FROM reviews WHERE project_id=? ORDER BY rowid DESC').all(projectId)).map(readReview).filter(board => status === 'all' || board.status === status);
  }
  review(id: string, projectId: string): ReviewBoard {
    const row = this.db.prepare('SELECT json FROM reviews WHERE id=? AND project_id=?').get(id, projectId);
    if (!row) throw new WorkbenchError('NOT_FOUND', 'Review not found.');
    return readReview(row);
  }
  saveReview(projectId: string, sessionId: string, content: ReviewContent | undefined, origin: 'user' | 'agent', id?: string, expectedRevision?: number, transition?: 'completed' | 'active'): ReviewBoard {
    if (this.conversation(sessionId).projectId !== projectId) throw new WorkbenchError('NOT_FOUND', 'Session not found in project.');
    const result = this.db.transaction(() => {
      const old = id ? this.review(id, projectId) : undefined;
      if (old && (old.sessionId !== sessionId || old.revision !== expectedRevision)) throw new WorkbenchError('REVISION_CONFLICT', 'Review changed; read it again and reconcile your edit.', { revision: old.revision });
      if (old?.status === 'completed' && transition !== 'active') throw new WorkbenchError('REVIEW_COMPLETED', 'Review is completed. Explicitly reopen it before editing.');
      if (transition === 'active' && old?.status !== 'completed') throw new WorkbenchError('REVIEW_ACTIVE', 'Review is already active.');
      const finalContent = content ?? old;
      if (!finalContent) throw new WorkbenchError('INVALID_ARGUMENTS', 'Review content is required.');
      for (const cue of finalContent.cues) {
        for (const candidate of cue.candidates) this.asset(candidate.assetId, projectId);
        if (cue.referenceId) this.asset(cue.referenceId, projectId);
      }
      const stamp = { origin, at: now(), revision: (old?.revision ?? 0) + 1 };
      const cueAudit = Object.fromEntries(finalContent.cues.map(cue => {
        const previous = old?.cues.find(c => c.key === cue.key), audit = old?.cueAudit?.[cue.key];
        const fallback = old ? { origin: old.origin, at: old.updatedAt, revision: old.revision } : stamp;
        return [cue.key, {
          decision: previous?.decision === cue.decision && previous?.selectedAssetId === cue.selectedAssetId ? audit?.decision ?? fallback : stamp,
          notes: previous?.notes === cue.notes ? audit?.notes ?? fallback : stamp,
          candidates: Object.fromEntries(cue.candidates.map(c => [c.assetId, previous?.candidates.find(p => p.assetId === c.assetId)?.notes === c.notes ? audit?.candidates[c.assetId] ?? fallback : stamp]))
        }];
      }));
      const board: ReviewBoard = { title: finalContent.title, cues: finalContent.cues, status: transition ?? 'active', completedAt: transition === 'completed' ? stamp.at : null, completedBy: transition === 'completed' ? origin : null, cueAudit, id: old?.id ?? randomUUID(), projectId, sessionId, revision: stamp.revision, createdAt: old?.createdAt ?? stamp.at, updatedAt: stamp.at, origin };
      this.db.prepare('INSERT INTO reviews VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,json=excluded.json').run(board.id, projectId, sessionId, board.revision, JSON.stringify(board));
      this.db.prepare('INSERT INTO review_history VALUES (?,?,?)').run(board.id, board.revision, JSON.stringify(board));
      return board;
    })();
    this.changed(); return result;
  }
  reviewHistory(id: string, projectId: string): ReviewBoard[] {
    this.review(id, projectId);
    return this.db.prepare('SELECT json FROM review_history WHERE review_id=? ORDER BY revision').all(id).map(normalizeReview);
  }
  beginExternal(id: string, projectId: string, sessionId: string, operation: string, args: string) {
    const old = this.db.prepare('SELECT * FROM external_requests WHERE id=?').get(id) as { project_id: string; session_id: string; operation: string; args: string } | undefined;
    if (old) {
      if (old.project_id !== projectId || old.session_id !== sessionId || old.operation !== operation || old.args !== args) throw new WorkbenchError('REQUEST_CONFLICT', 'Request ID already belongs to different arguments.');
      return false;
    }
    this.db.prepare('INSERT INTO external_requests VALUES (?,?,?,?,?,?,?)').run(id, projectId, sessionId, operation, args, 'admitting', JSON.stringify({ jobIds: [] }));
    return true;
  }
  externalRequest(id: string) {
    const row = this.db.prepare('SELECT status,result FROM external_requests WHERE id=?').get(id) as { status: string; result: string };
    return { ...JSON.parse(row.result), status: row.status } as { status: string; jobIds: string[]; error?: string };
  }
  finishExternal(id: string, error?: string) {
    const record = this.externalRequest(id);
    this.db.prepare('UPDATE external_requests SET status=?,result=? WHERE id=?').run(error ? 'incomplete' : 'admitted', JSON.stringify({ ...record, ...(error ? { error } : {}) }), id);
    this.changed();
  }
  close() { this.db.close(); }
  projects(): Project[] { return this.db.prepare('SELECT json FROM projects ORDER BY rowid').all().map(decode<Project>); }
  project(id: string): Project {
    const row = this.db.prepare('SELECT json FROM projects WHERE id=?').get(id);
    if (!row) throw new Error('Project not found.'); return decode<Project>(row);
  }
  createProject(name: string): Project {
    const trimmed = name.trim().slice(0, PROJECT_NAME_MAX);
    if (!trimmed) throw new Error('A project name cannot be empty.');
    const project: Project = { id: randomUUID(), name: trimmed, createdAt: now() };
    this.db.prepare('INSERT INTO projects (id,json) VALUES (?,?)').run(project.id, JSON.stringify(project));
    this.changed(); return project;
  }
  renameProject(id: string, name: string): Project {
    const trimmed = name.trim().slice(0, PROJECT_NAME_MAX);
    if (!trimmed) throw new Error('A project name cannot be empty.');
    const renamed = { ...this.project(id), name: trimmed };
    this.db.prepare('UPDATE projects SET json=? WHERE id=?').run(JSON.stringify(renamed), id);
    this.changed(); return renamed;
  }
  /** The persisted active project, healed back to an existing project when the stored id is stale. */
  activeProjectId(): string {
    const stored = this.setting(ACTIVE_PROJECT_KEY, '');
    const projects = this.projects();
    const found = projects.find(project => project.id === stored);
    if (found) return found.id;
    const fallback = projects[0] ?? this.createProject(DEFAULT_PROJECT_NAME);
    this.setSetting(ACTIVE_PROJECT_KEY, fallback.id);
    return fallback.id;
  }
  setActiveProject(id: string): string { this.project(id); this.setSetting(ACTIVE_PROJECT_KEY, id); return id; }
  conversations(projectId?: string): Conversation[] {
    return (projectId
      ? this.db.prepare('SELECT json, project_id FROM conversations WHERE project_id=? ORDER BY rowid DESC').all(projectId)
      : this.db.prepare('SELECT json, project_id FROM conversations ORDER BY rowid DESC').all()).map(decodeConversation);
  }
  conversation(id: string): Conversation {
    const row = this.db.prepare('SELECT json, project_id FROM conversations WHERE id=?').get(id);
    if (!row) throw new Error('Conversation not found.'); return decodeConversation(row);
  }
  requireConversation(id: string) { if (!this.db.prepare('SELECT 1 FROM conversations WHERE id=?').get(id)) throw new Error('Conversation not found.'); }
  /** Guarantees the project holds at least one conversation and returns its id. */
  ensureConversation(projectId: string): string {
    this.project(projectId);
    const existing = this.db.prepare('SELECT id FROM conversations WHERE project_id=? ORDER BY rowid DESC').get(projectId) as { id: string } | undefined;
    return existing?.id ?? this.createConversation(projectId);
  }
  createConversation(projectId?: string): string {
    const project = projectId ?? this.activeProjectId();
    this.project(project);
    const c: Conversation = { id: randomUUID(), title: 'New conversation', createdAt: now(), projectId: project, titleSource: 'default' };
    this.db.prepare('INSERT INTO conversations (id,project_id,json) VALUES (?,?,?)').run(c.id, c.projectId, JSON.stringify(c));
    this.changed(); return c.id;
  }
  renameConversation(id: string, title: string, source: TitleSource): Conversation {
    const renamed = { ...this.conversation(id), title: title.trim().slice(0, TITLE_MAX), titleSource: source };
    if (!renamed.title) throw new Error('A session title cannot be empty.');
    this.db.prepare('UPDATE conversations SET json=? WHERE id=?').run(JSON.stringify(renamed), id);
    this.changed(); return renamed;
  }
  /** Auto-names an untouched session from its first message; an explicit title always wins. */
  titleConversation(id: string, title: string) {
    const c = this.conversation(id);
    if (c.title !== 'New conversation' || (c.titleSource ?? 'default') !== 'default') return;
    c.title = title.slice(0, TITLE_MAX); c.titleSource = 'default';
    this.db.prepare('UPDATE conversations SET json=? WHERE id=?').run(JSON.stringify(c), id);
  }
  messages(projectId?: string): Message[] {
    return (projectId
      ? this.db.prepare(`SELECT json FROM messages WHERE ${IN_PROJECT} ORDER BY rowid`).all(projectId)
      : this.db.prepare('SELECT json FROM messages ORDER BY rowid').all()).map(decode<Message>);
  }
  addMessage(conversationId: string, role: Message['role'], text: string, status: Message['status'] = 'completed', attachments?: ChatAttachment[]): Message {
    this.requireConversation(conversationId);
    const message: Message = { id: randomUUID(), conversationId, role, text, status, createdAt: now(), ...(attachments?.length ? { attachments } : {}) };
    this.db.prepare('INSERT INTO messages VALUES (?,?,?)').run(message.id, conversationId, JSON.stringify(message));
    this.changed(); return message;
  }
  /** Project-scoped message lookup for attachment serving; other projects fail like missing ones. */
  message(id: string, projectId: string): Message {
    const row = this.db.prepare('SELECT json, conversation_id FROM messages WHERE id=?').get(id) as { json: string; conversation_id: string } | undefined;
    if (!row) throw new Error('Message not found.');
    const conversation = this.db.prepare('SELECT project_id FROM conversations WHERE id=?').get(row.conversation_id) as { project_id: string } | undefined;
    if (!conversation || conversation.project_id !== projectId) throw new Error('Message not found.');
    return decode<Message>(row);
  }
  updateMessage(message: Message) { this.db.prepare('UPDATE messages SET json=? WHERE id=?').run(JSON.stringify(message), message.id); this.changed(); }
  assets(projectId?: string): Asset[] {
    return (projectId
      ? this.db.prepare('SELECT json, project_id FROM assets WHERE project_id=? ORDER BY rowid DESC').all(projectId)
      : this.db.prepare('SELECT json, project_id FROM assets ORDER BY rowid DESC').all()).map(decodeAsset);
  }
  /** Project-scoped lookup; an asset from another project fails exactly like a missing one. */
  asset(id: string, projectId: string): Asset {
    const row = this.db.prepare('SELECT json, project_id FROM assets WHERE id=?').get(id);
    if (!row) throw new Error('Asset not found.');
    const asset = decodeAsset(row);
    if (asset.projectId !== projectId) throw new Error('Asset not found.');
    return asset;
  }
  private indexAsset(asset: Asset) {
    this.db.prepare('DELETE FROM asset_search WHERE id=?').run(asset.id);
    this.db.prepare('INSERT INTO asset_search(id,text) VALUES (?,?)').run(asset.id, [asset.name, asset.description, ...asset.tags, ...asset.collections, asset.prompt, asset.feedback, asset.review].join(' '));
  }
  insertAsset(asset: Asset) {
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO assets (id,project_id,json) VALUES (?,?,?)').run(asset.id, asset.projectId, JSON.stringify(asset));
      this.indexAsset(asset);
    })();
    this.changed();
  }
  updateAsset(id: string, patch: AssetPatch, projectId: string, conversationId?: string): Asset {
    const asset = { ...this.asset(id, projectId), ...patch };
    this.db.transaction(() => {
      this.db.prepare('UPDATE assets SET json=? WHERE id=?').run(JSON.stringify(asset), id); this.indexAsset(asset);
      if (conversationId) this.addMessage(conversationId, 'tool', `Updated “${asset.name}”: ${Object.keys(patch).join(', ')}.`);
    })();
    this.changed(); return asset;
  }
  search(query: string, projectId: string): Asset[] {
    const words = query.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return this.assets(projectId);
    const match = words.map(w => `"${w.replaceAll('"', '""')}"*`).join(' AND ');
    return this.db.prepare('SELECT a.json, a.project_id FROM asset_search s JOIN assets a ON a.id=s.id WHERE asset_search MATCH ? AND a.project_id=? ORDER BY rank').all(match, projectId).map(decodeAsset);
  }
  playground(projectId?: string): Record<string, string[]> {
    const rows = (projectId
      ? this.db.prepare(`SELECT conversation_id, json FROM playground WHERE ${IN_PROJECT}`).all(projectId)
      : this.db.prepare('SELECT conversation_id, json FROM playground').all()) as { conversation_id: string; json: string }[];
    return Object.fromEntries(rows.map(r => [r.conversation_id, JSON.parse(r.json)]));
  }
  setPlayground(conversationId: string, ids: string[]) {
    const projectId = this.conversation(conversationId).projectId;
    for (const id of ids) this.asset(id, projectId);
    this.db.prepare('INSERT INTO playground VALUES (?,?) ON CONFLICT(conversation_id) DO UPDATE SET json=excluded.json').run(conversationId, JSON.stringify([...new Set(ids)]));
    this.changed();
  }
  addToPlayground(conversationId: string, ids: string[]) { this.setPlayground(conversationId, [...(this.playground()[conversationId] ?? []), ...ids]); }
  jobs(projectId?: string): Job[] {
    return (projectId
      ? this.db.prepare(`SELECT json FROM jobs WHERE ${IN_PROJECT} ORDER BY rowid`).all(projectId)
      : this.db.prepare('SELECT json FROM jobs ORDER BY rowid').all()).map(decode<Job>).map(normalizeJob);
  }
  job(id: string): Job {
    const row = this.db.prepare('SELECT json FROM jobs WHERE id=?').get(id); if (!row) throw new Error('Generation not found.'); return normalizeJob(decode<Job>(row));
  }
  createJobs(conversationId: string, input: AnyGenerationInput, kind: AssetKind, toolCallId?: string): Job[] {
    this.requireConversation(conversationId);
    const jobs: Job[] = [];
    this.db.transaction(() => {
      for (let i = 0; i < ('count' in input ? input.count ?? 1 : 1); i++) {
        const job: Job = { id: randomUUID(), conversationId, kind, status: 'queued', input: 'count' in input ? { ...input, count: 1 } : input, assetId: null, error: null, createdAt: now() };
        this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?)').run(job.id, conversationId, job.status, JSON.stringify(job)); jobs.push(job);
      }
      if (toolCallId?.startsWith('external:')) {
        const row = this.db.prepare('SELECT result FROM external_requests WHERE id=?').get(toolCallId) as { result: string };
        const result = JSON.parse(row.result);
        result.jobIds.push(...jobs.map(j => j.id));
        this.db.prepare('UPDATE external_requests SET result=? WHERE id=?').run(JSON.stringify(result), toolCallId);
        // Internal assistant admission records the caller ID before queueing. Keep its
        // recoverable job IDs in the same transaction as each admitted batch.
        this.db.prepare("UPDATE tool_calls SET result=? WHERE conversation_id=? AND status='waiting' AND json_extract(result,'$.requestId')=?")
          .run(JSON.stringify({ ...result, requestId: toolCallId.slice(9) }), conversationId, toolCallId.slice(9));
      } else if (toolCallId) {
        const row = this.db.prepare('SELECT result FROM tool_calls WHERE id=?').get(toolCallId) as { result: string | null } | undefined;
        const earlier = row?.result ? JSON.parse(row.result).jobIds ?? [] : [];
        this.db.prepare('UPDATE tool_calls SET status=?,result=? WHERE id=?').run('waiting', JSON.stringify({ jobIds: [...earlier, ...jobs.map(j => j.id)] }), toolCallId);
      }
    })();
    this.changed(); return jobs;
  }
  updateJob(job: Job) { this.db.prepare('UPDATE jobs SET status=?,json=? WHERE id=?').run(job.status, JSON.stringify(job), job.id); this.changed(); }
  completeJob(job: Job, asset: Asset) {
    this.db.transaction(() => { this.insertAsset(asset); this.updateJob({ ...job, status: 'completed', assetId: asset.id }); this.addToPlayground(job.conversationId, [asset.id]); })();
  }
  setting(key: string, fallback: string): string { return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined)?.value ?? fallback; }
  setSetting(key: string, value: string) { this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); this.changed(); }
  beginTool(id: string, conversationId: string, name: string, args: string): { fresh: boolean; result: string | null } {
    const existing = this.db.prepare('SELECT * FROM tool_calls WHERE id=?').get(id) as { conversation_id: string; name: string; args: string; result: string | null } | undefined;
    if (existing) {
      if (existing.conversation_id !== conversationId || existing.name !== name || existing.args !== args) throw new Error('Conflicting duplicate tool call.');
      return { fresh: false, result: existing.result };
    }
    this.db.prepare('INSERT INTO tool_calls VALUES (?,?,?,?,?,NULL)').run(id, conversationId, name, args, 'running');
    return { fresh: true, result: null };
  }
  finishTool(id: string, result: string) { this.db.prepare('UPDATE tool_calls SET status=?,result=? WHERE id=?').run('completed', result, id); }
  waitTool(id: string, result: unknown) { this.db.prepare('UPDATE tool_calls SET status=?,result=? WHERE id=?').run('waiting', JSON.stringify(result), id); }
  repairToolHistory(conversationId: string, input: unknown[]): { input: unknown[]; restoredCallIds: string[] } {
    this.requireConversation(conversationId);
    const repaired: unknown[] = [];
    const seenCalls = new Set<string>();
    const seenOutputs = new Set<string>();
    const restoredCallIds: string[] = [];
    const ledger = this.db.prepare('SELECT name,args,status,result FROM tool_calls WHERE conversation_id=? AND id=?');

    for (const item of input) {
      if (!item || typeof item !== 'object') { repaired.push(item); continue; }
      const record = item as Record<string, unknown>;
      if (record.type === 'function_call') {
        const callId = record.call_id;
        if (typeof callId !== 'string' || !callId) throw new Error(`Cannot repair tool history for conversation ${conversationId}: function_call is missing call_id.`);
        if (seenCalls.has(callId)) throw new Error(`Cannot repair tool history for conversation ${conversationId}: duplicate function_call ${callId}.`);
        seenCalls.add(callId);
        repaired.push(item);
        continue;
      }
      if (record.type === 'function_call_output') {
        const callId = record.call_id;
        if (typeof callId !== 'string' || !callId) throw new Error(`Cannot repair tool history for conversation ${conversationId}: function_call_output is missing call_id.`);
        if (seenOutputs.has(callId)) throw new Error(`Cannot repair tool history for conversation ${conversationId}: duplicate function_call_output ${callId}.`);
        seenOutputs.add(callId);
        if (!seenCalls.has(callId)) {
          const row = ledger.get(conversationId, callId) as { name: string; args: string; status: string; result: string | null } | undefined;
          if (!row) throw new Error(`Cannot repair tool history for conversation ${conversationId}: no durable tool call ledger entry exists for ${callId}. Restore the original tool call record before requesting a provider response.`);
          if (typeof row.name !== 'string' || typeof row.args !== 'string' || row.status !== 'completed' || row.result === null) {
            throw new Error(`Cannot repair tool history for conversation ${conversationId}: durable tool call ${callId} is incomplete or not completed. Resolve its ledger record before requesting a provider response.`);
          }
          repaired.push({ type: 'function_call', call_id: callId, name: row.name, arguments: row.args });
          restoredCallIds.push(callId);
          seenCalls.add(callId);
        }
        repaired.push(item);
        continue;
      }
      repaired.push(item);
    }
    return { input: repaired, restoredCallIds };
  }
  setTurn(conversationId: string, status: string) { this.db.prepare('INSERT INTO turns VALUES (?,?) ON CONFLICT(conversation_id) DO UPDATE SET status=excluded.status').run(conversationId, status); this.changed(); }
  recover() {
    this.db.prepare("UPDATE external_requests SET status='interrupted' WHERE status='admitting'").run();
    this.db.transaction(() => {
      for (const j of this.jobs().filter(j => j.status === 'running')) this.updateJob({ ...j, status: 'uncertain', error: 'App stopped during the provider request. It was not replayed.' });
      for (const m of this.messages().filter(m => m.status === 'running')) this.updateMessage({ ...m, status: 'failed', text: m.text + '\n[Interrupted when the app closed.]' });
      this.db.prepare("UPDATE turns SET status='interrupted' WHERE status='running'").run();
      this.db.prepare("UPDATE tool_calls SET status='uncertain',result=? WHERE status='running'").run(JSON.stringify({ error: 'Interrupted tool outcome; not replayed.' }));
      for (const row of this.db.prepare("SELECT id,result FROM tool_calls WHERE status='waiting'").all() as { id: string; result: string }[]) {
        this.db.prepare('UPDATE tool_calls SET status=?,result=? WHERE id=?').run('uncertain', JSON.stringify({ ...JSON.parse(row.result), interrupted: true, message: 'Inspect the recorded jobs; this call is not replayed.' }), row.id);
      }
    })();
  }
}

function normalizeReview(row: unknown): ReviewBoard {
  const board = decode<ReviewBoard>(row);
  return { ...board, status: board.status ?? 'active', completedAt: board.completedAt ?? null, completedBy: board.completedBy ?? null };
}
/** Obsolete repeat scheduling remains in immutable history, never active controls. */
function readReview(row: unknown): ReviewBoard {
  const board = normalizeReview(row);
  return { ...board, cues: board.cues.map(cue => {
    const { repeatIntervalMs: _interval, singleVoice: _single, ...current } = cue as typeof cue & { repeatIntervalMs?: number; singleVoice?: boolean };
    return current;
  }) };
}
