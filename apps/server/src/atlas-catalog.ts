import {
  CatalogUnavailableError,
  NoBackupFoundError,
  type BackupCatalog,
  type Mailbox,
  type Site,
  type Snapshot,
  type Team,
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
  /**
   * Index des instantanés d'une équipe, lus dans le stockage sans Graph (docs/adr/0022) ; absent
   * d'un faux qui ne lit pas Teams.
   */
  teams?: {
    listSnapshots(teamId: string): Promise<{
      indexes: readonly {
        snapshotId: string;
        createdAt: Date;
        teamDisplayName?: string | undefined;
      }[];
    }>;
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

/** Un site ou une équipe, avec ses instantanés du plus récent au plus ancien. */
interface SiteEntry {
  site: Site;
  snapshots: Snapshot[];
}

/** Résultat d'un recensement du stockage : les sites et les équipes sauvegardés. */
interface ScanEntries {
  sites: SiteEntry[];
  teams: SiteEntry[];
}

/**
 * Aucune sauvegarde : Atlas ne crée le bucket qu'à la première. Le SDK (6.2 comme 7.2) convertit
 * alors le `NoSuchBucket` de S3 en `NotFoundError` (`ATLAS_NOT_FOUND`, « No backups found for
 * tenant … »), le `NoSuchBucket` d'origine restant dans `cause` ; on accepte aussi ce dernier tel
 * quel. Le SDK 7.2 précise que seul le code fait contrat, pas le message (docs/adr/0019).
 */
function isBucketMissing(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 4; e = e.cause, depth++) {
    if (e.name === 'NoSuchBucket') return true;
    if (
      (e as { code?: unknown }).code === 'ATLAS_NOT_FOUND' &&
      e.message.includes('No backups found')
    )
      return true;
  }
  return false;
}

function toIso(value: Date): string {
  if (Number.isNaN(value.getTime()))
    throw new CatalogUnavailableError('Date de sauvegarde invalide');
  return value.toISOString();
}

/**
 * Adaptateur du port `BackupCatalog` au-dessus du SDK Atlas (lecture seule). Charges prises en
 * charge : `mail` et `onedrive` (par boîte), `sharepoint` (par site, via `listSites` et
 * `listSiteSnapshots`), `teams` (par équipe, via `listTeams` et `listTeamSnapshots`). Les autres
 * répondent sans instantané.
 *
 * Les sites et les équipes sauvegardés se déduisent du recensement du stockage, qui parcourt tout
 * le bucket : le résultat (sites, équipes et instantanés) est gardé en cache `siteCacheTtlMs`,
 * jamais recalculé à chaque requête. Les appels simultanés partagent le même calcul ; un échec n'est pas mis en cache.
 */
export class AtlasSdkCatalog implements BackupCatalog {
  private readonly siteCacheTtlMs: number;
  private readonly now: () => number;
  private siteCache: { entries: Promise<ScanEntries>; expiresAt: number } | undefined;

  constructor(
    private readonly atlas: AtlasSdkReader,
    options: AtlasCatalogOptions = {},
  ) {
    this.siteCacheTtlMs = options.siteCacheTtlMs ?? DEFAULT_SITE_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async listSites(): Promise<Site[]> {
    return (await this.siteEntries()).sites.map((e) => ({ ...e.site }));
  }

  async listSiteSnapshots(siteId: string): Promise<Snapshot[]> {
    const entry = (await this.siteEntries()).sites.find((e) => e.site.id === siteId);
    return entry ? entry.snapshots.map((s) => ({ ...s })) : [];
  }

  /** Équipes sauvegardées, tirées du même recensement que les sites (et du même cache). */
  async listTeams(): Promise<Team[]> {
    return (await this.siteEntries()).teams.map((e) => ({ ...e.site }));
  }

  async listTeamSnapshots(teamId: string): Promise<Snapshot[]> {
    const entry = (await this.siteEntries()).teams.find((e) => e.site.id === teamId);
    return entry ? entry.snapshots.map((s) => ({ ...s })) : [];
  }

  private siteEntries(): Promise<ScanEntries> {
    if (this.siteCache && this.now() < this.siteCache.expiresAt) return this.siteCache.entries;
    const cache = {
      entries: this.call(() => this.scanOwners()),
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

  /**
   * Ni `listSites()`, ni `teams.listTeams()`, ni `validate()` : ils passent par Graph
   * (docs/adr/0006, docs/adr/0022).
   */
  private async scanOwners(): Promise<ScanEntries> {
    const usage = await this.atlas.getStorageUsage({ breakdown: 'owner' });
    // Un recensement interrompu donnerait une liste muette sur les sites manquants.
    if (!usage.complete) throw new CatalogUnavailableError('Recensement du stockage incomplet');
    const owners = (workload: string) =>
      new Set(
        (usage.byOwner ?? [])
          .filter((o) => o.workload === workload && o.ownerId !== '')
          .map((o) => o.ownerId),
      );
    return {
      sites: await this.siteRows(owners('sharepoint')),
      teams: this.atlas.teams ? await this.teamRows(owners('teams'), this.atlas.teams) : [],
    };
  }

  private async teamRows(
    ids: ReadonlySet<string>,
    teams: NonNullable<AtlasSdkReader['teams']>,
  ): Promise<SiteEntry[]> {
    const entries: SiteEntry[] = [];
    for (const id of ids) {
      let indexes;
      try {
        indexes = (await teams.listSnapshots(id)).indexes;
      } catch {
        // Une équipe illisible ne doit pas rendre les sites indisponibles (même recensement) :
        // elle reste listée sans point de restauration, donc « En échec » sur la page Sources.
        entries.push({ site: { id, displayName: id }, snapshots: [] });
        continue;
      }
      const rows = indexes
        .map((row) => ({ row, createdAt: toIso(row.createdAt) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      // Une équipe dont aucun index n'est lisible n'a pas de point de restauration : pas listée.
      if (rows.length === 0) continue;
      entries.push({
        site: { id, displayName: rows[0]?.row.teamDisplayName || id },
        snapshots: rows.map(({ row, createdAt }) => ({
          id: row.snapshotId,
          workload: 'teams',
          createdAt,
        })),
      });
    }
    return entries;
  }

  private async siteRows(ids: ReadonlySet<string>): Promise<SiteEntry[]> {
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
      if (isBucketMissing(err)) throw new NoBackupFoundError({ cause: err });
      // Le message d'origine peut contenir des détails de stockage : il reste dans `cause`.
      throw new CatalogUnavailableError('Catalogue des sauvegardes indisponible', { cause: err });
    }
  }
}
