import { MailSendError, type Mailer, type MailerStatus } from './graph-mailer.js';
import {
  alertMessage,
  reportSubject,
  reportText,
  summarize,
  type MailMessage,
  type ReportSummary,
} from './mail-report.js';
import type { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import type {
  LastSend,
  ReportFrequency,
  ReportSettings,
  SendKind,
  SqliteReportStore,
} from './sqlite/sqlite-report-store.js';

/** Heure d'envoi du rapport (UTC) : valeur par défaut, non réglable (hors périmètre de #278). */
export const REPORT_HOUR_UTC = 7;

/** Exécutions relues par plan pour un rapport (une semaine de plans horaires). */
const RUNS_PER_PLAN = 500;

/** Délai avant un nouvel essai d'un rapport ou d'une alerte refusé. */
export const RETRY_MS = 15 * 60_000;

const TEST_INTERVAL_MS = 30_000;

/** Dernière échéance passée : aujourd'hui (ou hier) à 07:00 UTC, le lundi pour l'hebdomadaire. */
export function lastDueAt(now: Date, frequency: ReportFrequency): Date {
  const due = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), REPORT_HOUR_UTC),
  );
  if (due > now) due.setUTCDate(due.getUTCDate() - 1);
  if (frequency === 'weekly') due.setUTCDate(due.getUTCDate() - ((due.getUTCDay() + 6) % 7));
  return due;
}

/**
 * Démo : deux destinataires fictifs et un dernier rapport réussi, pour les captures. Le curseur
 * d'alerte est au plus haut : la démo n'envoie rien, mais n'inscrit pas non plus d'alerte.
 */
export function seedDemoReports(store: SqliteReportStore, now: number): void {
  if (store.cursor().lastReportAt !== null) return;
  const at = new Date(now);
  store.save(
    {
      recipients: ['marie.durand@exemple.invalid', 'paul.martin@exemple.invalid'],
      frequency: 'weekly',
      failureAlert: true,
    },
    at.toISOString(),
  );
  store.markAlerted('9999-12-31T00:00:00.000Z');
  store.recordSend({ at: lastDueAt(at, 'weekly').toISOString(), kind: 'report', ok: true });
}

export interface ReportServiceOptions {
  store: SqliteReportStore;
  plans: SqlitePlanStore;
  mailer: Mailer;
  logger: { error(obj: Record<string, unknown>, msg: string): void };
  now?: () => Date;
  tickMs?: number;
}

export type SendOutcome = { ok: true; at: string } | { ok: false; at: string; code: string };

/**
 * Rapports périodiques et alertes d'échec (issue #278). Chaque rapport ou alerte, réussi ou non,
 * est inscrit comme « dernier envoi » : un échec se voit dans Réglages et sur l'accueil, jamais en
 * silence, et il est retenté.
 */
export class ReportService {
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;
  private status: MailerStatus | undefined;
  private retryAfterMs = 0;
  private lastTestMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: ReportServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** État de l'envoi, gardé en mémoire ; `refresh` redemande un jeton (« Vérifier à nouveau »). */
  async mailerStatus(refresh = false): Promise<MailerStatus> {
    if (refresh || !this.status) this.status = await this.options.mailer.status();
    return this.status;
  }

  settings(): ReportSettings {
    return this.options.store.settings();
  }

  lastSend(): LastSend | null {
    return this.options.store.lastSend();
  }

  planCount(): number {
    return this.options.plans.list().length;
  }

  save(settings: ReportSettings): void {
    this.options.store.save(settings, this.now().toISOString());
  }

  /** Un essai toutes les 30 s au plus : la boîte de l'organisation n'envoie pas en rafale. */
  testAllowed(): boolean {
    const now = this.now().getTime();
    if (now - this.lastTestMs < TEST_INTERVAL_MS) return false;
    this.lastTestMs = now;
    return true;
  }

