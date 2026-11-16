import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { PlanScheduler, executeurSimule } from './plan-scheduler.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import type { Role } from './sqlite/sqlite-account-store.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { sessionFor, testAuth, withHeaders } from './test-support.js';

function setup(role: Role = 'admin', withScheduler = true) {
  const { auth } = testAuth();
  const audit = SqliteAuditLog.open(':memory:');
  const plans = SqlitePlanStore.open(':memory:');
  const scheduler = new PlanScheduler({
    plans,
    executeur: executeurSimule,
    listItems: (p) => Promise.resolve(p.selection),
    logger: { info: () => undefined, error: () => undefined },
  });
  const options = {
    version: '1',
    auth,
    audit,
    plans,
    ...(withScheduler ? { planScheduler: scheduler } : {}),
  };
  const session = sessionFor(auth, 'root', role);
  const raw = buildApp(options);
  const app = withHeaders(buildApp(options), session.headers);
  const plan = plans.create({
    name: 'Mails',
    scope: 'selection',
    dataTypes: ['mail'],
    selection: ['a', 'b'],
    rpoHours: 4,
    rtoHours: null,
    retentionDays: 30,
    gdprJustification: 'Obligation de conservation.',
  });
  return { app, raw, audit, plans, plan, scheduler };
}

const run = (app: FastifyInstance, id: string, payload?: object) =>
  app.inject({ method: 'POST', url: `/api/plans/${id}/run`, ...(payload ? { payload } : {}) });
const runs = (app: FastifyInstance, id: string) =>
  app.inject({ method: 'GET', url: `/api/plans/${id}/runs` });

describe('historique et lancement manuel', () => {
  it('answers 401 without a session and 403 to a non-administrator', async () => {
    const { raw, plan } = setup();
    expect((await runs(raw, plan.id)).statusCode).toBe(401);
    expect((await run(raw, plan.id, { reason: 'test' })).statusCode).toBe(401);
    const operator = setup('operator');
    expect((await runs(operator.app, operator.plan.id)).statusCode).toBe(403);
    expect((await run(operator.app, operator.plan.id, { reason: 'test' })).statusCode).toBe(403);
  });

  it('refuses a manual run without a reason, starts nothing and audits nothing', async () => {
    const { app, plan, plans, audit } = setup();
    for (const payload of [undefined, {}, { reason: '' }, { reason: '   ' }, { reason: 3 }]) {
      const res = await run(app, plan.id, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'reason_required' });
    }
    expect((await run(app, plan.id, { reason: 'x'.repeat(201) })).statusCode).toBe(400);
    expect(plans.listRuns(plan.id, 10)).toEqual([]);
    expect((await audit.list({ limit: 10, offset: 0 })).items).toHaveLength(0);
  });

  it('runs the plan at once, audits the reason and lists the history', async () => {
    const { app, plan, audit } = setup();
    const res = await run(app, plan.id, { reason: 'Contrôle avant audit' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ started: 2, skipped: 0 });

    await vi.waitFor(async () => {
      const items = (await runs(app, plan.id)).json<{ items: { status: string }[] }>().items;
      expect(items).toHaveLength(2);
      expect(items.every((r) => r.status === 'success')).toBe(true);
    });
    const [item] = (await runs(app, plan.id)).json<{ items: Record<string, unknown>[] }>().items;
    expect(item).toMatchObject({ planId: plan.id, error: null });
    expect(item?.['finishedAt']).toEqual(expect.any(String));

    const entries = (await audit.list({ limit: 10, offset: 0 })).items;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'plan.run',
      actor: 'root',
      resource: 'plan',
      target: plan.id,
      reason: 'Contrôle avant audit',
    });
  });

  it('answers 409 when every item is already running', async () => {
    const { app, plan, plans, audit } = setup();
    plans.startRun(plan.id, 'a', new Date().toISOString());
    plans.startRun(plan.id, 'b', new Date().toISOString());
    const res = await run(app, plan.id, { reason: 'Relance' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'run_in_progress' });
    const entries = (await audit.list({ limit: 10, offset: 0 })).items;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'plan.run', target: plan.id, reason: 'Relance' });
  });

  it('lists runs from the most recent to the oldest', async () => {
    const { app, plan, plans } = setup();
    for (const [item, at] of [
      ['a', '2026-03-01T10:00:00.000Z'],
      ['b', '2026-03-01T12:00:00.000Z'],
    ] as const) {
      const id = plans.startRun(plan.id, item, at);
      plans.finishRun(id as number, 'success', at);
    }
    const items = (await runs(app, plan.id)).json<{ items: { itemId: string }[] }>().items;
    expect(items.map((r) => r.itemId)).toEqual(['b', 'a']);
  });

  it('answers 503 when the plan items cannot be read', async () => {
    const { plan, plans } = setup();
    const broken = new PlanScheduler({
      plans,
      executeur: executeurSimule,
      listItems: () => Promise.reject(new Error('down')),
      logger: { info: () => undefined, error: () => undefined },
    });
    const { auth } = testAuth();
    const audit = SqliteAuditLog.open(':memory:');
    const session = sessionFor(auth, 'root', 'admin');
    const other = withHeaders(
      buildApp({ version: '1', auth, audit, plans, planScheduler: broken }),
      session.headers,
    );
    const res = await run(other, plan.id, { reason: 'Contrôle' });
    expect(res.statusCode).toBe(503);
    // L'audit est consigné avant le lancement, donc avant l'échec.
    const entries = (await audit.list({ limit: 10, offset: 0 })).items;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'plan.run', target: plan.id, reason: 'Contrôle' });
  });

  it('answers 404 for an unknown plan and 503 without scheduler', async () => {
    const { app } = setup();
    expect((await runs(app, 'inconnu')).statusCode).toBe(404);
    expect((await run(app, 'inconnu', { reason: 'x' })).statusCode).toBe(404);
    const off = setup('admin', false);
    const res = await run(off.app, off.plan.id, { reason: 'x' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'scheduler_unavailable' });
  });
});
