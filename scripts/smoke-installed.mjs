import { _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const executablePath = process.argv[2];
if (!executablePath) throw new Error('Pass the installed SfxChat.exe path.');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// Intentionally request mock mode: packaged code must refuse it.
env.SFXCHAT_TEST_MODE = '1';
env.SFXCHAT_TEST_DATA = resolve('.tmp', 'must-not-use-packaged-profile');
const instance = await electron.launch({ executablePath, env });
try {
  const page = await instance.firstWindow();
  await page.locator('.app-shell').waitFor();
  const info = await instance.evaluate(({ app, safeStorage }) => ({ packaged: app.isPackaged, data: app.getPath('userData'), secureStorageAvailable: safeStorage.isEncryptionAvailable() }));
  if (!info.packaged || info.data === env.SFXCHAT_TEST_DATA) throw new Error('Packaged environment isolation failed.');
  const snapshot = await page.evaluate(() => window.sfx.snapshot());
  if (!snapshot.conversations.length) throw new Error('Native SQLite initialization failed.');
  await mkdir(resolve('.tmp'), { recursive: true });
  await page.screenshot({ path: resolve('.tmp', 'installed.png') });
  console.log(JSON.stringify({ ...info, conversations: snapshot.conversations.length, assets: snapshot.assets.length, settings: snapshot.settings }, null, 2));
} finally { await instance.close(); }