  summary(frequency: ReportFrequency, now = this.now()): ReportSummary {
    const { plans } = this.options;
    return summarize(plans.list(), (id) => plans.listRuns(id, RUNS_PER_PLAN), now, frequency);
  }

  private async send(kind: SendKind, message: MailMessage): Promise<SendOutcome> {
    const at = this.now().toISOString();
    let outcome: SendOutcome;
    try {
      await this.options.mailer.send(message);
      outcome = { ok: true, at };
    } catch (err) {
      const code = err instanceof MailSendError ? err.code : 'error';
      // Le code seul : jamais l'adresse ni le contenu.
      this.options.logger.error({ code, kind }, 'envoi du rapport par mail en échec');
      // Un refus se voit tout de suite dans Réglages : l'état est relu au prochain affichage.
      this.status = undefined;
      outcome = { ok: false, at, code };
    }
    return outcome;
  }

  /**
   * Rapport ou alerte : inscrit comme dernier envoi. En échec, nouvel essai dans 15 min ; le
   * curseur n'avance qu'après un envoi réussi, donc rien n'est perdu.
   */
  private async deliver(kind: 'report' | 'alert', message: MailMessage): Promise<boolean> {
    const outcome = await this.send(kind, message);
    this.options.store.recordSend({ at: outcome.at, kind, ok: outcome.ok });
    if (!outcome.ok) this.retryAfterMs = this.now().getTime() + RETRY_MS;
    return outcome.ok;
  }

  /** « Envoyer un essai » : le rapport du moment, aux adresses saisies (pas encore enregistrées). */
  sendTest(to: string[], frequency: ReportFrequency): Promise<SendOutcome> {
    const now = this.now();
    return this.send('test', {
      to,
      subject: 'backup365 : essai de rapport par mail',
      text: reportText(this.summary(frequency, now), now, frequency),
    });
  }

  /** Un passage : rapport échu, puis alertes des échecs nouveaux. Jamais deux en même temps. */
  tick(): Promise<void> {
    this.ticking ??= this.runTick().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }

  private async runTick(): Promise<void> {
    const { store, plans } = this.options;
    const settings = store.settings();
    const cursor = store.cursor();
    if (cursor.lastReportAt === null) return;
    const now = this.now();
    if (now.getTime() < this.retryAfterMs) return;
    const to = settings.recipients;
    if (Date.parse(cursor.lastReportAt) < lastDueAt(now, settings.frequency).getTime()) {
      // Sans destinataire, l'échéance est passée sans envoi : ajouter une adresse ensuite
      // n'envoie pas aussitôt le rapport manqué.
      const sent =
        to.length === 0 ||
        (await this.deliver('report', {
          to,
          subject: reportSubject(settings.frequency),
          text: reportText(this.summary(settings.frequency, now), now, settings.frequency),
        }));
      if (!sent) return;
      store.markReport(now.toISOString());
    }
    // Les échecs terminés depuis le dernier signalé (interruptions comprises), par heure de fin.
    const failed = [
      ...plans.listRecentRuns({ result: 'failed', limit: RUNS_PER_PLAN }),
      ...plans.listRecentRuns({ result: 'interrupted', limit: RUNS_PER_PLAN }),
    ].filter((r) => r.finishedAt !== null && r.finishedAt > cursor.lastAlertAt);
    if (failed.length === 0) return;
    const latest = failed.reduce((a, r) => (r.finishedAt! > a ? r.finishedAt! : a), '');
    if (settings.failureAlert && to.length > 0) {
      if (!(await this.deliver('alert', alertMessage(failed, to)))) return;
    }
    store.markAlerted(latest);
  }

  start(): void {
    if (this.timer) return;
    const run = () => {
      this.tick().catch((err: unknown) => {
        this.options.logger.error(
          { code: (err as { code?: unknown }).code },
          'rapports par mail : passage en échec',
        );
      });
    };
    this.timer = setInterval(run, this.options.tickMs ?? 60_000);
    this.timer.unref();
    run();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.ticking;
  }
}
