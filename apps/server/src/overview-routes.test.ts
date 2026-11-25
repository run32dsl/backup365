import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { buildTestApp, testAuth } from './test-support.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import type { Overview } from './overview-routes.js';
import type { PlanScheduler } from './plan-scheduler.js';

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

const run = (plans: SqlitePlanStore, planId: string, status: 'success' | 'failed', ago: number) => {
  const id = plans.startRun(planId, 'item', hoursAgo(ago + 0.1));
  plans.finishRun(id!, status, hoursAgo(ago));
};

const get = (plans?: SqlitePlanStore, role: 'admin' | 'operator' = 'admin') => {
  const app = buildTestApp({ version: '1', role, ...(plans ? { plans } : {}) });
  return app.inject({ method: 'GET', url: '/api/overview' });
};

describe('GET /api/overview', () => {
  it('is unconfigured without any plan', async () => {
    const res = await get(SqlitePlanStore.open(':memory:'));
    expect(res.statusCode).toBe(200);
    expect(res.json<Overview>()).toEqual({
      state: 'unconfigured',
      plans: { total: 0, operational: 0, running: 0, queued: 0, failed: 0, late: 0 },
      lastBackupAt: null,
      lastBackupPlan: null,
      lastFailure: null,
      lateBackups: [],
    });
  });

  it('is pending, never unconfigured, once a plan exists without any result', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    plans.create(input('Jamais lancé'));
    const body = (await get(plans)).json<Overview>();
    expect(body).toEqual({
      state: 'pending',
      plans: { total: 1, operational: 0, running: 0, queued: 0, failed: 0, late: 1 },
      lastBackupAt: null,
      lastBackupPlan: null,
      lastFailure: null,
      lateBackups: [],
    });
  });

  it('follows the last result as soon as one plan has one, even if another never ran', async () => {
    const ok = SqlitePlanStore.open(':memory:');
    ok.create(input('Jamais lancé'));
    run(ok, ok.create(input('A')).id, 'success', 2);
    const body = (await get(ok)).json<Overview>();
    expect(body.state).toBe('operational');
    expect(body.plans).toMatchObject({ total: 2, operational: 1 });
    const ko = SqlitePlanStore.open(':memory:');
    ko.create(input('Jamais lancé'));
    run(ko, ko.create(input('B')).id, 'failed', 2);
    expect((await get(ko)).json<Overview>().state).toBe('failed');
  });

  it('is operational when the last run of every plan succeeded', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    run(plans, plans.create(input('A')).id, 'success', 3.5);
    run(plans, plans.create(input('B')).id, 'success', 3);
    const body = (await get(plans)).json<Overview>();
    expect(body.state).toBe('operational');
    expect(body.plans).toMatchObject({ total: 2, operational: 2 });
    expect(Date.now() - Date.parse(body.lastBackupAt!)).toBeLessThan(3.5 * 3_600_000);
    expect(body.lastBackupPlan).toBe('B');
  });

  it('is failed when a plan last run failed, and keeps the last success date', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    const a = plans.create(input('A')).id;
    run(plans, a, 'success', 30);
    run(plans, a, 'failed', 2);
    run(plans, plans.create(input('B')).id, 'success', 10);
    const body = (await get(plans)).json<Overview>();
    expect(body.state).toBe('failed');
    expect(body.plans).toMatchObject({ total: 2, operational: 0, failed: 1, late: 1 });
    const age = Date.now() - Date.parse(body.lastBackupAt!);
    expect(age).toBeGreaterThan(9.5 * 3_600_000);
    expect(age).toBeLessThan(10.5 * 3_600_000);
    expect(body.lastBackupPlan).toBe('B');
  });

  it('names the failed plan and shows the same success time as the plans list', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    run(plans, plans.create(input('Réussi')).id, 'success', 3);
    run(plans, plans.create(input('Raté')).id, 'failed', 5);
    const body = (await get(plans)).json<Overview>();
    expect(body.lastFailure?.plan).toBe('Raté');
    expect(Math.abs(Date.parse(body.lastFailure!.at) - Date.parse(hoursAgo(5)))).toBeLessThan(5000);
    const audit = SqliteAuditLog.open(':memory:');
    const list = await buildTestApp({ version: '1', role: 'admin', plans, audit }).inject({
      method: 'GET',
      url: '/api/plans',
    });
    const items = list.json<{ items: { name: string; lastRun: { finishedAt: string } }[] }>().items;
    expect(body.lastBackupAt).toBe(items.find((p) => p.name === 'Réussi')?.lastRun.finishedAt);
  });

  it('ignores a running run: a relaunched failed plan stays failed, a first run is not a result', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    const a = plans.create(input('A')).id;
    run(plans, a, 'failed', 5);
    plans.startRun(a, 'item', hoursAgo(0.5));
    expect((await get(plans)).json<Overview>().state).toBe('failed');
    const first = SqlitePlanStore.open(':memory:');
    first.startRun(first.create(input('B')).id, 'item', hoursAgo(0.5));
    const body = (await get(first)).json<Overview>();
    expect(body.state).toBe('pending');
    expect(body.plans).toEqual({
      total: 1,
      operational: 0,
      running: 1,
      queued: 0,
      failed: 0,
      late: 1,
    });
  });

  it('counts running and queued plans like GET /api/plans, without changing the state', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    const a = plans.create(input('A')).id;
    const b = plans.create(input('B')).id;
    const c = plans.create(input('C')).id;
    run(plans, a, 'success', 3.5);
    run(plans, b, 'success', 3.2);
    run(plans, c, 'success', 3);
    plans.startRun(a, 'item', hoursAgo(0.1));
    // Le planificateur dit qui attend ; un plan déjà en cours n'est pas compté deux fois.
    const planScheduler = {
      isQueued: (id: string) => id === a || id === b,
    } as unknown as PlanScheduler;
    const app = buildTestApp({ version: '1', plans, planScheduler });
    const body = (await app.inject({ method: 'GET', url: '/api/overview' })).json<Overview>();
    expect(body.plans).toEqual({
      total: 3,
      operational: 3,
      running: 1,
      queued: 1,
      failed: 0,
      late: 0,
    });
    expect(body.state).toBe('operational');
    // Sans planificateur (sauvegarde non configurée) : aucune file.
    expect((await get(plans)).json<Overview>().plans).toMatchObject({ running: 1, queued: 0 });
  });

  it('is open to the operator and carries no plan detail beyond the name', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    run(plans, plans.create(input('Nom visible')).id, 'failed', 1);
    const res = await get(plans, 'operator');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('Obligation de conservation');
  });

  it('answers 503 without plan store and 401 without session', async () => {
    expect((await get()).statusCode).toBe(503);
    const app = buildApp({
      version: '1',
      plans: SqlitePlanStore.open(':memory:'),
      auth: testAuth().auth,
    });
    expect((await app.inject({ method: 'GET', url: '/api/overview' })).statusCode).toBe(401);
  });
});
