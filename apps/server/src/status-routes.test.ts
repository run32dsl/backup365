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
import { StorageCheck } from './storage-check.js';
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

  describe('volume_octets', () => {
    const volume = async (c: BackupCatalog) => {
      const app = buildTestApp({ version: '1', catalog: c });
      const res = await app.inject({ method: 'GET', url: '/api/status' });
      expect(res.statusCode).toBe(200);
      return res.json<StatusReport>().volume_octets;
    };

    it('sums the sizes of the snapshots of mailboxes and sites', async () => {
      const sized = new FakeBackupCatalog({
        mailboxes: [{ id: 'a', displayName: 'Boîte A' }],
        sites: [{ id: 'site,1', displayName: 'Site de test' }],
        snapshots: {
          a: [
            { id: 's1', workload: 'mail', createdAt: hoursAgo(2), sizeBytes: 1_000 },
            { id: 's2', workload: 'mail', createdAt: hoursAgo(26), sizeBytes: 250 },
            { id: 's3', workload: 'onedrive', createdAt: hoursAgo(3), sizeBytes: 4_000_000_000 },
          ],
          'site,1': [{ id: 'p', workload: 'sharepoint', createdAt: hoursAgo(5), sizeBytes: 7 }],
        },
      });
      expect(await volume(sized)).toBe(4_000_001_257);
    });

    it('answers 0 for an empty catalog', async () => {
      expect(await volume(new FakeBackupCatalog({ mailboxes: [], snapshots: {} }))).toBe(0);
    });

    it('answers null when the size of one snapshot is unavailable', async () => {
      const partial = new FakeBackupCatalog({
        mailboxes: [{ id: 'a', displayName: 'Boîte A' }],
        snapshots: {
          a: [
            { id: 's1', workload: 'mail', createdAt: hoursAgo(2), sizeBytes: 1_000 },
            { id: 's2', workload: 'mail', createdAt: hoursAgo(26) },
          ],
        },
      });
      expect(await volume(partial)).toBeNull();
    });
  });

  describe('plan compliance', () => {
    // Boîte A seule : la boîte B, en retard, ferait passer tout plan qui la couvre en retard.
    const input = (name: string, scope: 'all' | 'selection' = 'selection') => ({
      name,
      scope,
      selection: scope === 'all' ? [] : ['a'],
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

    it('lists a plan as late when a source it covers is late, with the date of its latest backup', async () => {
      const plans = SqlitePlanStore.open(':memory:');
      finished(plans, plans.create(input('Tout', 'all')).id, 'success');
      const report = await get(plans);
      expect(report.plans?.counts).toEqual({ compliant: 0, late: 1, failed: 0 });
      const [late] = report.plans?.nonCompliant ?? [];
      const latest = report.rows.find((r) => r.sourceId === 'a')?.lastSnapshotAt;
      expect(Date.parse(late?.lastRun?.finishedAt ?? '')).toBe(Date.parse(latest ?? ''));
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
        pending: 0,
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
      plans.create({ ...input('Courrier', 'all'), retentionDays: 30 });
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
        // Boîte b en retard (40 h) : l'état du service est le pire de ses sources.
        ['mail', true, 'stale', 365, { kind: 'all' }],
        ['onedrive', false, 'missing', null, null],
        ['sharepoint', false, 'missing', null, null],
      ]);
    });

    // La page « Sources » rapproche `services`, `rows` et `plans` : ce test fixe ce que la route
    // rend pour un plan tout juste créé, jamais exécuté, sur un service sans aucune sauvegarde.
    it('gives a new plan its data types, a service awaiting its first run and rows without backup', async () => {
      const plans = SqlitePlanStore.open(':memory:');
      plans.create({ ...input('Fichiers'), dataTypes: ['onedrive'] });
      const report = await get(plans);
      // Sans `dataTypes`, la page ne peut pas savoir quel service un plan listé couvre.
      expect(report.plans?.nonCompliant).toMatchObject([
        { name: 'Fichiers', state: 'late', dataTypes: ['onedrive'], lastRun: null },
      ]);
      expect(report.services?.find((s) => s.service === 'onedrive')).toMatchObject({
        hasPlan: true,
        lastSnapshotAt: null,
        awaitingFirstRun: true,
      });
      // Une ligne par compte connu, même jamais sauvegardé : elles ne valent pas une sauvegarde.
      expect(
        report.rows.filter((r) => r.workload === 'onedrive').map((r) => r.lastSnapshotAt),
      ).toEqual([null, null]);
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

  describe('conditional writes of the storage (SDK 7.2.0, issue #567)', () => {
    const get = async (
      support: string | Error,
      role: Role = 'admin',
    ): Promise<{ body: Record<string, unknown>; probes: number }> => {
      let probes = 0;
      const storage = new StorageCheck({
        checkStorage: () => {
          probes++;
          return support instanceof Error
            ? Promise.reject(support)
            : Promise.resolve({ conditionalWrites: { support, detail: 'bucket tenant-x' } });
        },
      });
      const app = buildTestApp({
        version: '1',
        catalog,
        role,
        status: { maxAgeHours: 26, workloads: ['mail'], storage },
      });
      const body = (await app.inject({ method: 'GET', url: '/api/status' })).json<
        Record<string, unknown>
      >();
      await app.inject({ method: 'GET', url: '/api/status' });
      return { body, probes };
    };

    it('tells an administrator whether the storage honours them, probing once', async () => {
      const ok = await get('supported');
      expect(ok.body['storage']).toEqual({ conditionalWrites: 'supported' });
      expect(ok.probes).toBe(1);
      expect((await get('ignored')).body['storage']).toEqual({ conditionalWrites: 'ignored' });
      expect((await get('not_probed')).body['storage']).toEqual({
        conditionalWrites: 'not_probed',
      });
    });

    it('never passes on the SDK detail, and answers null when the check fails', async () => {
      expect(JSON.stringify((await get('ignored')).body)).not.toContain('tenant-x');
      const failed = await get(new Error('https://s3.example.test/tenant-x denied'));
      expect(failed.body['storage']).toEqual({ conditionalWrites: null });
      expect(JSON.stringify(failed.body)).not.toContain('tenant-x');
      // Un échec est gardé quelques minutes : la page suivante ne refait pas la vérification.
      expect(failed.probes).toBe(1);
      expect((await get('something-new')).body['storage']).toEqual({ conditionalWrites: null });
    });

    it('tells a non-administrator only that restores are suspended (#614)', async () => {
      const { body, probes } = await get('ignored', 'operator');
      expect(body).not.toHaveProperty('storage');
      expect(body['restoreSuspended']).toBe(true);
      expect(JSON.stringify(body)).not.toContain('conditionalWrites');
      expect(probes).toBe(1);
      expect((await get('supported', 'operator')).body['restoreSuspended']).toBe(false);
      expect((await get(new Error('down'), 'operator')).body['restoreSuspended']).toBe(false);
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
