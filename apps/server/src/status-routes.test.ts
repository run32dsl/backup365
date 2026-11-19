import {
  CatalogUnavailableError,
  FakeBackupCatalog,
  NoBackupFoundError,
  type BackupCatalog,
  type PlanComplianceReport,
  type StatusReport,
} from '@backup365/core';
import { describe, expect, it } from 'vitest';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { ROLES, type Role } from './sqlite/sqlite-account-store.js';
import { buildApp } from './app.js';
import { buildTestApp, testAuth } from './test-support.js';
import { parseMaxAgeHours, parseSiteCacheTtlMs, parseStatusWorkloads } from './config.js';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const catalog = new FakeBackupCatalog({
  mailboxes: [
    { id: 'a', displayName: 'Boîte A' },
    { id: 'b', displayName: 'Boîte B' },
  ],
  snapshots: {
    a: [{ id: 's1', workload: 'mail', createdAt: hoursAgo(2) }],
    b: [{ id: 's2', workload: 'mail', createdAt: hoursAgo(40) }],
  },
});

describe('GET /api/status', () => {
  it('returns the state per mailbox and workload with the alert count', async () => {
    const app = buildTestApp({ version: '1', catalog });
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(200);
    const report = res.json<StatusReport>();
    expect(report.maxAgeHours).toBe(26);
    expect(report.rows.map((r) => [r.sourceId, r.workload, r.state])).toEqual([
      ['a', 'mail', 'ok'],
      ['a', 'onedrive', 'missing'],
      ['b', 'mail', 'stale'],
      ['b', 'onedrive', 'missing'],
    ]);
    expect(report.alertCount).toBe(3);
  });

  it('includes backed-up SharePoint sites in rows and alerts', async () => {
    const withSite = new FakeBackupCatalog({
      mailboxes: [],
      sites: [{ id: 'site,1', displayName: 'Site de test' }],
      snapshots: { 'site,1': [{ id: 'p', workload: 'sharepoint', createdAt: hoursAgo(30) }] },
    });
    const app = buildTestApp({ version: '1', catalog: withSite });
    const report = (await app.inject({ method: 'GET', url: '/api/status' })).json<StatusReport>();
    expect(report.rows).toMatchObject([{ kind: 'site', sourceId: 'site,1', state: 'stale' }]);
    expect(report.alertCount).toBe(1);
  });

  describe('plan compliance', () => {
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
    const finished = (plans: SqlitePlanStore, planId: string, status: 'success' | 'failed') => {
      const id = plans.startRun(planId, 'item', hoursAgo(1));
      plans.finishRun(id!, status, hoursAgo(0.9));
    };
    const get = async (plans?: SqlitePlanStore, role: Role = 'admin') => {
      const app = buildTestApp({ version: '1', catalog, role, ...(plans ? { plans } : {}) });
      return (await app.inject({ method: 'GET', url: '/api/status' })).json<
        StatusReport & { plans?: PlanComplianceReport | null }
      >();
    };

    it('counts compliant, late and failed plans and lists the non-compliant ones', async () => {
      const plans = SqlitePlanStore.open(':memory:');
      finished(plans, plans.create(input('Conforme')).id, 'success');
      finished(plans, plans.create(input('Échoué')).id, 'failed');
      plans.create(input('Jamais lancé'));
      const report = await get(plans);
      expect(report.plans?.counts).toEqual({ compliant: 1, late: 1, failed: 1 });
      expect(report.plans?.nonCompliant.map((p) => [p.name, p.state])).toEqual([
        ['Jamais lancé', 'late'],
        ['Échoué', 'failed'],
      ]);
    });

    it.each(ROLES.filter((role) => role !== 'admin'))(
      'hides plan counts and names from the %s role (PO decision, pending PM)',
      async (role) => {
        const plans = SqlitePlanStore.open(':memory:');
        finished(plans, plans.create(input('Échoué')).id, 'failed');
        const app = buildTestApp({ version: '1', catalog, role, plans });
        const res = await app.inject({ method: 'GET', url: '/api/status' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).not.toHaveProperty('plans');
        expect(res.body).not.toContain('Échoué');
        expect(res.json<StatusReport>().rows).toHaveLength(4);
      },
    );

    it('omits the plans without a session', async () => {
      const plans = SqlitePlanStore.open(':memory:');
      finished(plans, plans.create(input('Échoué')).id, 'failed');
      const app = buildApp({ version: '1', catalog, plans, auth: testAuth().auth });
      const res = await app.inject({ method: 'GET', url: '/api/status' });
      expect(res.json()).not.toHaveProperty('plans');
      expect(res.body).not.toContain('Échoué');
    });

    it('has no mode without authentication: no auth service gives a 503 without plans', async () => {
      const plans = SqlitePlanStore.open(':memory:');
      finished(plans, plans.create(input('Échoué')).id, 'failed');
      const app = buildApp({ version: '1', catalog, plans });
      const res = await app.inject({ method: 'GET', url: '/api/status' });
      expect(res.statusCode).toBe(503);
      expect(res.body).not.toContain('Échoué');
    });

    it('hides the plans from a non-administrator even when the plan store fails', async () => {
      const plans = SqlitePlanStore.open(':memory:');
      plans.close();
      expect(await get(plans, 'operator')).not.toHaveProperty('plans');
    });

    it('reports zero everywhere when there is no plan', async () => {
      const report = await get(SqlitePlanStore.open(':memory:'));
      expect(report.plans).toEqual({
        counts: { compliant: 0, late: 0, failed: 0 },
        nonCompliant: [],
      });
    });

    it('omits the plans without a plan store', async () => {
      expect(await get()).not.toHaveProperty('plans');
    });

    it('answers null when the plan store fails, without failing the dashboard', async () => {
      const plans = SqlitePlanStore.open(':memory:');
      plans.close();
      const report = await get(plans);
      expect(report.plans).toBeNull();
      expect(report.services).toBeNull();
      expect(report.rows).toHaveLength(4);
    });

    it('gives one line per service with retention and scope, and no plan for OneDrive', async () => {
      const plans = SqlitePlanStore.open(':memory:');
      plans.create({ ...input('Courrier'), retentionDays: 30 });
      plans.create({
        ...input('Courrier long'),
        scope: 'selection',
        selection: ['a'],
        retentionDays: 365,
      });
      const { services } = await get(plans);
      expect(
        services?.map((s) => [s.service, s.hasPlan, s.state, s.retentionDays, s.scope]),
      ).toEqual([
        ['mail', true, 'ok', 365, { kind: 'all' }],
        ['onedrive', false, 'missing', null, null],
        ['sharepoint', false, 'missing', null, null],
      ]);
    });

    it('counts the distinct selected items when no plan covers a whole service', async () => {
      const plans = SqlitePlanStore.open(':memory:');
      plans.create({ ...input('A'), scope: 'selection', selection: ['a', 'b'] });
      plans.create({ ...input('B'), scope: 'selection', selection: ['b'] });
      const { services } = await get(plans);
      expect(services?.[0]?.scope).toEqual({ kind: 'selection', count: 2 });
    });

    it('hides the services from a non-administrator', async () => {
      const plans = SqlitePlanStore.open(':memory:');
      expect(await get(plans, 'operator')).not.toHaveProperty('services');
    });
  });

  it('uses the configured threshold and workloads', async () => {
    const app = buildTestApp({
      version: '1',
      catalog,
      status: { maxAgeHours: 48, workloads: ['mail'] },
    });
    const report = (await app.inject({ method: 'GET', url: '/api/status' })).json<StatusReport>();
    expect(report.rows.map((r) => r.state)).toEqual(['ok', 'ok']);
    expect(report.alertCount).toBe(0);
  });

  it('exposes the audit anchoring state', async () => {
    const get = async (
      auditAnchor: NonNullable<Parameters<typeof buildTestApp>[0]['status']>['auditAnchor'],
    ) => {
      const app = buildTestApp({
        version: '1',
        catalog,
        status: { maxAgeHours: 26, workloads: ['mail'], auditAnchor },
      });
      return (await app.inject({ method: 'GET', url: '/api/status' })).json<
        Record<string, unknown>
      >();
    };
    expect(
      (await get({ configured: false, reason: 'BACKUP365_AUDIT_ANCHOR_DIR absent' }))[
        'auditAnchor'
      ],
    ).toEqual({
      configured: false,
      label: 'ancrage du journal : non configuré',
      reason: 'BACKUP365_AUDIT_ANCHOR_DIR absent',
    });
    expect((await get({ configured: true }))['auditAnchor']).toEqual({
      configured: true,
      label: 'ancrage du journal : configuré',
    });
  });

  it('answers 503 without catalog', async () => {
    const res = await buildTestApp({ version: '1' }).inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'catalog_unavailable' });
  });

  it('answers a dedicated code when no backup exists yet, and health stays 200', async () => {
    const empty = {
      listMailboxes: () => Promise.reject(new NoBackupFoundError({ cause: new Error('atlas-x') })),
    } as unknown as BackupCatalog;
    const app = buildTestApp({ version: '1', catalog: empty });
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'no_backup_found' });
    const mailboxes = await app.inject({ method: 'GET', url: '/api/mailboxes' });
    expect(mailboxes.json()).toEqual({ error: 'no_backup_found' });
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });

  it('answers 503 without detail when the catalog fails', async () => {
    const failing = {
      listMailboxes: () => Promise.reject(new CatalogUnavailableError('bucket atlas-secret')),
    } as unknown as BackupCatalog;
    const res = await buildTestApp({ version: '1', catalog: failing }).inject({
      method: 'GET',
      url: '/api/status',
    });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('secret');
  });
});

describe('status configuration', () => {
  it('parses the threshold', () => {
    expect(parseMaxAgeHours(undefined)).toBe(26);
    expect(parseMaxAgeHours('12.5')).toBe(12.5);
    for (const bad of ['0', '-1', 'abc', '9000']) {
      expect(() => parseMaxAgeHours(bad)).toThrow('BACKUP365_STATUS_MAX_AGE_HOURS');
    }
  });
  it('parses the site cache duration', () => {
    expect(parseSiteCacheTtlMs(undefined)).toBe(3_600_000);
    expect(parseSiteCacheTtlMs('5')).toBe(300_000);
    for (const bad of ['0', '1.5', 'abc', '1441']) {
      expect(() => parseSiteCacheTtlMs(bad)).toThrow('BACKUP365_CATALOG_CACHE_MINUTES');
    }
  });
  it('parses the workloads', () => {
    expect(parseStatusWorkloads(undefined)).toEqual(['mail', 'onedrive', 'sharepoint']);
    expect(parseStatusWorkloads('mail, contacts,mail')).toEqual(['mail', 'contacts']);
    expect(() => parseStatusWorkloads('mail,chat')).toThrow('BACKUP365_STATUS_WORKLOADS');
  });
});
