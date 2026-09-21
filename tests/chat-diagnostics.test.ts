import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DiagnosticLog } from '../src/main/diagnostics';
import { MediaLibrary } from '../src/main/media';
import { CodexClient } from '../src/main/providers/codex';
import { Store } from '../src/main/store';
import { WorkbenchService, type ServicePorts } from '../src/main/service';

const audio = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'tone.mp3'));
const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-test' } })).toString('base64url')}.signature`;
const runtimes: { root: string; service: WorkbenchService; store: Store }[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0).reverse()) {
    try { await runtime.service.shutdown(); } catch { /* cleanup should survive failed assertions */ }
    try { runtime.store.close(); } catch { /* may have been closed by the test */ }
    rmSync(runtime.root, { recursive: true, force: true });
  }
});

function stream(...events: unknown[]): Response {
  const body = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-stream' } });
}

function settings() { return { codexReady: true, elevenLabsReady: true, secureStorageAvailable: true, loginPending: false, model: 'test-model', error: null, chatModels: [], activeChat: { modelId: 'codex:test-model', effort: '' }, providers: [] }; }
function setup(fetcher: typeof fetch, root: string, generate: () => Promise<{ bytes: Buffer; requestId: string; usage: string; model: string }>) {
  const store = new Store(join(root, 'library.sqlite'));
  const conversationId = store.createConversation();
  const media = new MediaLibrary(join(root, 'originals'));
  const ports: ServicePorts = { settings: async () => settings(), safeError: error => error instanceof Error ? error.message : 'failed', chat: async args => new CodexClient({ fetch: fetcher, endpoint: 'https://test.invalid' }).streamChat({ ...args, token }), generate };
  const service = new WorkbenchService(store, media, ports, () => {}, new DiagnosticLog(root, { maxBytes: 1024 * 1024 }));
  runtimes.push({ root, service, store });
  return { store, media, conversationId, service };
}

