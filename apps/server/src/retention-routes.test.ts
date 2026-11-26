import {
  CatalogUnavailableError,
  FakeBackupCatalog,
  NoBackupFoundError,
  type BackupCatalog,
} from '@backup365/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { sessionFor, testAuth, withHeaders } from './test-support.js';
import type { Role } from './sqlite/sqlite-account-store.js';

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function fakeCatalog() {
  return new FakeBackupCatalog({
    mailboxes: [
      { id: 'a', displayName: 'A' },
      { id: 'b', displayName: 'B' },
    ],
    sites: [{ id: 'site', displayName: 'Site' }],
    snapshots: {
      a: [
        { id: 'a1', workload: 'mail', createdAt: daysAgo(1), sizeBytes: 10 },
        { id: 'a2', workload: 'mail', createdAt: daysAgo(120), sizeBytes: 200 },
        { id: 'a3', workload: 'onedrive', createdAt: daysAgo(400), sizeBytes: 3_000 },
      ],
      b: [{ id: 'b1', workload: 'mail', createdAt: daysAgo(100), sizeBytes: 50 }],
      site: [{ id: 's1', workload: 'sharepoint', createdAt: daysAgo(500), sizeBytes: 7_000 }],
    },
  });
}

function setup(role: Role = 'admin', withCatalog: BackupCatalog | null = fakeCatalog()) {
  const catalog = withCatalog ?? undefined;
  const { auth } = testAuth();
  const audit = SqliteAuditLog.open(':memory:');
  const plans = SqlitePlanStore.open(':memory:');
  const session = sessionFor(auth, 'root', role);
  const app = withHeaders(buildApp({ version: '1', auth, audit, plans, catalog }), session.headers);
  const base = { rtoHours: null, gdprJustification: 'Obligation de conservation.' } as const;
  const mails = plans.create({
    ...base,
    name: 'Mails de A',
    scope: 'selection',
    selection: ['a'],
    dataTypes: ['mail'],
    rpoHours: 24,
    retentionDays: 90,
  });
  const all = plans.create({
    ...base,
    name: 'Tout',
    scope: 'all',
    selection: [],
    dataTypes: ['mail', 'onedrive', 'sharepoint'],
    rpoHours: 24,
    retentionDays: 365,
  });
  return { app, audit, plans, mails, all };
}

interface Body {
  retention: string;
  simulation: boolean;
  items: { planId: string; snapshots: number; items: number; bytes: number }[];
}

