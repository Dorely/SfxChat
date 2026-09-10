import { describe, expect, it } from 'vitest';
import { streamChat } from '../src/main/providers/codex';

const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account' } })).toString('base64url')}.synthetic`;
const message = (id: string, text: string) => ({ type: 'message', id, role: 'assistant', content: [{ type: 'output_text', text }] });
const call = { type: 'function_call', id: 'item-call', call_id: 'call-synthetic', name: 'generate_sounds', arguments: '{"prompt":"synthetic click"}' };
function fetchEvents(events: unknown[]): typeof fetch {
  return async () => new Response(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''), { headers: { 'x-request-id': 'request-synthetic' } });
}

describe('Codex replayable history', () => {
  it('keeps completed text and calls when the terminal output is empty', async () => {
    const result = await streamChat({ token, input: [] }, { fetch: fetchEvents([
      { type: 'response.output_text.delta', item_id: 'message-1', output_index: 0, delta: 'Creating a sound.' },
      { type: 'response.output_item.added', item: { ...call, arguments: '' } },
      { type: 'response.function_call_arguments.done', item_id: call.id, arguments: call.arguments },
      { type: 'response.output_item.done', item: call },
      { type: 'response.completed', response: { output: [] } },
    ]) });
    expect(result.output).toEqual([
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Creating a sound.' }] },
      { type: 'function_call', call_id: call.call_id, name: call.name, arguments: call.arguments },
    ]);
    expect(result.calls).toHaveLength(1);
    expect(result.requestId).toBe('request-synthetic');
  });

  it('merges partial terminal outputs by identity without dropping calls or repeating text', async () => {
    const displayed: string[] = [];
    const result = await streamChat({ token, input: [], onText: text => { displayed.push(text); } }, { fetch: fetchEvents([
      { type: 'response.output_item.added', output_index: 0, item: message('message-1', '') },
      { type: 'response.output_text.delta', item_id: 'message-1', output_index: 0, delta: 'First.' },
      { type: 'response.output_item.done', item: call },
      { type: 'response.output_item.added', output_index: 2, item: message('message-2', '') },
      { type: 'response.output_text.delta', item_id: 'message-2', output_index: 2, delta: 'Second.' },
      { type: 'response.completed', response: { output: [message('message-2', 'Second.')] } },
    ]) });
    expect(result.output.map(item => item.type)).toEqual(['message', 'function_call', 'message']);
    expect(result.output.filter(item => item.type === 'message').map(item => item.content[0].text)).toEqual(['First.', 'Second.']);
    expect(displayed).toEqual(['First.', 'Second.']);
  });

  it('accepts final-only calls and messages while ignoring opaque reasoning', async () => {
    const displayed: string[] = [];
    const result = await streamChat({ token, input: [], onText: text => { displayed.push(text); } }, { fetch: fetchEvents([
      { type: 'response.completed', response: { output: [{ type: 'reasoning', id: 'opaque' }, message('final', 'Ready.'), call] } },
    ]) });
    expect(result.output.map(item => item.type)).toEqual(['message', 'function_call']);
    expect(result.calls[0].id).toBe(call.call_id);
    expect(displayed).toEqual(['Ready.']);
  });

  it('redacts exact credentials from HTTP, stream, and transport failures', async () => {
    const http = async () => new Response(JSON.stringify({ error: { message: `Rejected ${token}`, param: 'input' } }), { status: 400, headers: { 'x-request-id': 'req-error' } });
    for (const fetcher of [http, fetchEvents([{ type: 'response.failed', response: { error: { message: `Rejected ${token}` } } }]), async () => { throw new Error(`Transport rejected ${token}`); }]) {
      const error = await streamChat({ token, input: [] }, { fetch: fetcher }).catch(error => error);
      expect(error.message).toContain('[redacted]');
      expect(error.message).not.toContain(token);
    }
  });

  it('binds unidentified text deltas to the final item without repeating it', async () => {
    const displayed: string[] = [];
    const result = await streamChat({ token, input: [], onText: text => { displayed.push(text); } }, { fetch: fetchEvents([
      { type: 'response.output_text.delta', delta: 'Ready.' },
      { type: 'response.completed', response: { output: [message('final', 'Ready.')] } },
    ]) });
    expect(result.output).toHaveLength(1);
    expect(displayed).toEqual(['Ready.']);
  });
});
