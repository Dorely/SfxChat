import { connect } from 'node:net';
import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { setTimeout as delay } from 'node:timers/promises';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { native } from '../shared/native';
import { installIntegration, skillText } from '../shared/install';
import { WorkbenchError, type OperationResponse, type ReviewBoard } from '../shared/workbench';

const helper = join(__dirname, 'sfxchat-helper.exe');
const root = join(process.env.APPDATA || '', 'SfxChat');
async function discovery() {
  const bytes = await native(helper, ['unprotect'], await readFile(join(root, 'bridge', 'endpoint.bin')));
  const value = JSON.parse(bytes.toString());
  if (value.version !== 1 || !/^\\\\\.\\pipe\\sfxchat-[a-f0-9]{64}$/.test(value.pipe) || !/^[a-f0-9]{64}$/.test(value.token)) throw new Error('Invalid bridge discovery.');
  return value as { pipe: string; token: string };
}
async function startApp() {
  const packaged = resolve(__dirname, '../../SfxChat.exe');
  let command = packaged, args: string[] = [];
  try { await access(packaged); } catch {
    const repository = resolve(__dirname, '../..');
    command = join(repository, 'node_modules/electron/dist/electron.exe'); args = [repository];
    try { await access(command); } catch { throw new WorkbenchError('APP_NOT_FOUND', 'Install the SfxChat desktop app with its bundled CLI.'); }
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
}
async function endpoint() {
  try { const e = await discovery(); await exchange(e, 'status', {}); return e; } catch { /* absent or stale: start the owning app once */ }
  await startApp();
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    try { const e = await discovery(); await exchange(e, 'status', {}); return e; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new WorkbenchError('APP_UNAVAILABLE', 'SfxChat did not start its local bridge. Open the app and inspect its diagnostic logs.');
}
function exchange(e: { pipe: string; token: string }, operation: string, args: unknown, signal?: AbortSignal): Promise<OperationResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const socket = connect(e.pipe); let buffer = '';
    const abort = () => { socket.destroy(); reject(signal?.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    socket.once('close', () => signal?.removeEventListener('abort', abort));
    socket.setEncoding('utf8'); socket.setTimeout(180000, () => { socket.destroy(); reject(new WorkbenchError('TIMEOUT', 'Request timed out. Inspect existing jobs before resubmitting.')); });
    socket.on('connect', () => socket.write(JSON.stringify({ token: e.token, operation, args }) + '\n'));
    socket.on('error', reject);
    socket.on('data', data => { buffer += data; if (Buffer.byteLength(buffer) > 32 * 1024 * 1024) { socket.destroy(); reject(new Error('Bridge response exceeds 32 MiB.')); } });
    socket.on('end', () => { try { const response = JSON.parse(buffer); resolve(response); } catch { reject(new WorkbenchError('CONNECTION_LOST', 'Connection closed without a result. Do not repeat paid work with a new request ID.')); } });
  });
}
async function call(operation: string, args: unknown = {}) { return exchange(await endpoint(), operation, args); }
function argsFrom(argv: string[]) {
  const positional: string[] = [], flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { positional.push(argv[i]); continue; }
    const key = argv[i].slice(2); const value = argv[i+1] && !argv[i+1].startsWith('--') ? argv[++i] : 'true';
    (flags[key] ??= []).push(value);
  }
  return { positional, flags };
}
async function main() {
  const { positional, flags } = argsFrom(process.argv.slice(2)); const [command, name] = positional;
  const installation = ['skill', 'install', 'uninstall'].includes(command);
  const allowed = new Set(installation ? ['scope', 'target', 'project', 'directory', 'mcp', 'dry-run', 'force', 'help'] : ['input', 'json', 'help']);
  for (const [key, values] of Object.entries(flags)) {
    if (!allowed.has(key) || (key !== 'target' && values.length !== 1)) throw new WorkbenchError('INVALID_ARGUMENTS', `Unknown or repeated option: --${key}`);
    if (['mcp', 'dry-run', 'force', 'help'].includes(key) ? values[0] !== 'true' : values.some(v => v === 'true')) throw new WorkbenchError('INVALID_ARGUMENTS', `Invalid value for --${key}`);
  }
  if (positional.length > (['call', 'skill'].includes(command) ? 2 : 1)) throw new WorkbenchError('INVALID_ARGUMENTS', 'Unexpected positional arguments.');
  if (command === 'mcp') {
    const catalogResult = await call('tools');
    if (!catalogResult.ok) throw new Error(catalogResult.error?.message);
    const catalog = catalogResult.result as { name: string; description: string; inputSchema: Record<string, unknown> }[];
    serveStdio(({ era }) => {
      const server = new McpServer({ name: 'sfxchat', version: '0.2.0' }, { capabilities: { resources: { subscribe: true } } });
      const watches = new Map<string, AbortController>(), subscribed = new Set<string>();
      let closed = false;
      const uriFor = (r: ReviewBoard) => `sfxchat://projects/${r.projectId}/sessions/${r.sessionId}/reviews/${r.id}`;
      const watch = (initial: ReviewBoard) => {
        const uri = uriFor(initial);
        if (closed || watches.has(uri)) return;
        // Bound idle connection state; durable get/wait remains available for every review.
        if (watches.size >= 128) { const oldest = watches.keys().next().value!; watches.get(oldest)!.abort(); watches.delete(oldest); subscribed.delete(oldest); }
        const controller = new AbortController(); watches.set(uri, controller);
        void (async () => {
          let revision = initial.revision, backoff = 1000;
          while (!controller.signal.aborted) {
            try {
              // Discovery only: background observation never launches the desktop.
              const response = await exchange(await discovery(), 'review_wait', { projectId: initial.projectId, sessionId: initial.sessionId, reviewId: initial.id, afterRevision: revision, timeoutMs: 30000 }, controller.signal);
              if (!response.ok) throw new Error(response.error?.message);
              const current = response.result as ReviewBoard;
              if (current.revision !== revision) {
                if (era === 'modern' || subscribed.has(uri)) await server.server.sendResourceUpdated({ uri });
                revision = current.revision;
              }
              backoff = 1000;
            } catch {
              if (controller.signal.aborted) break;
              await delay(backoff, undefined, { signal: controller.signal }).catch(() => {});
              backoff = Math.min(backoff * 2, 30000);
            }
          }
        })();
      };
      const readReview = async (uri: string) => {
        const match = /^sfxchat:\/\/projects\/([^/]+)\/sessions\/([^/]+)\/reviews\/([^/]+)$/.exec(uri);
        if (!match) throw new Error('Invalid review resource URI.');
        const response = await call('review_get', { projectId: match[1], sessionId: match[2], reviewId: match[3] });
        if (!response.ok) throw new Error(response.error?.message);
        const review = response.result as ReviewBoard; watch(review); return review;
      };
      server.server.onclose = () => { closed = true; for (const controller of watches.values()) controller.abort(); watches.clear(); subscribed.clear(); };
      if (era === 'legacy') {
        server.server.setRequestHandler('resources/subscribe', async request => { await readReview(request.params.uri); subscribed.add(request.params.uri); return {}; });
        server.server.setRequestHandler('resources/unsubscribe', async request => { subscribed.delete(request.params.uri); return {}; });
      }
      server.registerResource('review', new ResourceTemplate('sfxchat://projects/{projectId}/sessions/{sessionId}/reviews/{reviewId}', { list: undefined }), { mimeType: 'application/json', description: 'Review status, completion attribution, choices and feedback. Subscribe for saved changes; review_wait works without notifications.' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await readReview(uri.href)) }] }));
      for (const item of catalog) server.registerTool(item.name, { description: item.description, inputSchema: z.fromJSONSchema(item.inputSchema) as z.ZodObject<any> }, async (args: unknown) => {
        const response = await call(item.name, args);
        if (!response.ok) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(response.error) }] };
        const result = response.result as any;
        if (item.name.startsWith('review_') && result?.id && result?.revision) watch(result as ReviewBoard);
        if (item.name === 'review_open') {
          const current = await call('review_get', args);
          if (current.ok) watch(current.result as ReviewBoard);
        }
        const content: any[] = [];
        if (result?.media) content.push(result.media);
        if (item.name.startsWith('review_') && result?.id && result?.revision) content.push({ type: 'resource_link', uri: uriFor(result), name: result.title, mimeType: 'application/json', description: `Review ${result.status}; subscribe for saved changes.` });
        const lean = result?.media ? { ...result, media: { type: result.media.type, mimeType: result.media.mimeType } } : result;
        content.unshift({ type: 'text', text: JSON.stringify(lean) });
        return { content, structuredContent: { result: lean } };
      });
      server.registerResource('guidance', 'sfxchat://guidance', { mimeType: 'application/json', description: 'Full current design guidance and provider capabilities.' }, async () => ({ contents: [{ uri: 'sfxchat://guidance', mimeType: 'application/json', text: JSON.stringify(await call('guidance')) }] }));
      return server;
    });
    return;
  }
  if (command === 'skill' && !name) { process.stdout.write(skillText); return; }
  if (command === 'skill' || command === 'install' || command === 'uninstall') {
    const action = (command === 'skill' ? name : command) as 'install' | 'uninstall' | 'status';
    const result = await installIntegration({ action, scope: flags.scope?.[0] as 'project' | 'user', targets: flags.target as ('codex' | 'claude')[] ?? [], projectDirectory: flags.project?.[0] ? resolve(flags.project[0]) : undefined, directory: flags.directory?.[0] ? resolve(flags.directory[0]) : undefined, skill: true, mcp: !!flags.mcp, dryRun: !!flags['dry-run'], force: !!flags.force }, process.execPath, join(__dirname, 'cli.cjs'));
    output({ ok: true, result }); return;
  }
  if (!command || command === 'help' || flags.help) {
    output({ ok: true, result: { commands: ['status', 'tools', 'guidance', 'call <operation> --input <file.json> | --json <JSON>', 'mcp', 'skill', 'skill install|uninstall|status --scope project|user --target codex|claude [--project <absolute-directory>] [--directory <skills-parent>] [--mcp] [--dry-run] [--force]'], note: 'Generation returns durable IDs. All scoped operations require project/session IDs. App starts on demand. No provider credentials are accepted by this CLI.' } }); return;
  }
  if (command === 'call' && !name) throw new WorkbenchError('INVALID_ARGUMENTS', 'Specify an operation; run sfxchat tools for schemas.');
  if (flags.input && flags.json) throw new WorkbenchError('INVALID_ARGUMENTS', 'Use either --input or --json.');
  const raw = flags.input ? await readFile(resolve(flags.input[0]), 'utf8') : flags.json?.[0] ?? '{}';
  const result = await call(command === 'call' ? name : command, JSON.parse(raw)); output(result);
}
function output(response: OperationResponse) { process.stdout.write(JSON.stringify(response) + '\n'); if (!response.ok) process.exitCode = 1; }
main().catch(error => { const response: OperationResponse = { ok: false, error: { code: error instanceof WorkbenchError ? error.code : 'CLI_FAILED', message: error instanceof Error ? error.message : 'CLI failed.' } }; if (process.argv[2] === 'mcp') { process.stderr.write(JSON.stringify(response) + '\n'); process.exitCode = 1; } else output(response); });
