import { API_ERRORS } from './apiError.js';
import { REASON } from './RestoreJourney.js';
import type { DriveSnapshot, SiteEntry, SiteScope, SiteScopeSummary } from '@backup365/core';
import { dayOf, dateTimeOf, sizeOf, type Loaded } from './onedrive.js';
import { UNREACHABLE } from './session.js';
import { elementsInError, elementsWhich } from './format.js';

export type { SiteEntry, SiteScope, SiteScopeSummary };
export { dayOf, dateTimeOf, sizeOf };

export type SiteJobStatus = 'running' | 'succeeded' | 'failed';

/** Restauration SharePoint telle que l'API la rend : états, comptes et durées, jamais de contenu. */
export interface SiteJob {
  id: string;
  siteId: string;
  scope: SiteScope;
  path: string;
  status: SiteJobStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  total: number;
  restored: number;
  skipped: number;
  errors: number;
  copyName: string | null;
  error: 'restore_error' | 'restore_unreachable' | 'restore_lost' | null;
}

export interface Site {
  id: string;
  displayName: string;
}

export const SHAREPOINT_MESSAGES = {
  title: 'Restaurer depuis SharePoint',
  loadingPoints: 'Chargement des points de restauration…',
  loading: 'Chargement…',
  noSites: 'Aucun site SharePoint n’est encore sauvegardé.',
  noPoints: 'Aucun point de restauration pour ce site.',
  emptyFolder: 'Ce dossier ne contient aucun élément à cette date.',
  readError: 'La sauvegarde n’a pas pu être lue.',
  adminOnly: 'Réservé aux administrateurs',
  forbidden: 'Vous n’avez pas le droit de restaurer ce site. Contactez un administrateur.',
  forbiddenSite: (name: string) =>
    `Vous n’avez pas le droit de restaurer le site « ${name} ». Demandez à un administrateur ou choisissez un autre site.`,
  chooseOther: 'Choisir un autre site',
  reasonError: REASON.error,
  nameError: 'Le nom saisi ne correspond pas au site.',
  inactiveHint:
    'Le bouton reste inactif tant que la case n’est pas cochée et que le nom du site n’est pas exact.',
  alreadyRunning: 'Une restauration de ce site est déjà en cours.',
  auditUnavailable: 'Journal d’audit indisponible : restauration refusée.',
  emptyScope: 'Rien à restaurer à cette date : le périmètre ne contient aucun élément.',
  notInBackup: 'Cet élément n’est plus disponible dans la sauvegarde.',
  generic: 'La demande a échoué. Réessayez.',
} as const;

const T = SHAREPOINT_MESSAGES;

const SERVER_MESSAGES: Record<string, string> = {
  reason_required: T.reasonError,
  forbidden: T.forbidden,
  admin_required: T.forbidden,
  confirmation_mismatch: T.nameError,
  restore_in_progress: T.alreadyRunning,
  audit_unavailable: T.auditUnavailable,
  item_not_found: T.notInBackup,
  empty_scope: T.emptyScope,
};

export const SCOPE_OPTIONS: { value: SiteScope; label: string; noun: string }[] = [
  { value: 'item', label: 'Un élément', noun: 'l’élément' },
  { value: 'folder', label: 'Un dossier', noun: 'le dossier' },
  {
    value: 'library',
    label: 'Une bibliothèque',

    noun: 'la bibliothèque',
  },
  { value: 'site', label: 'Le site entier', noun: 'le site' },
];

export interface SharePointRoute {
  /** Site ; vide : le premier de la liste. */
  site: string;
  /** Granularité demandée par l'ancre ; `null` : celle par défaut. */
  scope: SiteScope | null;
  /** Dossier ouvert dans l'arborescence, `/` pour la racine du site. */
  path: string;
}

export const SHAREPOINT_HASH = '#/sharepoint';

/** `#/sharepoint[/<site>[/<granularité>[/<chemin>]]]`, chaque segment encodé. `null` si l'ancre n'est pas la bonne. */
export function parseSharePointHash(hash: string): SharePointRoute | null {
  if (hash !== SHAREPOINT_HASH && !hash.startsWith(`${SHAREPOINT_HASH}/`)) return null;
  const parts = hash.slice(SHAREPOINT_HASH.length).split('/').filter(Boolean);
  try {
    const [site = '', scope = '', ...path] = parts.map(decodeURIComponent);
    const found = SCOPE_OPTIONS.find((o) => o.value === scope);
    return {
      site,
      scope: found?.value ?? null,
      path: path.length === 0 ? '/' : `/${path.join('/')}`,
    };
  } catch {
    return null;
  }
}

