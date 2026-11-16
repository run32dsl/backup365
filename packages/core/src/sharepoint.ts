import {
  listFolderOf,
  normalizeDrivePath,
  type DriveEntry,
  type DriveManifestEntry,
} from './drive.js';

/** Granularité d'une restauration SharePoint. */
export type SiteScope = 'item' | 'folder' | 'library' | 'site';

export const SITE_SCOPES: readonly SiteScope[] = ['item', 'folder', 'library', 'site'];

/**
 * Élément d'un site sauvegardé. Le chemin virtuel est `/<bibliothèque>/<dossiers>/<fichier>` : la
 * racine `/` liste les bibliothèques (`kind: 'library'`).
 */
export interface SiteEntry extends Omit<DriveEntry, 'kind'> {
  kind: 'file' | 'folder' | 'library';
}

/** Ligne d'un manifeste d'instantané SharePoint, réduite à ce que la navigation lit. */
export interface SiteManifestEntry extends DriveManifestEntry {
  /** Bibliothèque de documents ; absente : `Documents`. */
  libraryName?: string | undefined;
}

/** Ce qu'une restauration touchera : des comptes, jamais de contenu. */
export interface SiteScopeSummary {
  items: number;
  sizeBytes: number;
}

/** Parcours en lecture seule d'un site SharePoint sauvegardé (les instantanés viennent du catalogue). */
export interface SiteBrowser {
  /** Contenu d'un dossier d'un instantané ; `null` si l'instantané n'existe pas. */
  listFolder(siteId: string, snapshotId: string, path: string): Promise<SiteEntry[] | null>;
  /** Fichiers sous un chemin (`/` : tout le site) ; `null` si l'instantané n'existe pas. */
  summarize(siteId: string, snapshotId: string, path: string): Promise<SiteScopeSummary | null>;
}

export interface SiteRestoreRequest {
  siteId: string;
  snapshotId: string;
  scope: SiteScope;
  /** `/` pour le site entier. */
  path: string;
  /** Nom de la copie d'un fichier seul ; vide dans les autres cas. */
  copyName: string;
}

/** Résultat d'une restauration SharePoint : des comptes, jamais de contenu. */
export interface SiteRestoreOutcome {
  restored: number;
  /** Éléments déjà présents, conservés tels quels. */
  skipped: number;
  errors: number;
}

/** Restauration à l'emplacement d'origine, sans écraser (docs/adr/0014). */
export interface SiteRestorer {
  restore(request: SiteRestoreRequest): Promise<SiteRestoreOutcome>;
}

const DEFAULT_LIBRARY = 'Documents';

interface SiteFile {
  /** Dossier complet, bibliothèque comprise. */
  dir: string;
  entry: SiteManifestEntry;
}

function activeFiles(entries: readonly SiteManifestEntry[]): SiteFile[] {
  const files: SiteFile[] = [];
  for (const entry of entries) {
    if (entry.changeType === 'deleted') continue;
    const library = (entry.libraryName ?? '').replace(/[/\\]/g, '') || DEFAULT_LIBRARY;
    const parent = normalizeDrivePath(entry.parentPath);
    if (parent === null) continue;
    files.push({ dir: parent === '/' ? `/${library}` : `/${library}${parent}`, entry });
  }
  return files;
}

/**
 * Contenu d'un dossier d'après le manifeste : les bibliothèques à la racine, puis dossiers et
 * fichiers. Les éléments supprimés n'y figurent pas.
 */
export function listSiteFolderOf(
  entries: readonly SiteManifestEntry[],
  folder: string,
): SiteEntry[] {
  const rows = listFolderOf(
    activeFiles(entries).map(({ dir, entry }) => ({ ...entry, parentPath: dir })),
    folder,
  );
  return rows.map((r) => (folder === '/' ? { ...r, kind: 'library' as const } : r));
}

/** Nombre et taille des fichiers sous `path` (`/` : tout le site). */
export function summarizeSite(
  entries: readonly SiteManifestEntry[],
  path: string,
): SiteScopeSummary {
  let items = 0;
  let sizeBytes = 0;
  for (const { dir, entry } of activeFiles(entries)) {
    const full = `${dir}/${entry.fileName}`;
    if (path === '/' || full === path || full.startsWith(`${path}/`)) {
      items += 1;
      sizeBytes += entry.sizeBytes;
    }
  }
  return { items, sizeBytes };
}

/**
 * Le chemin convient-il à la granularité ? Site : `/` ; bibliothèque : un segment ; dossier :
 * deux segments ou plus ; élément : deux segments ou plus (le type est vérifié contre la sauvegarde).
 */
export function isPathOfScope(scope: SiteScope, path: string): boolean {
  const depth = path.split('/').filter(Boolean).length;
  if (scope === 'site') return path === '/';
  if (scope === 'library') return depth === 1;
  return depth >= 2;
}
