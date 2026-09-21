import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/main/store';
import { ChatRegistry } from '../src/main/chat-registry';
import { SecureStore } from '../src/main/providers/secrets';
import { capabilityNote, runCapabilityProbe, toolsForModel } from '../src/main/providers/generic/capabilities';
import { chatPath, modelsPath, normalizeBaseUrl, normalizeEfforts } from '../src/main/providers/generic/registry';

const cleanup: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of cleanup.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

function memorySecrets(initial: Record<string, string> = {}): SecureStore {
  const values = new Map(Object.entries(initial));
  return {
    available: async () => true,
    get: async (name: string) => values.get(name) ?? null,
    set: async (name: string, value: string) => { values.set(name, value); },
    delete: async (name: string) => { values.delete(name); },
  } as unknown as SecureStore;
}

async function registry(secrets = memorySecrets()) {
  const root = await fs.mkdtemp(join(tmpdir(), 'sfxchat-registry-'));
  cleanup.push(root);
  const store = new Store(join(root, 'library.sqlite'));
  const handle = { store, registry: new ChatRegistry(store, secrets), root };
  const originalClose = store.close.bind(store);
  store.close = () => {
    try {
      originalClose();
    } catch (error) {
      if (!(error instanceof Error && /busy|locked/i.test(error.message))) throw error;
    }
  };
  return handle;
}

