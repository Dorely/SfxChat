import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/main/store';
import { MediaLibrary } from '../src/main/media';
import { WorkbenchService, type ServicePorts } from '../src/main/service';
import type { Asset, SettingsStatus } from '../src/shared/types';

const roots: string[] = [];
const runtimes: Array<{ store: Store; service: WorkbenchService }> = [];

afterEach(async () => {
  for (const runtime of runtimes) {
    await runtime.service.shutdown().catch(() => undefined);
    runtime.store.close();
  }
  runtimes.splice(0);
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function readySettings(): SettingsStatus {
  return { codexReady: true, elevenLabsReady: true, secureStorageAvailable: true, loginPending: false, model: 'synthetic-model', error: null, chatModels: [], activeChat: { modelId: 'codex:synthetic-model', effort: '' }, providers: [] };
}

function ports(overrides: Partial<ServicePorts> = {}): ServicePorts {
  return {
    settings: async () => readySettings(),
    chat: async () => ({ output: [], calls: [] }),
    generate: async () => ({ bytes: await fs.readFile(join(process.cwd(), 'tests', 'fixtures', 'tone.mp3')), requestId: 'request.synthetic', usage: '0', model: 'synthetic-model' }),
    safeError: error => error instanceof Error ? error.message : String(error),
    ...overrides,
  };
}

async function runtime(customPorts: Partial<ServicePorts> = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'sfxchat-lifecycle-'));
  roots.push(root);
  const store = new Store(join(root, 'library.sqlite'));
  const service = new WorkbenchService(store, new MediaLibrary(join(root, 'media')), ports(customPorts), () => undefined);
  runtimes.push({ store, service });
  const conversationId = store.createConversation();
  return { root, store, service, conversationId };
}

