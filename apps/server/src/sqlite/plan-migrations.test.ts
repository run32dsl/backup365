import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PLAN_MIGRATIONS, migrate } from './migrations.js';

function open(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, PLAN_MIGRATIONS);
  return db;
}

interface PlanRow {
  id: string;
  name: string;
  scope: string;
  rpo_hours: number;
  rto_hours: number | null;
  retention_days: number;
  gdpr_justification: string;
}

const base: PlanRow = {
  id: 'p1',
  name: 'Direction',
  scope: 'all',
  rpo_hours: 24,
  rto_hours: null,
  retention_days: 365,
  gdpr_justification: 'Obligation légale de conservation.',
};

function insert(db: DatabaseSync, over: Partial<PlanRow> = {}): void {
  const r = { ...base, ...over };
  db.prepare(
    'INSERT INTO plans (id, name, scope, rpo_hours, rto_hours, retention_days, gdpr_justification, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    r.id,
    r.name,
    r.scope,
    r.rpo_hours,
    r.rto_hours,
    r.retention_days,
    r.gdpr_justification,
    '2026-11-16T00:00:00Z',
  );
}

describe('PLAN_MIGRATIONS', () => {
  it('applies once and is idempotent', () => {
    const db = open();
    migrate(db, PLAN_MIGRATIONS);
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toHaveLength(
      PLAN_MIGRATIONS.length,
    );
  });

  it('stores a plan with its selection and runs, and cascades on delete', () => {
    const db = open();
    insert(db, { scope: 'selection' });
    db.prepare('INSERT INTO plan_items (plan_id, item_id) VALUES (?, ?)').run('p1', 'box-1');
    db.prepare(
      "INSERT INTO plan_runs (plan_id, item_id, started_at, finished_at, status, duration_ms, error) VALUES ('p1', 'box-1', 's', 'f', 'failed', 1200, 'timeout')",
    ).run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM plan_runs').get()).toEqual({ n: 1 });
    db.prepare("DELETE FROM plans WHERE id = 'p1'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM plan_runs').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM plan_items').get()).toEqual({ n: 0 });
  });

  it('defaults the RPO to 24 hours', () => {
    const db = open();
    db.prepare(
      "INSERT INTO plans (id, name, scope, retention_days, gdpr_justification, created_at) VALUES ('p2', 'N', 'all', 30, 'Finalité', 'd')",
    ).run();
    expect(db.prepare("SELECT rpo_hours FROM plans WHERE id = 'p2'").get()).toEqual({
      rpo_hours: 24,
    });
  });

  it('upgrades an existing plan to all workloads and refuses an empty list', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, PLAN_MIGRATIONS.slice(0, 2));
    db.prepare(
      "INSERT INTO plans (id, name, scope, retention_days, gdpr_justification, created_at) VALUES ('old', 'N', 'all', 30, 'Finalité', 'd')",
    ).run();
    migrate(db, PLAN_MIGRATIONS);
    expect(db.prepare("SELECT data_types FROM plans WHERE id = 'old'").get()).toEqual({
      data_types: 'mail,onedrive,sharepoint',
    });
    expect(() => db.prepare("UPDATE plans SET data_types = '' WHERE id = 'old'").run()).toThrow();
  });

  it('migrates files, calendar and contacts to mail, onedrive and sharepoint (#310)', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, PLAN_MIGRATIONS.slice(0, 4));
    const cases: [string, string][] = [
      ['mail,files,calendar,contacts', 'mail,onedrive,sharepoint'],
      ['files,calendar', 'mail,onedrive,sharepoint'],
      ['files', 'onedrive,sharepoint'],
      ['calendar,contacts', 'mail'],
      ['mail', 'mail'],
      ['unknown', 'mail,onedrive,sharepoint'],
    ];
    cases.forEach(([before], i) => {
      db.prepare(
        "INSERT INTO plans (id, name, scope, retention_days, gdpr_justification, created_at, data_types) VALUES (?, ?, 'all', 30, 'F', 'd', ?)",
      ).run(`p${i}`, `N${i}`, before);
    });
    migrate(db, PLAN_MIGRATIONS);
    const rows = db.prepare('SELECT data_types AS d FROM plans ORDER BY id').all();
    expect(rows).toEqual(cases.map(([, after]) => ({ d: after })));
  });

  it('refuses a plan without GDPR justification or with an RPO outside the list', () => {
    const db = open();
    expect(() => insert(db, { gdpr_justification: '   ' })).toThrow();
    expect(() => insert(db, { gdpr_justification: '' })).toThrow();
    for (const rpo of [1, 6, 8, 48]) expect(() => insert(db, { rpo_hours: rpo })).toThrow();
    expect(() => insert(db, { scope: 'other' })).toThrow();
    expect(() => insert(db, { retention_days: 0 })).toThrow();
  });

  it('enforces a unique name ignoring case, bounded lengths and a positive RTO', () => {
    const db = open();
    insert(db);
    expect(() => insert(db, { id: 'p2', name: 'DIRECTION' })).toThrow();
    expect(() => insert(db, { id: 'p3', name: 'x'.repeat(101) })).toThrow();
    expect(() =>
      insert(db, { id: 'p4', name: 'A', gdpr_justification: 'x'.repeat(1001) }),
    ).toThrow();
    expect(() => insert(db, { id: 'p5', name: 'B', rto_hours: 0 })).toThrow();
  });

  it('refuses runs and items of an unknown plan', () => {
    const db = open();
    expect(() =>
      db.prepare("INSERT INTO plan_items (plan_id, item_id) VALUES ('nope', 'i')").run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO plan_runs (plan_id, item_id, started_at, status) VALUES ('nope', 'i', 's', 'success')",
        )
        .run(),
    ).toThrow();
  });

  it('adds no_snapshot_reason, null by default and restricted to no_content', () => {
    const db = open();
    insert(db);
    const run = db.prepare(
      "INSERT INTO plan_runs (plan_id, item_id, started_at, status, no_snapshot_reason) VALUES ('p1', 'i', 's', 'success', ?)",
    );
    run.run(null);
    run.run('no_content');
    expect(() => run.run('no_changes')).toThrow();
    expect(db.prepare('SELECT no_snapshot_reason AS r FROM plan_runs ORDER BY id').all()).toEqual([
      { r: null },
      { r: 'no_content' },
    ]);
  });

  it('migration 6 keeps an existing selection plan limited on every charge', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, PLAN_MIGRATIONS.slice(0, 5));
    insert(db, { id: 'sel', name: 'Choisis', scope: 'selection' });
    insert(db, { id: 'all', name: 'Tout' });
    db.exec("UPDATE plans SET data_types = 'mail,sharepoint'");
    migrate(db, PLAN_MIGRATIONS);
    expect(db.prepare('SELECT id, selection_types AS t FROM plans ORDER BY id').all()).toEqual([
      { id: 'all', t: '' },
      { id: 'sel', t: 'mail,sharepoint' },
    ]);
    const run = db.prepare(
      "INSERT INTO plan_runs (plan_id, item_id, started_at, status, auto_added) VALUES ('all', 'i', 's', 'success', ?)",
    );
    expect(() => run.run(2)).toThrow();
  });

  it('refuses a run with an unknown status or a long error', () => {
    const db = open();
    insert(db);
    const run = db.prepare(
      "INSERT INTO plan_runs (plan_id, item_id, started_at, status, error) VALUES ('p1', 'i', 's', ?, ?)",
    );
    expect(() => run.run('done', null)).toThrow();
    expect(() => run.run('failed', 'x'.repeat(201))).toThrow();
  });
});
