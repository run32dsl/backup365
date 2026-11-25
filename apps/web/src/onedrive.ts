import { API_ERRORS } from './apiError.js';
import { REASON } from './RestoreJourney.js';
import { RESTORE_LABELS } from './restoreLabels.js';
import type { DriveEntry, DriveSnapshot, DriveVersion } from '@backup365/core';
import { UNREACHABLE } from './session.js';

export type { DriveEntry, DriveSnapshot, DriveVersion };
import { dayOf, dateTimeOf, sizeOf } from './format.js';

export { dayOf, dateTimeOf, sizeOf };

export type DriveMode = 'copy' | 'replace';
export type DriveKind = 'file' | 'folder';
export type DriveJobStatus = 'running' | 'succeeded' | 'failed';

/** Restauration OneDrive telle que l'API la rend : états et durées, jamais de contenu. */
export interface DriveJob {
  id: string;
  ownerId: string;
  path: string;
  kind: DriveKind;
  mode: DriveMode;
  versionAt: string | null;
  status: DriveJobStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  copyName: string | null;
  error: 'restore_error' | 'restore_unreachable' | 'restore_lost' | null;
}

export const ONEDRIVE_MESSAGES = {
  title: 'Restaurer depuis OneDrive',
  loading: 'Chargement de la sauvegarde…',
  noBackup: 'Aucune sauvegarde de ce OneDrive.',
  readError: 'La sauvegarde n’a pas pu être lue.',
  noVersions: 'Aucune version antérieure conservée pour ce fichier.',
  confirmReplace: 'Je confirme le remplacement du fichier actuel.',
  confirmError: 'Cochez la case pour confirmer le remplacement.',
  noRights:
    'Votre rôle ne permet pas de restaurer. Vous pouvez parcourir la sauvegarde ; demandez l’accès à un administrateur.',
  alreadyRunning: 'Une restauration de cet élément est déjà en cours.',
  auditUnavailable: 'Journal d’audit indisponible : restauration refusée.',
  notInBackup: 'Cet élément n’est plus disponible dans la sauvegarde.',
  generic: 'La demande a échoué. Réessayez.',
} as const;

const SERVER_MESSAGES: Record<string, string> = {
  reason_required: REASON.error,
  forbidden: ONEDRIVE_MESSAGES.noRights,
  restore_in_progress: ONEDRIVE_MESSAGES.alreadyRunning,
  audit_unavailable: ONEDRIVE_MESSAGES.auditUnavailable,
  item_not_found: ONEDRIVE_MESSAGES.notInBackup,
};

export interface OneDriveRoute {
  /** Compte OneDrive ; vide : le premier de la liste. */
  account: string;
  /** Dossier parcouru, `/` pour la racine. */
  path: string;
}

export const ONEDRIVE_HASH = '#/onedrive';

/** `#/onedrive/<compte>/<chemin>` ; chaque segment est encodé. `null` si l'ancre n'est pas la bonne. */
export function parseOneDriveHash(hash: string): OneDriveRoute | null {
  if (hash !== ONEDRIVE_HASH && !hash.startsWith(`${ONEDRIVE_HASH}/`)) return null;
  const parts = hash.slice(ONEDRIVE_HASH.length).split('/').filter(Boolean);
  try {
    const [account = '', ...path] = parts.map(decodeURIComponent);
    // Un segment `..` ou contenant `/` ne sortirait pas du OneDrive : le serveur le refuse aussi.
    return { account, path: path.length === 0 ? '/' : `/${path.join('/')}` };
  } catch {
    return null;
  }
}

export function oneDriveHash(account: string, path: string): string {
  const segments = path.split('/').filter(Boolean).map(encodeURIComponent);
  return [ONEDRIVE_HASH, encodeURIComponent(account), ...segments].join('/');
}

/** Fil d'Ariane : le compte (racine du OneDrive) puis chaque dossier, avec le chemin complet. */
export function breadcrumbOf(path: string, rootLabel: string): { label: string; path: string }[] {
  const out = [{ label: rootLabel, path: '/' }];
  let current = '';
  for (const segment of path.split('/').filter(Boolean)) {
    current += `/${segment}`;
    out.push({ label: segment, path: current });
  }
  return out;
}

/** Copie : `budget.xlsx` → `budget (restauré le 14-11-2026).xlsx` (voir `copyNameOf` du serveur). */
export { copyNameOf } from '@backup365/core';

/** « Restaurer » reste inactif tant que le remplacement n'est pas confirmé par la case. */
export const restoreBlocked = (mode: DriveMode, confirmed: boolean): boolean =>
  mode === 'replace' && !confirmed;

/** Lignes du récapitulatif de confirmation, dans l'ordre des écrans de résultat. */
export function confirmRowsOf(input: {
  account: string;
  name: string;
  mode: DriveMode;
  backupAt: string | null;
  versionAt: string | null;
  folderLabel: string;
  copyName: string;
  reason: string;
}): [string, string][] {
  const rows: [string, string][] = [
    ['Compte', input.account],
    [RESTORE_LABELS.item, input.name],
    [RESTORE_LABELS.backupDate, dateTimeOf(input.backupAt)],
  ];
  if (input.versionAt !== null) rows.push([RESTORE_LABELS.versionAt, dateTimeOf(input.versionAt)]);
  rows.push(['Emplacement', input.folderLabel]);
  if (input.mode === 'replace') rows.push(['Fichier remplacé', input.name]);
  else {
    // Une version restaurée en copie : le SDK choisit le nom (`copyName` vide).
    rows.push([
      'Restauré sous le nom',
      input.copyName === '' ? 'Nom choisi par OneDrive' : input.copyName,
    ]);
  }
  rows.push(['Motif', input.reason]);
  return rows;
}

