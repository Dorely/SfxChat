import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/main/store';

const roots: string[] = [];
const stores: Store[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function storeWithConversation() {
  const root = await fs.mkdtemp(join(tmpdir(), 'sfxchat-history-repair-'));
  roots.push(root);
  const store = new Store(join(root, 'library.sqlite'));
  stores.push(store);
  return { store, conversationId: store.createConversation() };
}

describe('Store.repairToolHistory', () => {
  it('leaves normal history unchanged', async () => {
    const { store, conversationId } = await storeWithConversation();
    const input = [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }, { type: 'message', content: [{ type: 'output_text', text: 'hi' }] }];

    const result = store.repairToolHistory(conversationId, input);

    expect(result).toEqual({ input, restoredCallIds: [] });
    expect(result.input).not.toBe(input);
  });

  it('restores an orphaned call from the exact conversation ledger without changing jobs or output', async () => {
    const { store, conversationId } = await storeWithConversation();
    const args = '{"prompt":"glass crack","count":2}';
    store.beginTool('call-orphan', conversationId, 'generate_sounds', args);
    store.finishTool('call-orphan', '{"jobIds":["job-1"]}');
    const jobsBefore = store.jobs();
    const output = { type: 'function_call_output', call_id: 'call-orphan', output: '{"jobIds":["job-1"]}' };
    const input = [{ role: 'user', content: 'make a sound' }, output];

    const result = store.repairToolHistory(conversationId, input);

    expect(result.restoredCallIds).toEqual(['call-orphan']);
    expect(result.input).toEqual([
      input[0],
      { type: 'function_call', call_id: 'call-orphan', name: 'generate_sounds', arguments: args },
      output,
    ]);
    expect(result.input[2]).toBe(output);
    expect(store.jobs()).toEqual(jobsBefore);
    expect((store.db.prepare('SELECT status,result FROM tool_calls WHERE id=?').get('call-orphan') as { status: string; result: string }).result).toBe('{"jobIds":["job-1"]}');
  });

  it('does not use a ledger row belonging to another conversation', async () => {
    const { store, conversationId } = await storeWithConversation();
    const otherConversationId = store.createConversation();
    store.beginTool('call-cross-conversation', otherConversationId, 'search_assets', '{"query":"rain"}');
    store.finishTool('call-cross-conversation', '[]');

    expect(() => store.repairToolHistory(conversationId, [{ type: 'function_call_output', call_id: 'call-cross-conversation', output: '[]' }])).toThrow(/no durable tool call ledger entry/i);
  });

  it('fails with an actionable error when the ledger entry is missing', async () => {
    const { store, conversationId } = await storeWithConversation();

    expect(() => store.repairToolHistory(conversationId, [{ type: 'function_call_output', call_id: 'call-missing', output: '{"error":"old result"}' }])).toThrow(/Restore the original tool call record.*provider response/i);
  });

  it('keeps an existing preceding call and does not restore a duplicate', async () => {
    const { store, conversationId } = await storeWithConversation();
    store.beginTool('call-present', conversationId, 'search_assets', '{"query":"rain"}');
    store.finishTool('call-present', '[]');
    const input = [
      { type: 'function_call', call_id: 'call-present', name: 'search_assets', arguments: '{"query":"rain"}' },
      { type: 'function_call_output', call_id: 'call-present', output: '[]' },
    ];

    expect(store.repairToolHistory(conversationId, input)).toEqual({ input, restoredCallIds: [] });
  });
});
