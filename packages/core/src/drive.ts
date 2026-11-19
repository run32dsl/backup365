/** Élément (fichier ou dossier) d'un OneDrive sauvegardé, au niveau d'un dossier parcouru. */
export interface DriveEntry {
  name: string;
  /** Chemin complet depuis la racine, ex. `/Documents/Budget/budget.xlsx`. */
  path: string;
  kind: 'file' | 'folder';
  /** Date de la version sauvegardée (ISO 8601) ; pour un dossier, la plus récente qu'il contient. */
  versionAt: string | null;
  /** Taille en octets ; `null` pour un dossier. */
  sizeBytes: number | null;
}

export interface DriveSnapshot {
  id: string;
  /** Horodatage UTC, ISO 8601. */
  createdAt: string;
}

/** Version sauvegardée d'un fichier. */
export interface DriveVersion {
  /** Identifiant de version Microsoft 365 ; `null` : le fichier tel que l'instantané l'a gardé. */
  versionId: string | null;
  snapshotId: string;
  /** Date de la version (ISO 8601). */
  at: string;
  sizeBytes: number;
  /** Version actuellement sauvegardée (la plus récente). */
  current: boolean;
}

/** Ligne d'un manifeste d'instantané OneDrive, réduite à ce que la navigation lit. */
export interface DriveManifestEntry {
  fileName: string;
  parentPath: string;
  sizeBytes: number;
  lastModifiedAt?: string | undefined;
  backupAt: string;
  changeType: string;
}

/** Parcours en lecture seule d'un OneDrive sauvegardé (adaptateur SDK : docs/adr/0013). */
export interface DriveBrowser {
  /** Instantanés d'un compte, du plus récent au plus ancien. */
  listSnapshots(ownerId: string): Promise<DriveSnapshot[]>;
  /** Contenu d'un dossier dans un instantané ; `null` si l'instantané n'existe pas. */
  listFolder(ownerId: string, snapshotId: string, path: string): Promise<DriveEntry[] | null>;
  /** Versions sauvegardées d'un fichier, de la plus récente à la plus ancienne. */
  listVersions(ownerId: string, path: string): Promise<DriveVersion[]>;
}

export type DriveRestoreMode = 'copy' | 'replace';
export type DriveItemKind = 'file' | 'folder';

export interface DriveRestoreRequest {
  ownerId: string;
  snapshotId: string;
  path: string;
  kind: DriveItemKind;
  mode: DriveRestoreMode;
  /** Version à restaurer ; absente : l'élément tel que l'instantané l'a gardé. */
  versionId?: string | undefined;
  /** Nom de la copie (mode `copy`). */
  copyName: string;
}

/** Résultat d'une restauration : des comptes, jamais de contenu. */
export interface DriveRestoreOutcome {
  restored: number;
  errors: number;
}

/** Restauration d'un fichier, d'un dossier ou d'une version dans le OneDrive d'origine. */
export interface DriveRestorer {
  restore(request: DriveRestoreRequest): Promise<DriveRestoreOutcome>;
}

const MAX_PATH_LENGTH = 1024;

/**
 * Chemin OneDrive canonique : commence par `/`, sans `/` final, sans segment vide, `.` ni `..`,
 * sans caractère de contrôle. `null` si le chemin n'est pas acceptable ; la racine est `/`.
 * Accepte le préfixe `/drive/root:` que Graph met devant `parentReference.path`.
 */
export function normalizeDrivePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_PATH_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\\]/.test(raw)) return null;
  const rooted = raw.replace(/^\/drive\/root:?/, '');
  const segments = rooted.split('/').filter((s) => s !== '');
  if (segments.some((s) => s === '.' || s === '..')) return null;
  if (rooted !== '' && !rooted.startsWith('/')) return null;
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export function joinDrivePath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`;
}

/** Dossier parent d'un chemin ; la racine est son propre parent. */
export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * `jj.mm.aaaa` (date UTC). Les `/` de `jj/mm/aaaa` sont interdits dans un nom de fichier
 * OneDrive : ils sont remplacés par des points (docs/adr/0013).
 */
export function copyDate(at: Date): string {
  return `${pad(at.getUTCDate())}.${pad(at.getUTCMonth() + 1)}.${at.getUTCFullYear()}`;
}

/** `budget.xlsx` → `budget (restauré le 14.11.2026).xlsx` ; un dossier n'a pas d'extension. */
export function copyNameOf(name: string, kind: DriveItemKind, at: Date): string {
  const suffix = ` (restauré le ${copyDate(at)})`;
  const dot = name.lastIndexOf('.');
  if (kind === 'folder' || dot <= 0) return `${name}${suffix}`;
  return `${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

/**
 * Contenu d'un dossier d'après les lignes du manifeste : fichiers directs et sous-dossiers déduits
 * des chemins plus profonds. Les éléments supprimés (`deleted`) n'y figurent pas. Dossiers
 * d'abord, puis ordre alphabétique.
 */
export function listFolderOf(entries: readonly DriveManifestEntry[], folder: string): DriveEntry[] {
  const files: DriveEntry[] = [];
  const folders = new Map<string, DriveEntry>();
  for (const e of entries) {
    if (e.changeType === 'deleted') continue;
    const parent = normalizeDrivePath(e.parentPath);
    if (parent === null) continue;
    const at = e.lastModifiedAt ?? e.backupAt;
    if (parent === folder) {
      files.push({
        name: e.fileName,
        path: joinDrivePath(folder, e.fileName),
        kind: 'file',
        versionAt: at,
        sizeBytes: e.sizeBytes,
      });
    } else if (folder === '/' || parent.startsWith(`${folder}/`)) {
      const rest = parent.slice(folder === '/' ? 1 : folder.length + 1);
      const name = rest.split('/')[0]!;
      const known = folders.get(name);
      if (!known) {
        folders.set(name, {
          name,
          path: joinDrivePath(folder, name),
          kind: 'folder',
          versionAt: at,
          sizeBytes: null,
        });
      } else if (known.versionAt !== null && at > known.versionAt) known.versionAt = at;
    }
  }
  const byName = (a: DriveEntry, b: DriveEntry) => a.name.localeCompare(b.name, 'fr');
  return [...[...folders.values()].sort(byName), ...files.sort(byName)];
}
