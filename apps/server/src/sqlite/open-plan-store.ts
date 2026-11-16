import { SqlitePlanStore } from './sqlite-plan-store.js';

export type OpenedPlanStore =
  { store: SqlitePlanStore; error?: undefined } | { store?: undefined; error: Error };

/** Ouvre la base des plans sans jamais lever : si elle est inutilisable, `/api/plans` répond 503. */
export function tryOpenPlanStore(path: string): OpenedPlanStore {
  try {
    return { store: SqlitePlanStore.open(path) };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}
