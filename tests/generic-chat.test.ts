import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatCompletionsClient, postWithEffortFallback, toChatMessages, toResponsesOutput } from '../src/main/providers/generic/chat';

afterEach(() => {
  vi.restoreAllMocks();
});

function chatSse(chunks: unknown[]): ReadableStream<Uint8Array> {
  const text = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 11)); controller.enqueue(bytes.slice(11)); controller.close(); } });
}

describe('chat completions transport', () => {
  it('streams text and fragmented tool calls into Responses-shaped output', async () => {
    const texts: string[] = [];
    const fetcher: typeof fetch = async () => new Response(chatSse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'probe', arguments: '{"a":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }], content: 'hi' } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]), { status: 200, headers: { 'x-request-id': 'req-1' } });
    const client = new ChatCompletionsClient({ fetch: fetcher, baseUrl: 'https://provider.test/v1', apiKey: 'key' });
    const result = await client.streamChat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function' }], effort: 'high', onText: text => { texts.push(text); } });
    expect(texts).toEqual(['hi']);
    expect(result.calls).toEqual([{ id: 'call-1', name: 'probe', arguments: '{"a":1}' }]);
    expect(result.requestId).toBe('req-1');
    const output = toResponsesOutput(result.text, result.calls);
    expect(output[0]).toMatchObject({ type: 'message' });
    expect(output[1]).toMatchObject({ type: 'function_call', call_id: 'call-1' });
  });

  it('omits the auth header for no-auth providers and converts history', async () => {
    let headers: Headers | undefined;
    const fetcher: typeof fetch = (async (input, init) => {
      headers = new Request(input, init).headers;
      return new Response(chatSse([{ choices: [{ delta: { content: 'ok' } }, { delta: {}, finish_reason: 'stop' }] }]), { status: 200 });
    }) as typeof fetch;
    const client = new ChatCompletionsClient({ fetch: fetcher, baseUrl: 'http://localhost:11434/v1' });
    const messages = toChatMessages([
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      { type: 'function_call', call_id: 'c1', name: 'probe', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' },
    ], 'system');
    await client.streamChat({ model: 'm', messages });
    expect(headers?.get('authorization')).toBeNull();
    expect(messages[0]).toMatchObject({ role: 'system' });
    expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
  });

  it('retries once without reasoning_effort when a gateway rejects it', async () => {
    const bodies: string[] = [];
    const fetcher: typeof fetch = (async (_input, init) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) return new Response(JSON.stringify({ error: { message: 'reasoning_effort is not supported' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      return new Response(chatSse([{ choices: [{ delta: { content: 'ok' } }, { delta: {}, finish_reason: 'stop' }] }]), { status: 200 });
    }) as typeof fetch;
    const client = new ChatCompletionsClient({ fetch: fetcher, baseUrl: 'https://provider.test/v1', apiKey: 'key' });
    await client.streamChat({ model: 'm', messages: [{ role: 'user', content: 'hi' }], effort: 'high' });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain('reasoning_effort');
    expect(bodies[1]).not.toContain('reasoning_effort');
  });

  it('lists models with OpenAI shape and redacts failures', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ object: 'list', data: [{ id: 'a' }, { id: ' b ' }, { name: 'c' }] }), { status: 200 });
    await expect(new ChatCompletionsClient({ fetch: fetcher, baseUrl: 'https://p.test/v1', apiKey: 'k' }).listModels()).resolves.toEqual(['a', 'b', 'c']);
    const failing: typeof fetch = async () => new Response(JSON.stringify({ error: { message: 'bad key k-secret' } }), { status: 401, headers: { 'content-type': 'application/json' } });
    await expect(new ChatCompletionsClient({ fetch: failing, baseUrl: 'https://p.test/v1', apiKey: 'k-secret' }).streamChat({ model: 'm', messages: [] })).rejects.toThrow(/chat provider/i);
  });

  it('posts codex reasoning.effort shape through the shared helper', async () => {
    const bodies: string[] = [];
    const fetcher: typeof fetch = (async (_input, init) => {
      bodies.push(String(init?.body));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await postWithEffortFallback({ kind: 'codex-account', effort: 'xhigh', fetchImpl: fetcher, url: 'https://codex.test', headers: {}, buildBody: extra => ({ model: 'm', ...extra }), providerLabel: 'Codex', secrets: [] });
    expect(JSON.parse(bodies[0])).toEqual({ model: 'm', reasoning: { effort: 'xhigh' } });
  });
});
