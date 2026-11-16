import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { PlanScope, ProtectionPlanInput, RpoHours } from '@backup365/core';
import { openDatabase } from './open-database.js';
import { PLAN_MIGRATIONS } from './migrations.js';

export interface StoredPlan extends ProtectionPlanInput {
  id: string;
  createdAt: string;
}

/** Un autre plan porte déjà ce nom (casse ignorée). */
export class PlanNameTakenError extends Error {}

interface Row {
  id: string;
  name: string;
  scope: PlanScope;
  rpo_hours: RpoHours;
  rto_hours: number | null;
  retention_days: number;
  gdpr_justification: string;
  created_at: string;
}

/** Plans de protection dans `plans.sqlite`. Appels synchrones : une opération n'est jamais entrelacée. */
export class SqlitePlanStore {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path: string): SqlitePlanStore {
    return new SqlitePlanStore(openDatabase(path, PLAN_MIGRATIONS));
  }

  close(): void {
    this.db.close();
  }

  private selection(id: string): string[] {
    return (
      this.db
        .prepare('SELECT item_id FROM plan_items WHERE plan_id = ? ORDER BY item_id')
        .all(id) as { item_id: string }[]
    ).map((r) => r.item_id);
  }

  private toPlan(row: Row): StoredPlan {
    return {
      id: row.id,
      name: row.name,
      scope: row.scope,
      selection: this.selection(row.id),
      rpoHours: row.rpo_hours,
      rtoHours: row.rto_hours,
      retentionDays: row.retention_days,
      gdprJustification: row.gdpr_justification,
      createdAt: row.created_at,
    };
  }

  list(): StoredPlan[] {
    const rows = this.db
      .prepare('SELECT * FROM plans ORDER BY name COLLATE NOCASE, id')
      .all() as unknown as Row[];
    return rows.map((r) => this.toPlan(r));
  }

  get(id: string): StoredPlan | undefined {
    const row = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as unknown as
      Row | undefined;
    return row && this.toPlan(row);
  }

  /** Lève `PlanNameTakenError` si le nom est déjà pris. */
  create(input: ProtectionPlanInput): StoredPlan {
    const id = randomUUID();
    this.write(() => {
      this.db
        .prepare(
          `INSERT INTO plans (id, name, scope, rpo_hours, rto_hours, retention_days, gdpr_justification, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.scope,
          input.rpoHours,
          input.rtoHours,
          input.retentionDays,
          input.gdprJustification,
          new Date().toISOString(),
        );
      this.setSelection(id, input.selection);
    });
    return this.get(id) as StoredPlan;
  }

  /** Remplace le plan ; `undefined` s'il n'existe pas. Lève `PlanNameTakenError` si le nom est pris. */
  update(id: string, input: ProtectionPlanInput): StoredPlan | undefined {
    const found = this.write(() => {
      const result = this.db
        .prepare(
          `UPDATE plans SET name = ?, scope = ?, rpo_hours = ?, rto_hours = ?, retention_days = ?,
             gdpr_justification = ? WHERE id = ?`,
        )
        .run(
          input.name,
          input.scope,
          input.rpoHours,
          input.rtoHours,
          input.retentionDays,
          input.gdprJustification,
          id,
        );
      if (result.changes === 0) return false;
      this.db.prepare('DELETE FROM plan_items WHERE plan_id = ?').run(id);
      this.setSelection(id, input.selection);
      return true;
    });
    return found ? this.get(id) : undefined;
  }

  /** Supprime le plan, sa sélection et son historique (cascade) ; `false` s'il n'existe pas. */
  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM plans WHERE id = ?').run(id).changes > 0;
  }

  private setSelection(id: string, items: readonly string[]): void {
    const insert = this.db.prepare('INSERT INTO plan_items (plan_id, item_id) VALUES (?, ?)');
    for (const item of items) insert.run(id, item);
  }

  /** Transaction ; l'unicité du nom (violée aussi par un autre processus) devient `PlanNameTakenError`. */
  private write<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = body();
      this.db.exec('COMMIT');
      return value;
    } catch (err) {
      this.db.exec('ROLLBACK');
      if (/UNIQUE/i.test((err as Error).message)) throw new PlanNameTakenError();
      throw err;
    }
  }
}
