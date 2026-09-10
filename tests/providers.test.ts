import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecureStore } from '../src/main/providers/secrets';
import { CodexAuth } from '../src/main/providers/auth';
import { streamChat } from '../src/main/providers/codex';
import { generateSound } from '../src/main/providers/elevenlabs';
import type { GenerationInput } from '../src/shared/types';

const cleanup: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of cleanup.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });

describe('SecureStore', () => {
  it('encrypts values and writes them atomically', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'sfxchat-secrets-')); cleanup.push(directory);
    const store = new SecureStore({ directory, isAvailable: () => true, encrypt: value => Buffer.from(`cipher:${value}`), decrypt: bytes => bytes.toString().replace(/^cipher:/, '') });
    await store.set('codex', 'synthetic-token');
    expect(await store.get('codex')).toBe('synthetic-token');
    expect((await fs.readFile(join(directory, 'codex.bin'))).toString()).toBe('cipher:synthetic-token');
    await store.delete('codex');
    expect(await store.get('codex')).toBeNull();
  });

  it('refuses plaintext fallback when platform protection is unavailable', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'sfxchat-secrets-')); cleanup.push(directory);
    const store = new SecureStore({ directory, isAvailable: () => false, encrypt: value => value, decrypt: bytes => bytes.toString() });
    await expect(store.set('x', 'secret')).rejects.toThrow(/unavailable/i);
  });
});

describe('CodexAuth', () => {
  function memoryStore(initial?: string): SecureStore {
    let value = initial ?? null;
    return { available: async () => true, get: async () => value, set: async (_name: string, next: string) => { value = next; }, delete: async () => { value = null; } } as unknown as SecureStore;
  }

  it('exchanges PKCE callback and preserves refresh token rotation', async () => {
    const store = memoryStore(); let opened = '';
    const tokenResponse = () => new Response(JSON.stringify({ access_token: 'access.synthetic', refresh_token: 'refresh.synthetic', expires_in: 3600 }), { status: 200 });
    const fetcher: typeof fetch = (input, init) => new URL(String(input)).hostname === '127.0.0.1' ? globalThis.fetch(input, init) : Promise.resolve(tokenResponse());
    const auth = new CodexAuth({ store, openExternal: url => { opened = url; }, fetch: fetcher });
    await auth.startLogin();
    const callback = new URL('http://127.0.0.1:1455/auth/callback'); callback.searchParams.set('state', new URL(opened).searchParams.get('state')!); callback.searchParams.set('code', 'synthetic-code');
    const callbackResponse = await globalThis.fetch(callback); await callbackResponse.text();
    await vi.waitFor(() => expect(auth.status.ready).toBe(true));
    expect(await auth.getAccessToken()).toBe('access.synthetic');
    expect(new URL(opened).searchParams.get('code_challenge')).toBeTruthy();
  });

  it('serializes refresh and logout prevents a late refresh from restoring credentials', async () => {
    let resolveRefresh!: (response: Response) => void;
    const store = memoryStore(JSON.stringify({ accessToken: 'expired', refreshToken: 'refresh', expiresAt: 0 }));
    const fetcher: typeof fetch = () => new Promise(resolve => { resolveRefresh = resolve; });
    const auth = new CodexAuth({ store, openExternal: () => undefined, fetch: fetcher });
    const tokenPromise = auth.getAccessToken();
    await vi.waitFor(() => expect(resolveRefresh).toBeTypeOf('function'));
    const logoutPromise = auth.logout();
    resolveRefresh(new Response(JSON.stringify({ access_token: 'late', refresh_token: 'late-refresh', expires_in: 3600 }), { status: 200 }));
    await logoutPromise;
    await expect(tokenPromise).rejects.toThrow();
    await expect(auth.getAccessToken()).rejects.toThrow(/signed in/i);
  });

  it('rejects an expired OAuth state and clears the loopback listener', async () => {
    const store = memoryStore(); let opened = ''; let clock = Date.now();
    const auth = new CodexAuth({ store, openExternal: url => { opened = url; }, now: () => clock, fetch: async () => new Response('{}', { status: 500 }) });
    await auth.startLogin();
    clock += 10 * 60 * 1000 + 1;
    const callback = new URL('http://127.0.0.1:1455/auth/callback'); callback.searchParams.set('state', new URL(opened).searchParams.get('state')!); callback.searchParams.set('code', 'expired');
    await auth.handleCallback('expired', callback.searchParams.get('state'));
    expect(auth.status.error).not.toBeNull();
    expect(auth.status.error).toMatch(/expired/i);
    expect(auth.status.pending).toBe(false);
  });
});

