import { describe, expect, it, vi } from 'vitest';
import { ProviderHttpError, ProviderResponseError, diagnosticError } from '../src/main/providers/errors';

function response(body: string, contentType = 'application/json', status = 400, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { 'content-type': contentType, ...headers } });
}

describe('provider errors', () => {
  it('parses OpenAI and ElevenLabs payloads and request IDs', async () => {
    const openai = await ProviderHttpError.fromResponse(response(JSON.stringify({ error: { message: 'Bad prompt', code: 'invalid', type: 'x', param: 'prompt' } }), 'application/json', 422, { 'x-request-id': 'req-1' }), 'OpenAI');
    expect(openai.status).toBe(422);
    expect(openai.details).toEqual({ message: 'Bad prompt', code: 'invalid', type: 'x', param: 'prompt', requestId: 'req-1' });
    const eleven = await ProviderHttpError.fromResponse(response(JSON.stringify({ detail: { message: 'No credits', status: 'error' } })), 'ElevenLabs');
    expect(eleven.details.message).toBe('No credits');
    expect(eleven.details.code).toBe('error');
    expect(eleven.details.type).toBeUndefined();
    const detailText = await ProviderHttpError.fromResponse(response(JSON.stringify({ detail: 'Quota exceeded' })), 'ElevenLabs');
    expect(detailText.details.message).toBe('Quota exceeded');
  });

  it('uses bounded plain text, ignores HTML, and redacts secrets before truncating', async () => {
    const plain = await ProviderHttpError.fromResponse(response('token=super-secret-123 ' + 'x'.repeat(40_000), 'text/plain'), 'Provider', ['super-secret-123']);
    expect(plain.message).toContain('[redacted]');
    expect(plain.message).not.toContain('super-secret-123');
    expect(plain.message.length).toBeLessThan(5_000);
    const html = await ProviderHttpError.fromResponse(response('<html>private</html>', 'text/html'), 'Provider');
    expect(html.details.message).toBe('Provider request failed');
  });

  it('preserves status when body reading times out and cancels the reader', async () => {
    const cancel = vi.fn(async () => undefined);
    const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => undefined); } });
    const original = body.getReader;
    body.getReader = (() => ({ read: () => new Promise<never>(() => undefined), cancel, releaseLock: vi.fn() })) as unknown as typeof original;
    const error = await ProviderHttpError.fromResponse(new Response(body, { status: 503, headers: { 'content-type': 'text/plain' } }), 'Provider');
    expect(error.status).toBe(503);
    expect(cancel).toHaveBeenCalled();
  }, 3_000);

  it('uses one total body deadline across slow-dripping chunks', async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      const cancel = vi.fn(async () => undefined);
      const body = new ReadableStream<Uint8Array>();
      body.getReader = (() => ({
        read: () => reads++ === 0
          ? Promise.resolve({ done: false, value: new TextEncoder().encode('{"detail":"first"}') })
          : new Promise<never>(() => undefined),
        cancel,
        releaseLock: vi.fn(),
      })) as unknown as typeof body.getReader;
      const pending = ProviderHttpError.fromResponse(new Response(body, { status: 429, headers: { 'content-type': 'application/json' } }), 'Provider');
      await vi.advanceTimersByTimeAsync(2_000);
      const error = await pending;
      expect(error.status).toBe(429);
      expect(error.details.message).toBe('Provider request failed');
      expect(cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports streamed payloads and safe diagnostics', () => {
    const error = ProviderResponseError.fromPayload('OpenAI', { error: { message: 'Bearer abc', code: 'bad' } }, ['abc']);
    expect(error.status).toBeUndefined();
    expect(error.details.message).toContain('[redacted]');
    expect(diagnosticError(error)).toEqual(expect.objectContaining({ provider: 'OpenAI', details: expect.any(Object) }));
    expect(diagnosticError(new Error('transport failed'))).toEqual({ name: 'Error', message: 'transport failed' });
  });
});
