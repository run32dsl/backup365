import type { ConditionalWrites } from '@backup365/core';

/**
 * Sous-ensemble de `AtlasInstance.checkStorage()` (SDK 7.3.0) lu par la console : le seul résultat
 * de la sonde d'écritures conditionnelles. Interroge S3 seulement, jamais Graph ; la sonde écrit
 * puis supprime un objet jetable dans le bucket.
 */
export interface AtlasStorageChecker {
  checkStorage(): Promise<{ conditionalWrites: { support: string } }>;
}

/** Durée de validité d'un résultat : 1 h. La sonde écrit dans le bucket, elle n'est pas rejouée à chaque page. */
export const STORAGE_CHECK_TTL_MS = 3_600_000;
/** Durée pendant laquelle un échec est gardé : 5 min, pour ne pas sonder à chaque chargement. */
export const STORAGE_CHECK_FAILURE_TTL_MS = 300_000;
/** Délai maximal d'une sonde : au-delà, la page Sources est servie avec un résultat inconnu. */
export const STORAGE_CHECK_TIMEOUT_MS = 10_000;

export interface StorageCheckOptions {
  ttlMs?: number;
  failureTtlMs?: number;
  timeoutMs?: number;
  /** Horloge, injectable pour les tests. */
  now?: () => number;
}

const SUPPORT: readonly ConditionalWrites[] = ['supported', 'ignored', 'not_probed'];

/**
 * Le stockage refuse-t-il les écritures conditionnelles dont dépend le bail par propriétaire du
 * SDK (docs/adr/0019 ; en 7.3.0, Atlas refuse d'écrire sinon) ? Résultat gardé `ttlMs`, échec (`null`) gardé `failureTtlMs` ; les
 * appels simultanés partagent la même sonde, bornée à `timeoutMs`. Seule la valeur de `support`
 * est retenue : le détail du SDK peut citer le bucket.
 */
export class StorageCheck {
  private cached: { value: Promise<ConditionalWrites | null>; expiresAt: number } | undefined;
  private readonly ttlMs: number;
  private readonly failureTtlMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly checker: AtlasStorageChecker,
    options: StorageCheckOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? STORAGE_CHECK_TTL_MS;
    this.failureTtlMs = options.failureTtlMs ?? STORAGE_CHECK_FAILURE_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? STORAGE_CHECK_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  conditionalWrites(): Promise<ConditionalWrites | null> {
    if (this.cached && this.now() < this.cached.expiresAt) return this.cached.value;
    const entry = { value: this.probe(), expiresAt: Number.POSITIVE_INFINITY };
    this.cached = entry;
    void entry.value.then((value) => {
      entry.expiresAt = this.now() + (value === null ? this.failureTtlMs : this.ttlMs);
    });
    return entry.value;
  }

  private async probe(): Promise<ConditionalWrites | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.timeoutMs);
    });
    try {
      const support = this.checker
        .checkStorage()
        .then((result) => SUPPORT.find((s) => s === result.conditionalWrites.support) ?? null);
      return await Promise.race([support.catch(() => null), timeout]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
