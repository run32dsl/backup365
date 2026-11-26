import { FAILURE_CAUSES } from '@backup365/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { sessionFor, testAuth, withHeaders } from './test-support.js';

describe('GET /api/plans: failure cause (issue #311)', () => {
  it('exposes a cause from a closed list, never the raw code', async () => {
    const { auth } = testAuth();
    const plans = SqlitePlanStore.open(':memory:');
    const session = sessionFor(auth, 'root', 'operator');
    const app = withHeaders(
      buildApp({ version: '1', auth, audit: SqliteAuditLog.open(':memory:'), plans }),
      session.headers,
    );
    const plan = plans.create({
      name: 'Mails',
      scope: 'all',
      dataTypes: ['mail'],
      selection: [],
      rpoHours: 4,
      rtoHours: null,
      retentionDays: 30,
      gdprJustification: 'Obligation légale.',
    });
    const lastRun = async () =>
      (await app.inject({ method: 'GET', url: '/api/plans' })).json<{
        items: { lastRun: Record<string, unknown> }[];
      }>().items[0]?.lastRun;
    const fail = (code: string, at: string) =>
      plans.finishRun(plans.startRun(plan.id, 'a', at) as number, 'failed', at, code);

    fail('interrupted', '2026-11-19T10:00:00.000Z');
    expect(await lastRun()).toMatchObject({ status: 'failed', failureCause: 'interrupted' });

    // Un code du SDK, de la forme qu'il a : jamais renvoyé tel quel.
    fail('ECONNRESET', '2026-11-19T11:00:00.000Z');
    const run = await lastRun();
    expect(run?.failureCause).toBe('unknown');
    expect(FAILURE_CAUSES).toContain(run?.failureCause);
    expect(JSON.stringify(run)).not.toContain('ECONNRESET');

    // Bail du SDK 7.2.0 (issue #567) : une autre opération tient l'élément.
    fail('ATLAS_OWNER_BUSY', '2026-11-19T11:30:00.000Z');
    const busy = await lastRun();
    expect(busy?.failureCause).toBe('owner_busy');
    expect(JSON.stringify(busy)).not.toContain('ATLAS_');

    // Une réussite ne porte pas de cause.
    plans.finishRun(
      plans.startRun(plan.id, 'a', '2026-11-19T12:00:00.000Z') as number,
      'success',
      '2026-11-19T12:00:00.000Z',
    );
    expect(await lastRun()).not.toHaveProperty('failureCause');
  });
});
