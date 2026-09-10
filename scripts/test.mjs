import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Use Electron's Node runtime so tests and packaged SQLite share the same ABI.
const result = spawnSync(require('electron'), ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
