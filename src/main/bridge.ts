import { createServer, type Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { native } from '../shared/native';
import { WorkbenchError, type OperationResponse } from '../shared/workbench';
import type { Operations } from './operations';
import { operationCatalog } from './operations';
import { redactText } from './diagnostics';

export function operationError(error: unknown): OperationResponse {
  const known = error instanceof WorkbenchError;
  return { ok: false, error: { code: known ? error.code : 'OPERATION_FAILED', message: redactText(error instanceof Error ? error.message : 'Operation failed.'), ...(known && error.details ? { details: error.details } : {}) } };
}
export async function startBridge(root: string, helper: string, operations: Operations) {
  const directory = join(root, 'bridge'); await mkdir(directory, { recursive: true });
  await native(helper, ['secure-directory', directory]);
  const token = randomBytes(32).toString('hex');
  const pipe = `\\\\.\\pipe\\sfxchat-${randomBytes(32).toString('hex')}`;
  const clients = new Set<Socket>();
  let closing = false;
  const server = createServer(socket => {
    clients.add(socket); socket.setEncoding('utf8'); socket.setTimeout(60000, () => socket.destroy());
    socket.on('error', () => {}); socket.on('close', () => clients.delete(socket));
    let buffer = '', accepted = false;
    socket.on('data', data => {
      if (accepted) { socket.destroy(); return; }
      buffer += data;
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) { socket.destroy(); return; }
      const end = buffer.indexOf('\n'); if (end < 0) return;
      accepted = true;
      void (async () => {
        try {
          const message = JSON.parse(buffer.slice(0, end));
          const supplied = Buffer.from(typeof message.token === 'string' ? message.token : '');
          if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) throw new WorkbenchError('UNAUTHORIZED', 'Invalid local bridge authentication.');
          if (closing) throw new WorkbenchError('CLOSING', 'SfxChat is closing.');
          const result = message.operation === 'tools' ? operationCatalog() : await operations.call(message.operation, message.args ?? {});
          if (!socket.destroyed) socket.end(JSON.stringify({ ok: true, result }) + '\n');
        } catch (e) { if (!socket.destroyed) socket.end(JSON.stringify(operationError(e)) + '\n'); }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(pipe, () => { server.off('error', reject); resolve(); }); });
  server.on('error', () => {});
  const discoveryPath = join(directory, 'endpoint.bin');
  try {
    const encrypted = await native(helper, ['protect'], Buffer.from(JSON.stringify({ version: 1, pipe, token, pid: process.pid })));
    await writeFile(discoveryPath + '.partial', encrypted); await rename(discoveryPath + '.partial', discoveryPath);
  } catch (e) { server.close(); throw e; }
  return { async close() { closing = true; await unlink(discoveryPath).catch(() => {}); for (const socket of clients) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
