import { SqliteAccountStore } from './sqlite-account-store.js';

export type OpenedAccountStore =
  { store: SqliteAccountStore; error?: undefined } | { store?: undefined; error: Error };

/**
 * Ouvre la base des comptes sans jamais lever : si elle est inutilisable, le serveur démarre
 * quand même mais toute l'API hors santé répond 503 (jamais d'accès sans authentification).
 */
export function tryOpenAccountStore(path: string): OpenedAccountStore {
  try {
    return { store: SqliteAccountStore.open(path) };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}
