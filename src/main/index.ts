import { Operations } from './operations';
import { startBrowserHost } from './browser-host';
import { Exporter } from './exporter';
import { startBridge, operationError } from './bridge';
import { RendererPort } from './ui-port';
import { installIntegration } from '../shared/install';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { Store } from './store';
import { MediaLibrary } from './media';
import { decodeAudio, renderClip } from './audio';
import { MidiRenderer } from './midi-render';
import { loadSoundfont } from './soundfont';
import { midiDurationSeconds } from '../shared/midi';
import { WorkbenchService, type ServicePorts } from './service';
import { SecureStore } from './providers/secrets';
import { CodexAuth } from './providers/auth';
import { CodexClient, DEFAULT_MODEL } from './providers/codex';
import { resolveChatModel } from '../shared/chat-models';
import { ElevenLabsClient } from './providers/elevenlabs';
import { ElevenLabsMusicClient } from './providers/elevenlabs-music';
import { GeminiMusicClient } from './providers/gemini-music';
import { ChatRegistry } from './chat-registry';
import { MusicRegistry } from './music-registry';
import { ProviderKeys } from './provider-keys';
import { VoiceRegistry } from './voice-registry';
import { VoiceClient } from './providers/voice';
import { AnthropicClient } from './providers/generic/anthropic';
import { ChatCompletionsClient, toChatMessages, toResponsesOutput } from './providers/generic/chat';
import { GenericResponsesClient } from './providers/generic/responses';
import { capabilityNote, toolsForModel } from './providers/generic/capabilities';
import { tools } from './assistant';
import { commandSchemas, idSchema } from './validation';
import { DiagnosticLog, redactText } from './diagnostics';
import { diagnosticError } from './providers/errors';

