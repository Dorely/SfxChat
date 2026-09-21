import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaLibrary, generatedFields } from '../src/main/media';
import { Store } from '../src/main/store';
import { WorkbenchService, type ServicePorts } from '../src/main/service';
import type { Asset, GenerationInput, SettingsStatus } from '../src/shared/types';

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

function wavBytes(seconds = 1): Buffer {
  const sampleRate = 8_000;
  const channels = 1;
  const bits = 16;
  const dataSize = sampleRate * channels * (bits / 8) * seconds;
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + dataSize, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channels * (bits / 8), 28);
  bytes.writeUInt16LE(channels * (bits / 8), 32);
  bytes.writeUInt16LE(bits, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(dataSize, 40);
  return bytes;
}

function readySettings(overrides: Partial<SettingsStatus> = {}): SettingsStatus {
  return { codexReady: false, elevenLabsReady: true, secureStorageAvailable: true, loginPending: false, model: 'synthetic-model', error: null, chatModels: [], activeChat: { modelId: 'codex:synthetic-model', effort: '' }, providers: [], ...overrides };
}

function ports(overrides: Partial<ServicePorts> = {}): ServicePorts {
  return {
    settings: async () => readySettings(),
    chat: async () => ({ output: [], calls: [] }),
    generate: async () => ({ bytes: Buffer.from('synthetic-mp3'), requestId: 'request.synthetic', usage: '1', model: 'synthetic-model' }),
    safeError: error => error instanceof Error ? error.message : String(error),
    ...overrides,
  };
}

async function runtime(customPorts: Partial<ServicePorts> = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'sfxchat-runtime-'));
  roots.push(root);
  const store = new Store(join(root, 'library.sqlite'));
  const service = new WorkbenchService(store, new MediaLibrary(join(root, 'media')), ports(customPorts), () => undefined);
  runtimes.push({ store, service });
  const conversationId = store.createConversation();
  return { root, store, service, conversationId };
}

async function assetFromWav(media: MediaLibrary, fields: Partial<Asset> = {}) {
  return media.save(wavBytes(), 'wav', fields);
}

describe('Store persistence and library operations', () => {
  it('persists searchable metadata, edits, provenance, revisions, and playground order across restart', async () => {
    const first = await runtime();
    const original = await assetFromWav(new MediaLibrary(join(first.root, 'media')), {
      ...generatedFields({ prompt: 'metal door slam', duration: 1, name: 'Door Slam' }),
      name: 'Door Slam', tags: ['metal', 'impact'], collections: ['foley'], provider: 'ElevenLabs', model: 'synthetic-model', requestId: 'req-original', usage: '1',
    });
    first.store.insertAsset(original);
    const second = await assetFromWav(new MediaLibrary(join(first.root, 'media')), { name: 'Rain Texture', description: 'soft distant rain', tags: ['rain'] });
    first.store.insertAsset(second);
    first.store.setPlayground(first.conversationId, [second.id, original.id, second.id]);
    first.store.updateAsset(original.id, { name: 'Heavy Door Slam', tags: ['metal', 'impact', 'heavy'], review: 'accepted', feedback: 'Use this transient.' }, first.conversationId);
    expect(first.store.search('heavy metal')).toHaveLength(1);
    expect(first.store.playground()[first.conversationId]).toEqual([second.id, original.id]);

    first.store.close();
    const reopened = new Store(join(first.root, 'library.sqlite'));
    const reopenedOriginal = reopened.asset(original.id);
    expect(reopenedOriginal.hash).toBe(original.hash);
    expect(reopenedOriginal.name).toBe('Heavy Door Slam');
    expect(reopenedOriginal.request).toMatchObject({ prompt: 'metal door slam', duration: 1 });
    expect(reopened.search('Use this')).toHaveLength(1);
    expect(reopened.playground()[first.conversationId]).toEqual([second.id, original.id]);
    reopened.setPlayground(first.conversationId, [original.id]);
    reopened.addToPlayground(first.conversationId, [second.id, original.id]);
    expect(reopened.playground()[first.conversationId]).toEqual([original.id, second.id]);
    reopened.close();
    runtimes.splice(0, 1);
  });

  it('rejects databases created by a newer version', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'sfxchat-future-'));
    roots.push(root);
    const filename = join(root, 'library.sqlite');
    const database = new Store(filename);
    database.db.pragma('user_version = 99');
    database.close();
    expect(() => new Store(filename)).toThrow(/newer SfxChat version/i);
  });

  it('recovers interrupted jobs, turns, messages, and tool calls without replaying them', async () => {
    const first = await runtime();
    const [job] = first.store.createJobs(first.conversationId, { prompt: 'interrupted click' });
    first.store.updateJob({ ...job, status: 'running' });
    const message = first.store.addMessage(first.conversationId, 'assistant', 'partial answer', 'running');
    first.store.setTurn(first.conversationId, 'running');
    first.store.beginTool('call-interrupted', first.conversationId, 'generate_sounds', '{"prompt":"interrupted click"}');
    first.store.close();
    runtimes.splice(0, 1);

    const restarted = new Store(join(first.root, 'library.sqlite'));
    restarted.recover();
    expect(restarted.job(job.id)).toMatchObject({ status: 'uncertain', error: expect.stringMatching(/not replayed/i) });
    expect(restarted.messages().find(item => item.id === message.id)).toMatchObject({ status: 'failed', text: expect.stringMatching(/Interrupted/) });
    expect((restarted.db.prepare('SELECT status, result FROM tool_calls WHERE id=?').get('call-interrupted') as { status: string; result: string }).status).toBe('uncertain');
    expect((restarted.db.prepare('SELECT status FROM turns WHERE conversation_id=?').get(first.conversationId) as { status: string }).status).toBe('interrupted');
    restarted.close();
  });
});

