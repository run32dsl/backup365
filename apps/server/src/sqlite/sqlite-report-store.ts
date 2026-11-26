import type { DatabaseSync } from 'node:sqlite';
import type { Migration } from './migrations.js';
import { openDatabase } from './open-database.js';

export const REPORT_FREQUENCIES = ['weekly', 'daily'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

/** Réglages des rapports par mail (issue #278), modifiés par un administrateur. */
export interface ReportSettings {
  recipients: string[];
  frequency: ReportFrequency;
  /** Alerte immédiate à chaque exécution en échec. */
  failureAlert: boolean;
}

/** Valeurs par défaut sûres : aucun destinataire, donc aucun envoi. */
export const DEFAULT_REPORT_SETTINGS: ReportSettings = {
  recipients: [],
  frequency: 'weekly',
  failureAlert: true,
};

export type SendKind = 'report' | 'alert' | 'test';

/**
 * Dernier rapport ou dernière alerte tenté : affiché dans Réglages et sur l'accueil. Un essai n'y
 * est jamais inscrit (son résultat s'affiche sur place) : il ne masque pas un échec réel.
 */
export interface LastSend {
  at: string;
  kind: Exclude<SendKind, 'test'>;
  ok: boolean;
}

/** État du planificateur des rapports : ce qui a déjà été envoyé. */
export interface ReportCursor {
  /** Dernier rapport traité ; `null` avant le premier enregistrement des réglages. */
  lastReportAt: string | null;
  /**
   * Fin de la dernière exécution en échec déjà signalée (ou ignorée à l'activation). L'heure de
   * fin, pas l'identifiant : un identifiant est donné au début, dans un autre ordre que les échecs.
   */
  lastAlertAt: string;
}

export const REPORT_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'report-settings',
    // Une seule ligne ; les adresses sont une liste JSON (données personnelles : base 0600).
    sql: `CREATE TABLE report_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      recipients TEXT NOT NULL,
      frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'daily')),
      failure_alert INTEGER NOT NULL CHECK (failure_alert IN (0, 1)),
      updated_at TEXT NOT NULL,
      last_report_at TEXT,
      last_alert_at TEXT NOT NULL,
      last_send_at TEXT,
      last_send_kind TEXT CHECK (last_send_kind IS NULL OR last_send_kind IN ('report', 'alert')),
      last_send_ok INTEGER CHECK (last_send_ok IS NULL OR last_send_ok IN (0, 1))
    );`,
  },
];

interface Row {
  recipients: string;
  frequency: ReportFrequency;
  failure_alert: number;
  last_report_at: string | null;
  last_alert_at: string;
  last_send_at: string | null;
  last_send_kind: LastSend['kind'] | null;
  last_send_ok: number | null;
}

/** Réglages et état des envois dans `reports.sqlite`. */
export class SqliteReportStore {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path: string): SqliteReportStore {
    return new SqliteReportStore(openDatabase(path, REPORT_MIGRATIONS));
  }

  close(): void {
    this.db.close();
  }

  private row(): Row | undefined {
    return this.db.prepare('SELECT * FROM report_settings WHERE id = 1').get() as Row | undefined;
  }

  settings(): ReportSettings {
    const row = this.row();
    if (!row) return { ...DEFAULT_REPORT_SETTINGS, recipients: [] };
    const parsed: unknown = JSON.parse(row.recipients);
    return {
      recipients: Array.isArray(parsed) ? parsed.filter((r) => typeof r === 'string') : [],
      frequency: row.frequency,
      failureAlert: row.failure_alert === 1,
    };
  }

  /**
   * Enregistre les réglages. Au premier enregistrement, le curseur part de maintenant : ni rapport
   * rattrapé, ni alerte pour un échec terminé avant `now`.
   */
  save(settings: ReportSettings, now: string): void {
    const recipients = JSON.stringify(settings.recipients);
    const alert = settings.failureAlert ? 1 : 0;
    if (this.row()) {
      this.db
        .prepare(
          'UPDATE report_settings SET recipients = ?, frequency = ?, failure_alert = ?, updated_at = ? WHERE id = 1',
        )
        .run(recipients, settings.frequency, alert, now);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO report_settings (id, recipients, frequency, failure_alert, updated_at, last_report_at, last_alert_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(recipients, settings.frequency, alert, now, now, now);
  }

  cursor(): ReportCursor {
    const row = this.row();
    return { lastReportAt: row?.last_report_at ?? null, lastAlertAt: row?.last_alert_at ?? '' };
  }

  markReport(at: string): void {
    this.db.prepare('UPDATE report_settings SET last_report_at = ? WHERE id = 1').run(at);
  }

  markAlerted(finishedAt: string): void {
    this.db.prepare('UPDATE report_settings SET last_alert_at = ? WHERE id = 1').run(finishedAt);
  }

  lastSend(): LastSend | null {
    const row = this.row();
    if (!row?.last_send_at || !row.last_send_kind || row.last_send_ok === null) return null;
    return { at: row.last_send_at, kind: row.last_send_kind, ok: row.last_send_ok === 1 };
  }

  recordSend(send: LastSend): void {
    this.db
      .prepare(
        'UPDATE report_settings SET last_send_at = ?, last_send_kind = ?, last_send_ok = ? WHERE id = 1',
      )
      .run(send.at, send.kind, send.ok ? 1 : 0);
  }
}

export type OpenedReportStore =
  { store: SqliteReportStore; error?: undefined } | { store?: undefined; error: Error };

/** Ouvre la base des rapports sans lever : inutilisable, `/api/reports` répond 503. */
export function tryOpenReportStore(path: string): OpenedReportStore {
  try {
    return { store: SqliteReportStore.open(path) };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}
