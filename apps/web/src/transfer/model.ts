import type { Mailbox } from '@backup365/core';
import { dateTimeOf, quoted } from '../format.js';

/**
 * Restauration d'un mail vers la boîte d'un autre compte (issue #546, docs/adr/0024) : libellés,
 * recherche d'un compte, nom du dossier créé. Réservée aux administrateurs.
 */

export const TRANSFER = {
  steps: ['Destination', 'Motif', 'Confirmation'],
  legend: 'Restaurer vers',
  origin: 'Le compte d’origine',
  other: 'Un autre compte',
  search: 'Rechercher un compte (nom ou adresse)',
  searchButton: 'Rechercher',
  results: 'Compte de destination',
  searching: 'Recherche des comptes…',
  empty: 'Aucun compte ne correspond à cette recherche.',
  unavailable: 'Liste des comptes indisponible. Réessayez.',
  sourceHint: 'compte d’origine',
  chooseTarget: 'Choisissez un compte de destination.',
  sameTarget: 'Choisissez un compte différent du compte d’origine.',
  reasonError: 'Indiquez le motif.',
  sending: 'Restauration en cours…',
} as const;

/** Titre de la boîte : « Restaurer « objet » ». */
export const transferTitle = (subject: string): string => `Restaurer ${quoted(subject)}`;

/** Bouton de confirmation : « Restaurer vers Dominique Fictif ». */
export const confirmLabel = (name: string): string => `Restaurer vers ${name}`;

/** Avertissement de la confirmation. */
export const readWarning = (name: string): string => `${name} pourra lire cet élément.`;

/** Nombre de comptes trouvés, annoncé (`role="status"`). */
export function foundLabel(n: number): string {
  if (n === 0) return TRANSFER.empty;
  return n === 1 ? '1 compte trouvé.' : `${n} comptes trouvés.`;
}

/** « Nom · adresse », ou l'adresse seule quand le catalogue n'a pas d'autre nom. */
export const accountLabel = (m: Mailbox): string =>
  m.displayName && m.displayName !== m.id ? `${m.displayName} · ${m.id}` : m.id;

/** Comptes dont le nom ou l'adresse contient la recherche (sans casse ni accents), triés par nom. */
export function searchAccounts(all: Mailbox[], query: string): Mailbox[] {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const q = fold(query.trim());
  return all
    .filter((m) => q === '' || fold(m.displayName).includes(q) || fold(m.id).includes(q))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `Restauration de {source} jj-mm-aaaa` : même nom et même date UTC que le serveur. */
export function transferFolderName(sourceName: string, at: Date): string {
  return `Restauration de ${sourceName} ${pad(at.getUTCDate())}-${pad(at.getUTCMonth() + 1)}-${at.getUTCFullYear()}`;
}

/** Récapitulatif de la confirmation (A3) : élément, source, destination, emplacement, motif. */
export function confirmRows(input: {
  subject: string;
  date: string;
  source: Mailbox;
  target: Mailbox;
  reason: string;
  now: number;
}): [string, string][] {
  const date = dateTimeOf(input.date);
  return [
    ['Élément', date ? `${input.subject} · ${date} UTC` : input.subject],
    ['Source', accountLabel(input.source)],
    ['Destination', accountLabel(input.target)],
    [
      'Emplacement',
      `Dossier ${quoted(transferFolderName(input.source.displayName, new Date(input.now)))} (nouveau, rien n’est écrasé)`,
    ],
    ['Motif', input.reason.trim()],
  ];
}

/** Comptes du catalogue ; lève si la liste n'est pas disponible. */
export async function fetchAccounts(fetchFn: typeof fetch = fetch): Promise<Mailbox[]> {
  const res = await fetchFn('/api/mailboxes');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { mailboxes: Mailbox[] }).mailboxes;
}
