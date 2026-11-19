import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { Role } from './sqlite/sqlite-account-store.js';
import { sessionFor, testAuth, withHeaders } from './test-support.js';

function setup(role: Role, backupConfigured: boolean) {
  const { auth } = testAuth();
  const session = sessionFor(auth, 'root', role);
  return withHeaders(
    buildApp({
      version: '1',
      auth,
      backupConfigured,
      status: { maxAgeHours: 26, workloads: ['mail', 'onedrive'] },
    }),
    session.headers,
  );
}

describe('GET /api/configuration', () => {
  it('gives an administrator the connection state and the workloads, nothing else', async () => {
    const res = await setup('admin', true).inject({ method: 'GET', url: '/api/configuration' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      microsoft: { connected: true },
      workloads: ['mail', 'onedrive'],
    });
  });

  it('reports a console not linked to Microsoft 365', async () => {
    const res = await setup('admin', false).inject({ method: 'GET', url: '/api/configuration' });
    expect(res.json<{ microsoft: { connected: boolean } }>().microsoft.connected).toBe(false);
  });

  it('refuses an operator', async () => {
    const res = await setup('operator', true).inject({ method: 'GET', url: '/api/configuration' });
    expect(res.statusCode).toBe(403);
  });

  it('answers 401 without a session', async () => {
    const res = await buildApp({ version: '1', auth: testAuth().auth }).inject({
      method: 'GET',
      url: '/api/configuration',
    });
    expect(res.statusCode).toBe(401);
  });

  it('exposes no write route', async () => {
    const res = await setup('admin', true).inject({
      method: 'POST',
      url: '/api/configuration',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
