import {
  CatalogUnavailableError,
  FakeBackupCatalog,
  NoBackupFoundError,
  type BackupCatalog,
  type StatusReport,
} from '@backup365/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
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
    const app = buildApp({ version: '1', catalog });
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
    const app = buildApp({ version: '1', catalog: withSite });
    const report = (await app.inject({ method: 'GET', url: '/api/status' })).json<StatusReport>();
    expect(report.rows).toMatchObject([{ kind: 'site', sourceId: 'site,1', state: 'stale' }]);
    expect(report.alertCount).toBe(1);
  });

  it('uses the configured threshold and workloads', async () => {
    const app = buildApp({
      version: '1',
      catalog,
      status: { maxAgeHours: 48, workloads: ['mail'] },
    });
    const report = (await app.inject({ method: 'GET', url: '/api/status' })).json<StatusReport>();
    expect(report.rows.map((r) => r.state)).toEqual(['ok', 'ok']);
    expect(report.alertCount).toBe(0);
  });

  it('answers 503 without catalog', async () => {
    const res = await buildApp({ version: '1' }).inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'catalog_unavailable' });
  });

  it('answers a dedicated code when no backup exists yet, and health stays 200', async () => {
    const empty = {
      listMailboxes: () => Promise.reject(new NoBackupFoundError({ cause: new Error('atlas-x') })),
    } as unknown as BackupCatalog;
    const app = buildApp({ version: '1', catalog: empty });
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
    const res = await buildApp({ version: '1', catalog: failing }).inject({
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
