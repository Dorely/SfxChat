// Development-only deterministic providers for Electron integration tests.
// The entrypoint refuses this mode in packaged builds.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ServicePorts } from './service';
export function mockPorts(audioPath: string, model: () => string): ServicePorts {
  return {
    settings: async () => ({ codexReady: true, elevenLabsReady: true, secureStorageAvailable: true, loginPending: false, model: model(), error: null, chatModels: [], activeChat: { modelId: `codex:${model()}`, effort: 'medium' }, providers: [] }),
    safeError: error => error instanceof Error ? error.message : 'Operation failed.',
    generate: async (_input, signal) => {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 100); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Cancelled')); }, { once: true }); });
      return { bytes: await readFile(audioPath), requestId: 'mock-request', model: 'mock-sfx', usage: '0' };
    },
    chat: async ({ input, onText, signal }) => {
      if (signal.aborted) throw new Error('Cancelled');
      const last = input.at(-1) as { role?: string; content?: { text: string }[]; type?: string };
      if (last?.role === 'user' && /generate|make|create/i.test(last.content?.[0]?.text ?? '')) {
        const call = { id: `mock-${randomUUID()}`, name: 'generate_sounds', arguments: JSON.stringify({ prompt: 'A short bright UI confirmation chime', count: 2, duration: 1 }) };
        return { calls: [call], output: [{ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments }] };
      }
      const text = last?.type === 'function_call_output' ? 'Two candidates are ready. Audition them in the playground and tell me which direction fits.' : 'Describe a sound, and we can create and compare a few ideas.';
      onText(text);
      return { calls: [], output: [{ role: 'assistant', content: [{ type: 'output_text', text }] }] };
    }
  };
}