describe('WorkbenchService generation and assistant tools', () => {
  it('completes generation with exact provenance and places each result on the board', async () => {
    const bytes = await fs.readFile(join(process.cwd(), 'tests', 'fixtures', 'tone.mp3'));
    const { store, service, conversationId } = await runtime({ generate: async () => ({ bytes, requestId: 'req-42', usage: '2', model: 'model-42' }) });
    const result = await service.generate(conversationId, { prompt: 'bright glass chime', count: 2, duration: 1.5, influence: 0.2, loop: true, name: 'Glass Chime' });
    await service.idle();
    expect(result.jobIds).toHaveLength(2);
    expect(store.jobs().every(job => job.status === 'completed')).toBe(true);
    expect(store.assets()).toHaveLength(2);
    expect(store.assets().map(asset => asset.hash)).toEqual([bytes, bytes].map(value => createHash('sha256').update(value).digest('hex')));
    for (const asset of store.assets()) {
      expect(asset).toMatchObject({ source: 'generated', name: 'Glass Chime', prompt: 'bright glass chime', provider: 'ElevenLabs', model: 'model-42', requestId: 'req-42', usage: '2', format: 'mp3', parentId: null });
      expect(asset.duration).toBeGreaterThan(0);
      expect(asset.request).toMatchObject({ prompt: 'bright glass chime', count: 1, duration: 1.5, influence: 0.2, loop: true });
    }
    expect(store.playground()[conversationId]).toHaveLength(2);
  });

  it('supports parent-linked revisions while preserving the original asset', async () => {
    const { root, store, service, conversationId } = await runtime();
    const original = await assetFromWav(new MediaLibrary(join(root, 'media')), { name: 'Original', source: 'generated', prompt: 'original pulse', request: { prompt: 'original pulse' } });
    store.insertAsset({ ...original, id: randomUUID() });
    const source = store.assets()[0];
    await service.generate(conversationId, { prompt: 'shorter original pulse', parentId: source.id, name: 'Revision' });
    await service.idle();
    const revision = store.assets().find(asset => asset.parentId === source.id);
    expect(revision).toMatchObject({ name: 'Revision', parentId: source.id, prompt: 'shorter original pulse', source: 'generated' });
    expect(store.asset(source.id).hash).toBe(source.hash);
  });

  it('fails known provider errors and marks unknown or cancelled dispatches uncertain without retries', async () => {
    const known = await runtime({ generate: async () => { throw Object.assign(new Error('rate limited'), { status: 429 }); } });
    await known.service.generate(known.conversationId, { prompt: 'known failure' });
    await known.service.idle();
    expect(known.store.jobs()[0]).toMatchObject({ status: 'failed', error: 'rate limited' });

    let calls = 0;
    const unknown = await runtime({ generate: async () => { calls++; throw new Error('decode failed'); } });
    await unknown.service.generate(unknown.conversationId, { prompt: 'unknown failure' });
    await unknown.service.idle();
    expect(unknown.store.jobs()[0]).toMatchObject({ status: 'uncertain', error: 'decode failed' });
    expect(calls).toBe(1);

    let rejectGeneration!: (error: unknown) => void;
    const cancelled = await runtime({ generate: (_input, signal) => new Promise((_resolve, reject) => { rejectGeneration = reject; signal.addEventListener('abort', () => reject(new Error('aborted'))); }) });
    await cancelled.service.generate(cancelled.conversationId, { prompt: 'cancelled dispatch' });
    await vi.waitFor(() => expect(cancelled.store.jobs()[0].status).toBe('running'));
    cancelled.service.cancelJob(cancelled.store.jobs()[0].id);
    rejectGeneration(new Error('aborted'));
    await cancelled.service.idle();
    expect(cancelled.store.jobs()[0]).toMatchObject({ status: 'uncertain', error: expect.stringMatching(/uncertain/i) });
  });

  it('does not duplicate a repeated tool call and rejects conflicting or malformed calls', async () => {
    let calls = 0;
    const { store, service, conversationId } = await runtime({ generate: async () => { calls++; return { bytes: Buffer.from('tool-result'), requestId: 'tool-request', usage: null, model: 'tool-model' }; } });
    const call = { id: 'call-generate-once', name: 'generate_sounds', arguments: JSON.stringify({ prompt: 'tool sound', count: 1 }) };
    const first = await service.executeTool(conversationId, call);
    const duplicate = await service.executeTool(conversationId, call);
    await service.idle();
    expect(JSON.parse(first)).toMatchObject({ jobIds: expect.any(Array) });
    expect(duplicate).toBe(first);
    expect(calls).toBe(1);
    expect(store.jobs()).toHaveLength(1);
    expect(store.jobs()[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not be validated/i), assetId: expect.any(String) });
    expect(store.assets()).toHaveLength(1);
    await expect(service.executeTool(conversationId, { ...call, arguments: JSON.stringify({ prompt: 'different tool sound' }) })).rejects.toThrow(/conflicting duplicate/i);

    const malformed = await service.executeTool(conversationId, { id: 'call-malformed', name: 'generate_sounds', arguments: '{"prompt":42}' });
    expect(JSON.parse(malformed)).toMatchObject({ error: expect.any(String) });
    expect(store.jobs()).toHaveLength(1);
    const unknown = await service.executeTool(conversationId, { id: 'call-unknown', name: 'made_up_tool', arguments: '{}' });
    expect(JSON.parse(unknown)).toMatchObject({ error: expect.stringMatching(/unknown assistant tool/i) });
  });
});

