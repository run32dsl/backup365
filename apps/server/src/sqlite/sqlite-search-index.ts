import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  IndexedMail,
  MailMetadata,
  SearchIndex,
  SearchPage,
  SearchQuery,
} from '@backup365/core';
import { SEARCH_MIGRATIONS } from './migrations.js';
import { openDatabase } from './open-database.js';

interface MailRow {
  mailbox_id: string;
  message_id: string;
  snapshot_id: string;
  sender: string;
  recipients: string;
  subject: string;
  sent_at: string;
  folder: string;
  size: number;
  attachments: string;
}

/** Mots d'une saisie : lettres et chiffres seuls, ce qui neutralise la syntaxe FTS5. */
function words(input: string): string[] {
  return input.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
}

/** Préfixe de chaque mot, conjonction ; `column` limite la recherche à une colonne. */
function matchTerms(input: string, column?: string): string[] {
  return words(input).map((w) => `${column ? `${column} : ` : ''}"${w}"*`);
}

/** Date normalisée en UTC ISO 8601 ; lève `RangeError` si elle est invalide. */
function utc(date: string): string {
  return new Date(date).toISOString();
}

function toMail(row: MailRow): IndexedMail {
  return {
    mailboxId: row.mailbox_id,
    messageId: row.message_id,
    snapshotId: row.snapshot_id,
    sender: row.sender,
    recipients: JSON.parse(row.recipients) as string[],
    subject: row.subject,
    date: row.sent_at,
    folder: row.folder,
    size: row.size,
    attachments: JSON.parse(row.attachments) as string[],
  };
}

/** Index de recherche SQLite FTS5. Seul fichier à connaître FTS5 et le pilote SQLite. */
export class SqliteSearchIndex implements SearchIndex {
  private constructor(private readonly db: DatabaseSync) {}

  /** Ouvre (et crée au besoin) la base ; `:memory:` pour les tests. */
  static open(path: string): SqliteSearchIndex {
    return new SqliteSearchIndex(openDatabase(path, SEARCH_MIGRATIONS));
  }

  close(): void {
    this.db.close();
  }

  isSnapshotIndexed(snapshotId: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 AS found FROM indexed_snapshots WHERE snapshot_id = ?')
      .get(snapshotId);
    return Promise.resolve(row !== undefined);
  }

  indexSnapshot(mailboxId: string, snapshotId: string, mails: MailMetadata[]): Promise<void> {
    const { db } = this;
    try {
      // Réindexer un instantané déjà indexé est sans effet (reprise, déclenchements concurrents).
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT 1 FROM indexed_snapshots WHERE snapshot_id = ?').get(snapshotId)) {
          db.exec('ROLLBACK');
          return Promise.resolve();
        }
        const insert = db.prepare(
          `INSERT OR IGNORE INTO mail_messages
             (mailbox_id, message_id, snapshot_id, sender, recipients, subject, sent_at, folder, size, attachments)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const insertFts = db.prepare(
          'INSERT INTO mail_fts (rowid, sender, recipients, subject, folder, attachments) VALUES (?, ?, ?, ?, ?, ?)',
        );
        let added = 0;
        for (const m of mails) {
          if (!Number.isInteger(m.size) || m.size < 0) throw new RangeError('size invalide');
          const result = insert.run(
            mailboxId,
            m.messageId,
            snapshotId,
            m.sender,
            JSON.stringify(m.recipients),
            m.subject,
            utc(m.date),
            m.folder,
            m.size,
            JSON.stringify(m.attachments),
          );
          if (result.changes > 0) {
            added += 1;
            insertFts.run(
              result.lastInsertRowid,
              m.sender,
              m.recipients.join(' '),
              m.subject,
              m.folder,
              m.attachments.join(' '),
            );
          }
        }
        // message_count = messages nouveaux apportés par cet instantané (doublons ignorés).
        db.prepare(
          'INSERT INTO indexed_snapshots (snapshot_id, mailbox_id, message_count, indexed_at) VALUES (?, ?, ?, ?)',
        ).run(snapshotId, mailboxId, added, new Date().toISOString());
        db.exec('COMMIT');
      } catch (err) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw err;
      }
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return Promise.resolve();
  }

  search(query: SearchQuery): Promise<SearchPage> {
    try {
      return Promise.resolve(this.runSearch(query));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private runSearch(query: SearchQuery): SearchPage {
    const terms = [
      ...matchTerms(query.q ?? ''),
      ...matchTerms(query.from ?? '', 'sender'),
      ...matchTerms(query.to ?? '', 'recipients'),
    ];
    // Une saisie sans aucun mot (ponctuation seule) ne correspond à rien.
    const empty = { total: 0, items: [] };
    for (const field of [query.q, query.from, query.to]) {
      if (field !== undefined && words(field).length === 0) return empty;
    }

    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (terms.length > 0) {
      where.push('m.id IN (SELECT rowid FROM mail_fts WHERE mail_fts MATCH ?)');
      params.push(terms.join(' '));
    }
    if (query.mailbox !== undefined) {
      where.push('m.mailbox_id = ?');
      params.push(query.mailbox);
    }
    if (query.after !== undefined) {
      where.push('m.sent_at >= ?');
      params.push(utc(query.after));
    }
    if (query.before !== undefined) {
      where.push('m.sent_at < ?');
      params.push(utc(query.before));
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const count = this.db
      .prepare(`SELECT COUNT(*) AS n FROM mail_messages m ${clause}`)
      .get(...params) as { n: number };
    const rows = this.db
      .prepare(
        `SELECT m.* FROM mail_messages m ${clause} ORDER BY m.sent_at DESC, m.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, query.limit, query.offset) as unknown as MailRow[];
    return { total: count.n, items: rows.map(toMail) };
  }
}
