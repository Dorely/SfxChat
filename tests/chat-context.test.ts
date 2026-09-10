import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContextTokenCounter } from '../src/main/chat-context';
import { Store } from '../src/main/store';
import { MediaLibrary } from '../src/main/media';
import { WorkbenchService, type ServicePorts } from '../src/main/service';
import { CHAT_MODELS, DEFAULT_MODEL, resolveChatModel } from '../src/shared/chat-models';
import type { SettingsStatus } from '../src/shared/types';

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

function settings(model = DEFAULT_MODEL): SettingsStatus {
  return { codexReady: true, elevenLabsReady: true, secureStorageAvailable: true, loginPending: false, model, error: null };
}

function ports(overrides: Partial<ServicePorts> = {}, model = DEFAULT_MODEL): ServicePorts {
  return {
    settings: async () => settings(model),
    chat: async () => ({ output: [], calls: [] }),
    generate: async () => ({ bytes: Buffer.from('unused'), requestId: null, usage: null, model: 'test' }),
    safeError: error => error instanceof Error ? error.message : String(error),
    ...overrides,
  };
}

async function runtime(customPorts: Partial<ServicePorts> = {}, model = DEFAULT_MODEL) {
  const root = await fs.mkdtemp(join(tmpdir(), 'sfxchat-context-'));
  roots.push(root);
  const store = new Store(join(root, 'library.sqlite'));
  const service = new WorkbenchService(store, new MediaLibrary(join(root, 'media')), ports(customPorts, model), () => undefined);
  runtimes.push({ store, service });
  return { root, store, service, conversationId: store.createConversation() };
}

describe('context token counting', () => {
  it('counts every request component, skips encrypted reasoning, and accepts special literals', () => {
    const counter = new ContextTokenCounter();
    const empty = counter.count({ instructions: '', tools: [], input: [] });
    const full = counter.count({
      instructions: 'system instructions',
      tools: [{ name: 'inspect', description: 'inspect an asset' }],
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'history' }] }, { encrypted_content: 'secret' }],
      draft: '<|endoftext|> literal',
      streamingText: 'live response'
    });
    expect(full.tokens).toBeGreaterThan(empty.tokens);
    expect(full.includesHiddenReasoning).toBe(true);
    expect(counter.count({ instructions: '', tools: [], input: [{ encrypted_content: 'a'.repeat(1000) }] }).tokens)
      .toBe(counter.count({ instructions: '', tools: [], input: [{}] }).tokens);
    for (const component of [
      { instructions: 'Instructions use context.' },
      { tools: [{ name: 'inspect', description: 'Inspect an asset.' }] },
      { input: [{ role: 'user', content: 'Conversation history.' }] },
      { draft: 'Draft uses context.' }, { streamingText: 'Reply uses context.' }
    ]) expect(counter.count({ instructions: '', tools: [], input: [], ...component }).tokens).toBeGreaterThan(empty.tokens);
    expect(counter.count({ instructions: '', tools: [], input: [{ encrypted_content: '' }] }).includesHiddenReasoning).toBe(false);
  });

  it('reports model mappings, configured limits, and unknown-model behavior', async () => {
    expect(resolveChatModel()).toBe(DEFAULT_MODEL);
    expect(resolveChatModel('backend default')).toBe(DEFAULT_MODEL);
    expect(resolveChatModel('gpt-5.6-astra')).toBe('gpt-6-astra');
    expect(resolveChatModel('custom-model')).toBe('custom-model');
    expect(CHAT_MODELS.every(model => model.contextLimit === 272_000)).toBe(true);

    const known = await runtime();
    expect((await known.service.chatContext(known.conversationId)).limit).toBe(272_000);
    const unknown = await runtime({}, 'custom-model');
    expect((await unknown.service.chatContext(unknown.conversationId)).model).toBe('custom-model');
    expect((await unknown.service.chatContext(unknown.conversationId)).limit).toBeNull();
  });

  it('counts draft and repaired history per conversation while excluding display-only errors', async () => {
    const current = await runtime();
    const secondConversationId = current.store.createConversation();
    const baseline = await current.service.chatContext(current.conversationId);
    const draft = await current.service.chatContext(current.conversationId, 'a draft with enough text to tokenize');
    expect(draft.tokens).toBeGreaterThan(baseline.tokens);

    current.store.beginTool('repair-call', current.conversationId, 'search_assets', '{"query":"rain"}');
    current.store.finishTool('repair-call', '{"assets":[]}');
    current.store.setSetting(`history/${current.conversationId}`, JSON.stringify([
      { type: 'function_call_output', call_id: 'repair-call', output: '{"assets":[]}' }
    ]));
    const withHistory = await current.service.chatContext(current.conversationId);
    expect(withHistory.tokens).toBeGreaterThan(baseline.tokens);
    expect((await current.service.chatContext(secondConversationId)).tokens).toBe(baseline.tokens);

    current.store.addMessage(current.conversationId, 'tool', 'display-only provider error', 'failed');
    expect((await current.service.chatContext(current.conversationId)).tokens).toBe(withHistory.tokens);
  });

  it('preserves context counts after reopening the service', async () => {
    const current = await runtime();
    current.store.setSetting(`history/${current.conversationId}`, JSON.stringify([
      { role: 'user', content: [{ type: 'input_text', text: 'persisted context' }] }
    ]));
    const before = await current.service.chatContext(current.conversationId, 'draft');
    await current.service.shutdown();
    current.store.close();
    runtimes.splice(0, 1);

    const reopenedStore = new Store(join(current.root, 'library.sqlite'));
    const reopened = new WorkbenchService(reopenedStore, new MediaLibrary(join(current.root, 'media')), ports(), () => undefined);
    runtimes.push({ store: reopenedStore, service: reopened });
    expect(await reopened.chatContext(current.conversationId, 'draft')).toEqual(before);
  });

  it('uses live streamed text once, then keeps the completed count stable', async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const current = await runtime({
      chat: async options => {
        options.onText('streamed response');
        await waiting;
        return { output: [{ role: 'assistant', content: [{ type: 'output_text', text: 'streamed response' }] }], calls: [] };
      }
    });
    await current.service.sendMessage(current.conversationId, 'start a streamed turn');
    await vi.waitFor(async () => expect((await current.service.chatContext(current.conversationId)).tokens).toBeGreaterThan(0));
    const during = await current.service.chatContext(current.conversationId);
    release();
    await current.service.idle();
    const completed = await current.service.chatContext(current.conversationId);
    expect(completed.tokens).toBe(during.tokens);
  });
});
