import type { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import { WorkbenchError, type PlaybackState, type UiCommand } from '../shared/workbench';
import type { UiPort } from './operations';

export class RendererPort implements UiPort {
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private currentSession: string | null = null;
  private playback: PlaybackState = { status: 'stopped', updatedAt: new Date().toISOString() };
  private ready = false;
  constructor(private window: () => BrowserWindow | null, private store: Store, private browser?: { available(): boolean; send(command: UiCommand): void }) {}
  markReady() { this.ready = true; }
  state(sessionId: string): PlaybackState { return this.currentSession === sessionId ? this.playback : { status: 'stopped', updatedAt: this.playback.updatedAt }; }
  report(sessionId: string, state: PlaybackState) { this.currentSession = sessionId; this.playback = { ...state, updatedAt: new Date().toISOString() }; }
  acknowledge(id: string, error?: string) {
    const pending = this.pending.get(id); if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(id);
    error ? pending.reject(new WorkbenchError('PLAYBACK_FAILED', error)) : pending.resolve({ ...this.playback });
  }
  async send(input: Omit<UiCommand, 'id'>) {
    const window = this.window();
    if (((!window || window.isDestroyed()) && !this.browser?.available()) || !this.ready) throw new WorkbenchError('UI_UNAVAILABLE', 'The audition UI is not ready. Try again after it opens.');
    if (this.pending.size && input.action !== 'stop') throw new WorkbenchError('UI_BUSY', 'Another client is changing the audition UI. Inspect playback status and retry after it completes.');
    if (input.action === 'stop' && this.currentSession !== input.sessionId) return this.state(input.sessionId);
    if (input.action !== 'stop') { this.store.setActiveProject(input.projectId); window?.show(); window?.focus(); }
    const command: UiCommand = { ...input, id: randomUUID() };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(command.id); reject(new WorkbenchError('UI_TIMEOUT', 'The audition UI did not acknowledge the command. Inspect playback status before trying again.')); }, 15000);
      this.pending.set(command.id, { resolve, reject, timer });
      if (this.browser?.available()) this.browser.send(command); else window?.webContents.send('sfx:ui-command', command);
    });
  }
  stopForVisibility() {
    const window = this.window();
    if (!window || window.isDestroyed() || !this.currentSession) return;
    const conversation = this.store.conversations().find(item => item.id === this.currentSession);
    if (!conversation) { this.currentSession = null; this.playback = { status: 'stopped', updatedAt: new Date().toISOString() }; return; }
    window.webContents.send('sfx:ui-command', { id: randomUUID(), action: 'stop', sessionId: this.currentSession, projectId: conversation.projectId });
  }
  unavailable() {
    this.ready = false; this.playback = { status: 'stopped', updatedAt: new Date().toISOString() };
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new WorkbenchError('UI_UNAVAILABLE', 'The audition UI closed.')); }
    this.pending.clear();
  }
}
