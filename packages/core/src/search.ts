import type { BackupCatalog } from './catalog.js';

/** Métadonnées d'un mail sauvegardé (jamais le corps au MVP). */
export interface MailMetadata {
  /** Identifiant du message, stable d'un instantané à l'autre. */
  messageId: string;
  sender: string;
  recipients: string[];
  subject: string;
  /** Date d'envoi ou de réception, UTC, ISO 8601. */
  date: string;
  folder: string;
  /** Taille en octets. */
  size: number;
  /** Noms des pièces jointes. */
  attachments: string[];
}

export interface IndexedMail extends MailMetadata {
  mailboxId: string;
  /** Premier instantané où le message a été vu. */
  snapshotId: string;
}

export interface SearchQuery {
  /** Mots recherchés dans l'objet, l'expéditeur, les destinataires, le dossier, les pièces jointes. */
  q?: string;
  mailbox?: string;
  /** Fragment d'adresse ou de nom de l'expéditeur. */
  from?: string;
  /** Fragment d'adresse ou de nom d'un destinataire. */
  to?: string;
  /** Borne basse incluse, ISO 8601 UTC. */
  after?: string;
  /** Borne haute exclue, ISO 8601 UTC. */
  before?: string;
  limit: number;
  offset: number;
}

export interface SearchPage {
  /** Nombre total de résultats, toutes pages confondues. */
  total: number;
  /** Du plus récent au plus ancien. */
  items: IndexedMail[];
}

/** Index de recherche des mails. Aucune syntaxe propre à un moteur n'apparaît ici. */
export interface SearchIndex {
  isSnapshotIndexed(snapshotId: string): Promise<boolean>;
  /**
   * Indexe un instantané de façon atomique et le marque comme indexé. Un message déjà connu
   * (même boîte, même `messageId`) n'est pas dupliqué.
   */
  indexSnapshot(mailboxId: string, snapshotId: string, mails: MailMetadata[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchPage>;
}

/** Lit les métadonnées des mails d'un instantané (adaptateur SDK à venir). */
export interface SnapshotMailReader {
  readMails(mailboxId: string, snapshotId: string): Promise<MailMetadata[]>;
}

/** Indexe les instantanés mail non encore indexés d'une boîte, du plus ancien au plus récent. */
export async function indexMailbox(
  deps: { catalog: BackupCatalog; reader: SnapshotMailReader; index: SearchIndex },
  mailboxId: string,
): Promise<{ indexed: number; skipped: number }> {
  const snapshots = (await deps.catalog.listSnapshots(mailboxId, 'mail')).reverse();
  let indexed = 0;
  let skipped = 0;
  for (const snapshot of snapshots) {
    if (await deps.index.isSnapshotIndexed(snapshot.id)) {
      skipped += 1;
      continue;
    }
    const mails = await deps.reader.readMails(mailboxId, snapshot.id);
    await deps.index.indexSnapshot(mailboxId, snapshot.id, mails);
    indexed += 1;
  }
  return { indexed, skipped };
}