describe('chat diagnostics integration', () => {
  it('completes a streamed tool call when response.completed has empty output, then preserves history after restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sfxchat-chat-')); let calls = 0; const requests: any[] = [];
    const callArgs = JSON.stringify({ prompt: 'A short bright confirmation chime', count: 1, duration: 1 });
    const call = { type: 'function_call', call_id: 'call-1', name: 'generate_sounds', arguments: callArgs };
    const fetcher: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)); requests.push(request);
      calls++;
      if (calls === 1) return stream({ type: 'response.output_item.added', item: { ...call, arguments: '' } }, { type: 'response.function_call_arguments.delta', call_id: 'call-1', delta: callArgs }, { type: 'response.function_call_arguments.done', call_id: 'call-1', arguments: callArgs }, { type: 'response.output_item.done', item: { ...call, arguments: callArgs } }, { type: 'response.completed', response: { status: 'completed', output: [] } });
      const input = request.input as any[];
      const index = input.findIndex(item => item.type === 'function_call' && item.call_id === 'call-1');
      if (index < 0 || input[index + 1]?.type !== 'function_call_output' || input[index + 1]?.call_id !== 'call-1') return new Response(JSON.stringify({ error: { message: 'No tool call found', code: 'invalid_request', param: 'input' } }), { status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'req-followup' } });
      return stream({ type: 'response.output_text.delta', delta: 'The sound is ready.' }, { type: 'response.completed', response: { status: 'completed', output: [] } });
    };
    let generated = 0;
    const first = setup(fetcher, root, async () => { generated++; return { bytes: audio, requestId: 'gen-1', usage: '1', model: 'test-sfx' }; });
    await first.service.sendMessage(first.conversationId, 'Make a confirmation sound.'); await first.service.idle();
    expect(generated).toBe(1); expect(first.store.assets()).toHaveLength(1); expect(first.store.messages().some(message => message.text.includes('The sound is ready.'))).toBe(true);
    await first.service.shutdown(); first.store.close();
    const second = setup(fetcher, root, async () => { throw new Error('generation must not repeat'); });
    const persisted = second.store.conversations().find(item => item.id === first.conversationId)!;
    await second.service.sendMessage(persisted.id, 'What should I audition next?'); await second.service.idle();
    expect(calls).toBe(3);
    const followupInput = requests[1].input as any[];
    const callIndex = followupInput.findIndex(item => item.type === 'function_call' && item.call_id === 'call-1');
    expect(callIndex).toBeGreaterThanOrEqual(0);
    expect(followupInput[callIndex + 1]).toMatchObject({ type: 'function_call_output', call_id: 'call-1' });
    const resumedInput = requests[2].input as any[];
    expect(resumedInput.some(item => item.type === 'function_call' && item.call_id === 'call-1')).toBe(true);
    expect(resumedInput.some(item => item.type === 'function_call_output' && item.call_id === 'call-1')).toBe(true);
  });

  it('reports a follow-up provider failure with request id and diagnostic reference while retaining completed sounds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sfxchat-chat-failure-')); let calls = 0; let generated = 0;
    const callArgs = JSON.stringify({ prompt: 'A short impact sound', count: 1, duration: 1 });
    const call = { type: 'function_call', call_id: 'call-fail', name: 'generate_sounds', arguments: callArgs };
    const fetcher: typeof fetch = async () => {
      calls++;
      if (calls === 1) return stream({ type: 'response.output_item.added', item: { ...call, arguments: callArgs } }, { type: 'response.output_item.done', item: { ...call, arguments: callArgs } }, { type: 'response.completed', response: { status: 'completed', output: [] } });
      return new Response(JSON.stringify({ error: { message: 'No tool call found; sk-test-echo-secret', code: 'invalid_request', param: 'input' } }), { status: 400, headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' } });
    };
    const { service, store, conversationId } = setup(fetcher, root, async () => { generated++; return { bytes: audio, requestId: 'gen-fail', usage: '1', model: 'test-sfx' }; });
    await service.sendMessage(conversationId, 'Make an impact.'); await service.idle();
    expect(generated).toBe(1); expect(store.assets()).toHaveLength(1);
    const failed = store.messages().find(message => message.status === 'failed' && message.role === 'assistant');
    expect(failed?.text).toContain('Assistant follow-up failed'); expect(failed?.text).toContain('Completed sounds remain'); expect(failed?.text).toContain('req-test'); expect(failed?.text).toContain('Diagnostic reference:');
    const log = readFileSync(join(root, 'logs', 'diagnostics.jsonl'), 'utf8');
    const entries = log.trim().split('\n').map(line => JSON.parse(line));
    const failure = entries.find(entry => entry.event === 'chat.failed');
    expect(failure?.details.conversationId).toBe(conversationId);
    expect(failure?.details.round).toBe(2);
    expect(failure?.details.error.status).toBe(400);
    expect(failure?.details.error.details.requestId).toBe('req-test');
    expect(log).toContain('invalid_request'); expect(log).not.toContain('Make an impact.'); expect(log).not.toContain('sk-test-echo-secret');
  });

  it('repairs an orphaned tool output from the durable ledger without regenerating', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sfxchat-chat-repair-')); const requests: any[] = [];
    const fetcher: typeof fetch = async (_input, init) => { requests.push(JSON.parse(String(init?.body))); return stream({ type: 'response.output_text.delta', delta: 'Recovered.' }, { type: 'response.completed', response: { status: 'completed', output: [] } }); };
    let generated = 0; const setupResult = setup(fetcher, root, async () => { generated++; throw new Error('must not generate'); });
    const callId = 'orphan-call'; const args = JSON.stringify({ prompt: 'already generated', count: 1, duration: 1 });
    setupResult.store.beginTool(callId, setupResult.conversationId, 'generate_sounds', args); setupResult.store.finishTool(callId, JSON.stringify({ jobIds: [], jobs: [], assets: [] }));
    setupResult.store.setSetting(`history/${setupResult.conversationId}`, JSON.stringify([{ type: 'function_call_output', call_id: callId, output: '{}' }]));
    await setupResult.service.sendMessage(setupResult.conversationId, 'Continue.'); await setupResult.service.idle();
    expect(generated).toBe(0); expect(setupResult.store.messages().some(message => message.text.includes('Recovered.'))).toBe(true);
    const repairedInput = requests[0].input as any[];
    expect(repairedInput).toContainEqual({ type: 'function_call', call_id: callId, name: 'generate_sounds', arguments: args });
    expect(repairedInput).toContainEqual({ type: 'function_call_output', call_id: callId, output: '{}' });
  });
});