describe('Media import and export', () => {
  it('imports playable WAV bytes and exports an exact hash-preserving copy', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'sfxchat-media-'));
    roots.push(root);
    const sourcePath = join(root, 'source.wav');
    const destination = join(root, 'export.wav');
    const bytes = wavBytes(1);
    await fs.writeFile(sourcePath, bytes);
    const media = new MediaLibrary(join(root, 'library'));
    const asset = await media.import(sourcePath);
    expect(asset).toMatchObject({ name: 'source', source: 'imported', format: 'wav', bytes: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') });
    expect(asset.duration).toBeCloseTo(1, 1);
    await media.export(asset, destination);
    expect(await fs.readFile(destination)).toEqual(bytes);
    await expect(media.export(asset, join(root, 'library', 'copy.wav'))).resolves.toBeUndefined();
    await expect(media.export(asset, destination)).rejects.toThrow();
  });

  it('imports through the service and keeps import ordering in the playground', async () => {
    const { root, store, service, conversationId } = await runtime();
    const first = join(root, 'first.wav');
    const second = join(root, 'second.wav');
    await fs.writeFile(first, wavBytes(1));
    await fs.writeFile(second, wavBytes(2));
    await service.importFiles(conversationId, [first, second]);
    expect(store.assets().map(asset => asset.name)).toEqual(['second', 'first']);
    expect(store.playground()[conversationId]).toEqual(store.assets().map(asset => asset.id).reverse());
    expect(store.messages(conversationId).filter(message => message.role === 'tool')).toHaveLength(2);
  });
});