function jwtWithAccount(account = 'acct.synthetic'): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })}.signature`;
}
function sse(events: unknown[]): ReadableStream<Uint8Array> {
  const text = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 13)); controller.enqueue(bytes.slice(13)); controller.close(); } });
}

describe('Codex transport', () => {
  it('handles fragmented SSE with interleaved tool calls', async () => {
    const events = [
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'one' } },
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'item-2', call_id: 'call-2', name: 'two' } },
      { type: 'response.function_call_arguments.delta', item_id: 'item-2', delta: '{"b":' },
      { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{"a":' },
      { type: 'response.function_call_arguments.delta', item_id: 'item-2', delta: '2}' },
      { type: 'response.function_call_arguments.done', item_id: 'item-2', arguments: '{"b":2}' },
      { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '1}' },
      { type: 'response.function_call_arguments.done', item_id: 'item-1' },
      { type: 'response.output_text.delta', delta: 'hello' },
      { type: 'response.completed', response: { usage: { total_tokens: 3 } } },
    ];
    const texts: string[] = [];
    const result = await streamChat({ token: jwtWithAccount(), input: [{ role: 'user', content: 'hi' }], onText: text => { texts.push(text); } }, { fetch: async () => new Response(sse(events), { status: 200 }) });
    expect(texts).toEqual(['hello']);
    expect(result.calls).toEqual([{ id: 'call-1', name: 'one', arguments: '{"a":1}' }, { id: 'call-2', name: 'two', arguments: '{"b":2}' }]);
    expect(result.output.every(item => item.type === 'message' || item.type === 'function_call')).toBe(true);
    expect(result.usage).toEqual({ total_tokens: 3 });
  });

  it('rejects an interrupted stream and provider failure without retrying', async () => {
    const fetcher = vi.fn(async () => new Response(sse([{ type: 'response.output_text.delta', delta: 'partial' }]), { status: 200 }));
    await expect(streamChat({ token: jwtWithAccount(), input: [] }, { fetch: fetcher })).rejects.toThrow(/before completion/i);
    const failed = async () => new Response(sse([{ type: 'response.failed', response: { error: { message: 'synthetic failure' } } }]), { status: 200 });
    await expect(streamChat({ token: jwtWithAccount(), input: [] }, { fetch: failed })).rejects.toThrow(/response failed/i);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(streamChat({ token: jwtWithAccount(), input: [] }, { fetch: async () => new Response(sse([
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'item', call_id: 'call', name: 'tool' } },
      { type: 'response.function_call_arguments.delta', item_id: 'item', delta: '{"x":' },
      { type: 'response.completed' },
    ]), { status: 200 }) })).rejects.toThrow(/tool call/i);
  });
});

describe('ElevenLabs transport', () => {
  const input: GenerationInput = { prompt: 'short synthetic click', duration: 1, influence: 0.4, loop: false };
  it('validates fields and preserves response bytes and request headers', async () => {
    const response = new Response(new Uint8Array([0, 1, 255]), { status: 200, headers: { 'request-id': 'req.synthetic', 'x-credits-used': '1' } });
    let request: Request | undefined;
    const result = await generateSound(input, 'key.synthetic', undefined, { fetch: async (input, init) => { request = new Request(input, init); return response; } });
    expect([...result.bytes]).toEqual([0, 1, 255]); expect(result.requestId).toBe('req.synthetic'); expect(result.usage).toBe('1');
    expect(request?.headers.get('xi-api-key')).toBe('key.synthetic');
    expect(JSON.parse(await request!.text())).toMatchObject({ text: input.prompt, duration_seconds: 1, prompt_influence: 0.4, loop: false });
  });
  it('rejects invalid provider fields before making a request', async () => {
    const fetcher = vi.fn();
    await expect(generateSound({ prompt: 'x', duration: 31 }, 'key', undefined, { fetch: fetcher })).rejects.toThrow(/duration/i);
    await expect(generateSound({ prompt: 'x', influence: -0.1 }, 'key', undefined, { fetch: fetcher })).rejects.toThrow(/influence/i);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
