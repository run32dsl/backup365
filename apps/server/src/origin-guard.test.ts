import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import { TEST_PASSWORD, addAccount, testAuth } from './test-support.js';

async function setup(trustProxy?: string) {
  const { auth } = testAuth();
  const audit = SqliteAuditLog.open(':memory:');
  await addAccount(auth, 'alice');
  const app = buildApp({ version: '1', auth, audit, ...(trustProxy ? { trustProxy } : {}) });
  const login = (headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: TEST_PASSWORD },
      headers,
    });
  return { app, audit, login };
}

describe('refus des écritures venant d’une autre origine', () => {
  it('accepts the same origin', async () => {
    const { login } = await setup();
    expect((await login({ origin: 'http://localhost', host: 'localhost' })).statusCode).toBe(200);
  });

  it('accepts a request without Origin nor Sec-Fetch-Site (non-browser client)', async () => {
    const { login } = await setup();
    expect((await login({})).statusCode).toBe(200);
  });

  it('accepts Sec-Fetch-Site same-origin', async () => {
    const { login } = await setup();
    expect((await login({ 'sec-fetch-site': 'same-origin' })).statusCode).toBe(200);
  });

  it('refuses another origin with 403 cross_origin', async () => {
    const { login } = await setup();
    const res = await login({ origin: 'https://evil.example', host: 'localhost' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'cross_origin' });
  });

  it('refuses Sec-Fetch-Site cross-site and an opaque Origin', async () => {
    const { login } = await setup();
    expect((await login({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await login({ origin: 'null' })).statusCode).toBe(403);
  });

  it('applies to PUT, PATCH and DELETE, not to GET (OIDC callback)', async () => {
    const { app } = await setup();
    const headers = { 'sec-fetch-site': 'cross-site' };
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/plans/x', headers });
      expect(res.statusCode).toBe(403);
    }
    const cb = await app.inject({ method: 'GET', url: '/api/auth/oidc/callback', headers });
    expect(cb.statusCode).not.toBe(403);
  });

  it('also refuses an encoded /api path, an unknown route, and compares the port', async () => {
    const { app, login } = await setup();
    const headers = { 'sec-fetch-site': 'cross-site' };
    for (const url of ['/%61pi/auth/login', '/api/unknown']) {
      expect((await app.inject({ method: 'POST', url, headers })).statusCode).toBe(403);
    }
    const port = await login({ origin: 'http://localhost:3000', host: 'localhost' });
    expect(port.statusCode).toBe(403);
    expect((await login({ origin: 'http://LOCALHOST', host: 'localhost' })).statusCode).toBe(200);
  });

  it('refuses without audit log configured', async () => {
    const { auth } = testAuth();
    const app = buildApp({ version: '1', auth });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('records the refusal in the audit log', async () => {
    const { audit, login } = await setup();
    await login({ origin: 'https://evil.example' });
    const { items } = await audit.list({ limit: 10, offset: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      action: 'access.denied',
      resource: 'api.write',
      reason: 'cross_origin',
    });
  });

  it('behind a trusted proxy, compares Origin with X-Forwarded-Host', async () => {
    const { login } = await setup('127.0.0.1');
    const proxied = { host: 'app:3000', 'x-forwarded-host': 'backup.example.org' };
    const ok = await login({ ...proxied, origin: 'https://backup.example.org' });
    expect(ok.statusCode).toBe(200);
    const ko = await login({ ...proxied, origin: 'http://app:3000' });
    expect(ko.statusCode).toBe(403);
  });

  it('without a trusted proxy, ignores X-Forwarded-Host', async () => {
    const { login } = await setup();
    const res = await login({
      host: 'app:3000',
      'x-forwarded-host': 'backup.example.org',
      origin: 'https://backup.example.org',
    });
    expect(res.statusCode).toBe(403);
  });
});
