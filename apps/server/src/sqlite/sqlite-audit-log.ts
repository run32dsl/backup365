import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  AUDIT_GENESIS_HASH,
  auditHashInput,
  isAuditAction,
  type AuditAction,
  type AuditEntry,
  type AuditEvent,
  type AuditFilter,
  type AuditLog,
  type AuditPage,
  type AuditVerification,
} from '@backup365/core';
import { AUDIT_MIGRATIONS } from './migrations.js';
import { openDatabase } from './open-database.js';

interface AuditRow {
  seq: number;
  at: string;
  actor: string;
  action: string;
  resource: string;
  target: string | null;
  count: number | null;
  reason: string | null;
  previous_hash: string;
  hash: string;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

function toEntry(row: AuditRow): AuditEntry {
  return {
    seq: row.seq,
    at: row.at,
    actor: row.actor,
    action: row.action as AuditAction,
    resource: row.resource,
    ...(row.target !== null ? { target: row.target } : {}),
    ...(row.count !== null ? { count: row.count } : {}),
    ...(row.reason !== null ? { reason: row.reason } : {}),
    previousHash: row.previous_hash,
    hash: row.hash,
  };
}

/** Journal d'audit SQLite en ajout seul (triggers) et chaîné. Seul fichier à connaître le pilote. */
export class SqliteAuditLog implements AuditLog {
  private constructor(private readonly db: DatabaseSync) {}

  /** Ouvre (et crée au besoin) la base ; `:memory:` pour les tests. */
  static open(path: string): SqliteAuditLog {
    return new SqliteAuditLog(openDatabase(path, AUDIT_MIGRATIONS));
  }

  close(): void {
    this.db.close();
  }

  /** Dernier maillon (rang et empreinte), `undefined` si le journal est vide. */
  head(): { seq: number; hash: string } | undefined {
    return this.db.prepare('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1').get() as
      { seq: number; hash: string } | undefined;
  }

  /** Empreinte stockée au rang `seq`, `undefined` si ce rang n'existe pas. */
  hashAt(seq: number): string | undefined {
    const row = this.db.prepare('SELECT hash FROM audit_log WHERE seq = ?').get(seq) as
      { hash: string } | undefined;
    return row?.hash;
  }

  record(event: AuditEvent): Promise<void> {
    try {
      this.append(event);
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private append(event: AuditEvent): void {
    if (!isAuditAction(event.action)) throw new RangeError('action invalide');
    if (event.actor === '' || event.resource === '') throw new RangeError('événement incomplet');
    if (event.count !== undefined && (!Number.isInteger(event.count) || event.count < 0)) {
      throw new RangeError('count invalide');
    }
    const at = new Date(event.at).toISOString();
    const { db } = this;
    // IMMEDIATE : le dernier maillon est lu et le suivant écrit sans qu'un autre processus s'intercale.
    db.exec('BEGIN IMMEDIATE');
    try {
      const last = db.prepare('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1').get() as
        { seq: number; hash: string } | undefined;
      const seq = (last?.seq ?? 0) + 1;
      const previousHash = last?.hash ?? AUDIT_GENESIS_HASH;
      const entry = { ...event, at, seq };
      db.prepare(
        `INSERT INTO audit_log (seq, at, actor, action, resource, target, count, reason, previous_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        seq,
        at,
        event.actor,
        event.action,
        event.resource,
        event.target ?? null,
        event.count ?? null,
        event.reason ?? null,
        previousHash,
        sha256(auditHashInput(previousHash, entry)),
      );
      db.exec('COMMIT');
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw err;
    }
  }

  list(filter: AuditFilter): Promise<AuditPage> {
    try {
      const where: string[] = [];
      const params: SQLInputValue[] = [];
      if (filter.from !== undefined) {
        where.push('at >= ?');
        params.push(new Date(filter.from).toISOString());
      }
      if (filter.to !== undefined) {
        where.push('at < ?');
        params.push(new Date(filter.to).toISOString());
      }
      if (filter.actor !== undefined) {
        where.push('actor = ?');
        params.push(filter.actor);
      }
      if (filter.action !== undefined) {
        where.push('action = ?');
        params.push(filter.action);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const count = this.db
        .prepare(`SELECT COUNT(*) AS n FROM audit_log ${clause}`)
        .get(...params) as { n: number };
      const rows = this.db
        .prepare(`SELECT * FROM audit_log ${clause} ORDER BY seq DESC LIMIT ? OFFSET ?`)
        .all(...params, filter.limit, filter.offset) as unknown as AuditRow[];
      return Promise.resolve({ total: count.n, items: rows.map(toEntry) });
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  verify(): Promise<AuditVerification> {
    try {
      return Promise.resolve(this.runVerify());
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private runVerify(): AuditVerification {
    let entries = 0;
    let expectedSeq = 1;
    let expectedPrevious = AUDIT_GENESIS_HASH;
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY seq ASC').iterate();
    for (const raw of rows) {
      const row = raw as unknown as AuditRow;
      const broken = (reason: string): AuditVerification => ({
        ok: false,
        entries,
        brokenAt: expectedSeq,
        reason,
      });
      if (row.seq !== expectedSeq) return broken('entrée manquante ou rang discontinu');
      if (row.previous_hash !== expectedPrevious) return broken('chaînage rompu');
      if (sha256(auditHashInput(row.previous_hash, toEntry(row))) !== row.hash) {
        return broken('empreinte incorrecte : entrée altérée');
      }
      entries += 1;
      expectedSeq += 1;
      expectedPrevious = row.hash;
    }
    return { ok: true, entries };
  }
}
