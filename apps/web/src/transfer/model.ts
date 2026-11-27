import type { Mailbox } from '@backup365/core';
import type { TransferBoxes } from '../restoreRows.js';

/**
 * Restauration d'un mail vers la boîte d'un autre compte (issue #546, docs/adr/0024) : libellés,
 * recherche d'un compte, nom du dossier créé. Réservée aux administrateurs.
 */

export const TRANSFER = {
  steps: ['Destination', 'Motif', 'Confirmation'],
  legend: 'Restaurer vers',
  origin: 'La boîte d’origine',
  other: 'La boîte d’un autre compte',
  search: 'Rechercher un compte (nom ou adresse)',
  searchButton: 'Rechercher',
  results: 'Compte de destination',
  searching: 'Recherche des comptes…',
  empty: 'Aucun compte ne correspond à cette recherche.',
  unavailable: 'Liste des comptes indisponible. Réessayez.',
  sourceHint: 'boîte d’origine',
  chooseTarget: 'Choisissez un compte de destination.',
  sameTarget: 'Choisissez un autre compte que celui de la boîte d’origine.',
  reasonError: 'Indiquez le motif.',
  sending: 'Restauration en cours…',
} as const;

/** Bouton de confirmation, court : l'adresse est déjà dans la liste et l'avertissement (#574). */
export const CONFIRM_LABEL = 'Restaurer vers ce compte';

/** Avertissement en tête de la confirmation, sans l'adresse : elle est déjà dans la liste (#590). */
export const READ_WARNING = 'La boîte de destination pourra lire ce mail.';

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

/** Boîtes d'origine et de destination de la liste libellée, comme « Nom · adresse ». */
export const transferBoxes = (source: Mailbox, target?: Mailbox): TransferBoxes => ({
  origin: accountLabel(source),
  target: target ? accountLabel(target) : undefined,
});

/** Comptes du catalogue ; lève si la liste n'est pas disponible. */
export async function fetchAccounts(fetchFn: typeof fetch = fetch): Promise<Mailbox[]> {
  const res = await fetchFn('/api/mailboxes');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { mailboxes: Mailbox[] }).mailboxes;
}
