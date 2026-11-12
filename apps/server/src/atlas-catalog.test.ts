import { CatalogUnavailableError } from '@backup365/core';
import { CONTRACT_FIXTURE, backupCatalogContract } from '@backup365/core/testing';
import { describe, expect, it } from 'vitest';
import { AtlasSdkCatalog, type AtlasSdkReader } from './atlas-catalog.js';

/** Faux du SDK, aux formes réelles (camelCase, `Date`), sans réseau. */
function fakeAtlas(override: Partial<AtlasSdkReader['outlook']> = {}): AtlasSdkReader {
  return {
    outlook: {
      listMailboxes: () =>
        Promise.resolve([
          {
            ownerId: CONTRACT_FIXTURE.mailbox.id,
            ownerEmail: CONTRACT_FIXTURE.mailbox.displayName,
          },
        ]),
      listSnapshots: (ownerId) =>
        Promise.resolve(
          ownerId === 'mbx-1'
            ? CONTRACT_FIXTURE.snapshots
                .filter((s) => s.workload === 'mail')
                .map((s) => ({ snapshotId: s.id, createdAt: new Date(s.createdAt) }))
            : [],
        ),
      getSnapshotDetail: (id) =>
        Promise.resolve(
          id === CONTRACT_FIXTURE.detail.id
            ? {
                snapshotId: id,
                createdAt: new Date(CONTRACT_FIXTURE.detail.createdAt),
                totalObjects: CONTRACT_FIXTURE.detail.itemCount,
              }
            : undefined,
        ),
      ...override,
    },
    onedrive: {
      listSnapshots: (ownerId) =>
        Promise.resolve(
          ownerId === 'mbx-1'
            ? [
                {
                  snapshotId: 'od-old',
                  createdAt: new Date('2026-01-05T00:00:00Z'),
                  totalFiles: 3,
                },
                {
                  snapshotId: 'od-new',
                  createdAt: new Date('2026-02-05T00:00:00Z'),
                  totalFiles: 7,
                },
              ]
            : [],
        ),
    },
  };
}

backupCatalogContract('AtlasSdkCatalog (fake SDK)', () =>
  Promise.resolve(new AtlasSdkCatalog(fakeAtlas())),
);

describe('AtlasSdkCatalog', () => {
  it('falls back to ownerId when the mailbox has no address', async () => {
    const catalog = new AtlasSdkCatalog(
      fakeAtlas({ listMailboxes: () => Promise.resolve([{ ownerId: 'owner-9' }]) }),
    );
    expect(await catalog.listMailboxes()).toEqual([{ id: 'owner-9', displayName: 'owner-9' }]);
  });

  it('lists OneDrive snapshots newest first and details them by scanning mailboxes', async () => {
    const catalog = new AtlasSdkCatalog(fakeAtlas());
    const snaps = await catalog.listSnapshots('mbx-1', 'onedrive');
    expect(snaps.map((s) => s.id)).toEqual(['od-new', 'od-old']);
    expect(await catalog.getSnapshotDetail('onedrive', 'od-old')).toEqual({
      id: 'od-old',
      workload: 'onedrive',
      createdAt: '2026-01-05T00:00:00.000Z',
      itemCount: 3,
    });
    expect(await catalog.getSnapshotDetail('onedrive', 'absent')).toBeNull();
  });

  it('has no snapshot for workloads the SDK catalog does not cover', async () => {
    const catalog = new AtlasSdkCatalog(fakeAtlas());
    expect(await catalog.listSnapshots('mbx-1', 'teams')).toEqual([]);
    expect(await catalog.getSnapshotDetail('sharepoint', 'x')).toBeNull();
  });

  it('rejects an invalid date as unavailable', async () => {
    const catalog = new AtlasSdkCatalog(
      fakeAtlas({
        listSnapshots: () => Promise.resolve([{ snapshotId: 's', createdAt: new Date('nope') }]),
      }),
    );
    await expect(catalog.listSnapshots('m', 'mail')).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
  });

  it('wraps SDK failures without leaking their message', async () => {
    const failing = new AtlasSdkCatalog(
      fakeAtlas({ listMailboxes: () => Promise.reject(new Error('bucket secret-name denied')) }),
    );
    const err = await failing.listMailboxes().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CatalogUnavailableError);
    expect((err as Error).message).not.toContain('secret-name');
  });
});
