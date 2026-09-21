import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenericResponsesClient } from '../src/main/providers/generic/responses';

afterEach(() => {
  vi.restoreAllMocks();
});

function sse(events: unknown[]): ReadableStream<Uint8Array> {
  const text = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

describe('generic responses transport', () => {
  it('streams without Codex-only headers and preserves call order', async () => {
    const requests: Request[] = [];
    const fetcher: typeof fetch = (async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(sse([
        { type: 'response.output_item.added', item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'probe' } },
        { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{"a":1}' },
        { type: 'response.function_call_arguments.done', item_id: 'item-1', arguments: '{"a":1}' },
        { type: 'response.output_text.delta', delta: 'done' },
        { type: 'response.completed', response: { status: 'completed', output: [] } },
      ]), { status: 200 });
    }) as typeof fetch;
    const texts: string[] = [];
    const result = await new GenericResponsesClient({ fetch: fetcher, baseUrl: 'https://provider.test/v1', apiKey: 'key' }).streamChat({
      model: 'm', input: [{ role: 'user', content: 'hi' }], instructions: 'sys', tools: [{ type: 'function' }], effort: 'low', onText: text => { texts.push(text); },
    });
    expect(texts).toEqual(['done']);
    expect(result.calls).toEqual([{ id: 'call-1', name: 'probe', arguments: '{"a":1}' }]);
    const headers = requests[0]!.headers;
    expect(headers.get('authorization')).toBe('Bearer key');
    expect(headers.get('chatgpt-account-id')).toBeNull();
    expect(headers.get('openai-beta')).toBeNull();
    expect(headers.get('originator')).toBeNull();
    const body = JSON.parse(await requests[0]!.text());
    expect(body).toMatchObject({ model: 'm', stream: true, instructions: 'sys', reasoning_effort: 'low' });
    expect(body).not.toHaveProperty('store');
  });

  it('sends no auth header for local endpoints', async () => {
    let headers: Headers | undefined;
    const fetcher: typeof fetch = (async (input, init) => {
      headers = new Request(input, init).headers;
      return new Response(sse([{ type: 'response.completed', response: { status: 'completed', output: [] } }]), { status: 200 });
    }) as typeof fetch;
    await new GenericResponsesClient({ fetch: fetcher, baseUrl: 'http://localhost:11434/v1' }).streamChat({ model: 'm', input: [], instructions: '' });
    expect(headers?.get('authorization')).toBeNull();
  });

  it('rejects incomplete streams and lists models', async () => {
    const incomplete: typeof fetch = async () => new Response(sse([{ type: 'response.output_text.delta', delta: 'x' }]), { status: 200 });
    await expect(new GenericResponsesClient({ fetch: incomplete, baseUrl: 'https://p.test/v1' }).streamChat({ model: 'm', input: [], instructions: '' })).rejects.toThrow(/before completion/i);
    const models: typeof fetch = async () => new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 });
    await expect(new GenericResponsesClient({ fetch: models, baseUrl: 'https://p.test/v1' }).listModels()).resolves.toEqual(['m1']);
  });
});
