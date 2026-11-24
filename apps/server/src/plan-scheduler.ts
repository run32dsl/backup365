import {
  NIGHT_SLOT_GAP,
  currentRunSlot,
  nightWindowStart,
  isNightPlan,
  type DataType,
  type NoSnapshotReason,
} from '@backup365/core';
import type { SqlitePlanStore, StoredPlan } from './sqlite/sqlite-plan-store.js';

/** Ce que le planificateur demande à l'exécuteur : un plan sur un élément, rien d'autre. */
export interface ExecutionTarget {
  planId: string;
  itemId: string;
  /** Charges que le plan protège : l'exécuteur ne sauvegarde que celles-là. */
  dataTypes: readonly DataType[];
}

/**
 * Exécute une sauvegarde. Une promesse rejetée marque l'exécution en échec ; seul un code
 * technique est conservé (jamais le message, qui pourrait citer un contenu ou un secret).
 */
export interface Executeur {
  execute(target: ExecutionTarget): Promise<ExecutionResult | void>;
}

/** Issue d'une exécution réussie. `no_content` : rien à sauvegarder, donc aucun point de restauration. */
export interface ExecutionResult {
  noSnapshotReason?: NoSnapshotReason;
}

/** Exécuteur simulé : réussit aussitôt. L'exécution réelle vient avec la sous-issue 4 de #49. */
export const executeurSimule: Executeur = { execute: () => Promise.resolve() };

export interface SchedulerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface SchedulerOptions {
  plans: SqlitePlanStore;
  executeur: Executeur;
  /** Éléments d'un plan : sa sélection, ou toutes les boîtes si son périmètre est `all`. */
  listItems: (plan: StoredPlan) => Promise<string[]>;
  logger: SchedulerLogger;
  /** Horloge injectable (tests). */
  now?: () => Date;
  /** Période de la minuterie ; les créneaux sont à la minute, 30 s suffisent. */
  tickMs?: number;
}

export interface ManualRunResult {
  /** Exécutions ouvertes. */
  started: number;
  /** Éléments ignorés parce qu'une exécution est déjà en cours dessus. */
  skipped: number;
  /** Vrai si une sauvegarde est en cours : le lancement attend son tour (rien n'est encore ouvert). */
  queued: boolean;
  /** Se résout quand les exécutions ouvertes sont terminées (ne rejette jamais). */
  done: Promise<void>;
}

const CODE = /^[A-Za-z0-9_.-]{1,64}$/;

/** Code technique d'une erreur : son `code` ou son nom, sinon `error`. Jamais son message. */
export function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && CODE.test(code)) return code;
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === 'string' && CODE.test(name) ? name : 'error';
}

/**
 * Planificateur des plans de protection. L'état est en base (`plan_runs`) : au démarrage, les
 * exécutions restées `running` passent en `failed` (`interrupted`), puis chaque tick lance, pour
 * chaque plan et chaque élément, une exécution si le dernier créneau n'en a aucune (donc une
 * seule par élément après une interruption, sans rattraper les créneaux manqués). Les éléments
 * s'exécutent l'un après l'autre ; la base interdit deux exécutions simultanées sur un élément.
 * Les journaux ne portent que des identifiants et des codes.
 */
export class PlanScheduler {
  private timer: NodeJS.Timeout | undefined;
  private ticking: Promise<void> | undefined;
  private readonly background = new Set<Promise<void>>();
  private stopped = false;
  /** Une seule sauvegarde à la fois (l'instance ne sert qu'un tenant) : file d'attente en mémoire. */
  private tail: Promise<void> = Promise.resolve();
  private waiting = 0;
  /** Plans dont un lancement manuel attend son tour (perdu au redémarrage, rien n'est en base). */
  private readonly queuedPlans = new Map<string, number>();
  /** Plans `all` : dernier créneau dont tous les éléments ont une exécution (évite de relister). */
  private readonly settledSlot = new Map<string, string>();
  private readonly now: () => Date;

  constructor(private readonly options: SchedulerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Vrai si un lancement manuel de ce plan attend la fin de la sauvegarde en cours. */
  isQueued(planId: string): boolean {
    return (this.queuedPlans.get(planId) ?? 0) > 0;
  }

  /** Exécute `fn` quand toutes les sauvegardes déjà demandées sont terminées. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.waiting += 1;
    const result = this.tail.then(fn);
    const release = (): void => {
      this.waiting -= 1;
    };
    this.tail = result.then(release, release);
    return result;
  }

  start(): void {
    this.stopped = false;
    const { plans, logger } = this.options;
    try {
      const interrupted = plans.interruptRunning(this.now().toISOString());
      if (interrupted > 0)
        logger.info({ interrupted }, 'exécutions interrompues par un redémarrage');
    } catch (err) {
      logger.error({ code: errorCode(err) }, 'reprise des exécutions interrompues en échec');
    }
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.tickMs ?? 30_000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.ticking;
    await Promise.all([...this.background]);
  }

  /** Un passage ; ignoré si le précédent n'est pas fini. Ne rejette jamais. */
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.ticking ??= this.pass().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }

  private async pass(): Promise<void> {
    const { plans, logger } = this.options;
    try {
      const now = this.now();
      const current = plans.list();
      const ids = new Set(current.map((p) => p.id));
      for (const id of this.settledSlot.keys()) if (!ids.has(id)) this.settledSlot.delete(id);
      for (const plan of current) {
        if (this.stopped) return;
        // Plan de nuit : rien en journée, ni création ni redémarrage (ADR 0017, pas de rattrapage).
        const night = isNightPlan(plan.rpoHours);
        const windowStart = night ? nightWindowStart(now) : null;
        if (night && !windowStart) continue;
        const slotAt = currentRunSlot(plan, now);
        // Le dernier créneau d'une nuit passée n'est pas rattrapé à l'ouverture de la fenêtre.
        if (windowStart && slotAt < windowStart) continue;
        const slot = slotAt.toISOString();
        // Le second passage de la nuit ne reprend que les éléments sans réussite depuis le premier.
        const successSince = new Date(
          new Date(slot).getTime() - NIGHT_SLOT_GAP * 60_000,
        ).toISOString();
        // Lister les boîtes interroge le stockage : on ne le refait pas pour un créneau déjà traité.
        // Une boîte apparue en cours de créneau est donc prise au créneau suivant.
        const memo = plan.scope === 'all';
        if (memo && this.settledSlot.get(plan.id) === slot) continue;
        let items: string[];
        try {
          items = await this.options.listItems(plan);
        } catch (err) {
          logger.error({ planId: plan.id, code: errorCode(err) }, 'éléments du plan illisibles');
          continue;
        }
        let settled = true;
        for (const itemId of items) {
          if (this.stopped) return;
          const due = (): boolean =>
            !plans.hasRunSince(plan.id, itemId, slot) &&
            !(night && plans.hasSuccessSince(plan.id, itemId, successSince));
          if (!due()) continue;
          const opened = await this.exclusive(async () => {
            // Revérifié à son tour : un lancement manuel a pu sauvegarder l'élément entre-temps.
            if (this.stopped) return false;
            if (!due()) return true;
            const runId = plans.startRun(plan.id, itemId, this.now().toISOString());
            if (runId === undefined) return false;
            await this.execute(plan, itemId, runId);
            return true;
          });
          if (!opened) settled = false;
        }
        if (memo && settled) this.settledSlot.set(plan.id, slot);
      }
    } catch (err) {
      logger.error({ code: errorCode(err) }, 'passage du planificateur en échec');
    }
  }

  /**
   * Lancement immédiat de tous les éléments du plan, l'un après l'autre, en arrière-plan. Si une
   * sauvegarde est déjà en cours (passage du planificateur ou autre lancement), le lancement est mis
   * en file : rien n'est ouvert en base avant son tour, donc il ne compte ni comme échec ni comme
   * exécution en cours. Sinon les exécutions sont ouvertes avant le retour.
   */
  async runNow(plan: StoredPlan): Promise<ManualRunResult> {
    const items = await this.options.listItems(plan);
    if (items.length === 0) {
      return { started: 0, skipped: 0, queued: false, done: Promise.resolve() };
    }
    // Déjà en file : une seconde demande ne ferait que sauvegarder le plan deux fois de suite.
    if (this.isQueued(plan.id)) {
      return { started: 0, skipped: 0, queued: true, done: Promise.resolve() };
    }
    const queued = this.waiting > 0;
    const opened: { itemId: string; runId: number }[] = [];
    const open = (): void => {
      const startedAt = this.now().toISOString();
      try {
        for (const itemId of items) {
          const runId = this.options.plans.startRun(plan.id, itemId, startedAt);
          if (runId !== undefined) opened.push({ itemId, runId });
        }
      } catch (err) {
        // Ne laisse aucune exécution ouverte sans suite : elle bloquerait son élément.
        this.closeInterrupted(opened, errorCode(err));
        opened.length = 0;
        throw err;
      }
    };
    if (queued) this.queuedPlans.set(plan.id, (this.queuedPlans.get(plan.id) ?? 0) + 1);
    // Prend sa place dans la file avant tout `await` : un passage qui suit attend ce lancement.
    const job: Promise<void> = this.exclusive(async () => {
      if (queued) {
        const left = (this.queuedPlans.get(plan.id) ?? 1) - 1;
        if (left > 0) this.queuedPlans.set(plan.id, left);
        else this.queuedPlans.delete(plan.id);
        if (this.stopped) return;
        open();
      }
      for (const run of opened) {
        if (this.stopped) this.closeInterrupted([run], 'interrupted');
        else await this.execute(plan, run.itemId, run.runId);
      }
    })
      .catch((err: unknown) => {
        this.options.logger.error({ code: errorCode(err) }, 'lancement manuel en échec');
      })
      .finally(() => this.background.delete(job));
    this.background.add(job);
    if (queued) return { started: 0, skipped: 0, queued: true, done: job };
    // Libre : les exécutions sont ouvertes tout de suite, la file ne fait que les enchaîner.
    open();
    return {
      started: opened.length,
      skipped: items.length - opened.length,
      queued: false,
      done: job,
    };
  }

  private closeInterrupted(runs: { runId: number }[], code: string): void {
    for (const { runId } of runs) {
      try {
        this.options.plans.finishRun(runId, 'failed', this.now().toISOString(), code);
      } catch (err) {
        // `done` ne rejette jamais : la base peut déjà être fermée à l'arrêt.
        this.options.logger.error({ runId, code: errorCode(err) }, 'clôture interrompue en échec');
      }
    }
  }

  private async execute(plan: StoredPlan, itemId: string, runId: number): Promise<void> {
    const { plans, executeur, logger } = this.options;
    const planId = plan.id;
    try {
      const result = await executeur.execute({ planId, itemId, dataTypes: plan.dataTypes });
      plans.finishRun(
        runId,
        'success',
        this.now().toISOString(),
        undefined,
        result?.noSnapshotReason,
      );
      logger.info({ planId, itemId, runId }, 'exécution terminée');
    } catch (err) {
      const code = errorCode(err);
      try {
        plans.finishRun(runId, 'failed', this.now().toISOString(), code);
      } catch (inner) {
        logger.error({ planId, runId, code: errorCode(inner) }, 'clôture de l’exécution en échec');
      }
      logger.error({ planId, itemId, runId, code }, 'exécution en échec');
    }
  }
}
