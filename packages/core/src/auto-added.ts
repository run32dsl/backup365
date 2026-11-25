import { currentRunSlot, type PlanRun, type RpoHours } from './protection-plan.js';
import type { StatusRow } from './status.js';

/**
 * Éléments qu'un plan a pris d'office à sa dernière exécution parce qu'ils sont apparus dans le
 * tenant après lui (charge « tout le tenant », issue #545). Page « Sources ».
 */
export interface AutoAddedEntry {
  planId: string;
  plan: string;
  /** Début de l'exécution qui les a pris (UTC, ISO 8601). */
  at: string;
  /** `name` : nom connu du catalogue ; `null` tant qu'aucune sauvegarde ne le donne. */
  items: { id: string; name: string | null }[];
}

type RunFacts = Pick<PlanRun, 'startedAt'> & { itemId: string; autoAdded: boolean };

/**
 * La dernière exécution d'un plan est le créneau de son exécution la plus récente : les
 * éléments s'y succèdent l'un après l'autre. Un plan dont la dernière exécution n'a rien ajouté
 * n'apparaît pas. Les noms viennent des lignes du catalogue (aucun nom n'est conservé à part).
 */
export function autoAddedAtLastRun(
  plans: readonly { id: string; name: string; rpoHours: RpoHours }[],
  runsOf: (planId: string) => readonly RunFacts[],
  rows: readonly Pick<StatusRow, 'sourceId' | 'displayName'>[],
): AutoAddedEntry[] {
  const names = new Map(rows.map((r) => [r.sourceId, r.displayName] as const));
  return plans.flatMap((plan) => {
    const runs = runsOf(plan.id).filter((r) => !Number.isNaN(Date.parse(r.startedAt)));
    const latest = Math.max(...runs.map((r) => Date.parse(r.startedAt)));
    if (!Number.isFinite(latest)) return [];
    const since = currentRunSlot(plan, new Date(latest)).getTime();
    const added = runs.filter((r) => r.autoAdded && Date.parse(r.startedAt) >= since);
    if (added.length === 0) return [];
    const ids = [...new Set(added.map((r) => r.itemId))];
    const at = Math.min(...added.map((r) => Date.parse(r.startedAt)));
    return [
      {
        planId: plan.id,
        plan: plan.name,
        at: new Date(at).toISOString(),
        items: ids.map((id) => ({ id, name: names.get(id) ?? null })),
      },
    ];
  });
}
