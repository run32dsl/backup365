import { randomUUID } from 'node:crypto';
import type { AuditLog, MailRestorer } from '@backup365/core';

export type RestoreStatus = 'running' | 'succeeded' | 'failed';

/** Cause d'un échec : un code fermé, jamais le message du SDK (il peut citer le stockage). */
export type RestoreFailure = 'restore_error' | 'restore_unreachable';

/** Restauration d'un mail : des états et des durées, jamais de contenu. */
export interface RestoreJob {
  id: string;
  mailboxId: string;
  messageId: string;
  status: RestoreStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Durée mesurée ; `null` tant que la restauration est en cours. Alimente le RTO observé. */
  durationMs: number | null;
  /** Dossier créé dans la boîte d'origine. */
  folder: string;
  error: RestoreFailure | null;
}

export interface RestoreTarget {
  mailboxId: string;
  messageId: string;
  snapshotId: string;
}

const MAX_JOBS = 1000;
const RESTORE_TIMEOUT_MS = 10 * 60_000;

const pad = (n: number): string => String(n).padStart(2, '0');

/** `Restauré par backup365 jj/mm/aaaa` (date UTC). */
export function restoreFolderName(at: Date): string {
  return `Restauré par backup365 ${pad(at.getUTCDate())}/${pad(at.getUTCMonth() + 1)}/${at.getUTCFullYear()}`;
}

/**
 * Restaurations de mails : une à la fois par mail, en arrière-plan, la dernière de chaque mail
 * gardée en mémoire (perdue au redémarrage ; le journal d'audit garde demande, résultat et durée).
 * La demande est consignée avant le lancement (si la consignation échoue, rien ne part) ; le
 * résultat l'est à la fin, son échec est signalé à `onError` par un code, sans message du SDK.
 */
export class RestoreService {
  private readonly jobs = new Map<string, RestoreJob>();
  private readonly pending = new Set<Promise<void>>();
  private readonly now: () => number;

  constructor(
    private readonly options: {
      restorer: MailRestorer;
      audit: AuditLog;
      now?: () => number;
      onError?: (code: string) => void;
      /** Délai maximal d'une restauration, en ms (10 min par défaut). */
      timeoutMs?: number;
    },
  ) {
    this.now = options.now ?? Date.now;
  }

  private key(mailboxId: string, messageId: string): string {
    return JSON.stringify([mailboxId, messageId]);
  }

  /** Dernière restauration de ce mail. */
  last(mailboxId: string, messageId: string): RestoreJob | undefined {
    return this.jobs.get(this.key(mailboxId, messageId));
  }

  /** Lance une restauration ; `'in_progress'` si une est déjà en cours pour ce mail. */
  async start(
    actor: string,
    mail: RestoreTarget,
    reason: string,
  ): Promise<RestoreJob | 'in_progress'> {
    const key = this.key(mail.mailboxId, mail.messageId);
    const previous = this.jobs.get(key);
    if (previous?.status === 'running') return 'in_progress';
    const startedMs = this.now();
    const job: RestoreJob = {
      id: randomUUID(),
      mailboxId: mail.mailboxId,
      messageId: mail.messageId,
      status: 'running',
      startedAt: new Date(startedMs).toISOString(),
      finishedAt: null,
      durationMs: null,
      folder: restoreFolderName(new Date(startedMs)),
      error: null,
    };
    // Réserve le mail avant tout `await` : deux demandes simultanées ne passent pas ensemble.
    this.jobs.set(key, job);
    try {
      await this.options.audit.record({
        at: job.startedAt,
        actor,
        action: 'restore.request',
        resource: 'mail.restore',
        target: `${mail.mailboxId}/${mail.messageId}`,
        reason,
      });
    } catch (err) {
      if (previous) this.jobs.set(key, previous);
      else this.jobs.delete(key);
      throw err;
    }
    this.trim();
    const run: Promise<void> = this.run(job, key, actor, mail, reason).finally(() => {
      this.pending.delete(run);
    });
    this.pending.add(run);
    return { ...job };
  }

  /** Attend la fin des restaurations en cours (tests, arrêt propre). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  private async run(
    job: RestoreJob,
    key: string,
    actor: string,
    mail: RestoreTarget,
    reason: string,
  ): Promise<void> {
    let error: RestoreFailure | null = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      // Délai maximal : un appel du SDK qui ne rend jamais la main ne bloque pas le mail.
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timeout'));
        }, this.options.timeoutMs ?? RESTORE_TIMEOUT_MS);
      });
      const outcome = await Promise.race([
        this.options.restorer.restoreMessage(mail.snapshotId, mail.messageId, job.folder),
        timeout,
      ]);
      if (outcome.errors > 0 || outcome.restored < 1) error = 'restore_error';
    } catch {
      error = 'restore_unreachable';
    } finally {
      clearTimeout(timer);
    }
    const finishedMs = this.now();
    const done: RestoreJob = {
      ...job,
      status: error ? 'failed' : 'succeeded',
      finishedAt: new Date(finishedMs).toISOString(),
      durationMs: Math.max(0, finishedMs - Date.parse(job.startedAt)),
      error,
    };
    this.jobs.set(key, done);
    try {
      await this.options.audit.record({
        at: done.finishedAt ?? job.startedAt,
        actor,
        action: 'restore.result',
        resource: 'mail.restore',
        target: `${mail.mailboxId}/${mail.messageId}`,
        count: error ? 0 : 1,
        reason: `outcome=${done.status};duration_ms=${done.durationMs ?? 0};reason=${reason}`,
      });
    } catch {
      this.options.onError?.('audit_result_failed');
    }
  }

  /** Borne la mémoire : les plus anciennes restaurations terminées sont oubliées. */
  private trim(): void {
    for (const [key, job] of this.jobs) {
      if (this.jobs.size <= MAX_JOBS) return;
      if (job.status !== 'running') this.jobs.delete(key);
    }
  }
}
