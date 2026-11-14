import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Electron still owns SQLite, safeStorage and providers; no native UI is created.
// The electron package exports its platform's executable path.
const child = spawn(createRequire(import.meta.url)('electron'), [resolve('.')], {
  env: { ...process.env, SFXCHAT_BROWSER: '1' }, stdio: ['inherit', 'pipe', 'inherit'], windowsHide: true
});
let origin, output = '', stopping = false;
child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  output = (output + chunk).slice(-2048);
  origin = output.match(/SfxChat browser: (http:\/\/127\.0\.0\.1:\d+)/)?.[1] ?? origin;
});
child.on('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return; stopping = true;
  if (!origin) { child.kill(); return; }
  void fetch(origin + '/shutdown', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })
    .catch(error => { process.stderr.write(`Browser shutdown failed: ${error.message}\n`); child.kill(); });
});
