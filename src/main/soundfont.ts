/**
 * SoundFont banks for MIDI playback: path resolution, validation, and the preset list the studio's
 * instrument picker offers. The bank decides which General MIDI instruments are actually available.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

export interface SoundfontPreset { bank: number; program: number; name: string }
export interface SoundfontInfo { path: string; name: string; hash: string; presets: SoundfontPreset[] }

const PRESET_HEADER_BYTES = 38;

const walk = (bytes: Buffer, from: number, to: number, visit: (id: string, start: number, end: number) => void) => {
  let offset = from;
  while (offset + 8 <= to) {
    const id = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > to) break;
    visit(id, start, end);
    offset = end + (size % 2);
  }
};

/** Reads the `pdta`/`phdr` preset list; the final entry is the end-of-list marker. */
export const readSoundfontPresets = (bytes: Buffer): SoundfontPreset[] => {
  if (bytes.length < 16 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'sfbk') {
    throw new Error('That file is not a SoundFont 2 bank.');
  }
  let presets: SoundfontPreset[] | null = null;
  walk(bytes, 12, bytes.length, (id, start, end) => {
    if (id !== 'LIST' || presets || bytes.toString('latin1', start, start + 4) !== 'pdta') return;
    walk(bytes, start + 4, end, (sub, subStart, subEnd) => {
      if (sub !== 'phdr' || presets) return;
      const count = Math.floor((subEnd - subStart) / PRESET_HEADER_BYTES) - 1;
      if (count < 1) throw new Error('That SoundFont bank has no presets.');
      const list: SoundfontPreset[] = [];
      for (let index = 0; index < count; index++) {
        const base = subStart + index * PRESET_HEADER_BYTES;
        const raw = bytes.toString('latin1', base, base + 20);
        const terminator = raw.indexOf('\0');
        const name = (terminator === -1 ? raw : raw.slice(0, terminator)).trim();
        list.push({ name: name || `Program ${index}`, program: bytes.readUInt16LE(base + 20), bank: bytes.readUInt16LE(base + 22) });
      }
      presets = list;
    });
  });
  if (!presets) throw new Error('That SoundFont bank has no preset list.');
  return presets;
};

const cache = new Map<string, { signature: string; info: SoundfontInfo }>();

/** Loads and caches a bank's metadata; the cache key includes size and modification time. */
export const loadSoundfont = async (path: string): Promise<SoundfontInfo> => {
  const stats = await stat(path);
  const signature = `${stats.size}:${stats.mtimeMs}`;
  const cached = cache.get(path);
  if (cached?.signature === signature) return cached.info;
  const bytes = await readFile(path);
  const info: SoundfontInfo = {
    path,
    name: basename(path),
    hash: createHash('sha256').update(bytes).digest('hex'),
    presets: readSoundfontPresets(bytes)
  };
  cache.set(path, { signature, info });
  return info;
};
