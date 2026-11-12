import type { AuditLog, StatusReport, Workload } from '@backup365/core';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { createAtlasCatalog, type AtlasHandle } from './atlas-sdk.js';
import type { AtlasManifestEntry } from './atlas-mail-index.js';
import type { StorageConfig } from './config.js';
import { SearchIndexer } from './search-indexer.js';
import { SqliteSearchIndex } from './sqlite/sqlite-search-index.js';

const storage: StorageConfig = {
  tenantId: 'tenant-test',
  endpoint: 'https://s3.example.test',
  region: 'r1',
  accessKeyId: 'id',
  secretAccessKey: 'secret',
  encryptionPassphrase: 'passphrase-of-14+',
};

const audit: AuditLog = {
  record: () => Promise.resolve(),
  list: () => Promise.resolve({ total: 0, items: [] }),
  verify: () => Promise.resolve({ ok: true, entries: 0 }),
};

const manifests: Record<string, { createdAt: Date; entries: AtlasManifestEntry[] }> = {
  'snap-old': {
    createdAt: new Date('2026-03-01T00:00:00Z'),
    entries: [
      {
        objectId: 'obj-1',
        sizeBytes: 10,
        subject: 'Budget annuel',
        folderId: 'f1',
        from: { address: 'alice@example.test' },
      },
    ],
  },
  'snap-new': {
    createdAt: new Date('2026-03-02T00:00:00Z'),
    entries: [
      {
        objectId: 'obj-1',
        sizeBytes: 10,
        subject: 'Budget annuel',
        folderId: 'f1',
        from: { address: 'alice@example.test' },
      },
      {
        objectId: 'obj-2',
        sizeBytes: 20,
        subject: 'Contrat fournisseur',
        folderId: 'f1',
        from: { address: 'carol@example.test' },
      },
    ],
  },
};

/** Faux SDK aux formes réelles : un manifeste par instantané. */
function fakeAtlas(fail = { on: false }): AtlasHandle {
  return {
    outlook: {
      listMailboxes: () => Promise.resolve([{ ownerId: 'owner-1', ownerEmail: 'a@example.test' }]),
      listSnapshots: () =>
        Promise.resolve(
          Object.entries(manifests).map(([snapshotId, m]) => ({
            snapshotId,
            createdAt: m.createdAt,
          })),
        ),
      getSnapshotDetail: (id: string) => {
        if (fail.on) return Promise.reject<never>(new Error('secret-detail-from-storage'));
        const m = manifests[id];
        return Promise.resolve(m && { snapshotId: id, totalObjects: m.entries.length, ...m });
      },
      readMessage: () => Promise.resolve(undefined),
    },
    onedrive: { listSnapshots: () => Promise.resolve([]) },
    sharepoint: { listSnapshots: () => Promise.resolve([]) },
    getStorageUsage: () => Promise.resolve({ complete: true }),
    dispose: () => Promise.resolve(),
  };
}

function setup(fail?: { on: boolean }) {
  const { catalog, reader } = createAtlasCatalog(storage, () => fakeAtlas(fail));
  const index = SqliteSearchIndex.open(':memory:');
  const errors: Record<string, unknown>[] = [];
  const indexer = new SearchIndexer({
    catalog,
    reader,
    index,
    intervalMs: 60_000,
    logger: { error: (obj) => errors.push(obj) },
  });
  const app = buildApp({ version: '1', catalog, searchIndex: index, audit, indexer });
  return { indexer, app, errors, index };
}

describe('SearchIndexer', () => {
  it('lets search find a mail by subject and by sender after one cycle', async () => {
    const { indexer, app } = setup();
    await indexer.runCycle();

    const bySubject = await app.inject({ method: 'GET', url: '/api/search?q=contrat' });
    expect(bySubject.json<{ items: { messageId: string }[] }>().items).toMatchObject([
      { messageId: 'obj-2' },
    ]);
    const bySender = await app.inject({ method: 'GET', url: '/api/search?from=alice' });
    // obj-1 figure dans les deux instantanés : indexé une seule fois.
    expect(bySender.json<{ total: number }>().total).toBe(1);
  });

  it('reports the last run and the indexed mail count in /api/status', async () => {
    const { indexer, app } = setup();
    const before = (await app.inject({ method: 'GET', url: '/api/status' })).json<
      StatusReport & { index: Record<string, unknown> }
    >();
    expect(before.index).toEqual({
      mails: 0,
      lastRunAt: null,
      lastSuccessAt: null,
      lastRunFailed: false,
    });
    await indexer.runCycle();
    const after = (await app.inject({ method: 'GET', url: '/api/status' })).json<
      StatusReport & { index: { mails: number; lastSuccessAt: string; lastRunFailed: boolean } }
    >();
    expect(after.index.mails).toBe(2);
    expect(after.index.lastSuccessAt).toEqual(expect.any(String));
    expect(after.index.lastRunFailed).toBe(false);
  });

  it('logs a failure without content and retries at the next cycle', async () => {
    const fail = { on: true };
    const { indexer, errors, app } = setup(fail);
    await indexer.runCycle();
    expect(indexer.status()).toMatchObject({ lastRunFailed: true, lastSuccessAt: null });
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors)).not.toContain('secret-detail');

    fail.on = false;
    await indexer.runCycle();
    expect(indexer.status().lastRunFailed).toBe(false);
    const res = await app.inject({ method: 'GET', url: '/api/search?q=budget' });
    expect(res.json<{ total: number }>().total).toBe(1);
  });

  it('keeps indexing the other mailboxes when one fails', async () => {
    const { catalog, reader } = createAtlasCatalog(storage, () => fakeAtlas());
    const index = SqliteSearchIndex.open(':memory:');
    const errors: Record<string, unknown>[] = [];
    const indexer = new SearchIndexer({
      catalog: {
        listMailboxes: () =>
          Promise.resolve([
            { id: 'broken', displayName: 'x' },
            { id: 'owner-1', displayName: 'y' },
          ]),
        listSnapshots: (mailboxId: string, workload: Workload) =>
          mailboxId === 'broken'
            ? Promise.reject(new Error('boom'))
            : catalog.listSnapshots(mailboxId, workload),
      } as unknown as typeof catalog,
      reader,
      index,
      intervalMs: 60_000,
      logger: { error: (obj) => errors.push(obj) },
    });
    await indexer.runCycle();
    expect(errors).toHaveLength(1);
    expect(indexer.status().lastRunFailed).toBe(true);
    expect((await index.search({ limit: 10, offset: 0 })).total).toBe(2);
  });

  it('reports a null mail count when the index cannot answer', async () => {
    const { indexer, index } = setup();
    const broken = { ...index, search: () => Promise.reject(new Error('db')) };
    const { catalog } = createAtlasCatalog(storage, () => fakeAtlas());
    const app = buildApp({
      version: '1',
      catalog,
      searchIndex: broken as unknown as SqliteSearchIndex,
      indexer,
    });
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ index: { mails: number | null } }>().index.mails).toBeNull();
  });

  it('runs on start and then at each interval, one cycle at a time', async () => {
    vi.useFakeTimers();
    try {
      const { indexer, index } = setup();
      indexer.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(await index.isSnapshotIndexed('snap-new')).toBe(true);
      expect(indexer.status().lastSuccessAt).not.toBeNull();
      const first = indexer.status().lastRunAt;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(indexer.status().lastRunAt).not.toBe(first);
      await indexer.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
