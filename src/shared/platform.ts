import { homedir } from 'node:os';
import { join } from 'node:path';

/** Desktop platforms SfxChat packages for: Windows x64 and Linux x64. */
export const windows = process.platform === 'win32';
const suffix = windows ? '.exe' : '';
/** Bundled native helper (Ogg, MIDI rendering, and Windows-only bridge protection). */
export const helperName = `sfxchat-helper${suffix}`;
/** Pinned Node runtime that runs the bundled CLI and MCP server. */
export const runtimeName = `sfxchat-runtime${suffix}`;
/** Packaged desktop executable, next to the `resources` directory. */
export const appExecutableName = `SfxChat${suffix}`;

/** The per-user profile, matching Electron's `appData`/SfxChat on each platform. */
export function profileRoot() {
  if (windows) return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'SfxChat');
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'SfxChat');
}
