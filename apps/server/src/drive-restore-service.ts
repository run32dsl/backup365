import { randomUUID } from 'node:crypto';
import {
  copyNameOf,
  type AuditLog,
  type DriveItemKind,
  type DriveRestoreMode,
  type DriveRestorer,
} from '@backup365/core';
import { restoreFailureOf, type RestoreFailure } from './restore-failure.js';

export type DriveRestoreStatus = 'running' | 'succeeded' | 'failed';

/** Cause d'un échec : un code fermé, jamais le message du SDK. */
export type DriveRestoreFailure = RestoreFailure;

/** Restauration d'un élément OneDrive : états et durées, jamais de contenu. */
export interface DriveRestoreJob {
  id: string;
  ownerId: string;
  path: string;
  kind: DriveItemKind;
  mode: DriveRestoreMode;
  /** Version restaurée (ISO 8601), le cas échéant. */
  versionAt: string | null;
  status: DriveRestoreStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Durée mesurée ; `null` tant que la restauration est en cours. */
  durationMs: number | null;
  /** Nom de la copie (mode `copy`), `null` en mode `replace`. */
  copyName: string | null;
  error: DriveRestoreFailure | null;
}

export interface DriveRestoreTarget {
  ownerId: string;
  snapshotId: string;
  path: string;
  name: string;
  kind: DriveItemKind;
  mode: DriveRestoreMode;
  versionId?: string | undefined;
  versionAt: string | null;
}

const MAX_JOBS = 1000;
const RESTORE_TIMEOUT_MS = 10 * 60_000;

/**
 * Restaurations OneDrive : une à la fois par élément, en arrière-plan, la dernière de chaque
 * élément gardée en mémoire. Même principe que `RestoreService` (docs/adr/0012) : la demande est
 * consignée avant le lancement (sinon rien ne part), le résultat à la fin avec la durée mesurée.
 * Reprise du délai : le job passe en échec incertain, l'appel du SDK n'est pas annulé.
 */
export class DriveRestoreService {
  private readonly jobs = new Map<string, DriveRestoreJob>();
  private readonly pending = new Set<Promise<void>>();
  /** Éléments dont l'appel du SDK n'a pas rendu la main, même après le délai. */
  private readonly busy = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly options: {
      restorer: DriveRestorer;
      audit: AuditLog;
      now?: () => number;
      onError?: (code: string) => void;
      timeoutMs?: number;
    },
  ) {
    this.now = options.now ?? Date.now;
  }

  private key(ownerId: string, path: string): string {
    return JSON.stringify([ownerId, path]);
  }

  last(ownerId: string, path: string): DriveRestoreJob | undefined {
    return this.jobs.get(this.key(ownerId, path));
  }

  /** Lance une restauration ; `'in_progress'` si une est déjà en cours pour cet élément. */
  async start(
    actor: string,
    target: DriveRestoreTarget,
    reason: string,
  ): Promise<DriveRestoreJob | 'in_progress'> {
    const key = this.key(target.ownerId, target.path);
    const previous = this.jobs.get(key);
    if (previous?.status === 'running' || this.busy.has(key)) return 'in_progress';
    const startedMs = this.now();
    const job: DriveRestoreJob = {
      id: randomUUID(),
      ownerId: target.ownerId,
      path: target.path,
      kind: target.kind,
      mode: target.mode,
      versionAt: target.versionAt,
      status: 'running',
      startedAt: new Date(startedMs).toISOString(),
      finishedAt: null,
      durationMs: null,
      // Une version restaurée en copie : le SDK choisit le nom, on ne l'annonce pas.
      copyName:
        target.mode === 'copy' && target.versionId === undefined
          ? copyNameOf(target.name, target.kind, new Date(startedMs))
          : null,
      error: null,
    };
    // Réserve l'élément avant tout `await` : deux demandes simultanées ne passent pas ensemble.
    this.jobs.set(key, job);
    try {
      await this.options.audit.record({
        at: job.startedAt,
        actor,
        action: 'restore.request',
        resource: 'onedrive.restore',
        target: `${target.ownerId}${target.path}`,
        reason,
      });
    } catch (err) {
      if (previous) this.jobs.set(key, previous);
      else this.jobs.delete(key);
      throw err;
    }
    this.trim();
    const run: Promise<void> = this.run(job, key, actor, target, reason).finally(() => {
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
    job: DriveRestoreJob,
    key: string,
    actor: string,
    target: DriveRestoreTarget,
    reason: string,
  ): Promise<void> {
    let error: DriveRestoreFailure | null = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timeout'));
        }, this.options.timeoutMs ?? RESTORE_TIMEOUT_MS);
      });
      const call = this.options.restorer.restore({
        ownerId: target.ownerId,
        snapshotId: target.snapshotId,
        path: target.path,
        kind: target.kind,
        mode: target.mode,
        versionId: target.versionId,
        copyName: job.copyName ?? '',
      });
      // Après le délai l'appel n'est pas annulé : l'élément reste réservé jusqu'à sa fin réelle.
      this.busy.add(key);
      const release = () => this.busy.delete(key);
      call.then(release, release);
      const outcome = await Promise.race([call, timeout]);
      if (outcome.errors > 0 || outcome.restored < 1) error = 'restore_error';
    } catch (err) {
      error = restoreFailureOf(err);
    } finally {
      clearTimeout(timer);
    }
    const finishedMs = this.now();
    const done: DriveRestoreJob = {
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
        resource: 'onedrive.restore',
        target: `${target.ownerId}${target.path}`,
        count: error ? 0 : 1,
        reason: `outcome=${done.status};duration_ms=${done.durationMs ?? 0};mode=${target.mode};reason=${reason}`,
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