function wavBytes(seconds = 1): Buffer {
  const sampleRate = 8_000;
  const dataSize = sampleRate * 2 * seconds;
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write('RIFF');
  bytes.writeUInt32LE(36 + dataSize, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(dataSize, 40);
  return bytes;
}

async function insertAsset(store: Store, root: string, fields: Partial<Asset> = {}) {
  const asset = await new MediaLibrary(join(root, 'media')).save(wavBytes(), 'wav', fields);
  store.insertAsset(asset);
  return asset;
}

describe('WorkbenchService lifecycle guards', () => {
  it('refuses new generation and chat messages once shutdown begins, including an in-flight admission', async () => {
    let resolveSettings!: (settings: SettingsStatus) => void;
    const settings = vi.fn(() => new Promise<SettingsStatus>(resolve => { resolveSettings = resolve; }));
    const current = await runtime({ settings });
    const pending = current.service.generate(current.conversationId, { prompt: 'admission race' });
    await vi.waitFor(() => expect(settings).toHaveBeenCalledTimes(1));
    await current.service.shutdown();
    resolveSettings(readySettings());
    await expect(pending).rejects.toThrow(/closing/i);
    await expect(current.service.generate(current.conversationId, { prompt: 'after shutdown' })).rejects.toThrow(/closing/i);
    await expect(current.service.sendMessage(current.conversationId, 'after shutdown')).rejects.toThrow(/closing/i);
    expect(current.store.jobs()).toHaveLength(0);
  });

  it('yields during a huge admission and shutdown rejects the unscheduled remainder before provider dispatch', async () => {
    const generate = vi.fn(async () => ({ bytes: Buffer.from('provider must not run'), requestId: null, usage: null, model: 'synthetic-model' }));
    const current = await runtime({ generate });
    const pending = current.service.generate(current.conversationId, { prompt: 'large request', count: 100_000 });
    await vi.waitFor(() => {
      const admitted = current.store.jobs().length;
      expect(admitted).toBeGreaterThan(0);
      expect(admitted).toBeLessThan(100_000);
    }, { timeout: 2_000, interval: 1 });
    const admitted = current.store.jobs().length;
    await current.service.shutdown();
    await expect(pending).rejects.toThrow(/closing/i);
    expect(admitted).toBeLessThan(100_000);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('Tool-call checkpoints and recovery', () => {
  it('accumulates job IDs across admission checkpoints for one tool call', async () => {
    const current = await runtime();
    const callId = 'checkpoint-129';
    current.store.beginTool(callId, current.conversationId, 'generate_sounds', JSON.stringify({ prompt: 'checkpointed request' }));
    const first = current.store.createJobs(current.conversationId, { prompt: 'checkpointed request', count: 128 }, callId);
    const second = current.store.createJobs(current.conversationId, { prompt: 'checkpointed request', count: 1 }, callId);
    const row = current.store.db.prepare('SELECT status, result FROM tool_calls WHERE id=?').get(callId) as { status: string; result: string };
    expect(row.status).toBe('waiting');
    expect(JSON.parse(row.result).jobIds).toEqual([...first, ...second].map(job => job.id));
  });

  it('recovers a waiting generation as uncertain with recorded job IDs and never dispatches it again', async () => {
    const first = await runtime();
    const call = { id: 'waiting-generation', name: 'generate_sounds', arguments: JSON.stringify({ prompt: 'recover this generation' }) };
    first.store.beginTool(call.id, first.conversationId, call.name, call.arguments);
    const [job] = first.store.createJobs(first.conversationId, JSON.parse(call.arguments), call.id);
    first.store.updateJob({ ...job, status: 'running' });
    const recorded = first.store.db.prepare('SELECT status, result FROM tool_calls WHERE id=?').get(call.id) as { status: string; result: string };
    expect(recorded.status).toBe('waiting');
    first.store.close();
    runtimes.splice(0, 1);

    const restarted = new Store(join(first.root, 'library.sqlite'));
    restarted.recover();
    const recovered = restarted.db.prepare('SELECT status, result FROM tool_calls WHERE id=?').get(call.id) as { status: string; result: string };
    expect(recovered.status).toBe('uncertain');
    expect(JSON.parse(recovered.result)).toMatchObject({ jobIds: [job.id], interrupted: true });
    const generate = vi.fn(async () => ({ bytes: Buffer.from('never dispatched'), requestId: null, usage: null, model: 'synthetic-model' }));
    const service = new WorkbenchService(restarted, new MediaLibrary(join(first.root, 'media')), ports({ generate }), () => undefined);
    runtimes.push({ store: restarted, service });
    const replay = await service.executeTool(first.conversationId, call);
    expect(JSON.parse(replay)).toMatchObject({ jobIds: [job.id], interrupted: true });
    expect(generate).not.toHaveBeenCalled();
  });

  it('records asset activity in the explicitly supplied conversation', async () => {
    const current = await runtime();
    const secondConversationId = current.store.createConversation();
    const asset = await insertAsset(current.store, current.root, { name: 'Shared candidate' });
    current.store.setPlayground(current.conversationId, [asset.id]);
    current.store.setPlayground(secondConversationId, [asset.id]);
    current.service.updateAsset(asset.id, { tags: ['selected'] }, secondConversationId);
    expect(current.store.messages(current.conversationId)).toHaveLength(0);
    expect(current.store.messages(secondConversationId).map(message => message.text)).toEqual(['Updated “Shared candidate”: tags.']);
    expect(current.store.asset(asset.id).tags).toEqual(['selected']);
  });
});

describe('Chat tool round trips', () => {
  it('persists assistant output and function-call output across reopening', async () => {
    const call = { id: 'chat-generation', name: 'generate_sounds', arguments: JSON.stringify({ prompt: 'chat round trip', count: 1, duration: 1 }) };
    let chatCalls = 0;
    const current = await runtime({
      chat: async ({ onText }) => {
        chatCalls++;
        if (chatCalls === 1) return { output: [{ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments }], calls: [call] };
        onText('The candidate is ready.');
        return { output: [{ role: 'assistant', content: [{ type: 'output_text', text: 'The candidate is ready.' }] }], calls: [] };
      },
    });
    await current.service.sendMessage(current.conversationId, 'Create a chat round trip sound.');
    await current.service.idle();
    expect(chatCalls).toBe(2);
    expect(current.store.messages(current.conversationId).map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant']);
    const historyKey = `history/${current.conversationId}`;
    const history = JSON.parse(current.store.setting(historyKey, '[]')) as Array<Record<string, unknown>>;
    expect(history.some(item => item.type === 'function_call')).toBe(true);
    expect(history.some(item => item.type === 'function_call_output')).toBe(true);
    current.store.close();
    runtimes.splice(0, 1);

    const reopened = new Store(join(current.root, 'library.sqlite'));
    expect(reopened.messages(current.conversationId).find(message => message.text === 'The candidate is ready.')).toMatchObject({ role: 'assistant', status: 'completed' });
    expect(JSON.parse(reopened.setting(historyKey, '[]'))).toEqual(history);
    reopened.close();
  });

  it('does not bill on malformed or repeated tool requests', async () => {
    const generate = vi.fn(async () => ({ bytes: await fs.readFile(join(process.cwd(), 'tests', 'fixtures', 'tone.mp3')), requestId: 'request.once', usage: '1', model: 'synthetic-model' }));
    const current = await runtime({ generate });
    const malformed = { id: 'malformed-generation', name: 'generate_sounds', arguments: '{"prompt":42}' };
    const firstMalformed = await current.service.executeTool(current.conversationId, malformed);
    const repeatedMalformed = await current.service.executeTool(current.conversationId, malformed);
    expect(JSON.parse(firstMalformed)).toMatchObject({ error: expect.any(String) });
    expect(repeatedMalformed).toBe(firstMalformed);
    expect(generate).not.toHaveBeenCalled();

    const valid = { id: 'repeated-generation', name: 'generate_sounds', arguments: JSON.stringify({ prompt: 'bill once', count: 1, duration: 1 }) };
    const firstValid = await current.service.executeTool(current.conversationId, valid);
    const repeatedValid = await current.service.executeTool(current.conversationId, valid);
    await current.service.idle();
    expect(JSON.parse(firstValid).jobs[0].status).toBe('completed');
    expect(repeatedValid).toBe(firstValid);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