/** Mode copie : phrase rassurante en texte courant, sans bandeau. */
export const COPY_CONSEQUENCE = 'Aucun fichier existant ne sera modifié.';

/** Mode remplacement : titre du bandeau d'avertissement. */
export const REPLACE_WARNING_TITLE = 'Remplacement du fichier actuel';

/** Mode remplacement : conséquence, nommant le fichier et la version restaurée. */
export function replaceWarningOf(name: string, versionAt: string | null): string {
  const version =
    versionAt === null ? 'la version sauvegardée' : `la version du ${dateTimeOf(versionAt)} UTC`;
  return `${name} sera remplacé par ${version}. L’actuel reste dans l’historique OneDrive.`;
}

export function failureCause(error: DriveJob['error']): string {
  if (error === 'restore_unreachable') return 'OneDrive injoignable pour le moment';
  if (error === 'restore_lost') return 'le suivi a été perdu (service redémarré)';
  return 'le service de restauration a signalé une erreur';
}

/** Vrai si l'appel a pu aboutir malgré l'échec affiché. */
export function isOutcomeUncertain(error: DriveJob['error']): boolean {
  return error === 'restore_unreachable' || error === 'restore_lost';
}

export type Loaded<T> =
  { status: 'ok'; data: T } | { status: 'unconfigured' | 'no_backup' | 'error' };

async function load<T>(
  url: string,
  pick: (body: never) => T,
  fetchFn: typeof fetch,
): Promise<Loaded<T>> {
  try {
    const res = await fetchFn(url);
    if (res.ok) return { status: 'ok', data: pick((await res.json()) as never) };
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (res.status === 503 && body?.error === 'catalog_unavailable')
      return { status: 'unconfigured' };
    if (res.status === 503 && body?.error === 'no_backup_found') return { status: 'no_backup' };
    return { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

const owner = (account: string): string => `/api/onedrive/${encodeURIComponent(account)}`;

/** Comptes ayant une sauvegarde (les boîtes : un OneDrive porte l'identifiant de son propriétaire). */
export function fetchAccounts(
  fetchFn: typeof fetch = fetch,
): Promise<Loaded<{ id: string; displayName: string }[]>> {
  return load(
    '/api/mailboxes',
    (b: { mailboxes: { id: string; displayName: string }[] }) => b.mailboxes,
    fetchFn,
  );
}

export function fetchSnapshots(
  account: string,
  fetchFn: typeof fetch = fetch,
): Promise<Loaded<DriveSnapshot[]>> {
  return load(
    `${owner(account)}/snapshots`,
    (b: { snapshots: DriveSnapshot[] }) => b.snapshots,
    fetchFn,
  );
}

export function fetchEntries(
  account: string,
  snapshotId: string,
  path: string,
  fetchFn: typeof fetch = fetch,
): Promise<Loaded<DriveEntry[]>> {
  const query = new URLSearchParams({ snapshot: snapshotId, path });
  return load(
    `${owner(account)}/items?${query.toString()}`,
    (b: { entries: DriveEntry[] }) => b.entries,
    fetchFn,
  );
}

export function fetchVersions(
  account: string,
  path: string,
  fetchFn: typeof fetch = fetch,
): Promise<Loaded<DriveVersion[]>> {
  const query = new URLSearchParams({ path });
  return load(
    `${owner(account)}/versions?${query.toString()}`,
    (b: { versions: DriveVersion[] }) => b.versions,
    fetchFn,
  );
}

/** La restauration est-elle configurée ? En cas d'erreur : oui, le serveur tranchera. */
export async function fetchDriveRestoreConfigured(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn('/api/onedrive/status');
    if (!res.ok) return true;
    return ((await res.json()) as { configured: boolean }).configured;
  } catch {
    return true;
  }
}

/** Dernière restauration de l'élément ; lève si la réponse n'est pas en 2xx. */
export async function fetchLastDriveJob(
  account: string,
  path: string,
  fetchFn: typeof fetch = fetch,
): Promise<DriveJob | null> {
  const res = await fetchFn(
    `${owner(account)}/restore?${new URLSearchParams({ path }).toString()}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { last: DriveJob | null }).last;
}

export interface DriveRestoreInput {
  snapshotId: string;
  path: string;
  kind: DriveKind;
  mode: DriveMode;
  versionId?: string | undefined;
  reason: string;
}

export type DriveRestoreResult =
  { ok: true; job: DriveJob } | { ok: false; message: string; requestId?: string };

/** Lance la restauration. `message` est en français, sans détail technique. */
export async function startDriveRestore(
  account: string,
  input: DriveRestoreInput,
  fetchFn: typeof fetch = fetch,
): Promise<DriveRestoreResult> {
  try {
    const res = await fetchFn(`${owner(account)}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, reason: input.reason.trim() }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const code = typeof body?.error === 'string' ? body.error : '';
      const requestId = res.headers.get('x-request-id') ?? undefined;
      return {
        ok: false,
        message: SERVER_MESSAGES[code] ?? API_ERRORS[code] ?? ONEDRIVE_MESSAGES.generic,
        ...(requestId ? { requestId } : {}),
      };
    }
    return { ok: true, job: ((await res.json()) as { job: DriveJob }).job };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}
