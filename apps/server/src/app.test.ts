import { describe, expect, it } from 'vitest';
import { buildApp, REDACTED_PATHS, SECURITY_HEADERS } from './app.js';

describe('GET /api/health', () => {
  it('returns status ok and the version', async () => {
    const app = buildApp({ version: '9.9.9' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: '9.9.9' });
  });
});

describe('logger redaction', () => {
  it('never writes authorization or cookie values', async () => {
    const lines: string[] = [];
    const stream = { write: (line: string) => void lines.push(line) };
    const app = buildApp({ version: '1.0.0', logger: { redact: REDACTED_PATHS, stream } });
    app.log.info({ req: { headers: { authorization: 'Bearer s3cret', cookie: 'sid=s3cret' } } });
    await app.close();
    const output = lines.join('');
    expect(output).not.toContain('s3cret');
    expect(output).toContain('"level":30');
  });

  it('keeps real request headers out of the log', async () => {
    const lines: string[] = [];
    const stream = { write: (line: string) => void lines.push(line) };
    const app = buildApp({ version: '1.0.0', logger: { redact: REDACTED_PATHS, stream } });
    await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: 'Bearer s3cret', cookie: 'sid=s3cret' },
    });
    await app.close();
    const output = lines.join('');
    expect(output).toContain('incoming request');
    expect(output).not.toContain('s3cret');
  });
});

describe('security headers', () => {
  it('sets them on every response, errors included', async () => {
    const app = buildApp({ version: '1.0.0' });
    const ok = await app.inject({ method: 'GET', url: '/api/health' });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(ok.headers[name]).toBe(value);
    }
    const missing = await app.inject({ method: 'GET', url: '/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['x-content-type-options']).toBe('nosniff');
  });
});
