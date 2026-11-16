import {
  CatalogUnavailableError,
  listSiteFolderOf,
  summarizeSite,
  type SiteBrowser,
  type SiteEntry,
  type SiteManifestEntry,
  type SiteRestoreOutcome,
  type SiteRestoreRequest,
  type SiteRestorer,
  type SiteScopeSummary,
} from '@backup365/core';

/** Ligne de manifeste SharePoint telle que le SDK la rend (noms en camelCase). */
export interface SdkSiteManifestEntry {
  libraryName?: string | undefined;
  fileName: string;
  parentPath: string;
  sizeBytes: number;
  lastModifiedAt?: string | undefined;
  backupAt: string;
  changeType: string;
}

/**
 * Sous-ensemble de `AtlasInstance` lu pour parcourir un site sauvegardé : `listSnapshots`
 * (manifestes complets, sans Graph : docs/adr/0014). `entries` est facultatif pour que les faux
 * du catalogue restent valables ; l'instance réelle le fournit.
 */
export interface AtlasSiteReader {
  sharepoint: {
    listSnapshots(siteId: string): Promise<
      {
        snapshotId: string;
        entries?: readonly SdkSiteManifestEntry[] | undefined;
      }[]
    >;
  };
}

/** Adaptateur du port `SiteBrowser`, en lecture seule. */
export class AtlasSdkSiteBrowser implements SiteBrowser {
  constructor(private readonly atlas: AtlasSiteReader) {}

  async listFolder(siteId: string, snapshotId: string, path: string): Promise<SiteEntry[] | null> {
    const entries = await this.entries(siteId, snapshotId);
    return entries && listSiteFolderOf(entries, path);
  }

  async summarize(
    siteId: string,
    snapshotId: string,
    path: string,
  ): Promise<SiteScopeSummary | null> {
    const entries = await this.entries(siteId, snapshotId);
    return entries && summarizeSite(entries, path);
  }

  private async entries(
    siteId: string,
    snapshotId: string,
  ): Promise<readonly SiteManifestEntry[] | null> {
    let rows;
    try {
      rows = await this.atlas.sharepoint.listSnapshots(siteId);
    } catch (err) {
      // Le message d'origine peut contenir des détails de stockage : il reste dans `cause`.
      throw new CatalogUnavailableError('Sauvegarde SharePoint indisponible', { cause: err });
    }
    const row = rows.find((r) => r.snapshotId === snapshotId);
    if (!row) return null;
    if (!row.entries) throw new CatalogUnavailableError('Manifeste SharePoint indisponible');
    return row.entries;
  }
}

/**
 * Sous-ensemble de `AtlasInstance` utilisé pour restaurer : `sharepoint.restore`. Il passe par
 * Graph et exige de vrais identifiants (docs/adr/0014).
 */
export interface AtlasSiteRestorer {
  sharepoint: {
    restore(
      siteId: string,
      options: {
        snapshotId: string;
        fileFilter?: string[];
        conflictBehavior: 'replace' | 'rename' | 'fail';
        inPlace?: boolean;
        renameTo?: string;
      },
    ): Promise<{
      filesRestored: number;
      filesSkipped: number;
      errors: string[];
      interrupted: boolean;
    }>;
  };
}

/**
 * Adaptateur du port `SiteRestorer`. Toujours à l'emplacement d'origine (`inPlace`) et jamais en
 * écrasant (`conflictBehavior: 'rename'`) ; un fichier seul reçoit en plus le nom daté.
 */
export class AtlasSdkSiteRestorer implements SiteRestorer {
  constructor(private readonly atlas: AtlasSiteRestorer) {}

  async restore(req: SiteRestoreRequest): Promise<SiteRestoreOutcome> {
    const result = await this.atlas.sharepoint.restore(req.siteId, {
      snapshotId: req.snapshotId,
      ...(req.scope === 'site' ? {} : { fileFilter: [req.path] }),
      conflictBehavior: 'rename',
      inPlace: true,
      ...(req.scope === 'item' && req.copyName !== '' ? { renameTo: req.copyName } : {}),
    });
    return {
      restored: result.filesRestored,
      skipped: result.filesSkipped,
      // Une restauration interrompue n'est pas un succès, même sans erreur nommée.
      errors: result.errors.length + (result.interrupted ? 1 : 0),
    };
  }
}
