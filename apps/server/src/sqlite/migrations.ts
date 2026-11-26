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

/**
 * Migrations des comptes locaux (accounts.sqlite, base distincte : elle contient des empreintes
 * de mots de passe). Le nom d'utilisateur est unique sans tenir compte de la casse.
 */
export const ACCOUNT_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'local-accounts',
    sql: `
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
        password_hash TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'oidc-accounts',
    // Compte de connexion Microsoft : identifiant d'objet Entra, sans mot de passe local.
    sql: `
      ALTER TABLE accounts ADD COLUMN oidc_subject TEXT;
      CREATE UNIQUE INDEX accounts_oidc_subject ON accounts (oidc_subject)
        WHERE oidc_subject IS NOT NULL;
    `,
  },
];

/**
 * Migrations des plans de protection (plans.sqlite, base distincte : les plans et leur historique
 * ne se reconstruisent pas depuis le catalogue). `error` ne reçoit qu'un code ou un message
 * technique court, jamais un contenu de mail.
 */
export const PLAN_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'protection-plans',
    sql: `
      CREATE TABLE plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 1 AND 100),
        scope TEXT NOT NULL CHECK (scope IN ('all', 'selection')),
        rpo_hours INTEGER NOT NULL DEFAULT 24 CHECK (rpo_hours IN (4, 12, 24)),
        rto_hours INTEGER CHECK (rto_hours IS NULL OR rto_hours > 0),
        retention_days INTEGER NOT NULL CHECK (retention_days > 0),
        gdpr_justification TEXT NOT NULL CHECK (length(trim(gdpr_justification)) BETWEEN 1 AND 1000),
        created_at TEXT NOT NULL
      );
      CREATE TABLE plan_items (
        plan_id TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
        item_id TEXT NOT NULL CHECK (length(item_id) > 0),
        PRIMARY KEY (plan_id, item_id)
      );
      CREATE TABLE plan_runs (
        id INTEGER PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
        duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        error TEXT CHECK (error IS NULL OR length(error) <= 200)
      );
      CREATE INDEX plan_runs_plan_start ON plan_runs (plan_id, started_at);
    `,
  },
  {
    version: 2,
    name: 'plan-runs-one-running-per-item',
    // Jamais deux exécutions simultanées sur un même élément, tous plans confondus.
    sql: `CREATE UNIQUE INDEX plan_runs_one_running_per_item ON plan_runs (item_id) WHERE status = 'running';`,
  },
  {
    version: 3,
    name: 'plan-data-types',
    // Liste séparée par des virgules, jamais vide ; les plans existants protègent tout.
    sql: `ALTER TABLE plans ADD COLUMN data_types TEXT NOT NULL DEFAULT 'mail,files,calendar,contacts' CHECK (length(data_types) > 0);`,
  },
  {
    version: 4,
    name: 'plan-runs-no-snapshot-reason',
    // Réussite sans point de restauration : la ressource était vide (ADR 0009, issue #80).
    sql: `ALTER TABLE plan_runs ADD COLUMN no_snapshot_reason TEXT CHECK (no_snapshot_reason IS NULL OR no_snapshot_reason IN ('no_content'));`,
  },
  {
    version: 5,
    name: 'plan-data-types-workloads',
    // « files » devient OneDrive et SharePoint ; « calendar » et « contacts » vivent dans la boîte,
    // donc suivent « mail » (issue #310). Une valeur illisible protège tout, comme avant.
    sql: `UPDATE plans SET data_types = COALESCE(NULLIF(rtrim(
      (CASE WHEN (',' || data_types || ',') LIKE '%,mail,%' OR (',' || data_types || ',') LIKE '%,calendar,%'
              OR (',' || data_types || ',') LIKE '%,contacts,%' THEN 'mail,' ELSE '' END) ||
      (CASE WHEN (',' || data_types || ',') LIKE '%,files,%' THEN 'onedrive,sharepoint,' ELSE '' END),
    ','), ''), 'mail,onedrive,sharepoint');`,
  },
  {
    version: 6,
    name: 'plan-runs-volume',
    // Historique des exécutions (issue #258) : éléments copiés et taille source, si le moteur les
    // fournit ; `NULL` sinon (échec, exécution antérieure).
    sql: `
      ALTER TABLE plan_runs ADD COLUMN items_saved INTEGER CHECK (items_saved IS NULL OR items_saved >= 0);
      ALTER TABLE plan_runs ADD COLUMN source_bytes INTEGER CHECK (source_bytes IS NULL OR source_bytes >= 0);
      CREATE INDEX plan_runs_start ON plan_runs (started_at);
    `,
  },
  {
    version: 7,
    name: 'plan-runs-backup-result',
    // Résultat d'une sauvegarde lancée par la console, tiré du retour de `backup()` (issue #439) :
    // deux nombres, jamais un nom de dossier ni un message. `NULL` : résultat inconnu.
    sql: `
      ALTER TABLE plan_runs ADD COLUMN backup_result TEXT CHECK (backup_result IS NULL OR backup_result IN ('success', 'warnings', 'failed'));
      ALTER TABLE plan_runs ADD COLUMN folder_error_count INTEGER CHECK (folder_error_count IS NULL OR folder_error_count >= 0);
      ALTER TABLE plan_runs ADD COLUMN warning_count INTEGER CHECK (warning_count IS NULL OR warning_count >= 0);
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
