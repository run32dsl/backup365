import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { testAuth } from './test-support.js';

const failingRequestId = async (): Promise<string> => {
  const { auth } = testAuth();
  const app = buildApp({
    version: '1',
    auth,
    audit: SqliteAuditLog.open(':memory:'),
    plans: SqlitePlanStore.open(':memory:'),
  });
  const res = await app.inject({ method: 'GET', url: '/api/plans' });
  await app.close();
  expect(res.statusCode).toBeGreaterThanOrEqual(400);
  return String(res.headers['x-request-id']);
};

describe('identifiant de requête', () => {
  it('is never the same before and after a restart', async () => {
    const before = await failingRequestId();
    const after = await failingRequestId();
    expect(before).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(after).not.toBe(before);
  });
});