/** Le chemin n'est pris en compte qu'avec une granularité : elle précède le chemin dans l'ancre. */
export function sharePointHash(site: string, scope?: SiteScope, path = '/'): string {
  const segments = scope ? path.split('/').filter(Boolean).map(encodeURIComponent) : [];
  return [SHAREPOINT_HASH, encodeURIComponent(site), ...(scope ? [scope] : []), ...segments].join(
    '/',
  );
}

/**
 * Clic simple sur un lien : on navigue dans la page sans recharger. Un clic modifié (Ctrl, Meta,
 * Maj, Alt, bouton du milieu) est laissé au navigateur, qui ouvre le `href` du lien.
 */
export function followInApp(
  ev: {
    button: number;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    preventDefault: () => void;
  },
  navigate: () => void,
): void {
  if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
  ev.preventDefault();
  navigate();
}

/** Niveaux du fil d'Ariane : le site, puis chaque dossier du chemin avec son chemin complet. */
export function breadcrumbLevels(
  siteName: string,
  path: string,
): { label: string; path: string }[] {
  const levels = [{ label: siteName, path: '/' }];
  let acc = '';
  for (const segment of path.split('/').filter(Boolean)) {
    acc += `/${segment}`;
    levels.push({ label: segment, path: acc });
  }
  return levels;
}

/** Lien d'un niveau du fil : son `href` propre, et un clic simple qui ouvre ce niveau. */
export function breadcrumbLink(
  level: { path: string },
  siteId: string,
  scope: SiteScope,
  go: (path: string) => void,
): { href: string; onClick: (ev: Parameters<typeof followInApp>[0]) => void } {
  return {
    href: sharePointHash(siteId, scope, level.path),
    onClick: (ev) => {
      followInApp(ev, () => {
        go(level.path);
      });
    },
  };
}

/** Chemin virtuel en fil lisible : `Documents partagés > Plans 2024`. */
export function pathLabel(path: string): string {
  return path.split('/').filter(Boolean).join(' > ');
}

/** Ce qui a été restauré, pour l'écran de résultat : `Fichier : Documents partagés > plan-a.pdf`. */
export function restoredContentLabel(scope: SiteScope, path: string): string {
  if (scope === 'site') return 'Site entier';
  const kind = scope === 'item' ? 'Fichier' : scope === 'folder' ? 'Dossier' : 'Bibliothèque';
  return `${kind} : ${pathLabel(path)}`;
}

/** Choix valide pour la granularité ? Mêmes règles que le serveur (`isPathOfScope`). */
export function canContinue(scope: SiteScope, path: string, file: string | null): boolean {
  const depth = path.split('/').filter(Boolean).length;
  if (scope === 'site') return true;
  if (scope === 'library') return depth === 1;
  if (scope === 'folder') return depth >= 2;
  return file !== null;
}

/** Pourquoi « Continuer » est inactif, en une phrase. */
export function continueHint(scope: SiteScope): string {
  if (scope === 'library') return 'Ouvrez la bibliothèque à restaurer pour continuer.';
  if (scope === 'folder') return 'Ouvrez le dossier à restaurer pour continuer.';
  return 'Choisissez un élément pour continuer.';
}

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

/** `1 240 éléments, 3,2 Go`. */
export function summaryCountOf(s: SiteScopeSummary): string {
  const size =
    s.sizeBytes >= 1_000_000_000
      ? `${(s.sizeBytes / 1_000_000_000).toFixed(1).replace('.', ',')} Go`
      : sizeOf(s.sizeBytes);
  return `${plural(s.items, 'élément', 'éléments').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}, ${size}`;
}

/** `à 02:00` de la date ISO (UTC). */
function timeOf(iso: string): string {
  return dateTimeOf(iso).slice(11);
}

/** Phrase de récapitulatif (élément, dossier, bibliothèque), en langage clair. */
export function summaryOf(input: {
  scope: SiteScope;
  siteName: string;
  path: string;
  pointAt: string;
  summary: SiteScopeSummary | null;
}): string {
  const label = pathLabel(input.path);
  const what =
    input.scope === 'library'
      ? `la bibliothèque « ${label} »`
      : input.scope === 'folder'
        ? `le dossier « ${label} »`
        : input.scope === 'item'
          ? `l’élément « ${label} »`
          : 'le site entier';
  const count = input.summary ? ` ${summaryCountOf(input.summary)}.` : '';
  return `Vous allez restaurer ${what} du site « ${input.siteName} », tel qu’il était le ${dayOf(input.pointAt)} à ${timeOf(input.pointAt)}, à son emplacement d’origine. Les fichiers existants ne seront pas remplacés.${count}`;
}

/** Phrase de récapitulatif du site entier ; le nombre d'éléments suit quand il est connu. */
export function wholeSiteSummaryOf(input: {
  siteName: string;
  pointAt: string;
  items: number | null;
}): string {
  const count = input.items === null ? '' : ` : ${plural(input.items, 'élément', 'éléments')}`;
  return `Vous allez restaurer le site « ${input.siteName} » tel qu’il était le ${dayOf(input.pointAt)} à ${timeOf(input.pointAt)}${count}. Les contenus manquants seront recréés.`;
}

