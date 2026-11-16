import {
  CatalogUnavailableError,
  listFolderOf,
  normalizeDrivePath,
  parentOf,
  joinDrivePath,
  type DriveBrowser,
  type DriveEntry,
  type DriveManifestEntry,
  type DriveRestoreOutcome,
  type DriveRestoreRequest,
  type DriveRestorer,
  type DriveSnapshot,
  type DriveVersion,
} from '@backup365/core';

/** Ligne de manifeste telle que le SDK la rend (noms en camelCase). */
export interface SdkDriveManifestEntry {
  fileName: string;
  parentPath: string;
  sizeBytes: number;
  lastModifiedAt?: string | undefined;
  backupAt: string;
  changeType: string;
}

export interface SdkDriveVersion {
  snapshotId: string;
  backupAt: string;
  versionId?: string | undefined;
  sizeBytes: number;
  lastModifiedAt?: string | undefined;
  changeType: string;
}

/**
 * Sous-ensemble de `AtlasInstance` lu pour parcourir un OneDrive sauvegardé : `listSnapshots`
 * (manifestes complets) et `listFileVersions`. Aucune ne demande Graph (docs/adr/0013). Les deux
 * champs sont facultatifs pour que les faux des autres tests restent valables : l'instance réelle
 * les fournit.
 */
export interface AtlasDriveReader {
  onedrive: {
    listSnapshots(ownerId: string): Promise<
      {
        snapshotId: string;
        createdAt: Date;
        totalFiles: number;
        entries?: readonly SdkDriveManifestEntry[] | undefined;
      }[]
    >;
    listFileVersions?(ownerId: string, fileRef: string): Promise<SdkDriveVersion[]>;
  };
}

/** Adaptateur du port `DriveBrowser`, en lecture seule. */
export class AtlasSdkDriveBrowser implements DriveBrowser {
  constructor(private readonly atlas: AtlasDriveReader) {}

  async listSnapshots(ownerId: string): Promise<DriveSnapshot[]> {
    const rows = await this.call(() => this.atlas.onedrive.listSnapshots(ownerId));
    return rows.map((r) => ({ id: r.snapshotId, createdAt: iso(r.createdAt) })).sort(newestFirst);
  }

  async listFolder(
    ownerId: string,
    snapshotId: string,
    path: string,
  ): Promise<DriveEntry[] | null> {
    const rows = await this.call(() => this.atlas.onedrive.listSnapshots(ownerId));
    const row = rows.find((r) => r.snapshotId === snapshotId);
    if (!row) return null;
    if (!row.entries) throw new CatalogUnavailableError('Manifeste OneDrive indisponible');
    return listFolderOf(row.entries as readonly DriveManifestEntry[], path);
  }

  async listVersions(ownerId: string, path: string): Promise<DriveVersion[]> {
    const read = this.atlas.onedrive.listFileVersions?.bind(this.atlas.onedrive);
    if (!read) throw new CatalogUnavailableError('Versions OneDrive indisponibles');
    const rows = await this.call(() => read(ownerId, path));
    return rows
      .filter((r) => r.changeType !== 'deleted')
      .map((r) => ({
        versionId: r.versionId ?? null,
        snapshotId: r.snapshotId,
        at: r.lastModifiedAt ?? r.backupAt,
        sizeBytes: r.sizeBytes,
      }))
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((v, i) => ({ ...v, current: i === 0 }));
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CatalogUnavailableError) throw err;
      // Le message d'origine peut contenir des détails de stockage : il reste dans `cause`.
      throw new CatalogUnavailableError('Sauvegarde OneDrive indisponible', { cause: err });
    }
  }
}

function iso(value: Date): string {
  if (Number.isNaN(value.getTime()))
    throw new CatalogUnavailableError('Date de sauvegarde invalide');
  return value.toISOString();
}

function newestFirst(a: { createdAt: string }, b: { createdAt: string }): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Sous-ensemble de `AtlasInstance` utilisé pour restaurer : `onedrive.restore` (fichier ou dossier
 * d'un instantané) et `onedrive.restoreVersion` (une version). Contrairement aux lectures, ils
 * passent par Graph et exigent de vrais identifiants (docs/adr/0013).
 */
export interface AtlasDriveRestorer {
  onedrive: {
    restore(
      ownerId: string,
      options: {
        snapshotId: string;
        fileFilter: string[];
        conflictBehavior: 'replace' | 'rename' | 'fail';
        inPlace?: boolean;
        destination?: string;
        renameTo?: string;
      },
    ): Promise<{ filesRestored: number; errors: string[] }>;
    restoreVersion(
      ownerId: string,
      options: { fileRef: string; versionId: string; placement: 'copy' | 'in-place' },
    ): Promise<{ filesRestored: number; errors: string[] }>;
  };
}

/**
 * Adaptateur du port `DriveRestorer`. Mode `copy` : jamais d'écrasement (`renameTo` pour un
 * fichier, dossier de destination daté pour un dossier, `placement: 'copy'` pour une version).
 * Mode `replace` : seulement pour un fichier, `conflictBehavior: 'replace'` ou
 * `placement: 'in-place'` (l'ancienne version reste dans l'historique OneDrive).
 */
export class AtlasSdkDriveRestorer implements DriveRestorer {
  constructor(private readonly atlas: AtlasDriveRestorer) {}

  async restore(req: DriveRestoreRequest): Promise<DriveRestoreOutcome> {
    const path = normalizeDrivePath(req.path);
    if (path === null || path === '/') throw new Error('invalid_path');
    const result = await this.run(req, path);
    return { restored: result.filesRestored, errors: result.errors.length };
  }

  private run(req: DriveRestoreRequest, path: string) {
    const od = this.atlas.onedrive;
    if (req.versionId !== undefined) {
      return od.restoreVersion(req.ownerId, {
        fileRef: path,
        versionId: req.versionId,
        placement: req.mode === 'replace' ? 'in-place' : 'copy',
      });
    }
    const base = { snapshotId: req.snapshotId, fileFilter: [path] };
    if (req.mode === 'replace') {
      if (req.kind === 'folder') throw new Error('replace_folder_refused');
      return od.restore(req.ownerId, { ...base, conflictBehavior: 'replace', inPlace: true });
    }
    if (req.kind === 'file') {
      return od.restore(req.ownerId, {
        ...base,
        conflictBehavior: 'rename',
        inPlace: true,
        renameTo: req.copyName,
      });
    }
    return od.restore(req.ownerId, {
      ...base,
      conflictBehavior: 'rename',
      destination: joinDrivePath(parentOf(path), req.copyName),
    });
  }
}
