import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AuditEvent } from '@backup365/core';
import { auditLogContract } from '@backup365/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { SqliteAuditLog } from './sqlite-audit-log.js';

const dir = mkdtempSync(join(tmpdir(), 'backup365-audit-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
const freshPath = () => join(dir, `audit-${++counter}`, 'audit.sqlite');

/** Attaque simulée : une seconde connexion retire le trigger puis modifie la base. */
function attack(path: string, sql: string, params: (string | number)[] = []): void {
  const db = new DatabaseSync(path);
  db.exec('DROP TRIGGER audit_log_no_update; DROP TRIGGER audit_log_no_delete');
  db.prepare(sql).run(...params);
  db.close();
}

auditLogContract('SqliteAuditLog', () => {
  const path = freshPath();
  const log = SqliteAuditLog.open(path);
  return Promise.resolve({
    log,
    alterActor: (seq, actor) => {
      attack(path, 'UPDATE audit_log SET actor = ? WHERE seq = ?', [actor, seq]);
    },
    deleteEntry: (seq) => {
      attack(path, 'DELETE FROM audit_log WHERE seq = ?', [seq]);
    },
  });
});

const event: AuditEvent = {
  at: '2026-01-15T10:00:00.000Z',
  actor: 'alice',
  action: 'list.view',
  resource: 'mailboxes',
};

describe('SqliteAuditLog storage', () => {
  it('refuses UPDATE and DELETE (append-only table)', async () => {
    const path = freshPath();
    const log = SqliteAuditLog.open(path);
    await log.record(event);
    const db = new DatabaseSync(path);
    expect(() => db.prepare("UPDATE audit_log SET actor = 'x'").run()).toThrow(/ajout seul/);
    expect(() => db.prepare('DELETE FROM audit_log').run()).toThrow(/ajout seul/);
    db.close();
    expect(await log.verify()).toEqual({ ok: true, entries: 1 });
  });

  it('detects an altered hash even when the entry content is untouched', async () => {
    const path = freshPath();
    const log = SqliteAuditLog.open(path);
    await log.record(event);
    await log.record(event);
    attack(path, "UPDATE audit_log SET hash = 'f' || substr(hash, 2) WHERE seq = 1");
    expect(await log.verify()).toMatchObject({ ok: false, brokenAt: 1 });
  });

  it('persists across reopening and keeps chaining', async () => {
    const path = freshPath();
    const first = SqliteAuditLog.open(path);
    await first.record(event);
    first.close();
    const second = SqliteAuditLog.open(path);
    await second.record(event);
    expect(await second.verify()).toEqual({ ok: true, entries: 2 });
    second.close();
  });

  it('creates the database readable by the owner only', async () => {
    const path = freshPath();
    const log = SqliteAuditLog.open(path);
    await log.record(event);
    expect(statSync(path).mode & 0o077).toBe(0);
    log.close();
  });
});
