import type { IndexedMail } from '@backup365/core';
import { toUtcIso } from './audit.js';

export interface SearchQuery {
  q?: string;
  mailbox?: string;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
}

export interface SearchResponse {
  total: number;
  limit: number;
  offset: number;
  items: IndexedMail[];
}

/** Nombre de résultats par page. */
export const SEARCH_PAGE_SIZE = 25;

/** Longueur minimale du motif d'export (la même que côté serveur). */
export const MIN_REASON_LENGTH = 3;

function params(query: SearchQuery): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') out.set(key, String(value));
  }
  return out.toString();
}

/** Interroge `/api/search` ; les filtres vides sont omis. Lève une erreur hors 2xx. */
export async function searchMails(
  query: SearchQuery,
  fetchFn: typeof fetch = fetch,
): Promise<SearchResponse> {
  const res = await fetchFn(`/api/search?${params(query)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as SearchResponse;
}

/** Requête issue du formulaire : première page, dates locales converties en UTC. */
export function searchQueryFromForm(form: FormData): SearchQuery {
  const text = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  return {
    limit: SEARCH_PAGE_SIZE,
    offset: 0,
    q: text('q'),
    mailbox: text('mailbox'),
    after: toUtcIso(text('after')),
    before: toUtcIso(text('before')),
  };
}

/** Adresse de la fiche d'un mail (ancre de l'interface). */
export function mailHref(mail: Pick<IndexedMail, 'mailboxId' | 'messageId'>): string {
  return `#/mail/${encodeURIComponent(mail.mailboxId)}/${encodeURIComponent(mail.messageId)}`;
}

/** Boîte et message désignés par une ancre `#/mail/<boîte>/<message>` ; `null` sinon. */
export function parseMailHash(hash: string): { mailboxId: string; messageId: string } | null {
  const match = /^#\/mail\/([^/]+)\/([^/]+)$/.exec(hash);
  if (!match?.[1] || !match[2]) return null;
  try {
    return { mailboxId: decodeURIComponent(match[1]), messageId: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

function mailUrl(mailboxId: string, messageId: string): string {
  return `/api/mails/${encodeURIComponent(mailboxId)}/${encodeURIComponent(messageId)}`;
}

/** Fiche d'un mail (`/api/mails/…`). Lève une erreur hors 2xx. */
export async function fetchMail(
  mailboxId: string,
  messageId: string,
  fetchFn: typeof fetch = fetch,
): Promise<IndexedMail> {
  const res = await fetchFn(mailUrl(mailboxId, messageId));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as IndexedMail;
}

/** Motif utilisable : au moins `MIN_REASON_LENGTH` caractères hors espaces de bord. */
export function isReasonValid(reason: string): boolean {
  return reason.trim().length >= MIN_REASON_LENGTH;
}

/** Demande l'export EML avec son motif. Lève une erreur hors 2xx ; renvoie le fichier. */
export async function exportEml(
  mailboxId: string,
  messageId: string,
  reason: string,
  fetchFn: typeof fetch = fetch,
): Promise<Blob> {
  const res = await fetchFn(`${mailUrl(mailboxId, messageId)}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: reason.trim() }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/** Propose le fichier au téléchargement du navigateur. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