protocol.registerSchemesAsPrivileged([{ scheme: 'sfx-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.setName('SfxChat');
app.setPath('userData', join(app.getPath('appData'), 'SfxChat'));
const browserMode = !app.isPackaged && process.env.SFXCHAT_BROWSER === '1';
let browserHost: Awaited<ReturnType<typeof startBrowserHost>> | null = null;
let window: BrowserWindow | null = null;
let service: WorkbenchService | null = null;
let auth: CodexAuth | null = null;
let quitting = false;
let operations: Operations | null = null;
let bridge: Awaited<ReturnType<typeof startBridge>> | null = null;
let rendererPort: RendererPort | null = null;
let eventTimer: ReturnType<typeof setTimeout> | null = null;
const diagnostics = new DiagnosticLog(app.getPath('userData'));
const changed = () => {
  if (eventTimer) return;
  eventTimer = setTimeout(() => { eventTimer = null; if (window && !window.isDestroyed()) window.webContents.send('sfx:changed'); browserHost?.changed(); }, 40);
};
function safeError(error: unknown) {
  // Never surface upstream payloads, headers or arbitrary diagnostic objects.
  const text = error instanceof Error ? error.message : 'Operation failed.';
  return redactText(text);
}
function bytesResponse(bytes: Buffer, contentType: string, request: Request): Response {
  const headers: Record<string, string> = { 'content-type': contentType, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'cache-control': 'private, max-age=31536000, immutable' };
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
}
if (!app.requestSingleInstanceLock()) { if (browserMode) { process.stderr.write('Close the existing SfxChat owner before starting browser development.\n'); app.exit(1); } else app.quit(); }
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  void app.whenReady().then(async () => {
    const root = app.getPath('userData'); await mkdir(root, { recursive: true });
    diagnostics.record('app.started', { version: app.getVersion(), packaged: app.isPackaged });
    const store = new Store(join(root, 'library.sqlite'), changed);
    const media = new MediaLibrary(join(root, 'originals'), join(root, 'chat-media'));
    const secrets = new SecureStore({ directory: join(root, 'secrets'), encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value), isAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text') });
    auth = new CodexAuth({ store: secrets, openExternal: url => shell.openExternal(url), onChange: status => { if (status.error) diagnostics.record('auth.failed', { message: status.error }); changed(); } });
    let credentialError: string | null = null;
    try { await auth.initialize(); } catch (error) { credentialError = safeError(error); }
    const codex = new CodexClient(); const eleven = new ElevenLabsClient();
    const elevenMusic = new ElevenLabsMusicClient(); const geminiMusic = new GeminiMusicClient();
    const providerKeys = new ProviderKeys(store, secrets);
    const registry = new ChatRegistry(store, secrets, providerKeys);
    const music = new MusicRegistry(store, providerKeys);
    const voice = new VoiceRegistry(store, providerKeys);
    const voiceClient = new VoiceClient();
    const model = () => resolveChatModel(store.setting('chat-model', DEFAULT_MODEL));
    const livePorts: ServicePorts = {
      settings: async () => {
        let keys: import('../shared/types').ProviderKeyStatus[] = [];
        try { keys = await providerKeys.status(); } catch (error) { credentialError = safeError(error); }
        const elevenLabsReady = keys.find(k => k.id === 'elevenlabs')?.ready ?? false;
        const geminiReady = keys.find(k => k.id === 'gemini')?.ready ?? false;
        const active = registry.activeSelection();
        return { codexReady: auth!.status.ready, loginPending: auth!.status.pending, elevenLabsReady, geminiReady, providerKeys: keys, voiceProviders: await voice.entries(keys), activeVoiceId: voice.activeId(), secureStorageAvailable: await secrets.available(), model: model(), error: auth!.status.error ?? credentialError, chatModels: registry.options(), activeChat: active, providers: registry.providers(), musicProviders: await music.entries(keys), activeMusicId: music.activeId() };
      },
      chat: async options => {
        const target = await registry.resolveActive();
        const timeout = AbortSignal.timeout(180_000);
        const signal = AbortSignal.any([options.signal, timeout]);
        if (target.kind === 'codex') {
          const filtered = toolsForModel({ vision: true, audio: true }, tools) as unknown[];
          return codex.streamChat({ model: target.slug, input: options.input, instructions: options.instructions, tools: filtered, effort: target.effort, token: await auth!.getAccessToken(), signal, onText: options.onText });
        }
        const key = target.provider ? await registry.providerKey(target.provider.id) : null;
        const filtered = toolsForModel(target.record ?? { vision: true, audio: true }, tools) as unknown[];
        const note = target.record ? capabilityNote(target.record) : '';
        const instructions = note ? `${options.instructions}\n${note}` : options.instructions;
        if (target.kind === 'anthropic') {
          const maxTokens = target.record?.maxTokens ?? 8192;
          return new AnthropicClient({ baseUrl: target.provider!.baseUrl, apiKey: key }).streamChat({ model: target.slug, input: options.input, instructions, tools: filtered, maxTokens, signal, onText: options.onText });
        }
        if (target.kind === 'responses') {
          return new GenericResponsesClient({ baseUrl: target.provider!.baseUrl, apiKey: key }).streamChat({ model: target.slug, input: options.input, instructions, tools: filtered, effort: target.effort || undefined, signal, onText: options.onText });
        }
        const result = await new ChatCompletionsClient({ baseUrl: target.provider!.baseUrl, apiKey: key }).streamChat({ model: target.slug, messages: toChatMessages(options.input, instructions), tools: filtered, effort: target.effort || undefined, signal, onText: options.onText });
        return { output: toResponsesOutput(result.text, result.calls), calls: result.calls, usage: result.usage, requestId: result.requestId };
      },
      generateEffect: async (input, signal) => {
        const key = await providerKeys.get('elevenlabs');
        if (!key) throw new Error('Add your ElevenLabs API key in Settings first.');
        const result = await eleven.generateSound(input, key, AbortSignal.any([signal, AbortSignal.timeout(180_000)]));
        return { ...result, format: 'mp3' as const, provider: 'ElevenLabs' };
      },
      generateMusic: async (input, signal) => {
        // The provider, model, and key resolve here rather than in tool arguments or the
        // renderer; every capability uses the one shared vendor key.
        const target = await music.resolve(input.providerId);
        const timeout = AbortSignal.any([signal, AbortSignal.timeout(600_000)]);
        if (target.provider.kind === 'elevenlabs-music') {
          const result = await elevenMusic.compose(input, target.model, target.key, timeout);
          return { ...result, provider: target.provider.label };
        }
        const result = await geminiMusic.compose(input, target.model, target.key, timeout);
        return { ...result, provider: target.provider.label };
      },
      generateVoice: async (input, signal) => {
        if (!input.providerId) throw new Error('Queued voice request has no resolved provider.');
        const key = await providerKeys.get(input.providerId);
        if (!key) throw new Error('Save the shared provider API key in Settings first.');
        return voiceClient.generate(input, key, AbortSignal.any([signal, AbortSignal.timeout(600_000)]));
      },
      listVoices: async input => {
        const key = await providerKeys.get(input.providerId);
        if (!key) throw new Error('Save the shared provider API key in Settings first.');
        return voiceClient.list(input, key, AbortSignal.timeout(30_000));
      },
      renderMidi: async (asset, input) => {
        const seconds = asset.midi?.durationSeconds ?? (asset.request?.kind === 'midi' ? midiDurationSeconds(asset.request.composition) : 0);
        if (!(seconds > 0)) throw new Error('This MIDI clip has no length to render.');
        const wav = await midiRenderer.renderClip(await readFile(media.path(asset)), await resolveSoundfont(), { seconds });
        return renderClip(await decodeAudio(wav, 'wav'), input);
      },
      renderMidiBytes: async (midi, seconds) => midiRenderer.renderClip(midi, await resolveSoundfont(), { seconds }),
      soundfont: async () => { const bank = await resolveSoundfont(); return { name: bank.name, hash: bank.hash, presets: bank.presets }; },
      safeError
    };
    service = new WorkbenchService(store, media, livePorts, changed, diagnostics);
    store.recover(); store.ensureConversation(store.activeProjectId());
    const agentRoot = app.isPackaged ? join(process.resourcesPath, 'agent') : join(__dirname, '../agent');
    rendererPort = new RendererPort(() => window, store, browserMode ? { available: () => browserHost?.available() ?? false, send: command => browserHost?.send(command) } : undefined);
    const exporter = new Exporter(media, store, join(agentRoot, 'sfxchat-helper.exe'));
    const midiRenderer = new MidiRenderer(join(agentRoot, 'sfxchat-helper.exe'), join(root, 'midi-renders'));
    // The bundled General MIDI bank ships beside the app; a bank saved in Settings overrides it.
    const bundledSoundfont = app.isPackaged ? join(process.resourcesPath, 'soundfonts', 'GeneralUser-GS.sf2') : join(__dirname, '../../resources/soundfonts/GeneralUser-GS.sf2');
    const resolveSoundfont = async () => {
      const custom = store.setting('soundfont-path', '');
      if (custom) { try { return await loadSoundfont(custom); } catch (error) { diagnostics.record('soundfont.custom_failed', { error: diagnosticError(error) }); } }
      return await loadSoundfont(bundledSoundfont);
    };
    operations = new Operations(service, rendererPort, exporter);
    service.operation = (name, args) => operations!.call(name, args);
    bridge = await startBridge(root, join(agentRoot, 'sfxchat-helper.exe'), operations);
    const context = (id: string) => ({ projectId: store.conversation(id).projectId, sessionId: id });

    const serveMedia = async (request: Request): Promise<Response> => {
      try {
        const url = new URL(request.url);
        if (request.method !== 'GET') return new Response(null, { status: 404 });
        if (url.hostname === 'asset') {
          const id = idSchema.parse(url.pathname.slice(1)); const asset = store.asset(id, store.activeProjectId());
          // MIDI assets are symbolic; playback serves the synth render through the bundled bank.
          if (asset.format === 'mid') {
            const seconds = asset.midi?.durationSeconds ?? (asset.request?.kind === 'midi' ? midiDurationSeconds(asset.request.composition) : 0);
            if (!(seconds > 0)) return new Response(null, { status: 404 });
            const bytes = await midiRenderer.renderClip(await readFile(media.path(asset)), await resolveSoundfont(), { seconds });
            return bytesResponse(bytes, 'audio/wav', request);
          }
          const bytes = await readFile(media.path(asset));
          return bytesResponse(bytes, asset.format === 'mp3' ? 'audio/mpeg' : 'audio/wav', request);
        }
        if (url.hostname === 'chat') {
          const [messageId, attachmentId] = url.pathname.slice(1).split('/');
          if (!messageId || !attachmentId) return new Response(null, { status: 404 });
          const message = store.message(idSchema.parse(messageId), store.activeProjectId());
          const attachment = (message.attachments ?? []).find(entry => entry.id === idSchema.parse(attachmentId));
          if (!attachment) return new Response(null, { status: 404 });
          const bytes = await readFile(media.chatAttachmentPath(attachment.id, attachment.kind === 'image' ? 'png' : 'wav'));
          return bytesResponse(bytes, attachment.mediaType, request);
        }
        return new Response(null, { status: 404 });
      } catch { return new Response(null, { status: 404 }); }
    };
    protocol.handle('sfx-media', serveMedia);

    const handlers: Record<string, (...args: any[]) => unknown> = {
      operation: async (name, args) => { try { return { ok: true, result: await operations!.call(name, args, 'user') }; } catch (e) { return operationError(e); } },
      installIntegration: async input => { try { return { ok: true, result: await installIntegration(input, join(agentRoot, 'sfxchat-runtime.exe'), join(agentRoot, 'cli.cjs')) }; } catch (e) { return operationError(e); } },
      chooseDirectory: async () => { const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; },
      uiReady: () => rendererPort!.markReady(), uiAcknowledge: (id, error) => rendererPort!.acknowledge(id, error),
      playbackReport: (id, state) => { store.requireConversation(id); rendererPort!.report(id, state); },
      snapshot: () => service!.snapshot(), createConversation: () => store.createConversation(),
      renameConversation: (id, title) => { store.renameConversation(id, title, 'user'); },
      createProject: name => { const project = store.createProject(name); store.setActiveProject(project.id); store.ensureConversation(project.id); return project; },
      renameProject: (id, name) => store.renameProject(id, name),
      setActiveProject: id => { store.setActiveProject(id); store.ensureConversation(id); },
      chatContext: (id, draft) => service!.chatContext(id, draft),
      openLogs: async () => { const directory = join(root, 'logs'); await mkdir(directory, { recursive: true }); const error = await shell.openPath(directory); if (error) throw new Error(error); },
      sendMessage: (id, text) => service!.sendMessage(id, text), cancelTurn: id => service!.cancelTurn(id),
      generate: (id, input) => operations!.call('generate_sounds', { ...context(id), requestId: randomUUID(), input }, 'user').then(requireAdmission), cancelJob: id => operations!.call('cancel_job', { ...context(store.job(id).conversationId), id }, 'user'),
      generateMusic: (id, input) => { const { kind: _kind, ...fields } = input; return operations!.call('generate_music', { ...context(id), requestId: randomUUID(), input: fields }, 'user').then(requireAdmission); },
      generateVoice: (id, input) => { const { kind: _kind, ...fields } = input; return operations!.call('generate_voice', { ...context(id), requestId: randomUUID(), input: fields }, 'user').then(requireAdmission); },
      listVoices: input => operations!.call('list_voices', input, 'user'),
      saveVoiceProvider: input => { voice.save(input); changed(); }, setActiveVoice: id => { voice.setActive(id); changed(); },
      saveProviderKey: async (id, key) => { await providerKeys.save(id, key); credentialError = null; changed(); },
      selectProviderKey: async (id, candidateId) => { await providerKeys.select(id, candidateId); credentialError = null; changed(); },
      updateAsset: (id, patch, conversationId) => operations!.call('update_asset', { ...context(conversationId ?? store.ensureConversation(store.activeProjectId())), id, patch }, 'user'),
      analyzeAudio: (id, input) => operations!.call('analyze_audio', { projectId: store.activeProjectId(), id, input }, 'user'), trimAsset: (conversationId, id, input) => operations!.call('trim_asset', { ...context(conversationId), id, input }, 'user'),
      previewTrim: (id, input) => service!.previewTrim(id, input, store.activeProjectId()),
      spectrogram: (id, input) => service!.spectrogram(id, input, store.activeProjectId()),
      midiNotes: id => service!.midiNotes(id, store.activeProjectId()),
      previewMidi: composition => service!.previewMidi(composition),
      saveMidiEdit: (conversationId, id, composition, name) => service!.saveMidiEdit(conversationId, id, composition, name),
      soundfontInfo: () => service!.soundfont(),
      setPlayground: (id, ids) => operations!.call('set_playground', { ...context(id), assetIds: ids }, 'user'),
      searchAssets: query => operations!.call('search_assets', { projectId: store.activeProjectId(), query }, 'user'),
      importAudio: async (id, kind) => {
        const result = await dialog.showOpenDialog(window!, { title: 'Import audio', filters: [{ name: 'Audio or MIDI', extensions: ['wav', 'mp3', 'mid', 'midi'] }], properties: ['openFile', 'multiSelections'] });
        if (!result.canceled) await operations!.call('import_audio', { ...context(id), paths: result.filePaths, kind: kind ?? 'effect' }, 'user');
      },
      exportAsset: async (id, format = 'original') => {
        const asset = store.asset(id, store.activeProjectId());
        const extension = format === 'original' ? asset.format : format;
        const result = await dialog.showSaveDialog(window!, { title: 'Export audio', defaultPath: `${asset.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.${extension}`, filters: [{ name: format === 'original' ? 'Original audio' : format === 'wav' ? 'PCM WAV' : 'Ogg Vorbis', extensions: [extension] }] });
        if (!result.canceled && result.filePath) await operations!.call('export_asset', { projectId: asset.projectId, id, destination: result.filePath, format }, 'user');
      },
      startLogin: () => auth!.startLogin(), cancelLogin: () => auth!.cancelLogin(), logout: () => auth!.logout(),
      saveModel: value => { const resolved = resolveChatModel(value); store.setSetting('chat-model', resolved); registry.setActive(`codex:${resolved}`, registry.activeSelection().effort || 'medium'); },
      saveChatProvider: async input => { const provider = await registry.saveProvider(input); changed(); return provider; },
      deleteChatProvider: async id => { await registry.deleteProvider(id); changed(); },
      listChatModels: providerId => registry.listModels(providerId),
      testChatModel: input => registry.testModel(input),
      saveChatModel: async input => { const record = await registry.saveModel(input); changed(); return record; },
      deleteChatModel: async id => { await registry.deleteModel(id); changed(); },
      setActiveChat: input => { const selection = registry.setActive(input.modelId, input.effort); store.setSetting('chat-model', selection.modelId.startsWith('codex:') ? selection.modelId.slice(6) : selection.modelId); changed(); return selection; },
      saveMusicProvider: async input => { const provider = await music.saveProvider(input); changed(); return provider; },
      deleteMusicProvider: async id => { await music.deleteProvider(id); changed(); },
      setActiveMusic: id => { const active = music.setActive(id); changed(); return active; }
    };
    const invoke = async (method: unknown, rawArgs: unknown) => {
      if (quitting) throw new Error('SfxChat is closing.');
      if (typeof method !== 'string' || !Object.hasOwn(commandSchemas, method)) throw new Error('Unknown application operation.');
      const parsed = commandSchemas[method as keyof typeof commandSchemas].safeParse(rawArgs);
      if (!parsed.success) throw new Error('Invalid operation arguments.');
      try { return await handlers[method](...parsed.data); } catch (error) {
        const reference = diagnostics.record('operation.failed', { method, error: diagnosticError(error) });
        throw new Error(`${safeError(error)}${reference ? `\nDiagnostic reference: ${reference}. Open Settings → Open diagnostic logs for details.` : ''}`);
      }
    };
    ipcMain.handle('sfx:call', async (event, method: unknown, rawArgs: unknown) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted application request.');
      return invoke(method, rawArgs);
    });
    if (browserMode) {
      browserHost = await startBrowserHost({ directory: join(__dirname, '../renderer'), invoke, media: serveMedia, disconnected: () => rendererPort?.unavailable(), shutdown: () => app.quit() });
      process.stdout.write(`SfxChat browser: ${browserHost.url}\n`);
      service.pump(); return;
    }
    window = new BrowserWindow({ width: 1440, height: 940, minWidth: 1000, minHeight: 650, title: 'SfxChat', backgroundColor: '#191b19', show: false, webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.removeMenu();
    window.on('hide', () => rendererPort?.stopForVisibility());
    window.on('minimize', () => rendererPort?.stopForVisibility());
    window.on('closed', () => rendererPort?.unavailable());
    window.webContents.on('render-process-gone', () => rendererPort?.unavailable());
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
    rendererPort?.unavailable();
    void Promise.all([browserHost?.close(), bridge?.close(), operations?.close(), service?.shutdown(), auth?.cancelLogin()]).finally(() => { if (eventTimer) clearTimeout(eventTimer); service?.store.close(); app.quit(); });
  });
}

function requireAdmission(value: unknown) { const result = value as { status: string; error?: string }; if (result.status !== 'admitted') throw new Error(result.error || 'Generation admission incomplete; inspect jobs before retrying.'); }