/** `3 min 12 s` : voir `formatDuration` de `restore.ts`. */
export { formatDuration } from './restore.js';

/** Bilan d'une restauration réussie : les compteurs nuls sont omis, chaque nombre a son nom. */
export function successSummary(
  restored: number,
  skipped: number,
  errors: number,
  duration: string,
): string {
  const parts = [
    restored > 0
      ? `${elementsWhich(restored, 'restauré')} en ${duration}.`
      : `Aucun élément restauré en ${duration}.`,
  ];
  if (skipped > 0) {
    parts.push(
      `${skipped < 2 ? '1 élément déjà présent a été conservé' : `${skipped} éléments déjà présents ont été conservés`}.`,
    );
  }
  if (errors > 0) parts.push(`${elementsInError(errors)}.`);
  return parts.join(' ');
}

/** Phrase de l'alerte d'échec (hors état incertain) : ce qui a été restauré, rien d'écrasé. */
export function failureSummary(restored: number): string {
  const done = restored > 0 ? elementsWhich(restored, 'restauré') : 'aucun élément restauré';
  return `La restauration a échoué : ${done}. Rien n’a été écrasé.`;
}

export function failureCause(error: SiteJob['error']): string {
  if (error === 'restore_unreachable') return 'SharePoint injoignable pour le moment';
  if (error === 'restore_lost') return 'le suivi a été perdu (service redémarré)';
  return 'le service de restauration a signalé une erreur';
}

/** Vrai si l'appel a pu aboutir malgré l'échec affiché. */
export function isOutcomeUncertain(error: SiteJob['error']): boolean {
  return error === 'restore_unreachable' || error === 'restore_lost';
}

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

const site = (id: string): string => `/api/sharepoint/${encodeURIComponent(id)}`;

export function fetchSites(fetchFn: typeof fetch = fetch): Promise<Loaded<Site[]>> {
  return load('/api/sharepoint/sites', (b: { sites: Site[] }) => b.sites, fetchFn);
}

export function fetchSiteSnapshots(
  siteId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Loaded<DriveSnapshot[]>> {
  return load(
    `${site(siteId)}/snapshots`,
    (b: { snapshots: DriveSnapshot[] }) => b.snapshots,
    fetchFn,
  );
}

export function fetchSiteEntries(
  siteId: string,
  snapshotId: string,
  path: string,
  fetchFn: typeof fetch = fetch,
): Promise<Loaded<SiteEntry[]>> {
  const query = new URLSearchParams({ snapshot: snapshotId, path });
  return load(
    `${site(siteId)}/items?${query.toString()}`,
    (b: { entries: SiteEntry[] }) => b.entries,
    fetchFn,
  );
}

export function fetchScope(
  siteId: string,
  snapshotId: string,
  path: string,
  fetchFn: typeof fetch = fetch,
): Promise<Loaded<SiteScopeSummary>> {
  const query = new URLSearchParams({ snapshot: snapshotId, path });
  return load(
    `${site(siteId)}/scope?${query.toString()}`,
    (b: SiteScopeSummary) => ({ items: b.items, sizeBytes: b.sizeBytes }),
    fetchFn,
  );
}

/** La restauration est-elle configurée ? En cas d'erreur : oui, le serveur tranchera. */
export async function fetchSiteRestoreConfigured(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn('/api/sharepoint/status');
    if (!res.ok) return true;
    return ((await res.json()) as { configured: boolean }).configured;
  } catch {
    return true;
  }
}

/** Dernière restauration du site ; lève si la réponse n'est pas en 2xx. */
export async function fetchLastSiteJob(
  siteId: string,
  fetchFn: typeof fetch = fetch,
): Promise<SiteJob | null> {
  const res = await fetchFn(`${site(siteId)}/restore`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { last: SiteJob | null }).last;
}

export interface SiteRestoreInput {
  snapshotId: string;
  scope: SiteScope;
  path: string;
  reason: string;
  confirmName?: string | undefined;
}

export type SiteRestoreResult =
  { ok: true; job: SiteJob } | { ok: false; message: string; requestId?: string };

/** Lance la restauration. `message` est en français, sans détail technique. */
export async function startSiteRestore(
  siteId: string,
  input: SiteRestoreInput,
  fetchFn: typeof fetch = fetch,
): Promise<SiteRestoreResult> {
  try {
    const res = await fetchFn(`${site(siteId)}/restore`, {
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
        message: SERVER_MESSAGES[code] ?? API_ERRORS[code] ?? T.generic,
        ...(requestId ? { requestId } : {}),
      };
    }
    return { ok: true, job: ((await res.json()) as { job: SiteJob }).job };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}
