import { describe, expect, it } from 'vitest';
import type { Overview } from './overview-routes.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { buildTestApp } from './test-support.js';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const input = (name: string) => ({
  name,
  scope: 'all' as const,
  selection: [],
  dataTypes: ['mail' as const],
  rpoHours: 4 as const,
  rtoHours: null,
  retentionDays: 90,
  gdprJustification: 'Obligation de conservation.',
});

describe('GET /api/overview: failed plans (issue #311)', () => {
  it('counts a plan as failed when its last run failed, even if a success is within the RPO', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    const id = plans.create(input('A')).id;
    plans.finishRun(plans.startRun(id, 'item', hoursAgo(1.2)) as number, 'success', hoursAgo(1.1));
    plans.finishRun(plans.startRun(id, 'item', hoursAgo(0.2)) as number, 'failed', hoursAgo(0.1));
    const body = (
      await buildTestApp({ version: '1', plans }).inject({ method: 'GET', url: '/api/overview' })
    ).json<Overview>();
    // « Voir l'erreur » (état failed) a toujours un plan à montrer dans la liste filtrée.
    expect(body.state).toBe('failed');
    expect(body.plans).toMatchObject({ total: 1, operational: 0, failed: 1, late: 0 });
  });
});
