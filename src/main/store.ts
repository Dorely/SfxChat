import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Asset, AssetKind, AssetPatch, Conversation, GenerationInput, Job, Message, MusicGenerationInput } from '../shared/types';

const now = () => new Date().toISOString();
const decode = <T>(row: unknown): T => JSON.parse((row as { json: string }).json) as T;
// Records written before music existed carry no kind; they are sound effects.
const normalizeAsset = (asset: Asset): Asset => asset.kind ? asset : { ...asset, kind: 'effect' };
const normalizeJob = (job: Job): Job => job.kind ? job : { ...job, kind: 'effect' };

export class Store {
  readonly db: Database.Database;
  constructor(filename: string, private changed: () => void = () => {}) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > 1) { this.db.close(); throw new Error('This library was created by a newer SfxChat version.'); }
    if (version === 0) this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE conversations (id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), json TEXT NOT NULL);
        CREATE TABLE assets (id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE VIRTUAL TABLE asset_search USING fts5(id UNINDEXED, text, tokenize='unicode61');
        CREATE TABLE jobs (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), status TEXT NOT NULL, json TEXT NOT NULL);
        CREATE TABLE playground (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), json TEXT NOT NULL);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE tool_calls (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), name TEXT NOT NULL, args TEXT NOT NULL, status TEXT NOT NULL, result TEXT);
        CREATE TABLE turns (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), status TEXT NOT NULL);
        PRAGMA user_version = 1;
      `);
    })();
  }
  close() { this.db.close(); }
  conversations(): Conversation[] { return this.db.prepare('SELECT json FROM conversations ORDER BY rowid DESC').all().map(decode<Conversation>); }
  createConversation(): string {
    const c: Conversation = { id: randomUUID(), title: 'New conversation', createdAt: now() };
    this.db.prepare('INSERT INTO conversations VALUES (?,?)').run(c.id, JSON.stringify(c));
    this.changed(); return c.id;
  }
  requireConversation(id: string) { if (!this.db.prepare('SELECT 1 FROM conversations WHERE id=?').get(id)) throw new Error('Conversation not found.'); }
  titleConversation(id: string, title: string) {
    const c = decode<Conversation>(this.db.prepare('SELECT json FROM conversations WHERE id=?').get(id));
    if (c.title !== 'New conversation') return;
    c.title = title.slice(0, 70); this.db.prepare('UPDATE conversations SET json=? WHERE id=?').run(JSON.stringify(c), id);
  }
  messages(conversationId?: string): Message[] {
    return (conversationId ? this.db.prepare('SELECT json FROM messages WHERE conversation_id=? ORDER BY rowid').all(conversationId) : this.db.prepare('SELECT json FROM messages ORDER BY rowid').all()).map(decode<Message>);
  }
  addMessage(conversationId: string, role: Message['role'], text: string, status: Message['status'] = 'completed'): Message {
    this.requireConversation(conversationId);
    const message: Message = { id: randomUUID(), conversationId, role, text, status, createdAt: now() };
    this.db.prepare('INSERT INTO messages VALUES (?,?,?)').run(message.id, conversationId, JSON.stringify(message));
    this.changed(); return message;
  }
  updateMessage(message: Message) { this.db.prepare('UPDATE messages SET json=? WHERE id=?').run(JSON.stringify(message), message.id); this.changed(); }
  assets(): Asset[] { return this.db.prepare('SELECT json FROM assets ORDER BY rowid DESC').all().map(decode<Asset>).map(normalizeAsset); }
  asset(id: string): Asset {
    const row = this.db.prepare('SELECT json FROM assets WHERE id=?').get(id);
    if (!row) throw new Error('Asset not found.'); return normalizeAsset(decode<Asset>(row));
  }
  private indexAsset(asset: Asset) {
    this.db.prepare('DELETE FROM asset_search WHERE id=?').run(asset.id);
    this.db.prepare('INSERT INTO asset_search(id,text) VALUES (?,?)').run(asset.id, [asset.name, asset.description, ...asset.tags, ...asset.collections, asset.prompt, asset.feedback, asset.review].join(' '));
  }
  insertAsset(asset: Asset) {
    this.db.transaction(() => { this.db.prepare('INSERT INTO assets VALUES (?,?)').run(asset.id, JSON.stringify(asset)); this.indexAsset(asset); })();
    this.changed();
  }
  updateAsset(id: string, patch: AssetPatch, conversationId?: string): Asset {
    const asset = { ...this.asset(id), ...patch };
    this.db.transaction(() => {
      this.db.prepare('UPDATE assets SET json=? WHERE id=?').run(JSON.stringify(asset), id); this.indexAsset(asset);
      if (conversationId) this.addMessage(conversationId, 'tool', `Updated “${asset.name}”: ${Object.keys(patch).join(', ')}.`);
    })();
    this.changed(); return asset;
  }
  search(query: string): Asset[] {
    const words = query.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return this.assets();
    const match = words.map(w => `"${w.replaceAll('"', '""')}"*`).join(' AND ');
    return this.db.prepare('SELECT a.json FROM asset_search s JOIN assets a ON a.id=s.id WHERE asset_search MATCH ? ORDER BY rank').all(match).map(decode<Asset>).map(normalizeAsset);
  }
  playground(): Record<string, string[]> {
    return Object.fromEntries((this.db.prepare('SELECT * FROM playground').all() as { conversation_id: string; json: string }[]).map(r => [r.conversation_id, JSON.parse(r.json)]));
  }
  setPlayground(conversationId: string, ids: string[]) {
    this.requireConversation(conversationId); for (const id of ids) this.asset(id);
    this.db.prepare('INSERT INTO playground VALUES (?,?) ON CONFLICT(conversation_id) DO UPDATE SET json=excluded.json').run(conversationId, JSON.stringify([...new Set(ids)]));
    this.changed();
  }
  addToPlayground(conversationId: string, ids: string[]) { this.setPlayground(conversationId, [...(this.playground()[conversationId] ?? []), ...ids]); }
  jobs(): Job[] { return this.db.prepare('SELECT json FROM jobs ORDER BY rowid').all().map(decode<Job>).map(normalizeJob); }
  job(id: string): Job {
    const row = this.db.prepare('SELECT json FROM jobs WHERE id=?').get(id); if (!row) throw new Error('Generation not found.'); return normalizeJob(decode<Job>(row));
  }
  createJobs(conversationId: string, input: GenerationInput | MusicGenerationInput, kind: AssetKind, toolCallId?: string): Job[] {
    this.requireConversation(conversationId);
    const jobs: Job[] = [];
    this.db.transaction(() => {
      for (let i = 0; i < (input.count ?? 1); i++) {
        const job: Job = { id: randomUUID(), conversationId, kind, status: 'queued', input: { ...input, count: 1 }, assetId: null, error: null, createdAt: now() };
        this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?)').run(job.id, conversationId, job.status, JSON.stringify(job)); jobs.push(job);
      }
      if (toolCallId) {
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