describe('GET /api/plans/retention (simulation, issue #79)', () => {
  it('donne pour chaque plan ce qui dépasse sa durée, sans rien supprimer', async () => {
    const { app, mails, all } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/plans/retention' });
    expect(res.statusCode).toBe(200);
    const body = res.json<Body>();
    expect(body.retention).toBe('not_enforced');
    expect(body.simulation).toBe(true);
    const byId = new Map(body.items.map((i) => [i.planId, i]));
    // Mails de A, 90 jours : seul le mail de 120 jours dépasse (OneDrive hors du plan).
    expect(byId.get(mails.id)).toMatchObject({ snapshots: 1, items: 1, bytes: 200 });
    // Tout, 365 jours : le OneDrive de A (400 j) et le site (500 j) ; B (100 j) reste.
    expect(byId.get(all.id)).toMatchObject({ snapshots: 2, items: 2, bytes: 10_000 });
  });

  it("n'envoie jamais un site aux listes de boîtes, ni une boîte à SharePoint", async () => {
    const base = fakeCatalog();
    const asked: string[] = [];
    const strict: BackupCatalog = {
      listMailboxes: () => base.listMailboxes(),
      listSites: () => base.listSites(),
      getSnapshotDetail: () => Promise.resolve(null),
      listSnapshots: (id, workload) => {
        asked.push(`${workload}:${id}`);
        return id === 'site'
          ? Promise.reject(new CatalogUnavailableError('propriétaire inconnu'))
          : base.listSnapshots(id, workload);
      },
      listSiteSnapshots: (id) => {
        asked.push(`sharepoint:${id}`);
        return base.listSiteSnapshots(id);
      },
    };
    const { app } = setup('admin', strict);
    const res = await app.inject({ method: 'GET', url: '/api/plans/retention' });
    expect(res.statusCode).toBe(200);
    expect(asked).not.toContain('mail:site');
    expect(asked).not.toContain('sharepoint:a');
  });

  it("ne demande pas l'agenda au catalogue, qui ne liste pas ses instantanés", async () => {
    const base = fakeCatalog();
    const asked: string[] = [];
    const spy: BackupCatalog = {
      ...base,
      listMailboxes: () => base.listMailboxes(),
      listSites: () => base.listSites(),
      getSnapshotDetail: () => Promise.resolve(null),
      listSiteSnapshots: (id) => base.listSiteSnapshots(id),
      listSnapshots: (id, workload) => {
        asked.push(`${workload}:${id}`);
        return base.listSnapshots(id, workload);
      },
    };
    const { app, plans } = setup('admin', spy);
    const agenda = plans.create({
      name: 'Agenda de A',
      scope: 'selection',
      selection: ['a'],
      dataTypes: ['mail', 'calendar'],
      rpoHours: 24,
      rtoHours: null,
      retentionDays: 90,
      gdprJustification: 'Obligation de conservation.',
    });
    const res = await app.inject({ method: 'GET', url: '/api/plans/retention' });
    expect(res.statusCode).toBe(200);
    expect(asked.some((a) => a.startsWith('calendar:'))).toBe(false);
    const row = res.json<Body>().items.find((i) => i.planId === agenda.id);
    expect(row).toMatchObject({ snapshots: 1, items: 1, bytes: 200 });
  });

  it('ne supprime rien : le catalogue garde ses instantanés', async () => {
    const catalog = fakeCatalog();
    const { app } = setup('admin', catalog);
    await app.inject({ method: 'GET', url: '/api/plans/retention' });
    expect(await catalog.listSnapshots('a', 'mail')).toHaveLength(2);
    expect(await catalog.listSiteSnapshots('site')).toHaveLength(1);
  });

  it("refuse l'opérateur (403, refus consigné) et répond 503 sans catalogue", async () => {
    const operator = setup('operator');
    const res = await operator.app.inject({ method: 'GET', url: '/api/plans/retention' });
    expect(res.statusCode).toBe(403);
    const log = await operator.audit.list({ limit: 10, offset: 0 });
    expect(log.items.some((e) => e.action === 'access.denied')).toBe(true);
    const none = setup('admin', null);
    const off = await none.app.inject({ method: 'GET', url: '/api/plans/retention' });
    expect(off.statusCode).toBe(503);
    expect(off.json()).toEqual({ error: 'catalog_unavailable' });
  });

  it('répond zéro avant toute sauvegarde et 503 si le catalogue est injoignable', async () => {
    const failing = (err: Error): BackupCatalog => ({
      listMailboxes: () => Promise.reject(err),
      listSites: () => Promise.reject(err),
      listSnapshots: () => Promise.reject(err),
      listSiteSnapshots: () => Promise.reject(err),
      getSnapshotDetail: () => Promise.reject(err),
    });
    const empty = setup('admin', failing(new NoBackupFoundError()));
    const res = await empty.app.inject({ method: 'GET', url: '/api/plans/retention' });
    expect(res.statusCode).toBe(200);
    expect(res.json<Body>().items.map((i) => i.snapshots)).toEqual([0, 0]);
    const down = setup('admin', failing(new CatalogUnavailableError('bucket secret')));
    const off = await down.app.inject({ method: 'GET', url: '/api/plans/retention' });
    expect(off.statusCode).toBe(503);
    expect(off.body).not.toContain('secret');
  });
});
