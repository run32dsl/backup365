/** Affichage partagé par tous les écrans : dates, tailles, dossiers, charges, pluriels. */

const pad = (n: number): string => String(n).padStart(2, '0');

/** `jj/mm/aaaa` (UTC), ou chaîne vide si la date est illisible. */
export function dayOf(iso: string | null): string {
  const d = iso === null ? new Date(Number.NaN) : new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** `jj/mm/aaaa hh:mm` (UTC, sans secondes), ou chaîne vide si la date est illisible. */
export function dateTimeOf(iso: string | null): string {
  if (iso === null) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${dayOf(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Seconde ligne d'une carte de fichier : « Version du 18/11/2026 09:52 UTC · 84 Ko » ; absente sans valeur. */
export function cardSummary(versionAt: string | null, sizeBytes: number | null): string | null {
  const parts = [
    versionAt !== null && dateTimeOf(versionAt) !== ''
      ? `Version du ${dateTimeOf(versionAt)} UTC`
      : '',
    sizeBytes === null ? '' : sizeOf(sizeBytes),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** `dateTimeOf`, avec un tiret pour une date absente (cellule de tableau). */
export const dateTimeOrDash = (iso: string | null | undefined): string =>
  dateTimeOf(iso ?? null) || '—';

/** `842 o`, `2,4 Ko`, `84 Ko`, `1,2 Mo` ; `-` pour un dossier. */
export function sizeOf(bytes: number | null): string {
  if (bytes === null) return '-';
  if (bytes < 1000) return `${bytes} o`;
  const decimal = (n: number): string => n.toFixed(1).replace('.', ',');
  if (bytes < 9_950) return `${decimal(bytes / 1000)} Ko`;
  if (bytes < 999_500) return `${Math.round(bytes / 1000)} Ko`;
  return `${decimal(bytes / 1_000_000)} Mo`;
}

const FOLDERS: Record<string, string> = {
  inbox: 'Boîte de réception',
  sentitems: 'Éléments envoyés',
  sent: 'Éléments envoyés',
  archive: 'Archives',
  drafts: 'Brouillons',
  deleteditems: 'Éléments supprimés',
  trash: 'Éléments supprimés',
  junkemail: 'Courrier indésirable',
  junk: 'Courrier indésirable',
};

/** Nom d'un dossier de messagerie en français ; un nom inconnu est rendu tel quel. */
export const folderLabel = (folder: string): string =>
  FOLDERS[folder.toLowerCase().replace(/[\s_-]/g, '')] ?? folder;

const WORKLOADS: Record<string, string> = {
  mail: 'Messagerie',
  contacts: 'Contacts',
  onedrive: 'OneDrive',
  sharepoint: 'SharePoint',
  teams: 'Teams',
};

/** Nom d'une charge sauvegardée ; une charge inconnue est rendue telle quelle. */
export const workloadLabel = (workload: string): string => WORKLOADS[workload] ?? workload;

/** Ancienneté en clair : `il y a 3 h`, `il y a 3 jours` ; `jamais` sans sauvegarde. */
export function ageLabel(hours: number | null): string {
  if (hours === null) return 'jamais';
  if (hours < 1) return 'il y a moins d’1 h';
  if (hours < 24) return `il y a ${Math.floor(hours)} h`;
  return `il y a ${plural(Math.floor(hours / 24), 'jour')}`;
}

/** `1 résultat`, `10 résultats` (0 et 1 au singulier). */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n < 2 ? one : many}`;

/** `3 éléments`, `1 élément` : le nom est donné avec son accord, jamais un nombre nu. */
export const elements = (n: number): string => plural(n, 'élément');

/** `1 élément conservé`, `2 éléments conservés` : le participe s'accorde avec le nombre. */
export const elementsWhich = (n: number, participle: string): string =>
  `${elements(n)} ${participle}${n < 2 ? '' : 's'}`;

/** Espace insécable fine (U+202F) : devant ? ; ! et dans les guillemets français. */
export const NNBSP = ' ';
/** Espace insécable (U+00A0) : devant les deux-points. */
export const NBSP = ' ';

/** Texte entre guillemets français, avec des espaces insécables fines : jamais un guillemet seul en bout de ligne. */
export const quoted = (text: string): string => `«${NNBSP}${text}${NNBSP}»`;

/** `1 élément en erreur`, `2 éléments en erreur`. */
export const elementsInError = (n: number): string => `${elements(n)} en erreur`;
