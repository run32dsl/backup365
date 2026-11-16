import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { sessionFor, testAuth, withHeaders } from './test-support.js';
import type { Role } from './sqlite/sqlite-account-store.js';

function setup(role: Role = 'admin') {
  const { auth } = testAuth();
  const audit = SqliteAuditLog.open(':memory:');
  const plans = SqlitePlanStore.open(':memory:');
  const session = sessionFor(auth, 'root', role);
  const raw = buildApp({ version: '1', auth, audit, plans });
  const app = withHeaders(buildApp({ version: '1', auth, audit, plans }), session.headers);
  return { app, raw, audit, plans };
}

const valid = {
  name: 'Mails 4 h',
  scope: 'all',
  rpoHours: 4,
  retentionDays: 90,
  gdprJustification: 'Obligation de conservation des échanges.',
};

const send = (
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
) => app.inject({ method, url, ...(payload ? { payload } : {}) });

const log = async (audit: SqliteAuditLog) =>
  (await audit.list({ limit: 100, offset: 0 })).items.reverse();

describe('API des plans', () => {
  it('answers 401 without a session', async () => {
    const { raw } = setup();
    expect((await send(raw, 'GET', '/api/plans')).statusCode).toBe(401);
    expect((await send(raw, 'POST', '/api/plans', valid)).statusCode).toBe(401);
    expect((await send(raw, 'PUT', '/api/plans/x', valid)).statusCode).toBe(401);
    expect((await send(raw, 'DELETE', '/api/plans/x')).statusCode).toBe(401);
  });

  it('lets an operator read the list with compliance and last run, nothing else', async () => {
    const { app, plans } = setup('operator');
    const plan = plans.create({
      name: 'Mails',
      scope: 'all',
      dataTypes: ['mail', 'contacts'],
      selection: [],
      rpoHours: 4,
      rtoHours: null,
      retentionDays: 30,
      gdprJustification: 'Obligation légale.',
    });
    const before = (await send(app, 'GET', '/api/plans')).json<{
      items: Record<string, unknown>[];
    }>();
    expect(before.items[0]).not.toHaveProperty('gdprJustification');
    expect(before.items[0]).not.toHaveProperty('selection');
    expect((await send(app, 'GET', `/api/plans/${plan.id}/runs`)).statusCode).toBe(403);
    expect((await send(app, 'POST', `/api/plans/${plan.id}/run`, { reason: 'x' })).statusCode).toBe(
      403,
    );
    expect(before.items[0]).toMatchObject({
      dataTypes: ['mail', 'contacts'],
      compliance: { state: 'late', lastSuccessAt: null },
      running: false,
      lastRun: null,
    });
    const runId = plans.startRun(plan.id, 'a', new Date().toISOString()) as number;
    plans.finishRun(runId, 'success', new Date().toISOString());
    const after = (await send(app, 'GET', '/api/plans')).json<{
      items: Record<string, unknown>[];
    }>();
    expect(after.items[0]).toMatchObject({
      compliance: { state: 'compliant' },
      lastRun: { status: 'success' },
    });
  });

  it('answers 403 to a non-administrator on the write routes', async () => {
    const { app } = setup('operator');
    expect((await send(app, 'POST', '/api/plans', valid)).statusCode).toBe(403);
    expect((await send(app, 'PUT', '/api/plans/x', valid)).statusCode).toBe(403);
    expect((await send(app, 'DELETE', '/api/plans/x')).statusCode).toBe(403);
  });

  it('creates, lists, replaces and deletes a plan', async () => {
    const { app } = setup();
    const created = await send(app, 'POST', '/api/plans', {
      ...valid,
      scope: 'selection',
      selection: ['b', 'a'],
      rtoHours: 8,
    });
    expect(created.statusCode).toBe(201);
    const plan = created.json<{ id: string }>();
    expect(created.json()).toMatchObject({
      name: 'Mails 4 h',
      scope: 'selection',
      selection: ['a', 'b'],
      rpoHours: 4,
      rtoHours: 8,
      retentionDays: 90,
    });

    const list = await send(app, 'GET', '/api/plans');
    expect(list.json<{ items: unknown[] }>().items).toEqual([
      expect.objectContaining(created.json<object>()),
    ]);

    const replaced = await send(app, 'PUT', `/api/plans/${plan.id}`, {
      ...valid,
      name: 'Mails 24 h',
      rpoHours: 24,
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({
      id: plan.id,
      name: 'Mails 24 h',
      scope: 'all',
      selection: [],
      rpoHours: 24,
      rtoHours: null,
    });

    expect((await send(app, 'DELETE', `/api/plans/${plan.id}`)).statusCode).toBe(204);
    expect((await send(app, 'GET', '/api/plans')).json<{ items: unknown[] }>().items).toEqual([]);
  });

  it('refuses a write without a valid CSRF token (403)', async () => {
    const { app, plans } = setup();
    const { id } = (await send(app, 'POST', '/api/plans', valid)).json<{ id: string }>();
    const noToken = { 'x-csrf-token': 'faux' };
    for (const [method, url] of [
      ['POST', '/api/plans'],
      ['PUT', `/api/plans/${id}`],
      ['DELETE', `/api/plans/${id}`],
    ] as const) {
      const res = await app.inject({ method, url, headers: noToken, payload: valid });
      expect(res.statusCode).toBe(403);
    }
    expect(plans.list()).toHaveLength(1);
  });

  it('removes the selection and the run history with the plan', async () => {
    const { app, plans } = setup();
    const { id } = (
      await send(app, 'POST', '/api/plans', { ...valid, scope: 'selection', selection: ['a'] })
    ).json<{ id: string }>();
    const db = (plans as unknown as { db: import('node:sqlite').DatabaseSync }).db;
    db.prepare(
      "INSERT INTO plan_runs (plan_id, item_id, started_at, status) VALUES (?, 'a', 'x', 'running')",
    ).run(id);
    await send(app, 'DELETE', `/api/plans/${id}`);
    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect([count('plans'), count('plan_items'), count('plan_runs')]).toEqual([0, 0, 0]);
  });

  it('answers 404 for an unknown plan', async () => {
    const { app, audit } = setup();
    expect((await send(app, 'PUT', '/api/plans/inconnu', valid)).statusCode).toBe(404);
    expect((await send(app, 'DELETE', '/api/plans/inconnu')).statusCode).toBe(404);
    expect(await log(audit)).toHaveLength(0);
  });

  it('refuses invalid input with a clear message (400) and stores nothing', async () => {
    const { app, plans, audit } = setup();
    const cases: [object, string][] = [
      [{ ...valid, rpoHours: 6 }, 'RPO'],
      [{ ...valid, gdprJustification: '  ' }, 'justification RGPD'],
      [{ ...valid, scope: 'selection' }, 'au moins un élément'],
      [{ ...valid, scope: 'everything' }, 'périmètre'],
      [{ ...valid, scope: 'all', selection: ['a'] }, 'n’accepte pas de sélection'],
      [{ ...valid, name: '' }, 'nom'],
      [{ ...valid, retentionDays: 0 }, 'conservation'],
    ];
    for (const [body, expected] of cases) {
      const res = await send(app, 'POST', '/api/plans', body);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toContain(expected);
    }
    expect((await send(app, 'POST', '/api/plans', { ...valid, rpoHours: '4' })).statusCode).toBe(
      400,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/plans',
          payload: '[1]',
          headers: { 'content-type': 'application/json' },
        })
      ).statusCode,
    ).toBe(400);
    expect(plans.list()).toEqual([]);
    expect(await log(audit)).toHaveLength(0);
  });

  it('validates a replacement like a creation', async () => {
    const { app, plans } = setup();
    const { id } = (await send(app, 'POST', '/api/plans', valid)).json<{ id: string }>();
    const res = await send(app, 'PUT', `/api/plans/${id}`, { ...valid, rpoHours: 5 });
    expect(res.statusCode).toBe(400);
    expect(plans.get(id)?.rpoHours).toBe(4);
  });

  it('refuses a name already taken, case ignored (409)', async () => {
    const { app } = setup();
    expect((await send(app, 'POST', '/api/plans', valid)).statusCode).toBe(201);
    expect(
      (await send(app, 'POST', '/api/plans', { ...valid, name: 'MAILS 4 H' })).statusCode,
    ).toBe(409);
    const other = (await send(app, 'POST', '/api/plans', { ...valid, name: 'Autre' })).json<{
      id: string;
    }>();
    expect(
      (await send(app, 'PUT', `/api/plans/${other.id}`, { ...valid, name: 'mails 4 h' }))
        .statusCode,
    ).toBe(409);
  });

  it('audits each creation, modification and deletion without content', async () => {
    const { app, audit } = setup();
    const { id } = (await send(app, 'POST', '/api/plans', valid)).json<{ id: string }>();
    await send(app, 'PUT', `/api/plans/${id}`, { ...valid, rpoHours: 12, retentionDays: 30 });
    await send(app, 'DELETE', `/api/plans/${id}`);
    const entries = await log(audit);
    expect(entries.map((e) => [e.actor, e.action, e.resource, e.target, e.reason])).toEqual([
      ['root', 'plan.create', 'plan', id, 'scope:all,rpo:4'],
      ['root', 'plan.update', 'plan', id, 'changed:rpoHours,retentionDays'],
      ['root', 'plan.delete', 'plan', id, undefined],
    ]);
    expect(JSON.stringify(entries)).not.toContain('conservation des échanges');
  });

  it('answers 503 without audit log or plan database', async () => {
    const { auth } = testAuth();
    const { headers } = sessionFor(auth, 'root', 'admin');
    const noAudit = withHeaders(
      buildApp({ version: '1', auth, plans: SqlitePlanStore.open(':memory:') }),
      headers,
    );
    expect((await send(noAudit, 'POST', '/api/plans', valid)).statusCode).toBe(503);
    const { auth: auth2 } = testAuth();
    const s2 = sessionFor(auth2, 'root', 'admin');
    const noPlans = withHeaders(
      buildApp({ version: '1', auth: auth2, audit: SqliteAuditLog.open(':memory:') }),
      s2.headers,
    );
    expect((await send(noPlans, 'GET', '/api/plans')).statusCode).toBe(503);
  });
});
