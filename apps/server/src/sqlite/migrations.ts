import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Migrations de la base de recherche, dans l'ordre. Ne jamais modifier une migration publiée :
 * en ajouter une. Horodatages en UTC ISO 8601 (texte), identifiants en texte.
 */
export const SEARCH_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'mail-search',
    sql: `
      CREATE TABLE mail_messages (
        id INTEGER PRIMARY KEY,
        mailbox_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        recipients TEXT NOT NULL,
        subject TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        folder TEXT NOT NULL,
        size INTEGER NOT NULL,
        attachments TEXT NOT NULL,
        UNIQUE (mailbox_id, message_id)
      );
      CREATE INDEX mail_messages_mailbox_date ON mail_messages (mailbox_id, sent_at);
      CREATE INDEX mail_messages_date ON mail_messages (sent_at);
      CREATE TABLE indexed_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        mailbox_id TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE mail_fts USING fts5(
        sender, recipients, subject, folder, attachments,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `,
  },
];

/**
 * Migrations du journal d'audit (audit.sqlite, base distincte : l'index de recherche peut être
 * reconstruit, pas le journal). Les triggers refusent tout UPDATE et DELETE : ajout seul.
 */
export const AUDIT_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'audit-log',
    sql: `
      CREATE TABLE audit_log (
        seq INTEGER PRIMARY KEY,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        target TEXT,
        count INTEGER,
        reason TEXT,
        previous_hash TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE
      );
      CREATE INDEX audit_log_at ON audit_log (at);
      CREATE INDEX audit_log_actor ON audit_log (actor);
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
        BEGIN SELECT RAISE(ABORT, 'audit_log est en ajout seul'); END;
      CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
        BEGIN SELECT RAISE(ABORT, 'audit_log est en ajout seul'); END;
    `,
  },
];

/** Applique les migrations manquantes, chacune dans une transaction. */
export function migrate(db: DatabaseSync, migrations: readonly Migration[]): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const rows = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
    v: number | null;
  };
  const current = rows.v ?? 0;
  const latest = migrations.at(-1)?.version ?? 0;
  if (current > latest) {
    throw new Error(
      `Base en version ${current}, plus récente que ce programme (${latest}) : mettre à jour backup365`,
    );
  }
  for (const migration of migrations.filter((m) => m.version > current)) {
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
