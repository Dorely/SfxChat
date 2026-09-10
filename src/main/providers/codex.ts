const RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const DEFAULT_MODEL = 'gpt-5.6-sol';
const ORIGINATOR = 'codex_cli_rs';

export interface StreamChatInput { token: string; model?: string; input: unknown; instructions?: string; tools?: unknown[]; signal?: AbortSignal; onText?: (text: string) => void | Promise<void> }
export interface StreamChatResult { output: any[]; calls: { id: string; name: string; arguments: string }[]; usage?: unknown }
export interface CodexClientOptions { fetch?: typeof globalThis.fetch; endpoint?: string }
export class ProviderHttpError extends Error {
  constructor(readonly status: number, provider: string) { super(`${provider} API returned ${status}.`); this.name = 'ProviderHttpError'; }
}

function accountId(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Codex token is invalid.');
  try {
    const json = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - parts[1].length % 4) % 4), 'base64').toString('utf8')) as Record<string, any>;
    const id = json['https://api.openai.com/auth']?.chatgpt_account_id;
    if (typeof id !== 'string' || !id) throw new Error();
    return id;
  } catch { throw new Error('Codex token is invalid.'); }
}

function eventFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let split: number;
  while ((split = buffer.search(/\r?\n\r?\n/)) >= 0) {
    const separator = buffer[split] === '\r' ? (buffer[split + 2] === '\r' ? 4 : 2) : 2;
    frames.push(buffer.slice(0, split)); buffer = buffer.slice(split + separator);
  }
  return { frames, rest: buffer };
}
function parseFrame(frame: string): string | null {
  const lines = frame.split(/\r?\n/).filter(line => line.startsWith('data:'));
  if (!lines.length) return null;
  return lines.map(line => line.slice(5).replace(/^ /, '')).join('\n');
}
export class CodexClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly endpoint: string;
  constructor(options: CodexClientOptions = {}) { this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis); this.endpoint = options.endpoint ?? RESPONSES_ENDPOINT; }

  async streamChat(args: StreamChatInput): Promise<StreamChatResult> {
    const body: Record<string, unknown> = { model: args.model || DEFAULT_MODEL, stream: true, store: false, input: args.input, instructions: args.instructions ?? 'You are a helpful assistant.' };
    if (args.tools?.length) { body.tools = args.tools; body.tool_choice = 'auto'; }
    const response = await this.fetcher(this.endpoint, { method: 'POST', headers: { authorization: `Bearer ${args.token}`, 'ChatGPT-Account-ID': accountId(args.token), 'OpenAI-Beta': 'responses=experimental', originator: ORIGINATOR, 'User-Agent': 'codex_cli_rs/0.0.0 (SfxChat)', accept: 'text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: args.signal });
    if (!response.ok) throw new ProviderHttpError(response.status, 'Codex');
    if (!response.body) throw new Error('Codex response did not include a stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = ''; let completed = false; let usage: unknown; let text = ''; let responseOutput: any[] | undefined;
    const calls = new Map<string, { id: string; name: string; arguments: string; done: boolean }>();
    const orderedCalls: { id: string; name: string; arguments: string; done: boolean }[] = [];
    const sequence: ({ kind: 'text' } | { kind: 'call'; call: { id: string; name: string; arguments: string; done: boolean } })[] = [];
    let textSeen = false;
    const upsertCall = (item: any): { id: string; name: string; arguments: string; done: boolean } | undefined => {
      const callId = typeof item?.call_id === 'string' ? item.call_id : (typeof item?.id === 'string' ? item.id : undefined);
      if (!callId) return undefined;
      const existing = (typeof item.call_id === 'string' ? calls.get(item.call_id) : undefined)
        ?? (typeof item.id === 'string' ? calls.get(item.id) : undefined);
      const call = existing ?? { id: callId, name: typeof item.name === 'string' ? item.name : '', arguments: '', done: false };
      if (!existing) orderedCalls.push(call);
      if (typeof item.name === 'string' && item.name) call.name = item.name;
      if (typeof item.call_id === 'string') calls.set(item.call_id, call);
      if (typeof item.id === 'string') calls.set(item.id, call);
      return call;
    };
    const output: any[] = [];
    const consume = async (data: string): Promise<void> => {
      if (data === '[DONE]') return;
      let event: any; try { event = JSON.parse(data); } catch { return; }
      switch (event.type) {
        case 'response.output_text.delta': {
          const delta = typeof event.delta === 'string' ? event.delta : ''; if (delta) { text += delta; if (!textSeen) { textSeen = true; sequence.push({ kind: 'text' }); } await args.onText?.(delta); } break;
        }
        case 'response.output_item.added': {
          const item = event.item; if (item?.type === 'function_call') {
            const before = orderedCalls.length;
            const call = upsertCall(item);
            if (call && orderedCalls.length !== before) sequence.push({ kind: 'call', call });
          } break;
        }
        case 'response.function_call_arguments.delta': { const id = event.call_id ?? event.item_id; const call = typeof id === 'string' ? calls.get(id) : undefined; if (call && typeof event.delta === 'string') call.arguments += event.delta; break; }
        case 'response.function_call_arguments.done': { const id = event.call_id ?? event.item_id; const call = typeof id === 'string' ? calls.get(id) : undefined; if (call) { if (typeof event.arguments === 'string') call.arguments = event.arguments; call.done = true; } break; }
        case 'response.output_item.done': { const item = event.item; if (item?.type === 'function_call') { const call = upsertCall(item); if (call) { if (typeof item.arguments === 'string') call.arguments = item.arguments; call.done = true; } } break; }
        case 'response.completed': case 'response.done':
          if (event.status === 'failed' || event.response?.status === 'failed' || event.error || event.response?.error) throw new Error('Codex response failed.');
          completed = true;
          usage = event.response?.usage ?? event.usage;
          if (Array.isArray(event.response?.output)) responseOutput = event.response.output;
          for (const item of responseOutput ?? []) {
            if (item?.type === 'function_call') {
              const call = upsertCall(item);
              if (call) { if (typeof item.arguments === 'string') call.arguments = item.arguments; call.done = true; }
            }
          }
          break;
        case 'response.failed': throw new Error('Codex response failed.');
        case 'error': throw new Error('Codex response returned an error.');
      }
    };
    try {
      while (!completed) {
        const part = await reader.read();
        if (part.done) { buffer += decoder.decode(); break; }
        buffer += decoder.decode(part.value, { stream: true });
        const parsed = eventFrames(buffer); buffer = parsed.rest;
        for (const frame of parsed.frames) {
          const data = parseFrame(frame); if (data !== null) await consume(data);
          if (completed) break;
        }
      }
      if (!completed) { const tail = parseFrame(buffer); if (tail !== null) await consume(tail); }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (!completed) throw new Error('Codex response stream ended before completion.');
    const finishedCalls = orderedCalls;
    if (finishedCalls.some(call => !call.done)) throw new Error('Codex response stream ended during a tool call.');
    if (responseOutput) output.push(...responseOutput);
    else {
      for (const entry of sequence) {
        if (entry.kind === 'text') output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
        else output.push({ type: 'function_call', call_id: entry.call.id, name: entry.call.name, arguments: entry.call.arguments });
      }
    }
    return { output, calls: finishedCalls.map(({ id, name, arguments: callArguments }) => ({ id, name, arguments: callArguments })), usage };
  }
}

export const streamChat = (args: StreamChatInput, options?: CodexClientOptions): Promise<StreamChatResult> => new CodexClient(options).streamChat(args);
export { RESPONSES_ENDPOINT, DEFAULT_MODEL };
