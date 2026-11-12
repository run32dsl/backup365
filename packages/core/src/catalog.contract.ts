import { describe, expect, it } from 'vitest';
import type { BackupCatalog } from './catalog.js';

/** Jeu de données que la fabrique doit charger dans l'implémentation testée. */
export const CONTRACT_FIXTURE = {
  mailbox: { id: 'mbx-1', displayName: 'Boîte de test' },
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

    it('returns the detail of a snapshot, or null when unknown', async () => {
      const catalog = await create();
      expect(await catalog.getSnapshotDetail('mail', 'snap-new')).toEqual(CONTRACT_FIXTURE.detail);
      expect(await catalog.getSnapshotDetail('mail', 'absent')).toBeNull();
    });
  });
}
