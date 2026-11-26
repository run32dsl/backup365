const DAY_MS = 86_400_000;

/** Ce qui dépasse la durée de conservation d'un plan. Simulation : rien n'est supprimé. */
export interface RetentionExcess {
  /** Instantanés antérieurs à cette date (UTC, ISO 8601) : ils dépassent la durée. */
  cutoff: string;
  /** Nombre d'instantanés au-delà de la durée. */
  snapshots: number;
  /** Éléments (boîtes, sites) qui ont au moins un instantané au-delà de la durée. */
  items: number;
  /** Somme des tailles logiques de ces instantanés, en octets. */
  bytes: number;
  /** Date du plus ancien d'entre eux, `null` s'il n'y en a aucun. */
  oldestAt: string | null;
}

/**
 * Calcule ce qui dépasse `retentionDays` à l'instant `now` : un instantané dépasse la durée s'il
 * a été créé strictement avant `now − retentionDays`. Les instantanés sont groupés par élément
 * (boîte ou site) pour compter les éléments concernés. Une taille absente compte pour 0. Calcul
 * pur : aucune suppression, aucun accès au stockage.
 */
export function retentionExcess(
  retentionDays: number,
  byItem: ReadonlyMap<string, readonly { createdAt: string; sizeBytes?: number }[]>,
  now: Date,
): RetentionExcess {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  let snapshots = 0;
  let items = 0;
  let bytes = 0;
  let oldestAt: string | null = null;
  for (const list of byItem.values()) {
    const over = list.filter((s) => s.createdAt < cutoff);
    if (over.length === 0) continue;
    items += 1;
    for (const s of over) {
      snapshots += 1;
      bytes += s.sizeBytes ?? 0;
      if (oldestAt === null || s.createdAt < oldestAt) oldestAt = s.createdAt;
    }
  }
  return { cutoff, snapshots, items, bytes, oldestAt };
}
