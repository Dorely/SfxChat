import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { Store } from './store';
import { MediaLibrary } from './media';
import { WorkbenchService, type ServicePorts } from './service';
import { SecureStore } from './providers/secrets';
import { CodexAuth } from './providers/auth';
import { CodexClient, DEFAULT_MODEL } from './providers/codex';
import { ElevenLabsClient } from './providers/elevenlabs';
import { commandSchemas, idSchema } from './validation';
import { mockPorts } from './testing';
import { DiagnosticLog, redactText } from './diagnostics';
import { diagnosticError } from './providers/errors';

protocol.registerSchemesAsPrivileged([{ scheme: 'sfx-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.setName('SfxChat');
app.setPath('userData', join(app.getPath('appData'), 'SfxChat'));
const testMode = !app.isPackaged && process.env.SFXCHAT_TEST_MODE === '1';
if (testMode && process.env.SFXCHAT_TEST_DATA) app.setPath('userData', process.env.SFXCHAT_TEST_DATA);
let window: BrowserWindow | null = null;
let service: WorkbenchService | null = null;
let auth: CodexAuth | null = null;
let quitting = false;
let eventTimer: ReturnType<typeof setTimeout> | null = null;
const diagnostics = new DiagnosticLog(app.getPath('userData'));
const changed = () => {
  if (eventTimer) return;
  eventTimer = setTimeout(() => { eventTimer = null; if (window && !window.isDestroyed()) window.webContents.send('sfx:changed'); }, 40);
};
function safeError(error: unknown) {
  // Never surface upstream payloads, headers or arbitrary diagnostic objects.
  const text = error instanceof Error ? error.message : 'Operation failed.';
  return redactText(text);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  void app.whenReady().then(async () => {
    const root = app.getPath('userData'); await mkdir(root, { recursive: true });
    diagnostics.record('app.started', { version: app.getVersion(), packaged: app.isPackaged });
    const store = new Store(join(root, 'library.sqlite'), changed);
    const media = new MediaLibrary(join(root, 'originals'));
    const secrets = new SecureStore({ directory: join(root, 'secrets'), encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value), isAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text') });
    auth = new CodexAuth({ store: secrets, openExternal: url => shell.openExternal(url), onChange: status => { if (status.error) diagnostics.record('auth.failed', { message: status.error }); changed(); } });
    let credentialError: string | null = null;
    try { await auth.initialize(); } catch (error) { credentialError = safeError(error); }
    const codex = new CodexClient(); const eleven = new ElevenLabsClient();
    const model = () => store.setting('chat-model', DEFAULT_MODEL);
    const livePorts: ServicePorts = {
      settings: async () => {
        let elevenLabsReady = false;
        try { elevenLabsReady = Boolean(await secrets.get('elevenlabs')); } catch (error) { credentialError = safeError(error); }
        return { codexReady: auth!.status.ready, loginPending: auth!.status.pending, elevenLabsReady, secureStorageAvailable: await secrets.available(), model: model(), error: auth!.status.error ?? credentialError };
      },
      chat: async options => codex.streamChat({ ...options, token: await auth!.getAccessToken(), signal: AbortSignal.any([options.signal, AbortSignal.timeout(180_000)]) }),
      generate: async (input, signal) => { const key = await secrets.get('elevenlabs'); if (!key) throw new Error('Add your ElevenLabs API key in Settings first.'); return eleven.generateSound(input, key, AbortSignal.any([signal, AbortSignal.timeout(180_000)])); },
      safeError
    };
    service = new WorkbenchService(store, media, testMode ? mockPorts(process.env.SFXCHAT_TEST_AUDIO ?? '', model) : livePorts, changed, diagnostics);
    store.recover(); if (!store.conversations().length) store.createConversation();

    protocol.handle('sfx-media', async request => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'asset' || request.method !== 'GET') return new Response(null, { status: 404 });
        const id = idSchema.parse(url.pathname.slice(1)); const asset = store.asset(id);
        const bytes = await readFile(media.path(asset));
        const headers: Record<string, string> = { 'content-type': asset.format === 'mp3' ? 'audio/mpeg' : 'audio/wav', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'cache-control': 'private, max-age=31536000, immutable' };
        const range = request.headers.get('range');
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 });
          const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
          const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
          if (start > end || start >= bytes.length) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${bytes.length}` } });
          return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': String(end - start + 1) } });
        }
        return new Response(new Uint8Array(bytes), { headers: { ...headers, 'content-length': String(bytes.length) } });
      } catch { return new Response(null, { status: 404 }); }
    });

    const handlers: Record<string, (...args: any[]) => unknown> = {
      snapshot: () => service!.snapshot(), createConversation: () => store.createConversation(),
      openLogs: async () => { const directory = join(root, 'logs'); await mkdir(directory, { recursive: true }); const error = await shell.openPath(directory); if (error) throw new Error(error); },
      sendMessage: (id, text) => service!.sendMessage(id, text), cancelTurn: id => service!.cancelTurn(id),
      generate: (id, input) => service!.generate(id, input).then(() => undefined), cancelJob: id => service!.cancelJob(id),
      updateAsset: (id, patch, conversationId) => service!.updateAsset(id, patch, conversationId),
      analyzeAudio: (id, input) => service!.analyzeAudio(id, input), trimAsset: (conversationId, id, input) => service!.trimAsset(conversationId, id, input),
      previewTrim: (id, input) => service!.previewTrim(id, input),
      setPlayground: (id, ids) => { store.setPlayground(id, ids); store.addMessage(id, 'tool', 'Updated the comparison playground.'); },
      searchAssets: query => store.search(query),
      importAudio: async id => {
        const result = await dialog.showOpenDialog(window!, { title: 'Import sounds', filters: [{ name: 'Audio', extensions: ['wav', 'mp3'] }], properties: ['openFile', 'multiSelections'] });
        if (!result.canceled) await service!.importFiles(id, result.filePaths);
      },
      exportAsset: async id => {
        const asset = store.asset(id);
        const result = await dialog.showSaveDialog(window!, { title: 'Export original audio', defaultPath: `${asset.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.${asset.format}`, filters: [{ name: 'Original audio', extensions: [asset.format] }] });
        if (!result.canceled && result.filePath) await media.export(asset, result.filePath);
      },
      startLogin: () => auth!.startLogin(), cancelLogin: () => auth!.cancelLogin(), logout: () => auth!.logout(),
      saveElevenLabsKey: async key => { if (key.trim()) await secrets.set('elevenlabs', key.trim()); else await secrets.delete('elevenlabs'); credentialError = null; changed(); },
      saveModel: value => store.setSetting('chat-model', value)
    };
    ipcMain.handle('sfx:call', async (event, method: unknown, rawArgs: unknown) => {
      if (quitting) throw new Error('SfxChat is closing.');
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted application request.');
      if (typeof method !== 'string' || !Object.hasOwn(commandSchemas, method)) throw new Error('Unknown application operation.');
      const parsed = commandSchemas[method as keyof typeof commandSchemas].safeParse(rawArgs);
      if (!parsed.success) throw new Error('Invalid operation arguments.');
      try { return await handlers[method](...parsed.data); } catch (error) {
        const reference = diagnostics.record('operation.failed', { method, error: diagnosticError(error) });
        throw new Error(`${safeError(error)}${reference ? `\nDiagnostic reference: ${reference}. Open Settings → Open diagnostic logs for details.` : ''}`);
      }
    });
    window = new BrowserWindow({ width: 1440, height: 940, minWidth: 1000, minHeight: 650, title: 'SfxChat', backgroundColor: '#191b19', show: false, webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('render-process-gone', (_event, details) => diagnostics.record('renderer.stopped', { reason: details.reason, exitCode: details.exitCode }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.on('ready-to-show', () => window?.show());
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (!app.isPackaged && devUrl) await window.loadURL(devUrl); else await window.loadFile(join(__dirname, '../renderer/index.html'));
    service.pump();
  }).catch(error => { diagnostics.record('app.start_failed', { error: diagnosticError(error) }); dialog.showErrorBox('SfxChat could not start', safeError(error)); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return; event.preventDefault(); quitting = true;
    void Promise.all([service?.shutdown(), auth?.cancelLogin()]).finally(() => { if (eventTimer) clearTimeout(eventTimer); service?.store.close(); app.quit(); });
  });
}
