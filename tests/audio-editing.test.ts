import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodeAudio, MAX_AUDIO_BYTES } from '../src/main/audio';
import { MediaLibrary } from '../src/main/media';
import { Store } from '../src/main/store';
import { WorkbenchService, type ServicePorts } from '../src/main/service';
import { commandSchemas } from '../src/main/validation';
import { tools } from '../src/main/assistant';

const contexts: { root: string; store: Store; service: WorkbenchService }[] = [];
afterEach(async () => {
  for (const { root, store, service } of contexts.splice(0)) {
    await service.shutdown(); store.close(); await rm(root, { recursive: true, force: true });
  }
});

function stereoWav() {
  const frames = 8000, bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  // Only the right channel carries an event. A channel-0-only waveform would lose it.
  for (let i = 1600; i < 6400; i++) bytes.writeInt16LE(i % 2 ? -16384 : 16384, 44 + i * 4 + 2);
  return bytes;
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'sfxchat-trim-'));
  const store = new Store(join(root, 'library.sqlite')), media = new MediaLibrary(join(root, 'audio'));
  const generate = vi.fn<ServicePorts['generate']>();
  const service = new WorkbenchService(store, media, {
    settings: async () => ({ codexReady: false, elevenLabsReady: false, secureStorageAvailable: false, loginPending: false, model: 'test', error: null }),
    generate, chat: async () => ({ output: [], calls: [] }), safeError: e => e instanceof Error ? e.message : String(e)
  }, () => undefined);
  contexts.push({ root, store, service });
  const conversation = store.createConversation();
  const source = await media.save(stereoWav(), 'wav', { name: 'Stereo impulse', source: 'generated', prompt: 'exact original prompt', provider: 'test', requestId: 'original-request', model: 'test', tags: ['impact'], review: 'accepted' });
  store.insertAsset(source);
  return { root, store, media, service, source, conversation, generate };
}

