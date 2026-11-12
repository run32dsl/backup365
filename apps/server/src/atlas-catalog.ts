import {
  CatalogUnavailableError,
  type BackupCatalog,
  type Mailbox,
  type Snapshot,
  type SnapshotDetail,
  type Workload,
} from '@backup365/core';

/**
 * Forme minimale attendue de chaque charge du SDK Atlas (`outlook`, `contacts`, `onedrive`…).
 * Le SDK n'est pas encore installé dans le dépôt : cette interface est l'unique point de contact
 * à vérifier contre `@wisecom/atlas-sdk` lors du câblage (voir docs/adr/0002).
 */
export interface AtlasWorkloadReader {
  listMailboxes(): Promise<{ id: string; displayName: string }[]>;
  listSnapshots(mailboxId: string): Promise<{ id: string; createdAt: Date | string }[]>;
  getSnapshotDetail(
    snapshotId: string,
  ): Promise<{ id: string; createdAt: Date | string; itemCount: number } | null | undefined>;
}

export type AtlasReaders = Record<Workload, AtlasWorkloadReader>;

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new CatalogUnavailableError('Date de sauvegarde invalide');
  return date.toISOString();
}

/** Adaptateur du port `BackupCatalog` au-dessus du SDK Atlas (lecture seule). */
export class AtlasSdkCatalog implements BackupCatalog {
  constructor(private readonly readers: AtlasReaders) {}

  async listMailboxes(): Promise<Mailbox[]> {
    // Les boîtes sont recensées par la charge mail ; les autres charges s'y rattachent par id.
    const rows = await this.call(() => this.readers.mail.listMailboxes());
    return rows.map(({ id, displayName }) => ({ id, displayName }));
  }

  async listSnapshots(mailboxId: string, workload: Workload): Promise<Snapshot[]> {
    const rows = await this.call(() => this.readers[workload].listSnapshots(mailboxId));
    return rows
      .map((row) => ({ id: row.id, workload, createdAt: toIso(row.createdAt) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getSnapshotDetail(workload: Workload, snapshotId: string): Promise<SnapshotDetail | null> {
    const row = await this.call(() => this.readers[workload].getSnapshotDetail(snapshotId));
    if (!row) return null;
    return {
      id: row.id,
      workload,
      createdAt: toIso(row.createdAt),
      itemCount: row.itemCount,
    };
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
