import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './open-database.js';
import { ACCOUNT_MIGRATIONS } from './migrations.js';

export const ROLES = ['admin', 'operator'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Compte local, sans l'empreinte du mot de passe : c'est ce qui sort de l'API. */
export interface Account {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  /** Mot de passe réinitialisé par un administrateur : à changer à la prochaine connexion. */
  mustChangePassword: boolean;
  createdAt: string;
}

export interface AccountRecord extends Account {
  passwordHash: string;
}

export interface NewAccount {
  username: string;
  role: Role;
  passwordHash: string;
  mustChangePassword?: boolean;
}

export interface AccountPatch {
  role?: Role;
  disabled?: boolean;
  passwordHash?: string;
  mustChangePassword?: boolean;
}

export class UsernameTakenError extends Error {}
/** Le changement retirerait le dernier administrateur actif. */
export class LastAdminError extends Error {}

interface Row {
  id: number;
  username: string;
  role: Role;
  password_hash: string;
  disabled: number;
  must_change_password: number;
  created_at: string;
}

function toRecord(row: Row): AccountRecord {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    passwordHash: row.password_hash,
    disabled: row.disabled === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
  };
}

/** Retire l'empreinte : à utiliser avant toute sortie hors du serveur. */
export function publicAccount(record: AccountRecord): Account {
  return {
    id: record.id,
    username: record.username,
    role: record.role,
    disabled: record.disabled,
    mustChangePassword: record.mustChangePassword,
    createdAt: record.createdAt,
  };
}

/** Comptes locaux dans SQLite. Appels synchrones : une opération n'est jamais entrelacée. */
export class SqliteAccountStore {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path: string): SqliteAccountStore {
    return new SqliteAccountStore(openDatabase(path, ACCOUNT_MIGRATIONS));
  }

  close(): void {
    this.db.close();
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n;
  }

  list(): AccountRecord[] {
    return (
      this.db.prepare('SELECT * FROM accounts ORDER BY username').all() as unknown as Row[]
    ).map(toRecord);
  }

  findById(id: number): AccountRecord | undefined {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as unknown as
      Row | undefined;
    return row && toRecord(row);
  }

  findByUsername(username: string): AccountRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM accounts WHERE username = ?')
      .get(username) as unknown as Row | undefined;
    return row && toRecord(row);
  }

  /** Crée un compte ; lève `UsernameTakenError` si le nom (casse ignorée) existe déjà. */
  create(input: NewAccount): AccountRecord {
    if (this.findByUsername(input.username)) throw new UsernameTakenError();
    try {
      const row = this.db
        .prepare(
          `INSERT INTO accounts (username, role, password_hash, must_change_password, created_at)
           VALUES (?, ?, ?, ?, ?) RETURNING *`,
        )
        .get(
          input.username,
          input.role,
          input.passwordHash,
          input.mustChangePassword ? 1 : 0,
          new Date().toISOString(),
        ) as unknown as Row;
      return toRecord(row);
    } catch (err) {
      // Deux processus (console et CLI) peuvent créer le même nom en même temps.
      if (/UNIQUE/i.test((err as Error).message)) throw new UsernameTakenError();
      throw err;
    }
  }

  /**
   * Crée l'administrateur initial **seulement si aucun compte n'existe**, en une seule
   * instruction : deux requêtes simultanées ne peuvent pas créer deux administrateurs.
   */
  createFirstAdmin(username: string, passwordHash: string): AccountRecord | undefined {
    const row = this.db
      .prepare(
        `INSERT INTO accounts (username, role, password_hash, created_at)
         SELECT ?, 'admin', ?, ? WHERE NOT EXISTS (SELECT 1 FROM accounts) RETURNING *`,
      )
      .get(username, passwordHash, new Date().toISOString()) as unknown as Row | undefined;
    return row && toRecord(row);
  }

  /**
   * Modifie un compte ; renvoie `undefined` s'il n'existe pas. Lève `LastAdminError` si le
   * changement retirerait le dernier administrateur actif (rôle changé ou compte désactivé).
   */
  update(id: number, patch: AccountPatch): AccountRecord | undefined {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.findById(id);
      if (!current) {
        this.db.exec('ROLLBACK');
        return undefined;
      }
      const next = {
        role: patch.role ?? current.role,
        disabled: patch.disabled ?? current.disabled,
        passwordHash: patch.passwordHash ?? current.passwordHash,
        mustChange: patch.mustChangePassword ?? current.mustChangePassword,
      };
      const wasActiveAdmin = current.role === 'admin' && !current.disabled;
      const staysActiveAdmin = next.role === 'admin' && !next.disabled;
      if (wasActiveAdmin && !staysActiveAdmin) {
        const { n } = this.db
          .prepare("SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin' AND disabled = 0")
          .get() as { n: number };
        if (n <= 1) throw new LastAdminError();
      }
      this.db
        .prepare(
          `UPDATE accounts SET role = ?, disabled = ?, password_hash = ?, must_change_password = ?
           WHERE id = ?`,
        )
        .run(next.role, next.disabled ? 1 : 0, next.passwordHash, next.mustChange ? 1 : 0, id);
      this.db.exec('COMMIT');
      return this.findById(id);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