function chatOk(text = 'ok'): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }, { delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('registry normalization', () => {
  it('normalizes bare hosts to /v1 and builds kind paths', () => {
    expect(normalizeBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1');
    expect(normalizeBaseUrl('https://api.commandcode.ai/provider/v1/')).toBe('https://api.commandcode.ai/provider/v1');
    expect(chatPath('https://p.test/v1', 'chat-completions')).toBe('https://p.test/v1/chat/completions');
    expect(chatPath('https://p.test/v1', 'responses')).toBe('https://p.test/v1/responses');
    expect(chatPath('https://p.test/v1', 'anthropic')).toBe('https://p.test/v1/messages');
    expect(modelsPath('https://p.test/v1')).toBe('https://p.test/v1/models');
    expect(() => normalizeBaseUrl('https://user:pass@host/v1')).toThrow(/credentials/i);
    expect(normalizeEfforts([' low ', 'low', ''])).toEqual(['low']);
  });
});

describe('capability probes', () => {
  it('tests every listed effort and flags the failing one', async () => {
    const seen: string[] = [];
    const fetcher: typeof fetch = (async (_input, init) => {
      const body = String(init?.body);
      seen.push(body);
      if (body.includes('"low"') || body.includes('effort":"low"')) {
        return new Response(JSON.stringify({ error: { message: 'bad effort low' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      if (body.includes('image_url') || body.includes('input_image')) return new Response(JSON.stringify({ error: { message: 'no vision' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      if (body.includes('input_audio')) return new Response(JSON.stringify({ error: { message: 'no audio' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      return chatOk();
    }) as typeof fetch;
    const outcome = await runCapabilityProbe({ provider: { id: 'p', label: 'P', baseUrl: 'https://p.test/v1', kind: 'chat-completions' }, slug: 'm', efforts: ['low', 'high'], fetch: fetcher });
    expect(outcome.failedEfforts).toEqual(['low']);
    expect(outcome.perEffort).toEqual({ low: 'fail', high: 'pass' });
    expect(seen.some(body => body.includes('reasoning_effort'))).toBe(true);
  });

  it('discovers anthropic max tokens from the top down and marks modalities', async () => {
    const fetcher: typeof fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.max_tokens > 32000) return new Response(JSON.stringify({ error: { message: 'max_tokens too high' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      if (body.messages) {
        const hasImage = JSON.stringify(body.messages).includes('image');
        if (hasImage) return new Response(JSON.stringify({ error: { message: 'no vision' } }), { status: 400, headers: { 'content-type': 'application/json' } });
        const events = `data: ${JSON.stringify({ type: 'message_delta', stop_reason: 'end_turn' })}\n\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
        return new Response(events, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      const events = `data: ${JSON.stringify({ type: 'message_delta', stop_reason: 'end_turn' })}\n\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
      return new Response(events, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    const outcome = await runCapabilityProbe({ provider: { id: 'p', label: 'P', baseUrl: 'https://a.test', kind: 'anthropic' }, slug: 'm', efforts: [], fetch: fetcher });
    expect(outcome.maxTokens).toBe(32000);
    expect(outcome.vision).toBe(false);
    expect(outcome.audio).toBe(true);
    expect(outcome.failedEfforts).toEqual([]);
  });
});

describe('capability gating', () => {
  it('saves providers offline but gates models on a fresh all-efforts pass', async () => {
    const { store, registry: chat } = await registry();
    const provider = await chat.saveProvider({ label: 'Local', baseUrl: 'http://localhost:11434', kind: 'chat-completions' });
    expect(provider.baseUrl).toBe('http://localhost:11434/v1');
    await expect(chat.saveModel({ providerId: provider.id, slug: 'm', efforts: ['low'] })).rejects.toThrow(/test/i);
    const fetcher: typeof fetch = (async (_input, init) => {
      const body = String(init?.body);
      if (body.includes('image_url') || body.includes('input_image')) return new Response(JSON.stringify({ error: { message: 'no vision' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      if (body.includes('input_audio')) return new Response(JSON.stringify({ error: { message: 'no audio' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      return chatOk();
    }) as typeof fetch;
    const outcome = await chat.testModel({ providerId: provider.id, slug: 'm', efforts: ['low'] }, fetcher);
    expect(outcome.failedEfforts).toEqual([]);
    const saved = await chat.saveModel({ providerId: provider.id, slug: 'm', efforts: ['low'] });
    expect(saved.effortResults).toEqual({ low: 'pass' });
    expect(saved.vision).toBe(false);
    expect(saved.audio).toBe(false);
    await expect(chat.saveModel({ providerId: provider.id, slug: 'm', efforts: ['low', 'high'] })).rejects.toThrow(/test/i);
    store.close();
  });

  it('filters future vision/audio tools and annotates instructions', () => {
    const tools = [{ name: 'generate_sounds' }, { name: 'spectrogram_view' }, { name: 'audio_listen' }];
    const filtered = toolsForModel({ vision: false, audio: false }, [{ name: 'generate_sounds' }, { name: 'spectrogram_view' }, { name: 'audio_listen' }] as unknown as { name?: string }[]);
    expect(filtered.map(tool => (tool as { name: string }).name)).toEqual(['generate_sounds']);
    expect(toolsForModel({ vision: true, audio: true }, tools as unknown as { name?: string }[])).toHaveLength(3);
    expect(capabilityNote({ vision: false, audio: true })).toMatch(/images/i);
  });

  it('resolves the combined selection with stale-effort fallback', async () => {
    const { store, registry: chat } = await registry();
    const provider = await chat.saveProvider({ label: 'P', baseUrl: 'https://p.test/v1', kind: 'chat-completions' });
    const fetcher: typeof fetch = (async () => chatOk()) as typeof fetch;
    await chat.testModel({ providerId: provider.id, slug: 'm', efforts: ['low', 'high'] }, fetcher);
    const saved = await chat.saveModel({ providerId: provider.id, slug: 'm', efforts: ['low', 'high'] });
    chat.setActive(saved.id, 'high');
    expect(chat.activeSelection()).toEqual({ modelId: saved.id, effort: 'high' });
    expect(() => chat.setActive(saved.id, 'bogus')).not.toThrow();
    expect(chat.activeSelection().effort).toBe('low');
    const target = await chat.resolveActive();
    expect(target.slug).toBe('m');
    expect(target.effort).toBe('low');
    store.close();
  });
});
