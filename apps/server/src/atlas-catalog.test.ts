import { CatalogUnavailableError } from '@backup365/core';
import { CONTRACT_FIXTURE, backupCatalogContract } from '@backup365/core/testing';
import { describe, expect, it } from 'vitest';
import { AtlasSdkCatalog, type AtlasReaders, type AtlasWorkloadReader } from './atlas-catalog.js';

function reader(workload: string): AtlasWorkloadReader {
  return {
    listMailboxes: () => Promise.resolve([{ ...CONTRACT_FIXTURE.mailbox }]),
    listSnapshots: (id) =>
      Promise.resolve(
        id === 'mbx-1'
          ? CONTRACT_FIXTURE.snapshots
              .filter((s) => s.workload === workload)
              // Dates en Date et dans le désordre : l'adaptateur normalise et trie.
              .map((s) => ({ id: s.id, createdAt: new Date(s.createdAt) }))
          : [],
      ),
    getSnapshotDetail: (id) =>
      Promise.resolve(id === CONTRACT_FIXTURE.detail.id ? { ...CONTRACT_FIXTURE.detail } : null),
  };
}

const readers = (override: Partial<AtlasWorkloadReader> = {}): AtlasReaders => ({
  mail: { ...reader('mail'), ...override },
  contacts: reader('contacts'),
  onedrive: reader('onedrive'),
  sharepoint: reader('sharepoint'),
  teams: reader('teams'),
});

backupCatalogContract('AtlasSdkCatalog (fake SDK)', () =>
  Promise.resolve(new AtlasSdkCatalog(readers())),
);

describe('AtlasSdkCatalog', () => {
  it('accepts ISO string dates and treats undefined detail as absent', async () => {
    const catalog = new AtlasSdkCatalog(
      readers({
        listSnapshots: () => Promise.resolve([{ id: 's', createdAt: '2026-03-01T02:00:00+02:00' }]),
        getSnapshotDetail: () => Promise.resolve(undefined),
      }),
    );
    expect((await catalog.listSnapshots('m', 'mail'))[0]?.createdAt).toBe(
      '2026-03-01T00:00:00.000Z',
    );
    expect(await catalog.getSnapshotDetail('mail', 's')).toBeNull();
  });

  it('rejects an invalid date as unavailable', async () => {
    const catalog = new AtlasSdkCatalog(
      readers({ listSnapshots: () => Promise.resolve([{ id: 's', createdAt: 'nope' }]) }),
    );
    await expect(catalog.listSnapshots('m', 'mail')).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
  });

  it('wraps SDK failures without leaking their message', async () => {
    const failing = new AtlasSdkCatalog(
      readers({ listMailboxes: () => Promise.reject(new Error('bucket secret-name denied')) }),
    );
    const err = await failing.listMailboxes().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CatalogUnavailableError);
    expect((err as Error).message).not.toContain('secret-name');
  });
});
