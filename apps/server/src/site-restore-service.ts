import { randomUUID } from 'node:crypto';
import { copyNameOf, type AuditLog, type SiteRestorer, type SiteScope } from '@backup365/core';

export type SiteRestoreStatus = 'running' | 'succeeded' | 'failed';

/** Cause d'un échec : un code fermé, jamais le message du SDK. */
export type SiteRestoreFailure = 'restore_error' | 'restore_unreachable';

/** Restauration d'un site SharePoint : états, comptes et durées, jamais de contenu. */
export interface SiteRestoreJob {
  id: string;
  siteId: string;
  scope: SiteScope;
  path: string;
  status: SiteRestoreStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Durée mesurée ; `null` tant que la restauration est en cours. */
  durationMs: number | null;
  /** Éléments que la restauration doit traiter (d'après la sauvegarde). */
  total: number;
  restored: number;
  /** Éléments déjà présents, conservés. */
  skipped: number;
  errors: number;
  /** Nom de la copie d'un fichier seul, sinon `null`. */
  copyName: string | null;
  error: SiteRestoreFailure | null;
}

export interface SiteRestoreTarget {
  siteId: string;
  snapshotId: string;
  scope: SiteScope;
  path: string;
  /** Nom du fichier, pour la copie d'un élément. */
  name: string;
  total: number;
}

const MAX_JOBS = 1000;
const RESTORE_TIMEOUT_MS = 30 * 60_000;

/**
 * Restaurations SharePoint : une à la fois par site (un site entier recouvre tout le reste), en
 * arrière-plan, la dernière de chaque site gardée en mémoire. Même principe que
 * `DriveRestoreService` (docs/adr/0013) : demande consignée avant le lancement, résultat à la fin
 * avec la durée mesurée.
 */
export class SiteRestoreService {
  private readonly jobs = new Map<string, SiteRestoreJob>();
  private readonly pending = new Set<Promise<void>>();
  /** Sites dont l'appel du SDK n'a pas rendu la main, même après le délai. */
  private readonly busy = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly options: {
      restorer: SiteRestorer;
      audit: AuditLog;
      now?: () => number;
      onError?: (code: string) => void;
      timeoutMs?: number;
    },
  ) {
    this.now = options.now ?? Date.now;
  }

  last(siteId: string): SiteRestoreJob | undefined {
    const job = this.jobs.get(siteId);
    return job && { ...job };
  }

  /** Lance une restauration ; `'in_progress'` si une est déjà en cours pour ce site. */
  async start(
    actor: string,
    target: SiteRestoreTarget,
    reason: string,
  ): Promise<SiteRestoreJob | 'in_progress'> {
    const key = target.siteId;
    const previous = this.jobs.get(key);
    if (previous?.status === 'running' || this.busy.has(key)) return 'in_progress';
    const startedMs = this.now();
    const job: SiteRestoreJob = {
      id: randomUUID(),
      siteId: target.siteId,
      scope: target.scope,
      path: target.path,
      status: 'running',
      startedAt: new Date(startedMs).toISOString(),
      finishedAt: null,
      durationMs: null,
      total: target.total,
      restored: 0,
      skipped: 0,
      errors: 0,
      copyName:
        target.scope === 'item' ? copyNameOf(target.name, 'file', new Date(startedMs)) : null,
      error: null,
    };
    // Réserve le site avant tout `await` : deux demandes simultanées ne passent pas ensemble.
    this.jobs.set(key, job);
    try {
      await this.options.audit.record({
        at: job.startedAt,
        actor,
        action: 'restore.request',
        resource: 'sharepoint.restore',
        target: `${target.siteId}${target.path}`,
        reason: `scope=${target.scope};reason=${reason}`,
      });
    } catch (err) {
      if (previous) this.jobs.set(key, previous);
      else this.jobs.delete(key);
      throw err;
    }
    this.trim();
    const run: Promise<void> = this.run(job, actor, target, reason).finally(() => {
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
    job: SiteRestoreJob,
    actor: string,
    target: SiteRestoreTarget,
    reason: string,
  ): Promise<void> {
    const key = target.siteId;
    let error: SiteRestoreFailure | null = null;
    let counts = { restored: 0, skipped: 0, errors: 0 };
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timeout'));
        }, this.options.timeoutMs ?? RESTORE_TIMEOUT_MS);
      });
      const call = this.options.restorer.restore({
        siteId: target.siteId,
        snapshotId: target.snapshotId,
        scope: target.scope,
        path: target.path,
        copyName: job.copyName ?? '',
      });
      // Après le délai l'appel n'est pas annulé : le site reste réservé jusqu'à sa fin réelle.
      this.busy.add(key);
      const release = () => this.busy.delete(key);
      call.then(release, release);
      counts = await Promise.race([call, timeout]);
      if (counts.errors > 0 || counts.restored + counts.skipped < 1) error = 'restore_error';
    } catch {
      error = 'restore_unreachable';
    } finally {
      clearTimeout(timer);
    }
    const finishedMs = this.now();
    const done: SiteRestoreJob = {
      ...job,
      ...counts,
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
        resource: 'sharepoint.restore',
        target: `${target.siteId}${target.path}`,
        count: done.restored,
        reason: `outcome=${done.status};duration_ms=${done.durationMs ?? 0};scope=${target.scope};skipped=${done.skipped};errors=${done.errors};reason=${reason}`,
      });
    } catch {
      this.options.onError?.('audit_result_failed');
    }
  }

  private trim(): void {
    for (const [key, job] of this.jobs) {
      if (this.jobs.size <= MAX_JOBS) return;
      if (job.status !== 'running') this.jobs.delete(key);
    }
  }
}
