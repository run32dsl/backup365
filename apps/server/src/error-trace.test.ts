import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { PlanScheduler, executeurSimule } from './plan-scheduler.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { sessionFor, testAuth, withHeaders } from './test-support.js';

const parse = (lines: string[]) => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe('erreurs visibles et tracées', () => {
  it('logs a refused run, returns the request id and audits the failure', async () => {
    const { auth } = testAuth();
    const audit = SqliteAuditLog.open(':memory:');
    const plans = SqlitePlanStore.open(':memory:');
    const scheduler = new PlanScheduler({
      plans,
      executeur: executeurSimule,
      listItems: (p) => Promise.resolve(p.selection),
      logger: { info: () => undefined, error: () => undefined },
    });
    const lines: string[] = [];
    const stream = { write: (line: string) => void lines.push(line) };
    const app = withHeaders(
      buildApp({
        version: '1',
        auth,
        audit,
        plans,
        planScheduler: scheduler,
        backupConfigured: false,
        logger: { stream },
      }),
      sessionFor(auth, 'root', 'admin').headers,
    );
    const plan = plans.create({
      name: 'Mails',
      scope: 'selection',
      dataTypes: ['mail'],
      selection: ['a'],
      rpoHours: 4,
      rtoHours: null,
      retentionDays: 30,
      gdprJustification: 'Obligation de conservation.',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/plans/${plan.id}/run`,
      payload: { reason: 'Contrôle secret-du-motif' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>().error).toBe('backup_not_configured');
    const requestId = String(res.headers['x-request-id']);
    expect(requestId).toMatch(/^req-/u);

    const entry = parse(lines).find((l) => l['msg'] === 'action en erreur');
    expect(entry).toMatchObject({
      level: 50,
      route: '/api/plans/:id/run',
      code: 'backup_not_configured',
      reqId: requestId,
      user: 'root',
      status: 503,
    });
    expect(lines.join('')).not.toContain('secret-du-motif');

    const [denied] = (await audit.list({ limit: 10, offset: 0 })).items;
    expect(denied).toMatchObject({
      action: 'access.denied',
      actor: 'root',
      resource: 'plan.run',
      reason: 'backup_not_configured',
    });
  });

  it('logs a 4xx as a warning', async () => {
    const lines: string[] = [];
    const stream = { write: (line: string) => void lines.push(line) };
    const { auth } = testAuth();
    const app = withHeaders(
      buildApp({
        version: '1',
        auth,
        audit: SqliteAuditLog.open(':memory:'),
        plans: SqlitePlanStore.open(':memory:'),
        logger: { stream },
      }),
      sessionFor(auth, 'root', 'admin').headers,
    );
    const res = await app.inject('/api/plans/inconnu/runs');
    expect(res.statusCode).toBe(404);
    const entry = parse(lines).find((l) => l['code']);
    expect(entry).toMatchObject({ level: 40, status: 404, code: 'plan_not_found', user: 'root' });
  });
});
