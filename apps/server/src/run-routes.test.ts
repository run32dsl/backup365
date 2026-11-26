import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import type { Role } from './sqlite/sqlite-account-store.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { sessionFor, testAuth, withHeaders } from './test-support.js';

const base = {
  scope: 'selection' as const,
  dataTypes: ['mail' as const],
  rpoHours: 24 as const,
  rtoHours: null,
  retentionDays: 30,
  gdprJustification: 'Obligation de conservation.',
};

const day = (n: number, minutes = 0) => new Date(Date.UTC(2026, 10, n, 2, minutes)).toISOString();

function setup(role: Role = 'admin', withPlans = true) {
  const { auth } = testAuth();
  const audit = SqliteAuditLog.open(':memory:');
  const plans = SqlitePlanStore.open(':memory:');
  const options = { version: '1', auth, audit, ...(withPlans ? { plans } : {}) };
  const raw = buildApp(options);
  const app = withHeaders(buildApp(options), sessionFor(auth, 'root', role).headers);
  const a = plans.create({ ...base, name: 'Direction', selection: ['box-a'] });
  const b = plans.create({ ...base, name: 'Comptabilité', selection: ['box-b'] });
  const ok = plans.startRun(a.id, 'box-a', day(16))!;
  plans.finishRun(ok, 'success', day(16, 14), undefined, {
    itemsSaved: 1284,
    sourceBytes: 3_400_000_000,
  });
  const ko = plans.startRun(a.id, 'box-a', day(17))!;
  plans.finishRun(ko, 'failed', day(17, 3), 'backup_errors');
  const cut = plans.startRun(b.id, 'box-b', day(18))!;
  plans.finishRun(cut, 'failed', day(18, 9), 'interrupted');
  const odd = plans.startRun(b.id, 'box-b', day(19))!;
  plans.finishRun(odd, 'failed', day(19, 1), 'ECONNRESET');
  plans.startRun(a.id, 'box-a', day(20));
  return { app, raw, plans, a, b };
}

const get = async (app: ReturnType<typeof setup>['app'], query = '') => {
  const res = await app.inject({ method: 'GET', url: `/api/runs${query}` });
  return { status: res.statusCode, body: res.json<{ items: Record<string, unknown>[] }>() };
};

describe('GET /api/runs', () => {
  it('lists the runs of every plan, most recent first, with a readable result', async () => {
    const { app } = setup();
    const { status, body } = await get(app);
    expect(status).toBe(200);
    expect(body.items.map((r) => [r.planName, r.result])).toEqual([
      ['Direction', 'running'],
      ['Comptabilité', 'failed'],
      ['Comptabilité', 'interrupted'],
      ['Direction', 'failed'],
      ['Direction', 'success'],
    ]);
    const success = body.items[4]!;
    expect(success).toMatchObject({
      startedAt: day(16),
      durationMs: 14 * 60_000,
      itemsSaved: 1284,
      sourceBytes: 3_400_000_000,
    });
    expect(success).not.toHaveProperty('failureCause');
  });

  it('gives a cause from the closed list, never the raw error code', async () => {
    const { app } = setup();
    const { body } = await get(app);
    expect(body.items.map((r) => r.failureCause)).toEqual([
      undefined,
      'unknown',
      'interrupted',
      'backup_errors',
      undefined,
    ]);
    expect(JSON.stringify(body)).not.toContain('ECONNRESET');
    for (const item of body.items) expect(item).not.toHaveProperty('error');
  });

  it('filters by plan and by result', async () => {
    const { app, a, b } = setup();
    const byPlan = await get(app, `?planId=${a.id}`);
    expect(byPlan.body.items).toHaveLength(3);
    expect(byPlan.body.items.every((r) => r.planId === a.id)).toBe(true);
    const failed = await get(app, '?result=failed');
    expect(failed.body.items.map((r) => r.failureCause)).toEqual(['unknown', 'backup_errors']);
    const interrupted = await get(app, `?planId=${b.id}&result=interrupted`);
    expect(interrupted.body.items).toHaveLength(1);
    expect((await get(app, '?planId=inconnu')).body.items).toEqual([]);
  });

  it('keeps only the 20 most recent runs', async () => {
    const { app, plans, b } = setup();
    for (let n = 0; n < 25; n += 1) {
      const id = plans.startRun(b.id, 'box-b', new Date(Date.UTC(2026, 9, 1 + n)).toISOString())!;
      plans.finishRun(id, 'success', new Date(Date.UTC(2026, 9, 1 + n, 1)).toISOString());
    }
    const { body } = await get(app);
    expect(body.items).toHaveLength(20);
    expect(body.items[0]!.result).toBe('running');
  });

  it('returns only the requested number of runs, from 1 to 20 (home page: 5)', async () => {
    const { app } = setup();
    const { status, body } = await get(app, '?limit=2');
    expect(status).toBe(200);
    expect(body.items.map((r) => r.result)).toEqual(['running', 'failed']);
    expect(body).toMatchObject({ limit: 2 });
    for (const bad of ['0', '21', 'deux', '1.5']) {
      expect((await get(app, `?limit=${bad}`)).status).toBe(400);
    }
  });

  it('refuses an unknown result, answers 401 without a session and is open to operators', async () => {
    const { app, raw } = setup();
    expect((await get(app, '?result=deleted')).status).toBe(400);
    expect((await raw.inject({ method: 'GET', url: '/api/runs' })).statusCode).toBe(401);
    const operator = setup('operator');
    expect((await get(operator.app)).status).toBe(200);
  });

  it('drops odd engine figures and never records a volume for a failed run', () => {
    const { plans, a } = setup();
    const odd = plans.startRun(a.id, 'box-x', day(21))!;
    plans.finishRun(odd, 'success', day(21, 1), undefined, { itemsSaved: -3, sourceBytes: 1.5 });
    const ko = plans.startRun(a.id, 'box-y', day(22))!;
    plans.finishRun(ko, 'failed', day(22, 1), 'backup_errors', { itemsSaved: 5, sourceBytes: 9 });
    const [failed, success] = plans.listRecentRuns({ planId: a.id, limit: 2 });
    expect([failed?.itemsSaved, failed?.sourceBytes]).toEqual([null, null]);
    expect([success?.itemsSaved, success?.sourceBytes]).toEqual([null, null]);
  });

  it('answers 503 without a plan store', async () => {
    const { app } = setup('admin', false);
    expect((await get(app)).status).toBe(503);
  });
});
