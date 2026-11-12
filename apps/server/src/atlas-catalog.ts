import {
  CatalogUnavailableError,
  type BackupCatalog,
  type Mailbox,
  type Site,
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
  sharepoint: {
    listSnapshots(siteId: string): Promise<
      {
        siteUrl?: string | undefined;
        siteDisplayName?: string | undefined;
        snapshotId: string;
        createdAt: Date;
        totalFiles: number;
      }[]
    >;
  };
  /** Recensement du stockage : parcourt tout le bucket (docs/adr/0006). */
  getStorageUsage(options: { breakdown: 'owner' }): Promise<{
    complete: boolean;
    byOwner?: readonly { workload: string; ownerId: string }[] | undefined;
  }>;
}

/** Durée de validité par défaut du recensement des sites : 1 h. */
export const DEFAULT_SITE_CACHE_TTL_MS = 3_600_000;

export interface AtlasCatalogOptions {
  /** Durée de validité du recensement des sites, en millisecondes. */
  siteCacheTtlMs?: number;
  /** Horloge, injectable pour les tests. */
  now?: () => number;
}

interface SiteEntry {
  site: Site;
  snapshots: Snapshot[];
}

function toIso(value: Date): string {
  if (Number.isNaN(value.getTime()))
    throw new CatalogUnavailableError('Date de sauvegarde invalide');
  return value.toISOString();
}

/**
 * Adaptateur du port `BackupCatalog` au-dessus du SDK Atlas (lecture seule). Charges prises en
 * charge : `mail` et `onedrive` (par boîte), `sharepoint` (par site, via `listSites` et
 * `listSiteSnapshots`). Les autres répondent sans instantané.
 *
 * Les sites sauvegardés se déduisent du recensement du stockage, qui parcourt tout le bucket :
 * le résultat (sites et instantanés) est gardé en cache `siteCacheTtlMs`, jamais recalculé à
 * chaque requête. Les appels simultanés partagent le même calcul ; un échec n'est pas mis en cache.
 */
export class AtlasSdkCatalog implements BackupCatalog {
  private readonly siteCacheTtlMs: number;
  private readonly now: () => number;
  private siteCache: { entries: Promise<SiteEntry[]>; expiresAt: number } | undefined;

  constructor(
    private readonly atlas: AtlasSdkReader,
    options: AtlasCatalogOptions = {},
  ) {
    this.siteCacheTtlMs = options.siteCacheTtlMs ?? DEFAULT_SITE_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async listSites(): Promise<Site[]> {
    return (await this.siteEntries()).map((e) => ({ ...e.site }));
  }

  async listSiteSnapshots(siteId: string): Promise<Snapshot[]> {
    const entry = (await this.siteEntries()).find((e) => e.site.id === siteId);
    return entry ? entry.snapshots.map((s) => ({ ...s })) : [];
  }

  private siteEntries(): Promise<SiteEntry[]> {
    if (this.siteCache && this.now() < this.siteCache.expiresAt) return this.siteCache.entries;
    const cache = {
      entries: this.call(() => this.scanSites()),
      expiresAt: Number.POSITIVE_INFINITY,
    };
    this.siteCache = cache;
    cache.entries.then(
      () => {
        cache.expiresAt = this.now() + this.siteCacheTtlMs;
      },
      () => {
        if (this.siteCache === cache) this.siteCache = undefined;
      },
    );
    return cache.entries;
  }

  /** Ni `listSites()` ni `validate()` : ils passent par Graph (docs/adr/0006). */
  private async scanSites(): Promise<SiteEntry[]> {
    const usage = await this.atlas.getStorageUsage({ breakdown: 'owner' });
    // Un recensement interrompu donnerait une liste muette sur les sites manquants.
    if (!usage.complete) throw new CatalogUnavailableError('Recensement du stockage incomplet');
    const ids = new Set(
      (usage.byOwner ?? [])
        .filter((o) => o.workload === 'sharepoint' && o.ownerId !== '')
        .map((o) => o.ownerId),
    );
    const entries: SiteEntry[] = [];
    for (const id of ids) {
      const rows = (await this.atlas.sharepoint.listSnapshots(id))
        .map((row) => ({ row, createdAt: toIso(row.createdAt) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const newest = rows[0]?.row;
      entries.push({
        site: { id, displayName: newest?.siteDisplayName || newest?.siteUrl || id },
        snapshots: rows.map(({ row, createdAt }) => ({
          id: row.snapshotId,
          workload: 'sharepoint',
          createdAt,
        })),
      });
    }
    return entries;
  }

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
