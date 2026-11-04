import { createApi } from '../shared/api';
import type { UiCommand, OperationResponse } from '../shared/workbench';
import type { Snapshot } from '../shared/types';

/** Host paths use an app dialog: embedded browsers can disable window.prompt. */
function hostPathDialog(title: string, label: string, multiline = false): Promise<string | null> {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'browser-path-dialog';
    const form = document.createElement('form'); form.method = 'dialog';
    const heading = document.createElement('h2'); heading.textContent = title;
    const field = document.createElement('label'); field.textContent = label;
    const input = document.createElement(multiline ? 'textarea' : 'input');
    if (input instanceof HTMLTextAreaElement) input.rows = 4;
    input.autofocus = true; field.append(input);
    const note = document.createElement('p'); note.textContent = 'Use absolute paths on the SfxChat host. This uses the real library and filesystem.';
    const actions = document.createElement('div'); actions.className = 'browser-path-actions';
    for (const [value, text] of [['cancel', 'Cancel'], ['accept', 'Continue']]) {
      const button = document.createElement('button'); button.value = value; button.textContent = text;
      button.className = value === 'accept' ? 'primary-button' : 'secondary-button'; actions.append(button);
    }
    form.append(heading, field, note, actions); dialog.append(form); document.body.append(dialog);
    dialog.addEventListener('close', () => { const value = dialog.returnValue === 'accept' ? input.value.trim() || null : null; dialog.remove(); resolve(value); }, { once: true });
    dialog.showModal();
  });
}

/** Browser development uses real owning operations, with no browser secret store. */
export function connectBrowserApi() {
  if (!['127.0.0.1'].includes(location.hostname) || location.protocol !== 'http:') throw new Error('Use the loopback URL printed by npm run dev:browser.');
  const changes = new Set<() => void>(), commands = new Set<(command: UiCommand) => void>();
  const events = new EventSource('/events');
  async function call(method: string, ...args: unknown[]): Promise<any> {
    // JSON turns array undefined into null; omit trailing optional arguments so
    // the same tuple schemas retain their IPC meaning.
    while (args.length && args.at(-1) === undefined) args.pop();
    const response = await fetch('/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }) });
    const envelope = JSON.parse(await response.text(), (_key, value) => {
      if (value && typeof value.$bytes === 'string') return Uint8Array.from(atob(value.$bytes), c => c.charCodeAt(0));
      return value;
    });
    if (!response.ok || !envelope.ok) throw new Error(envelope.error?.message ?? 'Browser host request failed.');
    return envelope.result;
  }
  events.addEventListener('changed', () => { for (const listener of changes) listener(); });
  events.addEventListener('ui-command', event => { const command: UiCommand = JSON.parse((event as MessageEvent).data); for (const listener of commands) listener(command); });
  events.addEventListener('error', () => window.dispatchEvent(new Event('sfx-host-disconnected')));
  events.addEventListener('open', () => { void call('uiReady').catch(() => undefined); for (const listener of changes) listener(); });
  const api = createApi({ hostMode: 'browser', mediaUrl: path => `/media/${path}`, call,
    onChanged: listener => { changes.add(listener); return () => { changes.delete(listener); }; },
    onUiCommand: listener => { commands.add(listener); return () => { commands.delete(listener); }; }
  });
  const result = (response: OperationResponse) => { if (!response.ok) throw new Error(response.error?.message ?? 'Operation failed.'); return response.result; };
  // Browser tools can fill path dialogs; files still import/export through the
  // same scoped operations, on the host filesystem, never an alternate library.
  api.chooseDirectory = () => hostPathDialog('Choose directory', 'Absolute directory path');
  api.importAudio = async (sessionId, kind = 'effect') => {
    const paths = await hostPathDialog('Import audio', 'Absolute WAV/MP3/Ogg/MIDI paths, one per line', true); if (!paths) return;
    const snapshot: Snapshot = await api.snapshot();
    result(await api.operation('import_audio', { projectId: snapshot.activeProjectId, sessionId, kind, paths: paths.split('\n').map(p => p.trim()).filter(Boolean) }));
  };
  api.exportAsset = async (id, format = 'original', oggQuality = 5) => {
    const destination = await hostPathDialog('Export audio', 'New absolute export filename'); if (!destination) return;
    const snapshot: Snapshot = await api.snapshot();
    result(await api.operation('export_asset', { projectId: snapshot.activeProjectId, id, destination, format, oggQuality }));
  };
  window.addEventListener('pagehide', () => events.close(), { once: true });
  return api;
}
