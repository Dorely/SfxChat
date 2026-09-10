import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiagnosticLog, redactText } from '../src/main/diagnostics';

function profile(): string { return mkdtempSync(join(tmpdir(), 'sfxchat-diagnostics-')); }

describe('diagnostics', () => {
  it('persists JSONL records and returns their diagnostic id', () => {
    const root = profile();
    const log = new DiagnosticLog(root);
    const id = log.record('provider.error', { status: 503, provider: 'elevenlabs' });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const record = JSON.parse(readFileSync(join(root, 'logs', 'diagnostics.jsonl'), 'utf8'));
    expect(record.id).toBe(id);
    expect(record.event).toBe('provider.error');
  });

  it('redacts secret fields, token patterns, URLs, and explicit runtime secrets', () => {
    const secret = 'runtime-secret-value';
    const text = 'Bearer abc.def token=plain https://example.test/x?access_token=url-secret&ok=1 sk-test-12345 eyJaaa.bbb.ccc';
    const redacted = redactText(`${text} ${secret}`, [secret]);
    expect(redacted).not.toContain('abc.def');
    expect(redacted).not.toContain('url-secret');
    expect(redacted).not.toContain('sk-test-12345');
    expect(redacted).not.toContain('eyJaaa.bbb.ccc');
    expect(redacted).not.toContain(secret);

    const root = profile();
    const log = new DiagnosticLog(root, { secrets: [secret] });
    const id = log.record('provider', { apiKey: 'field-secret', nested: { accessToken: 'token-secret', message: text } });
    expect(id).not.toBeNull();
    const output = readFileSync(join(root, 'logs', 'diagnostics.jsonl'), 'utf8');
    expect(output).not.toContain('field-secret');
    expect(output).not.toContain('token-secret');
    expect(output).not.toContain(secret);
  });

  it('rotates bounded logs and keeps only configured archives', () => {
    const root = profile();
    const log = new DiagnosticLog(root, { maxBytes: 180, maxArchives: 2 });
    for (let i = 0; i < 8; i += 1) log.record('event', { index: i, message: 'x'.repeat(55) });
    const files = log.files();
    expect(files).toHaveLength(3);
    expect(files.some(path => path.endsWith('.3'))).toBe(false);
  });

  it('returns null when the profile cannot be written', () => {
    const root = join(profile(), 'profile-file');
    writeFileSync(root, 'not a directory');
    expect(new DiagnosticLog(root).record('event', {})).toBeNull();
  });
});
