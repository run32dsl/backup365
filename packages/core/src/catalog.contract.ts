import { describe, expect, it } from 'vitest';
import type { BackupCatalog } from './catalog.js';

/** Jeu de données que la fabrique doit charger dans l'implémentation testée. */
export const CONTRACT_FIXTURE = {
  mailbox: { id: 'mbx-1', displayName: 'Boîte de test' },
  site: { id: 'site-1,abc', displayName: 'Site de test' },
  siteSnapshots: [
    { id: 'sp-old', workload: 'sharepoint', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'sp-new', workload: 'sharepoint', createdAt: '2026-02-02T00:00:00.000Z' },
  ],
  snapshots: [
    { id: 'snap-old', workload: 'mail', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'snap-new', workload: 'mail', createdAt: '2026-02-01T00:00:00.000Z' },
    { id: 'snap-contacts', workload: 'contacts', createdAt: '2026-02-01T00:00:00.000Z' },
  ],
  detail: {
    id: 'snap-new',
    workload: 'mail',
    createdAt: '2026-02-01T00:00:00.000Z',
    itemCount: 42,
  },
} as const;

/** Tests de contrat du port `BackupCatalog`, à rejouer sur chaque adaptateur. */
export function backupCatalogContract(name: string, create: () => Promise<BackupCatalog>): void {
  describe(`BackupCatalog contract: ${name}`, () => {
    it('lists mailboxes', async () => {
      const catalog = await create();
      expect(await catalog.listMailboxes()).toContainEqual(CONTRACT_FIXTURE.mailbox);
    });

    it('lists snapshots of one workload, newest first', async () => {
      const catalog = await create();
      const snaps = await catalog.listSnapshots('mbx-1', 'mail');
      expect(snaps.map((s) => s.id)).toEqual(['snap-new', 'snap-old']);
    });

    it('returns no snapshot for an unknown mailbox', async () => {
      const catalog = await create();
      expect(await catalog.listSnapshots('absent', 'mail')).toEqual([]);
    });

    it('lists backed-up sites and their snapshots, newest first', async () => {
      const catalog = await create();
      expect(await catalog.listSites()).toContainEqual(CONTRACT_FIXTURE.site);
      const snaps = await catalog.listSiteSnapshots(CONTRACT_FIXTURE.site.id);
      expect(snaps.map((s) => s.id)).toEqual(['sp-new', 'sp-old']);
      expect(await catalog.listSiteSnapshots('absent')).toEqual([]);
    });

    it('returns the detail of a snapshot, or null when unknown', async () => {
      const catalog = await create();
      expect(await catalog.getSnapshotDetail('mail', 'snap-new')).toEqual(CONTRACT_FIXTURE.detail);
      expect(await catalog.getSnapshotDetail('mail', 'absent')).toBeNull();
    });
  });
}
