import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicClient, toAnthropicMessages, toAnthropicTools } from '../src/main/providers/generic/anthropic';

afterEach(() => {
  vi.restoreAllMocks();
});

function sse(events: unknown[]): ReadableStream<Uint8Array> {
  const text = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}

describe('anthropic transport', () => {
  it('converts Responses history to blocks and accumulates tool_use', async () => {
    const requests: Request[] = [];
    const fetcher: typeof fetch = (async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(sse([
        { type: 'message_start', message: { usage: { input_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ready' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu-1', name: 'probe' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '1}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]), { status: 200, headers: { 'anthropic-request-id': 'req-a' } });
    }) as typeof fetch;
    const texts: string[] = [];
    const result = await new AnthropicClient({ fetch: fetcher, baseUrl: 'https://api.anthropic.test', apiKey: 'secret' }).streamChat({
      model: 'claude-test',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
        { type: 'function_call', call_id: 'old', name: 'probe', arguments: '{}' },
        { type: 'function_call_output', call_id: 'old', output: 'done' },
      ],
      instructions: 'sys',
      tools: [{ type: 'function', function: { name: 'probe', description: 'p', parameters: { type: 'object' } } }],
      maxTokens: 8192,
      onText: text => { texts.push(text); },
    });
    expect(texts).toEqual(['ready']);
    expect(result.calls).toEqual([{ id: 'tu-1', name: 'probe', arguments: '{"a":1}' }]);
    expect(result.output[0]).toMatchObject({ type: 'message' });
    expect(result.output[1]).toMatchObject({ type: 'function_call', call_id: 'tu-1' });
    expect(result.requestId).toBe('req-a');
    const sent = requests[0]!;
    expect(sent.headers.get('x-api-key')).toBe('secret');
    expect(sent.headers.get('anthropic-version')).toBe('2023-06-01');
    const body = JSON.parse(await sent.text());
    expect(body).toMatchObject({ model: 'claude-test', max_tokens: 8192, system: 'sys', stream: true, tool_choice: { type: 'auto' } });
    expect(body.tools[0]).toMatchObject({ name: 'probe', input_schema: { type: 'object' } });
    const assistant = body.messages.find((message: { role: string }) => message.role === 'assistant');
    expect(assistant.content).toMatchObject([{ type: 'tool_use', id: 'old' }]);
    const toolResult = body.messages.find((message: { role: string; content: { type: string }[] }) => message.role === 'user' && message.content[0]?.type === 'tool_result');
    expect(toolResult.content[0]).toMatchObject({ tool_use_id: 'old' });
  });

  it('passes thinking blocks through and rejects tool_use without calls', async () => {
    const messages = toAnthropicMessages([{ type: 'thinking', thinking: 'hmm' }]);
    expect(messages[0]!.content[0]).toMatchObject({ type: 'thinking' });
    expect(toAnthropicTools([{ type: 'other' }])).toEqual([]);
    const emptyTool: typeof fetch = async () => new Response(sse([
      { type: 'message_delta', stop_reason: 'tool_use' },
      { type: 'message_stop' },
    ]), { status: 200 });
    await expect(new AnthropicClient({ fetch: emptyTool, baseUrl: 'https://a.test' }).streamChat({ model: 'm', input: [], instructions: '', maxTokens: 8192 })).rejects.toThrow(/tool call/i);
  });

  it('lists models with the anthropic key header', async () => {
    let headers: Headers | undefined;
    const fetcher: typeof fetch = (async (input, init) => {
      headers = new Request(input, init).headers;
      return new Response(JSON.stringify({ data: [{ id: 'm1' }, { name: 'm2' }] }), { status: 200 });
    }) as typeof fetch;
    await expect(new AnthropicClient({ fetch: fetcher, baseUrl: 'https://a.test', apiKey: 'k' }).listModels()).resolves.toEqual(['m1', 'm2']);
    expect(headers?.get('x-api-key')).toBe('k');
  });
});
