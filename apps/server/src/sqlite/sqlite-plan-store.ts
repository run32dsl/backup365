import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  DATA_TYPES,
  type DataType,
  type NoSnapshotReason,
  type PlanScope,
  type ProtectionPlanInput,
  type RpoHours,
  type RunStatus,
} from '@backup365/core';
import { openDatabase } from './open-database.js';
import { PLAN_MIGRATIONS } from './migrations.js';

export interface StoredPlan extends ProtectionPlanInput {
  id: string;
  createdAt: string;
}

/** Une exécution de plan sur un élément. */
export interface StoredRun {
  id: number;
  planId: string;
  itemId: string;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  durationMs: number | null;
  /** Code technique (200 caractères au plus) : jamais un message ni un contenu. */
  error: string | null;
  /** Succès sans point de restauration : la ressource était vide. `null` sinon. */
  noSnapshotReason: NoSnapshotReason | null;
}

interface RunRow {
  id: number;
  plan_id: string;
  item_id: string;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  duration_ms: number | null;
  error: string | null;
  no_snapshot_reason: NoSnapshotReason | null;
}

/** Un autre plan porte déjà ce nom (casse ignorée). */
export class PlanNameTakenError extends Error {}

interface Row {
  id: string;
  name: string;
  scope: PlanScope;
  data_types: string;
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
      dataTypes: DATA_TYPES.filter((t): t is DataType => row.data_types.split(',').includes(t)),
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
          `INSERT INTO plans (id, name, scope, data_types, rpo_hours, rto_hours, retention_days, gdpr_justification, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.scope,
          input.dataTypes.join(','),
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
          `UPDATE plans SET name = ?, scope = ?, data_types = ?, rpo_hours = ?, rto_hours = ?,
             retention_days = ?, gdpr_justification = ? WHERE id = ?`,
        )
        .run(
          input.name,
          input.scope,
          input.dataTypes.join(','),
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

  /**
   * Ouvre une exécution `running`. `undefined` si l'élément a déjà une exécution en cours (index
   * unique de la base : valable aussi entre processus) ou si le plan n'existe plus.
   */
  startRun(planId: string, itemId: string, startedAt: string): number | undefined {
    try {
      const result = this.db
        .prepare(
          "INSERT INTO plan_runs (plan_id, item_id, started_at, status) VALUES (?, ?, ?, 'running')",
        )
        .run(planId, itemId, startedAt);
      return Number(result.lastInsertRowid);
    } catch (err) {
      if (/UNIQUE|FOREIGN KEY/i.test((err as Error).message)) return undefined;
      throw err;
    }
  }

  /** Clôt une exécution en cours ; sans effet si elle n'est plus `running` (plan supprimé…). */
  finishRun(
    id: number,
    status: 'success' | 'failed',
    finishedAt: string,
    error?: string,
    noSnapshotReason?: NoSnapshotReason,
  ): void {
    this.db
      .prepare(
        `UPDATE plan_runs SET status = ?, finished_at = ?, error = ?, no_snapshot_reason = ?,
           duration_ms = MAX(0, CAST(ROUND((julianday(?) - julianday(started_at)) * 86400000) AS INTEGER))
         WHERE id = ? AND status = 'running'`,
      )
      .run(
        status,
        finishedAt,
        error?.slice(0, 200) ?? null,
        status === 'success' ? (noSnapshotReason ?? null) : null,
        finishedAt,
        id,
      );
  }

  /** Au démarrage : les exécutions restées `running` n'ont pas fini, elles passent en `failed`. */
  interruptRunning(finishedAt: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE plan_runs SET status = 'failed', finished_at = ?, error = 'interrupted',
             duration_ms = MAX(0, CAST(ROUND((julianday(?) - julianday(started_at)) * 86400000) AS INTEGER))
           WHERE status = 'running'`,
        )
        .run(finishedAt, finishedAt).changes,
    );
  }

  /** Une exécution (quel qu'en soit le statut) de ce plan sur cet élément a-t-elle débuté depuis `since` ? */
  hasRunSince(planId: string, itemId: string, since: string): boolean {
    return (
      this.db
        .prepare(
          'SELECT 1 FROM plan_runs WHERE plan_id = ? AND item_id = ? AND started_at >= ? LIMIT 1',
        )
        .get(planId, itemId, since) !== undefined
    );
  }

  /**
   * Fin de la dernière réussite qui a créé un point de restauration, sur tout l'historique (pas
   * seulement les dernières exécutions listées) ; `null` s'il n'y en a aucune.
   */
  lastRestorePointAt(planId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT MAX(finished_at) AS at FROM plan_runs
         WHERE plan_id = ? AND status = 'success' AND no_snapshot_reason IS NULL`,
      )
      .get(planId) as { at: string | null } | undefined;
    return row?.at ?? null;
  }

  /** Historique d'un plan, du plus récent au plus ancien. */
  listRuns(planId: string, limit: number): StoredRun[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM plan_runs WHERE plan_id = ? ORDER BY started_at DESC, id DESC LIMIT ?',
      )
      .all(planId, limit) as unknown as RunRow[];
    return rows.map((r) => ({
      id: r.id,
      planId: r.plan_id,
      itemId: r.item_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      durationMs: r.duration_ms,
      error: r.error,
      noSnapshotReason: r.no_snapshot_reason,
    }));
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
