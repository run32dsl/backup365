/** Actions consignées. Le vocabulaire est fermé : une action inconnue est refusée par l'API. */
export const AUDIT_ACTIONS = ['list.view', 'item.open', 'item.export', 'access.denied'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * Événement du journal d'audit. Il ne contient jamais les termes recherchés ni le contenu d'un
 * élément (données personnelles) : seulement qui a fait quoi, sur quelle ressource, et quand.
 */
export interface AuditEvent {
  /** Horodatage UTC, ISO 8601. */
  at: string;
  /** Auteur de l'accès. Sans authentification (ADR 0002), c'est `anonymous`. */
  actor: string;
  action: AuditAction;
  /** Ressource consultée, ex. `mailboxes`, `mail.search`, `snapshot`. */
  resource: string;
  /** Identifiant opaque de l'objet visé (boîte, instantané), le cas échéant. */
  target?: string;
  /** Nombre d'éléments renvoyés, le cas échéant. */
  count?: number;
  /** Motif d'un échec d'accès (code court, sans donnée personnelle). */
  reason?: string;
}

/** Entrée enregistrée : l'événement, son rang et son empreinte chaînée. */
export interface AuditEntry extends AuditEvent {
  /** Rang dans le journal, à partir de 1, sans trou. */
  seq: number;
  /** Empreinte de l'entrée précédente (`AUDIT_GENESIS_HASH` pour la première). */
  previousHash: string;
  /** SHA-256 (hexadécimal) de `auditHashInput(previousHash, entry)`. */
  hash: string;
}

export interface AuditFilter {
  /** Borne basse incluse, ISO 8601. */
  from?: string;
  /** Borne haute exclue, ISO 8601. */
  to?: string;
  actor?: string;
  action?: AuditAction;
  limit: number;
  offset: number;
}

export interface AuditPage {
  total: number;
  /** Du plus récent au plus ancien. */
  items: AuditEntry[];
}

export type AuditVerification =
  { ok: true; entries: number } | { ok: false; entries: number; brokenAt: number; reason: string };

/**
 * Port du journal d'audit : en ajout seul, chaque entrée est chaînée à la précédente par une
 * empreinte SHA-256. Toute lecture ou export d'un élément sauvegardé doit y être consigné.
 */
export interface AuditLog {
  /** Ajoute l'événement à la suite du journal, de façon atomique. */
  record(event: AuditEvent): Promise<void>;
  list(filter: AuditFilter): Promise<AuditPage>;
  /** Relit toute la chaîne et signale la première entrée altérée. */
  verify(): Promise<AuditVerification>;
}

/** Empreinte « précédente » de la première entrée. */
export const AUDIT_GENESIS_HASH = '0'.repeat(64);

/**
 * Texte à hacher pour une entrée. Tous les adaptateurs l'utilisent : la chaîne reste vérifiable
 * d'un moteur à l'autre. JSON d'un tableau à positions fixes, donc sans ambiguïté de séparateur.
 */
export function auditHashInput(
  previousHash: string,
  e: Pick<
    AuditEntry,
    'seq' | 'at' | 'actor' | 'action' | 'resource' | 'target' | 'count' | 'reason'
  >,
): string {
  return JSON.stringify([
    previousHash,
    e.seq,
    e.at,
    e.actor,
    e.action,
    e.resource,
    e.target ?? null,
    e.count ?? null,
    e.reason ?? null,
  ]);
}
