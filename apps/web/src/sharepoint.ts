import { RESTORE_LABELS } from './restoreLabels.js';
import type { SiteEntry, SiteScope, SiteScopeSummary } from '@backup365/core';
import { dayOf, dateTimeOf, sizeOf } from './onedrive.js';
import { elementsInError, elementsWhich } from './format.js';
import type { SiteJob } from './sharepoint/model.js';

// Modèle et accès au serveur : un fichier chacun sous `sharepoint/`, réunis ici pour les écrans.
export * from './sharepoint/model.js';
export * from './sharepoint/api.js';
export type { SiteEntry, SiteScope, SiteScopeSummary };
export { dayOf, dateTimeOf, sizeOf };

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
      // Sans granularité valide, l'ancre ne dit pas quoi ouvrir : la racine du site.
      path: found && path.length > 0 ? `/${path.join('/')}` : '/',
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
  if (scope === 'item') return pathLabel(path).split(' > ').pop() ?? '';
  const kind = scope === 'folder' ? 'Dossier' : 'Bibliothèque';
  return `${kind} : ${pathLabel(path)}`;
}

/** Valeur de la ligne « Fichiers déjà présents » : la restauration ne remplace jamais. */
export const EXISTING_FILES_KEPT = 'conservés, non remplacés';

/**
 * Destination réelle : les éléments reviennent à leur emplacement d'origine, dans la bibliothèque
 * pour un élément, un dossier ou une bibliothèque ; à chaque emplacement pour le site entier.
 */
export function locationOf(scope: SiteScope, siteName: string, path: string): string {
  if (scope === 'site') return 'Emplacement d’origine de chaque élément';
  const segments = path.split('/').filter(Boolean);
  const place = scope === 'item' ? segments.slice(0, -1) : segments.slice(0, 1);
  return `${[siteName, ...place].filter(Boolean).join(' > ')} (emplacement d’origine)`;
}

/** Lignes « Emplacement » et « Fichiers déjà présents », communes au récapitulatif et aux résultats. */
export function placementRows(
  scope: SiteScope,
  siteName: string,
  path: string,
): [string, string][] {
  return [
    [RESTORE_LABELS.location, locationOf(scope, siteName, path)],
    [RESTORE_LABELS.existingFiles, EXISTING_FILES_KEPT],
  ];
}

/** Granularité de restauration déduite de la ligne cochée. */
export function scopeOfKind(kind: SiteEntry['kind']): SiteScope {
  return kind === 'file' ? 'item' : kind;
}

/** Pourquoi « Continuer » est inactif, en une phrase. */
export function continueHint(): string {
  return 'Cochez un fichier, un dossier ou une bibliothèque pour continuer.';
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

/** Lignes du récapitulatif de confirmation, dans l'ordre des écrans de résultat. */
export function confirmRowsOf(input: {
  scope: SiteScope;
  siteName: string;
  path: string;
  pointAt: string;
  summary: SiteScopeSummary | null;
  reason: string;
}): [string, string][] {
  const rows: [string, string][] = [
    ['Site', input.siteName],
    [RESTORE_LABELS.item, restoredContentLabel(input.scope, input.path)],
    [RESTORE_LABELS.backupDate, dateTimeOf(input.pointAt)],
    ...placementRows(input.scope, input.siteName, input.path),
  ];
  if (input.summary) {
    // Site entier : seul le nombre d'éléments est annoncé.
    rows.push([
      'Volume',
      input.scope === 'site'
        ? plural(input.summary.items, 'élément', 'éléments')
        : summaryCountOf(input.summary),
    ]);
  }
  rows.push(['Motif', input.reason]);
  return rows;
}

/** Site entier : titre du bandeau d'avertissement. */
export const SITE_WARNING_TITLE = 'Restauration du site entier';

/** Site entier : conséquence, nommant le site. */
export function siteWarningOf(siteName: string): string {
  return `Les contenus manquants du site ${siteName} seront recréés. Les fichiers existants ne sont pas modifiés.`;
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

export function failureCause(error: SiteJob['error']): string {
  if (error === 'restore_unreachable') return 'SharePoint injoignable pour le moment';
  if (error === 'restore_lost') return 'le suivi a été perdu (service redémarré)';
  return 'le service de restauration a signalé une erreur';
}

/** Conséquence d'un échec : état incertain, sinon éléments restaurés et en erreur, sinon « rien modifié ». */
export function failureConsequence(job: Pick<SiteJob, 'error' | 'restored' | 'errors'>): string {
  if (isOutcomeUncertain(job.error))
    return 'L’état de SharePoint est incertain : vérifiez avant de réessayer';
  if (job.restored < 1) return 'Rien n’a été modifié';
  const parts = [
    elementsWhich(job.restored, 'restauré'),
    job.errors > 0 ? elementsInError(job.errors) : '',
  ].filter(Boolean);
  return parts.join(', ');
}

/** Ligne « En erreur » du récapitulatif : le fichier, ou le dossier où se trouvent les éléments. */
export function errorItemLabel(job: Pick<SiteJob, 'scope' | 'path' | 'errors'>): string | null {
  const path = pathLabel(job.path);
  if (job.errors < 1 || job.scope === 'site' || path === '') return null;
  return job.scope === 'item' ? path : `dans ${path}`;
}

/** Vrai si l'appel a pu aboutir malgré l'échec affiché. */
export function isOutcomeUncertain(error: SiteJob['error']): boolean {
  return error === 'restore_unreachable' || error === 'restore_lost';
}
