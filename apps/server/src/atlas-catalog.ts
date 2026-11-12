import {
  CatalogUnavailableError,
  type BackupCatalog,
  type Mailbox,
  type Snapshot,
  type SnapshotDetail,
  type Workload,
} from '@backup365/core';

/**
 * Sous-ensemble de `AtlasInstance` (`@wisecom/atlas-sdk`) lu par l'adaptateur. L'instance réelle
 * y est assignable ; les tests passent un faux. Seules ces lectures ne demandent pas Graph
 * (docs/adr/0002) : `validate()` n'en fait pas partie.
 */
export interface AtlasSdkReader {
  outlook: {
    listMailboxes(): Promise<{ ownerId: string; ownerEmail?: string | undefined }[]>;
    listSnapshots(ownerId: string): Promise<{ snapshotId: string; createdAt: Date }[]>;
    getSnapshotDetail(
      snapshotId: string,
    ): Promise<{ snapshotId: string; createdAt: Date; totalObjects: number } | undefined>;
  };
  onedrive: {
    listSnapshots(
      ownerId: string,
    ): Promise<{ snapshotId: string; createdAt: Date; totalFiles: number }[]>;
  };
}

function toIso(value: Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new CatalogUnavailableError('Date de sauvegarde invalide');
  return date.toISOString();
}

/**
 * Adaptateur du port `BackupCatalog` au-dessus du SDK Atlas (lecture seule). Charges prises en
 * charge : `mail` et `onedrive`. Les autres répondent sans instantané.
 */
export class AtlasSdkCatalog implements BackupCatalog {
  constructor(private readonly atlas: AtlasSdkReader) {}

  async listMailboxes(): Promise<Mailbox[]> {
    // `ownerId` identifie la boîte pour toutes les charges ; le SDK ne donne pas de nom d'affichage
    // dans ce résumé, l'adresse (ou à défaut l'identifiant) en tient lieu.
    const rows = await this.call(() => this.atlas.outlook.listMailboxes());
    return rows.map((row) => ({ id: row.ownerId, displayName: row.ownerEmail ?? row.ownerId }));
  }

  async listSnapshots(mailboxId: string, workload: Workload): Promise<Snapshot[]> {
    const rows = await this.call(() => this.snapshotsOf(mailboxId, workload));
    return rows
      .map((row) => ({ id: row.id, workload, createdAt: toIso(row.createdAt) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getSnapshotDetail(workload: Workload, snapshotId: string): Promise<SnapshotDetail | null> {
    if (workload === 'mail') {
      const row = await this.call(() => this.atlas.outlook.getSnapshotDetail(snapshotId));
      if (!row) return null;
      return {
        id: row.snapshotId,
        workload,
        createdAt: toIso(row.createdAt),
        itemCount: row.totalObjects,
      };
    }
    if (workload === 'onedrive') {
      // Le SDK n'a pas de détail OneDrive : on cherche l'instantané parmi ceux de chaque boîte.
      for (const mailbox of await this.listMailboxes()) {
        const rows = await this.call(() => this.atlas.onedrive.listSnapshots(mailbox.id));
        const row = rows.find((r) => r.snapshotId === snapshotId);
        if (row) {
          return {
            id: row.snapshotId,
            workload,
            createdAt: toIso(row.createdAt),
            itemCount: row.totalFiles,
          };
        }
      }
    }
    return null;
  }

  private async snapshotsOf(
    mailboxId: string,
    workload: Workload,
  ): Promise<{ id: string; createdAt: Date }[]> {
    if (workload === 'mail') {
      const rows = await this.atlas.outlook.listSnapshots(mailboxId);
      return rows.map((r) => ({ id: r.snapshotId, createdAt: r.createdAt }));
    }
    if (workload === 'onedrive') {
      const rows = await this.atlas.onedrive.listSnapshots(mailboxId);
      return rows.map((r) => ({ id: r.snapshotId, createdAt: r.createdAt }));
    }
    return [];
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CatalogUnavailableError) throw err;
      // Le message d'origine peut contenir des détails de stockage : il reste dans `cause`.
      throw new CatalogUnavailableError('Catalogue des sauvegardes indisponible', { cause: err });
    }
  }
}