describe('sample-frame audio edits', () => {
  it('measures every channel with exact absolute window boundaries and no downmix cancellation', async () => {
    const { service, source } = await setup();
    const view = await service.analyzeAudio(source.id, { bins: 10 });
    expect(view).toMatchObject({ duration: 1, sampleRate: 8000, channels: 2, totalFrames: 8000, sourceHash: source.hash });
    expect(view.bins[0]).toMatchObject({ peak: 0, rms: 0, startFrame: 0, endFrame: 800 });
    expect(view.bins[2]).toMatchObject({ min: -0.5, max: 0.5, peak: 0.5, startSeconds: 0.2, endSeconds: 0.3 });
    expect(view.bins[2].rms).toBeCloseTo(Math.sqrt(0.125));
    const zoom = await service.analyzeAudio(source.id, { startSeconds: 0.199, endSeconds: 0.201, bins: 512 });
    expect(zoom.bins).toHaveLength(16);
    expect(zoom.bins[0].startFrame).toBe(1592);
    expect(zoom.bins[7].peak).toBe(0);
    expect(zoom.bins[8].peak).toBe(0.5);
    expect(zoom.bins.at(-1)?.endFrame).toBe(1608);
  });

  it('renders preview and saved trim identically, preserves exact retained PCM, lineage and original bytes', async () => {
    const { service, source, media, store, conversation, generate, root } = await setup();
    const original = await readFile(media.path(source));
    const input = { startSeconds: 0.20006, endSeconds: 0.8, name: 'Focused impact' };
    const preview = await service.previewTrim(source.id, input);
    const trim = await service.trimAsset(conversation, source.id, input);
    const bytes = await readFile(media.path(trim));
    expect(bytes).toEqual(Buffer.from(preview));
    expect(trim).toMatchObject({ source: 'edited', format: 'wav', parentId: source.id, name: 'Focused impact', duration: 0.6, review: 'unreviewed', prompt: source.prompt, provider: null, requestId: null, tags: ['impact'], edit: { kind: 'trim', startFrame: 1600, endFrame: 6400, sampleRate: 8000, sourceHash: source.hash, fadeInFrames: 0, fadeOutFrames: 0, requested: input } });
    const decoded = await decodeAudio(bytes, 'wav');
    expect(decoded.channels).toHaveLength(2);
    expect(decoded.channels[1]).toHaveLength(4800);
    expect(decoded.channels[1][0]).toBe(0.5);
    expect(decoded.channels[1][4799]).toBe(-0.5);
    expect(decoded.channels[0].every(v => v === 0)).toBe(true);
    expect(await readFile(media.path(source))).toEqual(original);
    expect(store.asset(source.id)).toEqual(source);
    expect(store.playground()[conversation]).toContain(trim.id);
    expect(generate).not.toHaveBeenCalled();
    await media.export(trim, join(root, 'trim.wav'));
    expect(await readFile(join(root, 'trim.wav'))).toEqual(bytes);
    const second = await service.trimAsset(conversation, trim.id, { startSeconds: 0.1, endSeconds: 0.2 });
    expect(second.parentId).toBe(trim.id);
    expect(second.edit).toMatchObject({ startFrame: 800, endFrame: 1600, sourceHash: trim.hash });
  });

  it('applies optional fades to all channels with zero endpoints and unchanged interior samples', async () => {
    const { service, source } = await setup();
    const bytes = await service.previewTrim(source.id, { startSeconds: 0.2, endSeconds: 0.8, fadeInMs: 10, fadeOutMs: 20 });
    const audio = await decodeAudio(Buffer.from(bytes), 'wav');
    const right = audio.channels[1];
    expect(right[0]).toBe(0); expect(Math.abs(right.at(-1)!)).toBe(0);
    expect(right[79]).toBe(-0.5); expect(right[80]).toBe(0.5);
    expect(right[1]).toBeCloseTo(-0.5 / 79);
    expect(right.at(-2)).toBeCloseTo(0.5 / 159);
  });

  it('rejects invalid ranges and fades without registering derivatives or calling providers', async () => {
    const { service, source, conversation, store, generate } = await setup();
    for (const input of [
      { startSeconds: -1, endSeconds: 0.2 }, { startSeconds: 0.5, endSeconds: 0.5 },
      { startSeconds: 0.5, endSeconds: 0.3 }, { startSeconds: 0, endSeconds: 1.0001 },
      { startSeconds: 0, endSeconds: NaN }, { startSeconds: 0, endSeconds: Infinity },
      { startSeconds: 0, endSeconds: 0.000001 }, { startSeconds: 0, endSeconds: 0.1, fadeInMs: 80, fadeOutMs: 80 },
      { startSeconds: 0, endSeconds: 0.1, fadeInMs: -2 }
    ]) await expect(async () => service.trimAsset(conversation, source.id, input)).rejects.toThrow();
    expect(store.assets()).toHaveLength(1); expect(generate).not.toHaveBeenCalled();
    for (const input of [{ bins: 513 }, { bins: 0 }, { bins: 1.5 }, { startSeconds: 1.1 }])
      await expect(async () => service.analyzeAudio(source.id, input)).rejects.toThrow();
    expect(commandSchemas.trimAsset.safeParse([conversation, source.id, { startSeconds: 0, endSeconds: 0.2, path: 'arbitrary.wav' }]).success).toBe(false);
    expect(commandSchemas.previewTrim.safeParse(['arbitrary-path', {}]).success).toBe(false);
    expect(tools.map(t => t.name)).toEqual(expect.arrayContaining(['analyze_audio', 'trim_asset']));
  });

  it('shares assistant operations, persists a replay-safe result atomically, and survives reopening', async () => {
    const { service, source, conversation, store, root } = await setup();
    const analysis = JSON.parse(await service.executeTool(conversation, { id: randomUUID(), name: 'analyze_audio', arguments: JSON.stringify({ id: source.id, bins: 12 }) }));
    expect(analysis.totalFrames).toBe(8000);
    const call = { id: randomUUID(), name: 'trim_asset', arguments: JSON.stringify({ id: source.id, startSeconds: 0.2, endSeconds: 0.8 }) };
    const result = await service.executeTool(conversation, call);
    expect(await service.executeTool(conversation, call)).toBe(result);
    expect(store.assets()).toHaveLength(2);
    const secondStore = new Store(join(root, 'library.sqlite'));
    try {
      const id = JSON.parse(result).id;
      expect(secondStore.asset(id).edit?.sourceHash).toBe(source.hash);
      expect(secondStore.beginTool(call.id, conversation, call.name, call.arguments)).toEqual({ fresh: false, result });
    } finally { secondStore.close(); }
  });

  it('checks original integrity even on a decoded-cache hit and rejects damaged WAVs', async () => {
    const { service, source, media } = await setup();
    await service.analyzeAudio(source.id, {});
    const damaged = stereoWav(); damaged[100] ^= 0xff;
    await writeFile(media.path(source), damaged);
    await expect(service.previewTrim(source.id, { startSeconds: 0, endSeconds: 0.1 })).rejects.toThrow('integrity');
    await expect(decodeAudio(stereoWav().subarray(0, 48), 'wav')).rejects.toThrow('damaged');
    const unsupported = stereoWav(); unsupported.writeUInt16LE(2, 20);
    await expect(decodeAudio(unsupported, 'wav')).rejects.toThrow('Unsupported');
    await expect(decodeAudio(Buffer.alloc(MAX_AUDIO_BYTES + 1), 'wav')).rejects.toThrow('64 MiB');
  });

  it('handles PCM bit depths and rejects float non-finite samples and unsupported speaker masks', async () => {
    for (const bits of [8, 16, 24, 32]) {
      const size = bits / 8, bytes = Buffer.alloc(44 + 2 * size);
      stereoWav().copy(bytes, 0, 0, 44);
      bytes.writeUInt32LE(bytes.length - 8, 4); bytes.writeUInt16LE(1, 22);
      bytes.writeUInt32LE(8000 * size, 28); bytes.writeUInt16LE(size, 32); bytes.writeUInt16LE(bits, 34);
      bytes.writeUInt32LE(2 * size, 40);
      if (bits === 8) { bytes[44] = 0; bytes[45] = 192; }
      else { bytes.writeIntLE(-(2 ** (bits - 1)), 44, size); bytes.writeIntLE(2 ** (bits - 2), 44 + size, size); }
      const audio = await decodeAudio(bytes, 'wav');
      expect([...audio.channels[0]]).toEqual([-1, 0.5]);
    }
    const bytes = Buffer.alloc(52); stereoWav().copy(bytes, 0, 0, 44);
    bytes.writeUInt32LE(44, 4); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(32, 34);
    bytes.writeUInt32LE(8, 40); bytes.writeFloatLE(NaN, 44);
    await expect(decodeAudio(bytes, 'wav')).rejects.toThrow('damaged');
    const extensible = Buffer.alloc(76); stereoWav().copy(extensible, 0, 0, 36);
    extensible.writeUInt32LE(68, 4); extensible.writeUInt32LE(40, 16); extensible.writeUInt16LE(0xfffe, 20);
    extensible.writeUInt16LE(22, 36); extensible.writeUInt16LE(16, 38); extensible.writeUInt32LE(0x30, 40);
    Buffer.from('0100000000001000800000aa00389b71', 'hex').copy(extensible, 44);
    extensible.write('data', 60); extensible.writeUInt32LE(8, 64);
    await expect(decodeAudio(extensible, 'wav')).rejects.toThrow('speaker layout');
    extensible.writeUInt32LE(3, 40);
    expect((await decodeAudio(extensible, 'wav')).channels).toHaveLength(2);
  });

  it('decodes the real MP3 fixture and produces a precisely shorter playable WAV without re-encoding MP3', async () => {
    const { service, conversation, store, media } = await setup();
    const mp3 = await media.save(await readFile(resolve('tests/fixtures/tone.mp3')), 'mp3', {}); store.insertAsset(mp3);
    const analysis = await service.analyzeAudio(mp3.id, {});
    expect(analysis.sampleRate).toBe(22050); expect(analysis.channels).toBe(1);
    expect(analysis.duration).toBeGreaterThan(0.2);
    expect(analysis.bins.some(b => b.peak > 0.01)).toBe(true);
    const trim = await service.trimAsset(conversation, mp3.id, { startSeconds: 0.05, endSeconds: 0.15 });
    expect(trim.duration).toBeCloseTo(2205 / 22050);
    expect(trim.edit?.decoder).toContain('mpg123-decoder@1.0.3');
  });

  it('waits for in-flight manual edits on shutdown and does not commit after closing', async () => {
    const { service, conversation, source, store } = await setup();
    const pending = service.trimAsset(conversation, source.id, { startSeconds: 0.2, endSeconds: 0.8 });
    const rejection = expect(pending).rejects.toThrow('closing');
    await service.shutdown(); await rejection;
    expect(store.assets()).toHaveLength(1);
  });

  it('cleans its new unregistered derivative when shutdown races a completed file write', async () => {
    const { service, conversation, source, store, media } = await setup();
    const save = media.save.bind(media);
    let signalSaved!: () => void, releaseSave!: () => void;
    const saved = new Promise<void>(resolve => { signalSaved = resolve; });
    const release = new Promise<void>(resolve => { releaseSave = resolve; });
    vi.spyOn(media, 'save').mockImplementation(async (...args) => {
      const asset = await save(...args); signalSaved(); await release; return asset;
    });
    const pending = service.trimAsset(conversation, source.id, { startSeconds: 0.2, endSeconds: 0.8 });
    const rejection = expect(pending).rejects.toThrow('closing');
    await saved;
    const stopped = service.shutdown(); releaseSave(); await stopped; await rejection;
    expect(store.assets()).toHaveLength(1);
    expect(await readdir(media.root)).toEqual([`${source.id}.wav`]);
  });
});
