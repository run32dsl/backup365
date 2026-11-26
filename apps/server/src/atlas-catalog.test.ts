import { CatalogUnavailableError, NoBackupFoundError } from '@backup365/core';
import { CONTRACT_FIXTURE, backupCatalogContract } from '@backup365/core/testing';
import { NotFoundError } from '@wisecom/atlas-sdk';
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
  it('lists backed-up teams from the storage census, newest snapshot first (#34)', async () => {
    const listSnapshots = vi.fn((teamId: string) =>
      Promise.resolve({
        indexes:
          teamId === 'team-1'
            ? [
                { snapshotId: 'tm-old', createdAt: new Date('2026-01-03T00:00:00Z') },
                {
                  snapshotId: 'tm-new',
                  createdAt: new Date('2026-02-03T00:00:00Z'),
                  teamDisplayName: 'Équipe de test',
                },
              ]
            : [],
      }),
    );
    const catalog = new AtlasSdkCatalog(
      fakeAtlas(
        {},
        {
          teams: { listSnapshots },
          getStorageUsage: () =>
            Promise.resolve({
              complete: true,
              byOwner: [
                { workload: 'teams', ownerId: 'team-1' },
                // Aucun index lisible : l'équipe n'a pas de point de restauration.
                { workload: 'teams', ownerId: 'team-empty' },
                { workload: 'sharepoint', ownerId: CONTRACT_FIXTURE.site.id },
              ],
            }),
        },
      ),
    );
    expect(await catalog.listTeams()).toEqual([{ id: 'team-1', displayName: 'Équipe de test' }]);
    expect((await catalog.listTeamSnapshots('team-1')).map((s) => [s.id, s.workload])).toEqual([
      ['tm-new', 'teams'],
      ['tm-old', 'teams'],
    ]);
    expect(await catalog.listTeamSnapshots('absent')).toEqual([]);
    // Équipes et sites viennent du même recensement : un seul appel par équipe.
    expect(await catalog.listSites()).toContainEqual(CONTRACT_FIXTURE.site);
    expect(listSnapshots).toHaveBeenCalledTimes(2);
  });

  it('keeps the sites readable when a team index cannot be read (#34)', async () => {
    const catalog = new AtlasSdkCatalog(
      fakeAtlas(
        {},
        {
          teams: { listSnapshots: () => Promise.reject(new Error('https://bucket/secret')) },
          getStorageUsage: () =>
            Promise.resolve({
              complete: true,
              byOwner: [
                { workload: 'teams', ownerId: 'team-1' },
                { workload: 'sharepoint', ownerId: CONTRACT_FIXTURE.site.id },
              ],
            }),
        },
      ),
    );
    expect(await catalog.listSites()).toContainEqual(CONTRACT_FIXTURE.site);
    // L'équipe reste visible, sans point de restauration : la page Sources la dit en échec.
    expect(await catalog.listTeams()).toEqual([{ id: 'team-1', displayName: 'team-1' }]);
    expect(await catalog.listTeamSnapshots('team-1')).toEqual([]);
  });

  it('lists no team when the SDK reader has no Teams API', async () => {
    expect(await new AtlasSdkCatalog(fakeAtlas()).listTeams()).toEqual([]);
  });

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

  describe('missing bucket', () => {
    // Forme réelle du SDK 6.2 (`create_readonly`) : NotFoundError ATLAS_NOT_FOUND, S3 en `cause`.
    const sdkNotFound = () =>
      Object.assign(new Error('No backups found for tenant secret-tenant'), {
        name: 'NotFoundError',
        code: 'ATLAS_NOT_FOUND',
        cause: Object.assign(new Error('bucket secret-name'), { name: 'NoSuchBucket' }),
      });

    it('reports the SDK "no backups" error without leaking its message', async () => {
      const catalog = new AtlasSdkCatalog(
        fakeAtlas({ listMailboxes: () => Promise.reject(sdkNotFound()) }),
      );
      const err = await catalog.listMailboxes().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NoBackupFoundError);
      expect(err).toBeInstanceOf(CatalogUnavailableError);
      expect((err as Error).message).not.toContain('secret');
    });

    it('recognises the SDK 7.2 NotFoundError thrown without a cause', async () => {
      // `create_storage_only` (SDK 7.2) lève l'erreur réelle sans `NoSuchBucket` en `cause`.
      const notFound = new NotFoundError('No backups found for tenant secret-tenant');
      const catalog = new AtlasSdkCatalog(
        fakeAtlas({ listMailboxes: () => Promise.reject(notFound) }),
      );
      await expect(catalog.listMailboxes()).rejects.toBeInstanceOf(NoBackupFoundError);
    });

    it('also recognises a raw NoSuchBucket, on the sites path too', async () => {
      const raw = Object.assign(new Error('x'), { name: 'NoSuchBucket' });
      const catalog = new AtlasSdkCatalog(
        fakeAtlas({}, { getStorageUsage: () => Promise.reject(raw) }),
      );
      await expect(catalog.listSites()).rejects.toBeInstanceOf(NoBackupFoundError);
    });

    it('keeps other failures (denied access) as plain unavailable', async () => {
      const denied = Object.assign(new Error('denied'), { name: 'AccessDenied' });
      const catalog = new AtlasSdkCatalog(
        fakeAtlas({ listMailboxes: () => Promise.reject(denied) }),
      );
      const err = await catalog.listMailboxes().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CatalogUnavailableError);
      expect(err).not.toBeInstanceOf(NoBackupFoundError);
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
