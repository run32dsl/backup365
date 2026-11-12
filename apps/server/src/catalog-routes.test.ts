import { CONTRACT_FIXTURE } from '@backup365/core/testing';
import {
  CatalogUnavailableError,
  FakeBackupCatalog,
  type AuditLog,
  type BackupCatalog,
} from '@backup365/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';

const fake = new FakeBackupCatalog({
  mailboxes: [{ ...CONTRACT_FIXTURE.mailbox }],
  snapshots: { 'mbx-1': CONTRACT_FIXTURE.snapshots.map((s) => ({ ...s })) },
  details: { 'snap-new': { ...CONTRACT_FIXTURE.detail } },
});

describe('catalog routes', () => {
  it('lists mailboxes', async () => {
    const app = buildApp({ version: '1', catalog: fake, audit: SqliteAuditLog.open(':memory:') });
    const res = await app.inject({ method: 'GET', url: '/api/mailboxes' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mailboxes: [CONTRACT_FIXTURE.mailbox] });
  });

  it('lists mail snapshots by default, newest first', async () => {
    const app = buildApp({ version: '1', catalog: fake, audit: SqliteAuditLog.open(':memory:') });
    const res = await app.inject({ method: 'GET', url: '/api/mailboxes/mbx-1/snapshots' });
    expect(res.statusCode).toBe(200);
    const ids = res.json<{ snapshots: { id: string }[] }>().snapshots.map((s) => s.id);
    expect(ids).toEqual(['snap-new', 'snap-old']);
  });

  it('filters by workload', async () => {
    const app = buildApp({ version: '1', catalog: fake, audit: SqliteAuditLog.open(':memory:') });
    const res = await app.inject({
      method: 'GET',
      url: '/api/mailboxes/mbx-1/snapshots?workload=contacts',
    });
    expect(res.json<{ snapshots: { id: string }[] }>().snapshots).toHaveLength(1);
  });

  it('rejects an unknown workload', async () => {
    const app = buildApp({ version: '1', catalog: fake, audit: SqliteAuditLog.open(':memory:') });
    const res = await app.inject({
      method: 'GET',
      url: '/api/mailboxes/mbx-1/snapshots?workload=nope',
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 503 when no catalog is configured', async () => {
    const app = buildApp({ version: '1', audit: SqliteAuditLog.open(':memory:') });
    expect((await app.inject({ method: 'GET', url: '/api/mailboxes' })).statusCode).toBe(503);
    const res = await app.inject({ method: 'GET', url: '/api/mailboxes/mbx-1/snapshots' });
    expect(res.statusCode).toBe(503);
  });

  it('answers 503 on the snapshots route when the catalog fails', async () => {
    const failing: BackupCatalog = {
      listMailboxes: () => Promise.resolve([]),
      listSnapshots: () => Promise.reject(new CatalogUnavailableError('x')),
      getSnapshotDetail: () => Promise.resolve(null),
      listSites: () => Promise.resolve([]),
      listSiteSnapshots: () => Promise.resolve([]),
    };
    const app = buildApp({
      version: '1',
      catalog: failing,
      audit: SqliteAuditLog.open(':memory:'),
    });
    const res = await app.inject({ method: 'GET', url: '/api/mailboxes/mbx-1/snapshots' });
    expect(res.statusCode).toBe(503);
  });

  it('rejects an oversized mailbox id', async () => {
    const app = buildApp({ version: '1', catalog: fake, audit: SqliteAuditLog.open(':memory:') });
    const res = await app.inject({
      method: 'GET',
      url: `/api/mailboxes/${'a'.repeat(257)}/snapshots`,
    });
    // La limite du routeur (512, app.ts) dépasse celle du schéma (256) : le schéma répond 400.
    expect(res.statusCode).toBe(400);
  });

  it('keeps other errors as 500', async () => {
    const broken: BackupCatalog = {
      ...fake,
      listMailboxes: () => Promise.reject(new Error('boom')),
      listSnapshots: () => Promise.resolve([]),
      getSnapshotDetail: () => Promise.resolve(null),
      listSites: () => Promise.resolve([]),
      listSiteSnapshots: () => Promise.resolve([]),
    };
    const app = buildApp({ version: '1', catalog: broken, audit: SqliteAuditLog.open(':memory:') });
    expect((await app.inject({ method: 'GET', url: '/api/mailboxes' })).statusCode).toBe(500);
  });

  describe('audit', () => {
    const entries = async (audit: SqliteAuditLog) =>
      (await audit.list({ limit: 100, offset: 0 })).items.reverse();

    const failing = {
      record: () => Promise.reject(new Error('disk full')),
    } as unknown as AuditLog;
    const down: BackupCatalog = {
      ...fake,
      listMailboxes: () => Promise.reject(new CatalogUnavailableError('bucket x denied')),
      listSnapshots: () => Promise.reject(new CatalogUnavailableError('bucket x denied')),
      getSnapshotDetail: () => Promise.reject(new CatalogUnavailableError('bucket x denied')),
      listSites: () => Promise.resolve([]),
      listSiteSnapshots: () => Promise.resolve([]),
    };

    it('records snapshot openings only, not the metadata lists', async () => {
      const audit = SqliteAuditLog.open(':memory:');
      const app = buildApp({ version: '1', catalog: fake, audit });
      await app.inject({ method: 'GET', url: '/api/mailboxes' });
      await app.inject({ method: 'GET', url: '/api/mailboxes/mbx-1/snapshots' });
      await app.inject({ method: 'GET', url: '/api/snapshots/snap-new' });
      expect((await entries(audit)).map((e) => [e.action, e.resource, e.target])).toEqual([
        ['item.open', 'snapshot', 'snap-new'],
      ]);
      expect(await audit.verify()).toEqual({ ok: true, entries: 1 });
    });

    it('serves the metadata lists without audit log or with a failing one', async () => {
      for (const audit of [undefined, failing]) {
        const app = buildApp({ version: '1', catalog: fake, audit });
        expect((await app.inject({ method: 'GET', url: '/api/mailboxes' })).statusCode).toBe(200);
        const res = await app.inject({ method: 'GET', url: '/api/mailboxes/mbx-1/snapshots' });
        expect(res.statusCode).toBe(200);
      }
    });

    it('does not record an access failure on the metadata lists', async () => {
      const audit = SqliteAuditLog.open(':memory:');
      const res = await buildApp({ version: '1', catalog: down, audit }).inject({
        method: 'GET',
        url: '/api/mailboxes/mbx-1/snapshots',
      });
      expect(res.statusCode).toBe(503);
      await buildApp({ version: '1', audit }).inject({ method: 'GET', url: '/api/mailboxes' });
      expect(await entries(audit)).toEqual([]);
    });

    it('records an access failure when the catalog is unavailable on a snapshot', async () => {
      const audit = SqliteAuditLog.open(':memory:');
      const app = buildApp({ version: '1', catalog: down, audit });
      const res = await app.inject({ method: 'GET', url: '/api/snapshots/snap-new' });
      expect(res.statusCode).toBe(503);
      expect((await entries(audit)).map((e) => [e.action, e.resource, e.reason])).toEqual([
        ['access.denied', 'snapshot', 'catalog_unavailable'],
      ]);
      expect(JSON.stringify(await entries(audit))).not.toContain('bucket');
    });

    it('records an access failure without catalog, and for an unknown snapshot', async () => {
      const audit = SqliteAuditLog.open(':memory:');
      await buildApp({ version: '1', audit }).inject({ method: 'GET', url: '/api/snapshots/x' });
      const app = buildApp({ version: '1', catalog: fake, audit });
      const res = await app.inject({ method: 'GET', url: '/api/snapshots/inconnu' });
      expect(res.statusCode).toBe(404);
      expect((await entries(audit)).map((e) => [e.action, e.reason])).toEqual([
        ['access.denied', 'catalog_unavailable'],
        ['access.denied', 'not_found'],
      ]);
    });

    it('answers 503 without audit log and sends nothing when recording fails', async () => {
      const noAudit = buildApp({ version: '1', catalog: fake });
      const res0 = await noAudit.inject({ method: 'GET', url: '/api/snapshots/snap-new' });
      expect(res0.statusCode).toBe(503);
      const app = buildApp({ version: '1', catalog: fake, audit: failing });
      const res = await app.inject({ method: 'GET', url: '/api/snapshots/snap-new' });
      expect(res.statusCode).toBe(500);
      expect(res.body).toBe('{"error":"internal_error"}');
    });

    it('answers 503 catalog_unavailable even when recording the denial fails', async () => {
      const app = buildApp({ version: '1', catalog: down, audit: failing });
      const res = await app.inject({ method: 'GET', url: '/api/snapshots/snap-new' });
      expect(res.statusCode).toBe(503);
      expect(res.body).toBe('{"error":"catalog_unavailable"}');
    });
  });

  it('answers 503 without details when the catalog fails', async () => {
    const failing: BackupCatalog = {
      ...fake,
      listMailboxes: () => Promise.reject(new CatalogUnavailableError('bucket x denied')),
      listSnapshots: () => Promise.reject(new CatalogUnavailableError('bucket x denied')),
      getSnapshotDetail: () => Promise.resolve(null),
      listSites: () => Promise.resolve([]),
      listSiteSnapshots: () => Promise.resolve([]),
    };
    const app = buildApp({
      version: '1',
      catalog: failing,
      audit: SqliteAuditLog.open(':memory:'),
    });
    const res = await app.inject({ method: 'GET', url: '/api/mailboxes' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('{"error":"catalog_unavailable"}');
  });
});
