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

/** `1 résultat`, `10 résultats` (0 et 1 au singulier). */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n < 2 ? one : many}`;
