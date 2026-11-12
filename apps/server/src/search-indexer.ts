import {
  indexMailbox,
  type BackupCatalog,
  type SearchIndex,
  type SnapshotMailReader,
} from '@backup365/core';

export interface IndexerStatus {
  /** Fin du dernier cycle terminé sans erreur (ISO 8601) ; `null` tant qu'aucun n'a réussi. */
  lastSuccessAt: string | null;
  /** Début du dernier cycle (ISO 8601) ; `null` avant le premier. */
  lastRunAt: string | null;
  /** Le dernier cycle a échoué (le détail est dans le journal, sans contenu). */
  lastRunFailed: boolean;
}

export interface IndexerLogger {
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface IndexerOptions {
  catalog: BackupCatalog;
  reader: SnapshotMailReader;
  index: SearchIndex;
  intervalMs: number;
  logger: IndexerLogger;
}

/**
 * Indexation en arrière-plan : un cycle au démarrage puis un par intervalle. Chaque boîte est
 * indexée de façon incrémentale (`indexMailbox`) ; un échec est journalisé (nom et code de
 * l'erreur seulement, jamais de contenu) et l'instantané fautif est retenté au cycle suivant.
 * Jamais deux cycles à la fois.
 */
export class SearchIndexer {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  private state: IndexerStatus = { lastSuccessAt: null, lastRunAt: null, lastRunFailed: false };

  constructor(private readonly options: IndexerOptions) {}

  status(): IndexerStatus {
    return { ...this.state };
  }

  /** Lance le premier cycle sans l'attendre, puis planifie les suivants. */
  start(): void {
    this.stopped = false;
    void this.runCycle();
    this.timer = setInterval(() => void this.runCycle(), this.options.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /** Un cycle ; ignoré si le précédent n'est pas fini. Ne rejette jamais. */
  runCycle(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.running ??= this.cycle().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async cycle(): Promise<void> {
    const { catalog, reader, index, logger } = this.options;
    this.state.lastRunAt = new Date().toISOString();
    let failed = false;
    try {
      for (const mailbox of await catalog.listMailboxes()) {
        if (this.stopped) return;
        try {
          await indexMailbox({ catalog, reader, index }, mailbox.id);
        } catch (err) {
          // Une boîte en échec ne bloque pas les autres.
          failed = true;
          logger.error(
            describe(err),
            "indexation d'une boîte en échec, nouvel essai au prochain cycle",
          );
        }
      }
    } catch (err) {
      failed = true;
      logger.error(describe(err), 'indexation impossible, nouvel essai au prochain cycle');
    }
    this.state.lastRunFailed = failed;
    if (!failed) this.state.lastSuccessAt = new Date().toISOString();
  }
}

/** Nom et code seulement : le message peut citer un objet, un chemin ou un contenu. */
function describe(err: unknown): Record<string, unknown> {
  const { name, code } = (err ?? {}) as { name?: unknown; code?: unknown };
  return {
    name: typeof name === 'string' ? name : undefined,
    code: typeof code === 'string' ? code : undefined,
  };
}
