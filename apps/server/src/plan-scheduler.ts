import { nextRunAt, runIntervalMinutes } from '@backup365/core';
import type { SqlitePlanStore, StoredPlan } from './sqlite/sqlite-plan-store.js';

/** Ce que le planificateur demande à l'exécuteur : un plan sur un élément, rien d'autre. */
export interface ExecutionTarget {
  planId: string;
  itemId: string;
}

/**
 * Exécute une sauvegarde. Une promesse rejetée marque l'exécution en échec ; seul un code
 * technique est conservé (jamais le message, qui pourrait citer un contenu ou un secret).
 */
export interface Executeur {
  execute(target: ExecutionTarget): Promise<void>;
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
  private readonly now: () => Date;

  constructor(private readonly options: SchedulerOptions) {
    this.now = options.now ?? (() => new Date());
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
      for (const plan of plans.list()) {
        if (this.stopped) return;
        // Les créneaux forment une suite arithmétique : le dernier est le prochain moins un intervalle.
        const slot = new Date(
          nextRunAt(plan, now).getTime() - runIntervalMinutes(plan.rpoHours) * 60_000,
        ).toISOString();
        let items: string[];
        try {
          items = await this.options.listItems(plan);
        } catch (err) {
          logger.error({ planId: plan.id, code: errorCode(err) }, 'éléments du plan illisibles');
          continue;
        }
        for (const itemId of items) {
          if (this.stopped) return;
          if (plans.hasRunSince(plan.id, itemId, slot)) continue;
          const runId = plans.startRun(plan.id, itemId, now.toISOString());
          if (runId !== undefined) await this.execute(plan.id, itemId, runId);
        }
      }
    } catch (err) {
      logger.error({ code: errorCode(err) }, 'passage du planificateur en échec');
    }
  }

  /**
   * Lancement immédiat de tous les éléments du plan. Les exécutions sont ouvertes avant le retour ;
   * elles s'exécutent ensuite en arrière-plan, l'une après l'autre.
   */
  async runNow(plan: StoredPlan): Promise<ManualRunResult> {
    const { plans } = this.options;
    const items = await this.options.listItems(plan);
    const opened: { itemId: string; runId: number }[] = [];
    const startedAt = this.now().toISOString();
    try {
      for (const itemId of items) {
        const runId = plans.startRun(plan.id, itemId, startedAt);
        if (runId !== undefined) opened.push({ itemId, runId });
      }
    } catch (err) {
      // Ne laisse aucune exécution ouverte sans suite : elle bloquerait son élément.
      for (const { runId } of opened) {
        plans.finishRun(runId, 'failed', this.now().toISOString(), errorCode(err));
      }
      throw err;
    }
    const job = (async () => {
      for (const { itemId, runId } of opened) {
        if (this.stopped) {
          plans.finishRun(runId, 'failed', this.now().toISOString(), 'interrupted');
          continue;
        }
        await this.execute(plan.id, itemId, runId);
      }
    })().finally(() => this.background.delete(job));
    this.background.add(job);
    return { started: opened.length, skipped: items.length - opened.length, done: job };
  }

  private async execute(planId: string, itemId: string, runId: number): Promise<void> {
    const { plans, executeur, logger } = this.options;
    try {
      await executeur.execute({ planId, itemId });
      plans.finishRun(runId, 'success', this.now().toISOString());
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
