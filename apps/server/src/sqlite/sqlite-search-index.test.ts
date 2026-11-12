import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  FakeBackupCatalog,
  indexMailbox,
  type MailMetadata,
  type SnapshotMailReader,
} from '@backup365/core';
import { searchIndexContract } from '@backup365/core/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate } from './migrations.js';
import { SqliteSearchIndex } from './sqlite-search-index.js';

searchIndexContract('SqliteSearchIndex', () => Promise.resolve(SqliteSearchIndex.open(':memory:')));

const dir = mkdtempSync(join(tmpdir(), 'backup365-test-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const mail = (messageId: string): MailMetadata => ({
  messageId,
  sender: 'alice@example.test',
  recipients: ['bob@example.test'],
  subject: 'Sujet',
  date: '2026-01-15T10:00:00.000Z',
  folder: 'Inbox',
  size: 10,
  attachments: [],
});

describe('SqliteSearchIndex storage', () => {
  it('creates the data folder and persists across reopening', async () => {
    const path = join(dir, 'sous-dossier', 'search.sqlite');
    const first = SqliteSearchIndex.open(path);
    await first.indexSnapshot('mbx', 'snap', [mail('m1')]);
    first.close();
    const second = SqliteSearchIndex.open(path);
    expect(await second.isSnapshotIndexed('snap')).toBe(true);
    expect(await second.search({ limit: 10, offset: 0 })).toMatchObject({ total: 1 });
    second.close();
  });

  it('rejects an invalid date without indexing anything', async () => {
    const index = SqliteSearchIndex.open(':memory:');
    await expect(
      index.indexSnapshot('mbx', 'snap', [{ ...mail('m1'), date: 'pas une date' }]),
    ).rejects.toThrow();
    expect(await index.isSnapshotIndexed('snap')).toBe(false);
  });
});

describe('migrations', () => {
  it('records the version and is idempotent', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    migrate(db);
    const rows = db.prepare('SELECT version FROM schema_migrations').all();
    expect(rows).toEqual(MIGRATIONS.map((m) => ({ version: m.version })));
  });

  it('applies only the missing migrations', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    migrate(db, [
      ...MIGRATIONS,
      { version: 2, name: 'extra', sql: 'CREATE TABLE extra (id INTEGER)' },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 2 });
  });

  it('rolls back a failing migration', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const bad = { version: 2, name: 'bad', sql: 'CREATE TABLE ok (id INTEGER); BROKEN' };
    expect(() => {
      migrate(db, [...MIGRATIONS, bad]);
    }).toThrow();
    expect(() => db.prepare('SELECT * FROM ok').all()).toThrow();
    expect(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()).toEqual({ v: 1 });
  });

  it('refuses a database newer than the program', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    db.prepare("INSERT INTO schema_migrations VALUES (99, 'future', 'x')").run();
    expect(() => {
      migrate(db);
    }).toThrow(/plus récente/);
  });
});

describe('indexMailbox (incremental)', () => {
  it('does not read again a snapshot already indexed', async () => {
    const reads: string[] = [];
    const reader: SnapshotMailReader = {
      readMails: (_mailbox, snapshotId) => {
        reads.push(snapshotId);
        return Promise.resolve([mail(`m-${snapshotId}`)]);
      },
    };
    const snap = (id: string, createdAt: string) => ({
      id,
      workload: 'mail' as const,
      createdAt,
    });
    const snapshots = [snap('s1', '2026-01-01T00:00:00.000Z')];
    const catalog = new FakeBackupCatalog({
      mailboxes: [{ id: 'mbx', displayName: 'Boîte' }],
      snapshots: { mbx: snapshots },
    });
    const index = SqliteSearchIndex.open(':memory:');

    expect(await indexMailbox({ catalog, reader, index }, 'mbx')).toEqual({
      indexed: 1,
      skipped: 0,
    });
    snapshots.push(snap('s2', '2026-02-01T00:00:00.000Z'));
    expect(await indexMailbox({ catalog, reader, index }, 'mbx')).toEqual({
      indexed: 1,
      skipped: 1,
    });
    expect(reads).toEqual(['s1', 's2']);
    expect(await index.search({ limit: 10, offset: 0 })).toMatchObject({ total: 2 });
  });
});
