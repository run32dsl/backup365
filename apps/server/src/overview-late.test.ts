import { FakeBackupCatalog, type BackupCatalog, type StatusReport } from '@backup365/core';
import { describe, expect, it } from 'vitest';
import type { Overview } from './overview-routes.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { buildTestApp } from './test-support.js';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const catalog = new FakeBackupCatalog({
  mailboxes: [
    { id: 'a', displayName: 'Boîte A' },
    { id: 'b', displayName: 'Boîte B' },
  ],
  sites: [{ id: 's', displayName: 'Site S' }],
  snapshots: {
    a: [
      { id: '1', workload: 'mail', createdAt: hoursAgo(2) },
      { id: '2', workload: 'onedrive', createdAt: hoursAgo(72) },
    ],
    b: [{ id: '3', workload: 'mail', createdAt: hoursAgo(1) }],
    s: [{ id: '4', workload: 'sharepoint', createdAt: hoursAgo(30) }],
  },
});

const app = () =>
  buildTestApp({
    version: '1',
    role: 'admin',
    catalog,
    plans: SqlitePlanStore.open(':memory:'),
  });

describe('GET /api/overview, late backups', () => {
  it('lists the backups past the threshold, as many as the stale rows of /api/status', async () => {
    const a = app();
    const overview = (await a.inject({ method: 'GET', url: '/api/overview' })).json<Overview>();
    const status = (await a.inject({ method: 'GET', url: '/api/status' })).json<StatusReport>();
    const stale = status.rows.filter((r) => r.state === 'stale');
    expect(overview.lateBackups).toHaveLength(stale.length);
    expect(overview.lateBackups.map((l) => [l.service, l.name])).toEqual([
      ['onedrive', 'Boîte A'],
      ['sharepoint', 'Site S'],
    ]);
  });

  it('stays a 200 with no late backup when the catalog fails', async () => {
    const failing = {
      listMailboxes: () => Promise.reject(new Error('indisponible')),
    } as unknown as BackupCatalog;
    const res = await buildTestApp({
      version: '1',
      catalog: failing,
      plans: SqlitePlanStore.open(':memory:'),
    }).inject({ method: 'GET', url: '/api/overview' });
    expect(res.statusCode).toBe(200);
    expect(res.json<Overview>().lateBackups).toEqual([]);
  });

  it('is empty without a catalog', async () => {
    const res = await buildTestApp({
      version: '1',
      plans: SqlitePlanStore.open(':memory:'),
    }).inject({ method: 'GET', url: '/api/overview' });
    expect(res.json<Overview>().lateBackups).toEqual([]);
  });
});
