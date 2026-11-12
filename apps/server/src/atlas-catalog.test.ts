import { CatalogUnavailableError } from '@backup365/core';
import { CONTRACT_FIXTURE, backupCatalogContract } from '@backup365/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AtlasSdkCatalog, type AtlasSdkReader } from './atlas-catalog.js';

/** Faux du SDK, aux formes réelles (camelCase, `Date`), sans réseau. */
function fakeAtlas(
  override: Partial<AtlasSdkReader['outlook']> = {},
  sdk: Partial<AtlasSdkReader> = {},
): AtlasSdkReader {
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
    sharepoint: {
      listSnapshots: (siteId) =>
        Promise.resolve(
          siteId === CONTRACT_FIXTURE.site.id
            ? CONTRACT_FIXTURE.siteSnapshots.map((s) => ({
                siteDisplayName: CONTRACT_FIXTURE.site.displayName,
                snapshotId: s.id,
                createdAt: new Date(s.createdAt),
                totalFiles: 1,
              }))
            : [],
        ),
    },
    getStorageUsage: () =>
      Promise.resolve({
        complete: true,
        byOwner: [
          { workload: 'sharepoint', ownerId: CONTRACT_FIXTURE.site.id },
          { workload: 'sharepoint', ownerId: CONTRACT_FIXTURE.site.id },
          { workload: 'sharepoint', ownerId: '' },
          { workload: 'onedrive', ownerId: 'mbx-1' },
        ],
      }),
    ...sdk,
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

  describe('SharePoint sites', () => {
    function counted(sdk: Partial<AtlasSdkReader> = {}) {
      const base = fakeAtlas();
      const calls = { usage: 0, snapshots: 0 };
      const atlas: AtlasSdkReader = {
        ...base,
        getStorageUsage: (o) => {
          calls.usage += 1;
          return base.getStorageUsage(o);
        },
        sharepoint: {
          listSnapshots: (id) => {
            calls.snapshots += 1;
            return base.sharepoint.listSnapshots(id);
          },
        },
        ...sdk,
      };
      return { atlas, calls };
    }

    it('deduplicates sites from the owner breakdown, keeping sharepoint owners with an id', async () => {
      const catalog = new AtlasSdkCatalog(fakeAtlas());
      expect(await catalog.listSites()).toEqual([CONTRACT_FIXTURE.site]);
    });

    it('falls back to the URL, then to the id, when the site has no display name', async () => {
      const row = { snapshotId: 's', createdAt: new Date('2026-01-01T00:00:00Z'), totalFiles: 1 };
      const byUrl = new AtlasSdkCatalog(
        fakeAtlas(
          {},
          { sharepoint: { listSnapshots: () => Promise.resolve([{ ...row, siteUrl: 'u' }]) } },
        ),
      );
      expect(await byUrl.listSites()).toEqual([{ id: CONTRACT_FIXTURE.site.id, displayName: 'u' }]);
      const byId = new AtlasSdkCatalog(
        fakeAtlas({}, { sharepoint: { listSnapshots: () => Promise.resolve([row]) } }),
      );
      expect(await byId.listSites()).toEqual([
        { id: CONTRACT_FIXTURE.site.id, displayName: CONTRACT_FIXTURE.site.id },
      ]);
    });

    it('scans the storage once, then serves the cache until it expires', async () => {
      let time = 1_000;
      const { atlas, calls } = counted();
      const catalog = new AtlasSdkCatalog(atlas, { siteCacheTtlMs: 60_000, now: () => time });
      await catalog.listSites();
      await catalog.listSiteSnapshots(CONTRACT_FIXTURE.site.id);
      await catalog.listSites();
      expect(calls).toEqual({ usage: 1, snapshots: 1 });
      time += 59_999;
      await catalog.listSites();
      expect(calls.usage).toBe(1);
      time += 1;
      await catalog.listSites();
      expect(calls).toEqual({ usage: 2, snapshots: 2 });
    });

    it('shares one scan between concurrent calls', async () => {
      const { atlas, calls } = counted();
      const catalog = new AtlasSdkCatalog(atlas);
      await Promise.all([catalog.listSites(), catalog.listSites(), catalog.listSites()]);
      expect(calls.usage).toBe(1);
    });

    it('does not cache a failure and does not leak its message', async () => {
      let fail = true;
      const { atlas, calls } = counted({
        getStorageUsage: () => {
          calls.usage += 1;
          return fail
            ? Promise.reject(new Error('bucket secret-name denied'))
            : Promise.resolve({ complete: true });
        },
      });
      const catalog = new AtlasSdkCatalog(atlas);
      const err = await catalog.listSites().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CatalogUnavailableError);
      expect((err as Error).message).not.toContain('secret-name');
      fail = false;
      expect(await catalog.listSites()).toEqual([]);
      expect(calls.usage).toBe(2);
    });

    it('asks for the owner breakdown only and rejects an invalid snapshot date', async () => {
      const usage = vi.fn(() =>
        Promise.resolve({ complete: true, byOwner: [{ workload: 'sharepoint', ownerId: 's,1' }] }),
      );
      const catalog = new AtlasSdkCatalog(
        fakeAtlas(
          {},
          {
            getStorageUsage: usage,
            sharepoint: {
              listSnapshots: () =>
                Promise.resolve([{ snapshotId: 'x', createdAt: new Date('nope'), totalFiles: 1 }]),
            },
          },
        ),
      );
      await expect(catalog.listSites()).rejects.toBeInstanceOf(CatalogUnavailableError);
      expect(usage).toHaveBeenCalledWith({ breakdown: 'owner' });
    });

    it('refuses an incomplete scan rather than listing a partial set of sites', async () => {
      const catalog = new AtlasSdkCatalog(
        fakeAtlas({}, { getStorageUsage: () => Promise.resolve({ complete: false }) }),
      );
      await expect(catalog.listSites()).rejects.toBeInstanceOf(CatalogUnavailableError);
    });
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
